struct Uniforms {
    width_hi: f32, width_lo: f32, height_hi: f32, height_lo: f32,
    x_min_hi: f32, x_min_lo: f32, x_max_hi: f32, x_max_lo: f32,
    y_min_hi: f32, y_min_lo: f32, y_max_hi: f32, y_max_lo: f32,
    max_iter: u32,
    precision_mode: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;

// --- Emulated Double Precision (DS) Library ---

struct DS {
    hi: f32,
    lo: f32,
};

fn ds_set(a: f32) -> DS {
    return DS(a, 0.0);
}

fn ds_add(a: DS, b: DS) -> DS {
    let t1 = a.hi + b.hi;
    let e = t1 - a.hi;
    let t2 = ((b.hi - e) + (a.hi - (t1 - e))) + a.lo + b.lo;
    let hi = t1 + t2;
    let lo = t2 - (hi - t1);
    return DS(hi, lo);
}

fn ds_sub(a: DS, b: DS) -> DS {
    return ds_add(a, DS(-b.hi, -b.lo)); // Simple negation
}

fn ds_mul(a: DS, b: DS) -> DS {
    // Split a.hi and b.hi into high/low parts for accurate multiplication
    // For f32 (24 bit mantissa), split at 12 bits: C = 2^12 + 1 = 4097.0
    let C = 4097.0;
    
    let cona = a.hi * C;
    let a_hi = cona - (cona - a.hi);
    let a_lo = a.hi - a_hi;
    
    let conb = b.hi * C;
    let b_hi = conb - (conb - b.hi);
    let b_lo = b.hi - b_hi;
    
    let prod = a.hi * b.hi;
    let err = (a_hi * b_hi - prod) + a_hi * b_lo + a_lo * b_hi + a.lo * b.hi + a.hi * b.lo;
    
    let hi = prod + err;
    let lo = err - (hi - prod);
    return DS(hi, lo);
}

fn ds_sqr(a: DS) -> DS {
     let C = 4097.0;
     let cona = a.hi * C;
     let a_hi = cona - (cona - a.hi);
     let a_lo = a.hi - a_hi;
     
     let prod = a.hi * a.hi;
     let err = (a_hi * a_hi - prod) + 2.0 * a_hi * a_lo + 2.0 * a.lo * a.hi; 
     let hi = prod + err;
     let lo = err - (hi - prod);
     return DS(hi, lo);
}

fn ds_mag_sq(a: DS) -> f32 {
    return a.hi * a.hi; // Sufficient for bounds check
}

fn ds_create(hi: f32, lo: f32) -> DS {
    return DS(hi, lo);
}

// --- Iterators ---

fn iterate_f32(cx: f32, cy: f32, max_iter: u32) -> f32 {
    var zx = 0.0;
    var zy = 0.0;
    var zx2 = 0.0;
    var zy2 = 0.0;
    var iter = 0u;
    
    while (zx2 + zy2 < 4.0 && iter < max_iter) {
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        zx2 = zx * zx;
        zy2 = zy * zy;
        iter = iter + 1u;
    }
    
    if (iter >= max_iter) { return 1.0; }
    return f32(iter) / f32(max_iter);
}

fn iterate_ds(cx: DS, cy: DS, max_iter: u32) -> f32 {
    var zx = DS(0.0, 0.0);
    var zy = DS(0.0, 0.0);
    var iter = 0u;
    
    // z*z + c
    // (x+iy)^2 + c = (x^2 - y^2) + i(2xy) + c
    
    while (ds_mag_sq(zx) + ds_mag_sq(zy) < 4.0 && iter < max_iter) {
        let zx2 = ds_sqr(zx);
        let zy2 = ds_sqr(zy);
        let two_zx_zy = ds_mul(ds_mul(zx, zy), DS(2.0, 0.0));
        
        zy = ds_add(two_zx_zy, cy);
        zx = ds_add(ds_sub(zx2, zy2), cx);
        
        iter = iter + 1u;
    }
    
    if (iter >= max_iter) { return 1.0; }
    return f32(iter) / f32(max_iter);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    // Use hi/lo width to construct f64 width
    // Just using hi part for bounds check is fine
    if (x >= u32(uniforms.width_hi) || y >= u32(uniforms.height_hi)) {
        return;
    }

    let width_f = uniforms.width_hi; // Use f32 scalar for division logic, precision loss here is minimal for screenspace
    let height_f = uniforms.height_hi;

    // SSAA Loop (2x2)
    var total_val = 0.0;
    let offsets = array<vec2<f32>, 4>(
        vec2<f32>(0.25, 0.25),
        vec2<f32>(0.75, 0.25),
        vec2<f32>(0.25, 0.75),
        vec2<f32>(0.75, 0.75)
    );

    // Reconstruct DS constants
    let x_min = DS(uniforms.x_min_hi, uniforms.x_min_lo);
    let x_max = DS(uniforms.x_max_hi, uniforms.x_max_lo);
    let y_min = DS(uniforms.y_min_hi, uniforms.y_min_lo);
    let y_max = DS(uniforms.y_max_hi, uniforms.y_max_lo);
    
    let x_range = ds_sub(x_max, x_min);
    let y_range = ds_sub(y_max, y_min);

    for (var i = 0; i < 4; i++) {
        let sample_x = f32(x) + offsets[i].x;
        let sample_y = f32(y) + offsets[i].y;
        
        // Ratio is simple f32 (0.0 to 1.0)
        // We construct DS from this ratio? 
        // No, (sample_x / width_f) is f32. Convert to DS.
        let rx = DS(sample_x / width_f, 0.0);
        let ry = DS(sample_y / height_f, 0.0);
        
        // cx = x_min + ratio * x_range
        let cx = ds_add(x_min, ds_mul(rx, x_range));
        let cy = ds_add(y_min, ds_mul(ry, y_range));

        var val = 0.0;
        if (uniforms.precision_mode == 0u) {
            // Fast Path: f32
            let cx_f = cx.hi + cx.lo;
            let cy_f = cy.hi + cy.lo;
            val = iterate_f32(cx_f, cy_f, uniforms.max_iter);
        } else {
            // High Precision: DS
            val = iterate_ds(cx, cy, uniforms.max_iter);
        }
        total_val = total_val + val;
    }
    
    let avg = total_val / 4.0;
    
    // Output color
    var color = vec4<f32>(avg, avg, avg, 1.0);
    if (avg >= 1.0) { color = vec4<f32>(0.0, 0.0, 0.0, 1.0); } // Black inside
    
    textureStore(output_texture, vec2<i32>(i32(x), i32(y)), color);
}

// Blit Shader (Unchanged)
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    let pos = positions[vertex_index];
    out.uv = vec2<f32>((pos.x + 1.0) * 0.5, 1.0 - (pos.y + 1.0) * 0.5);
    return out;
}

@group(0) @binding(2) var input_texture: texture_2d<f32>;
@group(0) @binding(3) var input_sampler: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(input_texture, input_sampler, in.uv);
}
