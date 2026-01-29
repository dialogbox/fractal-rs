struct Uniforms {
    width_hi: f32, width_lo: f32, height_hi: f32, height_lo: f32,
    x_min_hi: f32, x_min_lo: f32, x_max_hi: f32, x_max_lo: f32,
    y_min_hi: f32, y_min_lo: f32, y_max_hi: f32, y_max_lo: f32,
    max_iter: u32,
    precision_mode: u32,
    step_size: u32,
    flags: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;

// --- DS Library (Emulated Double Precision) ---
struct DS {
    hi: f32,
    lo: f32,
};

fn ds_add(a: DS, b: DS) -> DS {
    let t1 = a.hi + b.hi;
    let e = t1 - a.hi;
    let t2 = ((b.hi - e) + (a.hi - (t1 - e))) + a.lo + b.lo;
    let hi = t1 + t2;
    let lo = t2 - (hi - t1);
    return DS(hi, lo);
}

fn ds_sub(a: DS, b: DS) -> DS {
    let t1 = a.hi - b.hi;
    let e = t1 - a.hi;
    let t2 = ((-b.hi - e) + (a.hi - (t1 - e))) + a.lo - b.lo;
    let hi = t1 + t2;
    let lo = t2 - (hi - t1);
    return DS(hi, lo);
}

fn ds_mul(a: DS, b: DS) -> DS {
    let C = 4097.0; // 2^12 + 1
    let cone = a.hi * C;
    let ctwo = b.hi * C;
    let a_hi = cone - (cone - a.hi);
    let a_lo = a.hi - a_hi;
    let b_hi = ctwo - (ctwo - b.hi);
    let b_lo = b.hi - b_hi;
    
    let t1 = a.hi * b.hi;
    let t2 = (((a_hi * b_hi - t1) + a_hi * b_lo) + a_lo * b_hi);
    let t3 = t2 + (a.hi * b.lo + a.lo * b.hi);
    
    let hi = t1 + t3;
    let lo = t3 - (hi - t1);
    return DS(hi, lo);
}

fn ds_sqr(a: DS) -> DS {
    let C = 4097.0; // 2^12 + 1
    let cone = a.hi * C;
    let a_hi = cone - (cone - a.hi);
    let a_lo = a.hi - a_hi;
    
    let t1 = a.hi * a.hi;
    let t2 = ((a_hi * a_hi - t1) + 2.0 * a_hi * a_lo);
    let t3 = t2 + (2.0 * a.hi * a.lo);
    
    let hi = t1 + t3;
    let lo = t3 - (hi - t1);
    return DS(hi, lo);
}

fn ds_mag_sq(a: DS) -> f32 {
    return a.hi * a.hi;
}

// --- Iteration Functions ---

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
    // Smooth coloring
    // let log_zn = log2(zx2 + zy2) * 0.5;
    // let nu = log2(log_zn / log2(2.0));
    // let res = f32(iter) + 1.0 - nu;
    return f32(iter) / f32(max_iter);
}

fn iterate_ds(cx: DS, cy: DS, max_iter: u32) -> f32 {
    var zx = DS(0.0, 0.0);
    var zy = DS(0.0, 0.0);
    var iter = 0u;
    
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
    let step = uniforms.step_size;
    let pixel_x = global_id.x * step;
    let pixel_y = global_id.y * step;
    
    if (pixel_x >= u32(uniforms.width_hi) || pixel_y >= u32(uniforms.height_hi)) {
        return;
    }

    // SKIP LOGIC: Reuse previous pixels
    if (uniforms.flags == 1u) {
        if ((global_id.x % 2u == 0u) && (global_id.y % 2u == 0u)) {
             return;
        }
    }

    let center_x = f32(pixel_x) + 0.5;
    let center_y = f32(pixel_y) + 0.5;
    let width_f = uniforms.width_hi;
    let height_f = uniforms.height_hi;

    var val = 0.0;

    if (uniforms.precision_mode == 0u) {
        // Fast f32 Path
        let x_min = uniforms.x_min_hi;
        let x_max = uniforms.x_max_hi;
        let y_min = uniforms.y_min_hi;
        let y_max = uniforms.y_max_hi;
        
        // Simple linear interpolation
        let rx = center_x / width_f;
        let ry = center_y / height_f;
        
        let cx = x_min + rx * (x_max - x_min);
        let cy = y_min + ry * (y_max - y_min);
        
        val = iterate_f32(cx, cy, uniforms.max_iter);

    } else {
        // High Precision DS Path
        let x_min = DS(uniforms.x_min_hi, uniforms.x_min_lo);
        let x_max = DS(uniforms.x_max_hi, uniforms.x_max_lo);
        let y_min = DS(uniforms.y_min_hi, uniforms.y_min_lo);
        let y_max = DS(uniforms.y_max_hi, uniforms.y_max_lo);
        
        // Range
        let x_range = ds_sub(x_max, x_min);
        let y_range = ds_sub(y_max, y_min);
        
        // Ratios (f32 is enough for screen coordinates)
        let rx = DS(center_x / width_f, 0.0);
        let ry = DS(center_y / height_f, 0.0);
        
        // Interpolate
        let cx = ds_add(x_min, ds_mul(rx, x_range));
        let cy = ds_add(y_min, ds_mul(ry, y_range));

        val = iterate_ds(cx, cy, uniforms.max_iter);
    }
    
    // Output color
    var color = vec4<f32>(val, val, val, 1.0);
    if (val >= 1.0) { color = vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    
    // Splat
    for (var dy = 0u; dy < step; dy = dy + 1u) {
         for (var dx = 0u; dx < step; dx = dx + 1u) {
              let target_x = pixel_x + dx;
              let target_y = pixel_y + dy;
              if (target_x < u32(uniforms.width_hi) && target_y < u32(uniforms.height_hi)) {
                  textureStore(output_texture, vec2<i32>(i32(target_x), i32(target_y)), color);
              }
         }
    }
}

// Blit Shader
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
