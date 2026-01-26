
use wgpu;
use futures;
use bytemuck;
use std::time::Duration;

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    width: f32,
    height: f32,
    x_min: f32,
    x_max: f32,
    y_min: f32,
    y_max: f32,
    max_iter: u32,
    padding: u32,
}

fn main() {
    futures::executor::block_on(run());
}

async fn run() {
    println!("Step 1: finding adapter...");
    let instance = wgpu::Instance::default();
    let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
    }).await.expect("Failed to find an appropriate adapter");

    let info = adapter.get_info();
    println!("Using adapter: {:?} ({:?})", info.name, info.backend);

    println!("Step 2: Requesting Device...");
    let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
        label: None,
        required_features: wgpu::Features::empty(),
        required_limits: wgpu::Limits::default(),
        memory_hints: Default::default(),
    }, None).await.expect("Failed to create device");

    println!("Step 3: Loading Shader...");
    // We assume the shader is in ../src/shader.wgsl relative to this example
    let shader_source = include_str!("../src/shader.wgsl");
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Compute Shader"),
        source: wgpu::ShaderSource::Wgsl(shader_source.into()),
    });

    let width = 64u32;
    let height = 64u32;
    let texture_size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };

    println!("Step 4: Creating Resources...");
    // Texture
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Output Texture"),
        size: texture_size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::TEXTURE_BINDING, // COPY_SRC is CRITICAL
        view_formats: &[],
    });
    let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());

    // Uniforms
    let uniforms = Uniforms {
        width: width as f32,
        height: height as f32,
        x_min: -2.0,
        x_max: 1.0,
        y_min: -1.5,
        y_max: 1.5,
        max_iter: 100,
        padding: 0,
    };
    let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Uniform Buffer"),
        contents: bytemuck::cast_slice(&[uniforms]),
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
    });

    // ---------------------------------------------------------
    // Split into Two Bind Groups to avoid usage conflict
    // ---------------------------------------------------------

    // 1. Compute Bind Group (Uniforms + Storage)
    let compute_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("Compute Layout"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                 ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::StorageTexture { access: wgpu::StorageTextureAccess::WriteOnly, format: wgpu::TextureFormat::Rgba8Unorm, view_dimension: wgpu::TextureViewDimension::D2 },
                count: None,
            },
        ],
    });

    let compute_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Compute Bind Group"),
        layout: &compute_bind_group_layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&texture_view) },
        ],
    });

    // 2. Render Bind Group (Not used in this test, but conceptually separate)
    // We only need Compute for the headless test.

    // Pipeline Layout verifying COMPUTE ONLY
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("Pipeline Layout"),
        bind_group_layouts: &[&compute_bind_group_layout], // Only Compute Layout
        push_constant_ranges: &[],
    });

    let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("Compute Pipeline"),
        layout: Some(&pipeline_layout),
        module: &shader,
        entry_point: Some("main"),
        compilation_options: Default::default(),
        cache: None,
    });

    println!("Step 5: Dispatching...");
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
    {
        let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor::default());
        cpass.set_pipeline(&compute_pipeline);
        cpass.set_bind_group(0, &compute_bind_group, &[]); // Bind dedicated group
        cpass.dispatch_workgroups(width / 8, height / 8, 1);
    }
    
    // Copy to Staging
    let unpadded_bytes_per_row = width * 4;
    let align = 256;
    let padding = (align - unpadded_bytes_per_row % align) % align;
    let padded_bytes_per_row = unpadded_bytes_per_row + padding;
    let size = (padded_bytes_per_row * height) as u64;

    let staging_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Staging Buffer"),
        size,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

     encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &staging_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            texture_size,
        );
    
    queue.submit(Some(encoder.finish()));

    println!("Step 6: Reading back...");
    let slice = staging_buffer.slice(..);
    let (tx, rx) = futures::channel::oneshot::channel();
    slice.map_async(wgpu::MapMode::Read, move |v| tx.send(v).unwrap());
    device.poll(wgpu::Maintain::Wait);
    rx.await.unwrap().unwrap();

    let data = slice.get_mapped_range();
    let vec_data = data.to_vec();
    
    println!("Data size: {}", vec_data.len());
    
    // Check first pixel
    let r = vec_data[0];
    let g = vec_data[1];
    let b = vec_data[2];
    let a = vec_data[3];
    
    println!("Pixel[0]: R={}, G={}, B={}, A={}", r, g, b, a);
    
    // Check if we have NON-Black pixels
    let non_zero = vec_data.iter().filter(|&&x| x > 0).count();
    println!("Non-zero bytes: {}", non_zero);
    
    if non_zero > 0 {
        println!("TEST PASSED: Output detected.");
    } else {
        println!("TEST FAILED: All black.");
    }
}
use wgpu::util::DeviceExt; // Import for create_buffer_init
