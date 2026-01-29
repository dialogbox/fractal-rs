struct Uniforms {
    width_hi: f32, width_lo: f32, height_hi: f32, height_lo: f32,
    x_min_hi: f32, x_min_lo: f32, x_max_hi: f32, x_max_lo: f32,
    y_min_hi: f32, y_min_lo: f32, y_max_hi: f32, y_max_lo: f32,
    max_iter: u32,
    precision_mode: u32,
    step_size: u32,
    flags: u32,
    color1: vec4<f32>,
    color2: vec4<f32>,
    bright_min: f32,
    bright_max: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;

// --- DS Library (Emulated Double Precision) ---
struct DS {
    hi: f32,
    lo: f32,
};

fn two_sum(a: f32, b: f32) -> vec2<f32> {
    let s = a + b;
    let v = s - a;
    let err = (a - (s - v)) + (b - v);
    return vec2<f32>(s, err);
}

fn ds_add(a: DS, b: DS) -> DS {
    let s = two_sum(a.hi, b.hi);
    let err = s.y + a.lo + b.lo;
    let res = two_sum(s.x, err);
    return DS(res.x, res.y);
}

fn ds_sub(a: DS, b: DS) -> DS {
    let s = two_sum(a.hi, -b.hi);
    let err = s.y + a.lo - b.lo;
    let res = two_sum(s.x, err);
    return DS(res.x, res.y);
}

fn two_prod(a: f32, b: f32) -> vec2<f32> {
    let p = a * b;
    let C = 4097.0;
    let t = a * C;
    let a_hi = t - (t - a);
    let a_lo = a - a_hi;
    let t2 = b * C;
    let b_hi = t2 - (t2 - b);
    let b_lo = b - b_hi;
    let err = ((a_hi * b_hi - p) + a_hi * b_lo + a_lo * b_hi) + a_lo * b_lo;
    return vec2<f32>(p, err);
}

fn ds_mul(a: DS, b: DS) -> DS {
    let p = two_prod(a.hi, b.hi);
    let err = p.y + a.hi * b.lo + a.lo * b.hi;
    let res = two_sum(p.x, err);
    return DS(res.x, res.y);
}

fn ds_sqr(a: DS) -> DS {
    let p = two_prod(a.hi, a.hi);
    let err = p.y + 2.0 * a.hi * a.lo;
    let res = two_sum(p.x, err);
    return DS(res.x, res.y);
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
    
    // Increased escape radius to 100.0 for smoother mu calculation at deep zooms
    while (zx2 + zy2 < 100.0 && iter < max_iter) {
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        zx2 = zx * zx;
        zy2 = zy * zy;
        iter = iter + 1u;
    }
    
    if (iter >= max_iter) { return 1.0; }
    
    // Smooth coloring: mu = iter + 1 - log(log(|Z|))/log(2)
    let dist = zx2 + zy2;
    let log_z = log2(dist) * 0.5;
    let nu = log2(log_z);
    
    let smooth_val = f32(iter) + 1.0 - nu;
    return smooth_val / f32(max_iter);
}

fn iterate_ds(cx: DS, cy: DS, max_iter: u32) -> f32 {
    var zx = DS(0.0, 0.0);
    var zy = DS(0.0, 0.0);
    var iter = 0u;
    
    while (ds_mag_sq(zx) + ds_mag_sq(zy) < 100.0 && iter < max_iter) {
        let zx2 = ds_sqr(zx);
        let zy2 = ds_sqr(zy);
        
        // zy = 2.0 * zx * zy + cy
        let zx_zy = ds_mul(zx, zy);
        let two_zx_zy = DS(zx_zy.hi * 2.0, zx_zy.lo * 2.0);
        zy = ds_add(two_zx_zy, cy);
        
        // zx = zx2 - zy2 + cx
        zx = ds_add(ds_sub(zx2, zy2), cx);
        
        iter = iter + 1u;
    }
    
    if (iter >= max_iter) { return 1.0; }
    
    let dist = ds_mag_sq(zx) + ds_mag_sq(zy);
    let log_z = log2(dist) * 0.5;
    let nu = log2(log_z);
    
    let smooth_val = f32(iter) + 1.0 - nu;
    return smooth_val / f32(max_iter);
}

fn getColor(t: f32) -> vec4<f32> {
    if (t >= 1.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    
    // Smooth cyclic palette between color1 and color2
    // Interpolate based on cosine wave for smoothness
    let freq = 1.0;
    let cos_val = cos(6.28318 * freq * t) * 0.5 + 0.5;
    
    let base_col = mix(uniforms.color1.rgb, uniforms.color2.rgb, cos_val);
    
    // Apply brightness/darkness scaling
    // We want the final brightness to be between bright_min and bright_max
    let final_col = uniforms.bright_min + base_col * (uniforms.bright_max - uniforms.bright_min);
    
    return vec4<f32>(final_col, 1.0);
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

    let width_f = uniforms.width_hi;
    let height_f = uniforms.height_hi;

    // --- 4x Jittered Anti-Aliasing ---
    // Instead of 1 sample at center, we take 4 samples in a rotated grid pattern
    // (0.375, 0.125), (0.875, 0.375), (0.125, 0.625), (0.625, 0.875)
    let jitter = array<vec2<f32>, 4>(
        vec2<f32>(0.375, 0.125),
        vec2<f32>(0.875, 0.375),
        vec2<f32>(0.125, 0.625),
        vec2<f32>(0.625, 0.875)
    );

    var avg_color = vec4<f32>(0.0);

    for (var s = 0u; s < 4u; s = s + 1u) {
        let sample_x = f32(pixel_x) + jitter[s].x;
        let sample_y = f32(pixel_y) + jitter[s].y;
        
        var val = 0.0;
        if (uniforms.precision_mode == 0u) {
            let rx = sample_x / width_f;
            let ry = sample_y / height_f;
            let cx = uniforms.x_min_hi + rx * (uniforms.x_max_hi - uniforms.x_min_hi);
            let cy = uniforms.y_min_hi + ry * (uniforms.y_max_hi - uniforms.y_min_hi);
            val = iterate_f32(cx, cy, uniforms.max_iter);
        } else {
            let x_min = DS(uniforms.x_min_hi, uniforms.x_min_lo);
            let x_max = DS(uniforms.x_max_hi, uniforms.x_max_lo);
            let y_min = DS(uniforms.y_min_hi, uniforms.y_min_lo);
            let y_max = DS(uniforms.y_max_hi, uniforms.y_max_lo);
            let rx = DS(sample_x / width_f, 0.0);
            let ry = DS(sample_y / height_f, 0.0);
            let cx = ds_add(x_min, ds_mul(rx, ds_sub(x_max, x_min)));
            let cy = ds_add(y_min, ds_mul(ry, ds_sub(y_max, y_min)));
            val = iterate_ds(cx, cy, uniforms.max_iter);
        }
        avg_color = avg_color + getColor(val);
    }
    
    let color = avg_color / 4.0;
    
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
