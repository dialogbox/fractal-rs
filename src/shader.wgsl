struct Uniforms {
    width: f32,
    height: f32,
    x_min: f32,
    x_max: f32,
    y_min: f32,
    y_max: f32,
    max_iter: u32,
    padding: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    if (x >= u32(uniforms.width) || y >= u32(uniforms.height)) {
        return;
    }

    let width_f = uniforms.width;
    let height_f = uniforms.height;

    // SSAA Loop (2x2)
    var total_color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    // Offsets: -0.25 and +0.25 from center (0.5).
    // So relative to x (integer), points are x+0.25 and x+0.75.
    let offsets = array<vec2<f32>, 4>(
        vec2<f32>(0.25, 0.25),
        vec2<f32>(0.75, 0.25),
        vec2<f32>(0.25, 0.75),
        vec2<f32>(0.75, 0.75)
    );

    for (var i = 0; i < 4; i++) {
        let sample_x = f32(x) + offsets[i].x;
        let sample_y = f32(y) + offsets[i].y;

        let cx = uniforms.x_min + (sample_x / width_f) * (uniforms.x_max - uniforms.x_min);
        let cy = uniforms.y_min + (sample_y / height_f) * (uniforms.y_max - uniforms.y_min);

        var zx = 0.0;
        var zy = 0.0;
        var iter = 0u;

        while (zx * zx + zy * zy < 4.0 && iter < uniforms.max_iter) {
            let temp = zx * zx - zy * zy + cx;
            zy = 2.0 * zx * zy + cy;
            zx = temp;
            iter = iter + 1u;
        }
        
        var sample_val = 0.0;
        if (iter < uniforms.max_iter) {
             sample_val = f32(iter) / f32(uniforms.max_iter);
        }
        // Accumulate (Greyscale for now, but keeping vec4 structure if we want color later)
        total_color = total_color + vec4<f32>(sample_val, sample_val, sample_val, 1.0);
    }
    
    // Average
    let avg_color = total_color / 4.0;
    
    // Ensure alpha is 1.0
    let final_color = vec4<f32>(avg_color.rgb, 1.0);

    textureStore(output_texture, vec2<i32>(i32(x), i32(y)), final_color);
}

// Blit Shader for Render Pipeline

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    // Fullscreen triangle
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0)
    );
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),  // Invert Y for texture sampling? Wgpu/Vulkan usually 0,0 top-left? 
        // WGSL texture sample: 0,0 is usually top-left or bottom-left depending on API.
        // WebGPU NDC: Y up. Texture Sample: 0,0 top-left (usually).
        // Let's assume 0,0 is top-left.
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0) 
    );
    // Let's use standard quad logic to be safe or just standard triangle. 
    // Normalized coords (-1 to 1).
    // UVs (0 to 1).
    // If Y is up in NDC (-1 bottom, 1 top).
    // If Texture 0 is top.
    
    // Position 0 (-1,-1): Bottom-Left. UV (0, 1) -> Bottom-Left of Texture? 
    // Wait, texture coords y=0 is top. y=1 is bottom.
    // So (-1, -1) bottom-left screen corresponds to (0, 1) bottom-left texture. Correct.
    
    var out: VertexOutput;
    out.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    
    // UVs mapping
    // (-1, -1) -> (0, 1)
    // ( 3, -1) -> (2, 1)
    // (-1,  3) -> (0, -1)
    // Interpolation should work.
    
    // Hardcode UVs based on vertices
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
