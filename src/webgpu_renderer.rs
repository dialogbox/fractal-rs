#[cfg(target_arch = "wasm32")]
use wgpu::util::DeviceExt;
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use std::borrow::Cow;
use crate::console;

#[wasm_bindgen]
pub struct RenderParams {
    pub x_min: f64,
    pub x_max: f64,
    pub y_min: f64,
    pub y_max: f64,
    pub max_iter: u32,
    pub step: u32,
    pub reuse: bool,
    pub color1_r: f32, pub color1_g: f32, pub color1_b: f32,
    pub color2_r: f32, pub color2_g: f32, pub color2_b: f32,
    pub bright_min: f32,
    pub bright_max: f32,
}

#[wasm_bindgen]
impl RenderParams {
    #[wasm_bindgen(constructor)]
    pub fn new(
        x_min: f64, x_max: f64, y_min: f64, y_max: f64, 
        max_iter: u32, step: u32, reuse: bool,
        color1_r: f32, color1_g: f32, color1_b: f32,
        color2_r: f32, color2_g: f32, color2_b: f32,
        bright_min: f32, bright_max: f32
    ) -> RenderParams {
        RenderParams { 
            x_min, x_max, y_min, y_max, max_iter, step, reuse,
            color1_r, color1_g, color1_b,
            color2_r, color2_g, color2_b,
            bright_min, bright_max
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    width_hi: f32, width_lo: f32, height_hi: f32, height_lo: f32,
    x_min_hi: f32, x_min_lo: f32, x_max_hi: f32, x_max_lo: f32,
    y_min_hi: f32, y_min_lo: f32, y_max_hi: f32, y_max_lo: f32,
    max_iter: u32,
    precision_mode: u32,
    step_size: u32,
    flags: u32,
    color1: [f32; 4],
    color2: [f32; 4],
    bright_min: f32,
    bright_max: f32,
    _pad: [f32; 2],
}

fn split_f64(v: f64) -> (f32, f32) {
    let hi = v as f32;
    let lo = (v - hi as f64) as f32;
    (hi, lo)
}

#[wasm_bindgen]
pub struct GpuRenderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    compute_pipeline: wgpu::ComputePipeline,
    render_pipeline: wgpu::RenderPipeline,
    compute_bind_group: wgpu::BindGroup,
    render_bind_group: wgpu::BindGroup,
    compute_bind_group_layout: wgpu::BindGroupLayout,
    render_bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    texture: wgpu::Texture,
    sampler: wgpu::Sampler,
    width: u32,
    height: u32,
    config: wgpu::SurfaceConfiguration,
}

#[wasm_bindgen]
impl GpuRenderer {
    #[cfg(target_arch = "wasm32")]
    pub async fn new(canvas: web_sys::HtmlCanvasElement) -> Result<GpuRenderer, JsValue> {
        web_sys::console::log_1(&"Rust: Creating WGPU Instance...".into());
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });
        
        let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&format!("Failed to create surface: {}", e)))?;

        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }).await.ok_or("Failed to find a WebGPU adapter")?;

        let mut limits = adapter.limits();
        if limits.max_storage_textures_per_shader_stage < 1 {
             limits.max_storage_textures_per_shader_stage = 1;
        }

        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: None,
            required_features: wgpu::Features::empty(),
            required_limits: limits,
            memory_hints: Default::default(),
        }, None).await.map_err(|e| JsValue::from_str(&e.to_string()))?;

        let width = 100;
        let height = 100;

        let texture_size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Output Texture"),
            size: texture_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC, 
            view_formats: &[],
        });

        let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Mandelbrot Shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(include_str!("shader.wgsl"))),
        });

        let uniforms = Uniforms {
             width_hi: width as f32, width_lo: 0.0,
             height_hi: height as f32, height_lo: 0.0,
             x_min_hi: -2.0, x_min_lo: 0.0,
             x_max_hi: 1.0, x_max_lo: 0.0,
             y_min_hi: -1.0, y_min_lo: 0.0,
             y_max_hi: 1.0, y_max_lo: 0.0,
             max_iter: 100,
             precision_mode: 0,
             step_size: 1,
             flags: 0,
             color1: [0.6118, 0.6745, 0.7294, 1.0], // #9cacba
             color2: [0.0627, 0.2863, 0.6745, 1.0], // #1049ac
             bright_min: 0.0,
             bright_max: 0.8,
             _pad: [0.0, 0.0],
         };

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Uniform Buffer"),
            contents: bytemuck::cast_slice(&[uniforms]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

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

        let render_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Render Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let render_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Render Bind Group"),
            layout: &render_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&texture_view) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&sampler) },
            ],
        });

        let compute_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Compute Pipeline Layout"),
            bind_group_layouts: &[&compute_bind_group_layout],
            push_constant_ranges: &[],
        });

        let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Compute Pipeline"),
            layout: Some(&compute_pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let caps = surface.get_capabilities(&adapter);
        let surface_format = caps.formats[0];
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_DST,
            format: surface_format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
             desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let render_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Render Pipeline Layout"),
            bind_group_layouts: &[&render_bind_group_layout],
            push_constant_ranges: &[],
        });

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Render Pipeline"),
            layout: Some(&render_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: config.format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Ok(GpuRenderer {
            surface,
            device,
            queue,
            compute_pipeline,
            render_pipeline,
            compute_bind_group,
            render_bind_group,
            compute_bind_group_layout,
            render_bind_group_layout,
            uniform_buffer,
            texture,
            sampler,
            width,
            height,
            config,
        })
    }
    
    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 { return; }
        self.width = width;
        self.height = height;
        
        let texture_size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };

        self.texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Output Texture"),
            size: texture_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        
        let texture_view = self.texture.create_view(&wgpu::TextureViewDescriptor::default());

        self.compute_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Compute Bind Group"),
            layout: &self.compute_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.uniform_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&texture_view) },
            ],
        });

        self.render_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Render Bind Group"),
            layout: &self.render_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&texture_view) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.sampler) },
            ],
        });

        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }
    
    pub fn render(&self, p: RenderParams) {
        console::log_1(&format!("Rust: Rendering with size {}x{}, step {}", self.width, self.height, p.step).into());

        let (w_hi, w_lo) = split_f64(self.width as f64);
        let (h_hi, h_lo) = split_f64(self.height as f64);
        let (x_min_hi, x_min_lo) = split_f64(p.x_min);
        let (x_max_hi, x_max_lo) = split_f64(p.x_max);
        let (y_min_hi, y_min_lo) = split_f64(p.y_min);
        let (y_max_hi, y_max_lo) = split_f64(p.y_max);

        let zoom_width = p.x_max - p.x_min;
        let precision_mode = if zoom_width < 1e-4 { 1 } else { 0 };

        console::log_1(&format!("Rust: Precision Mode: {} (Zoom: {:e})", precision_mode, zoom_width).into());

        let uniforms = Uniforms {
             width_hi: w_hi, width_lo: w_lo, height_hi: h_hi, height_lo: h_lo,
             x_min_hi, x_min_lo, x_max_hi, x_max_lo,
             y_min_hi, y_min_lo, y_max_hi, y_max_lo,
             max_iter: p.max_iter,
             precision_mode,
             step_size: p.step,
             flags: if p.reuse { 1 } else { 0 },
             color1: [p.color1_r, p.color1_g, p.color1_b, 1.0],
             color2: [p.color2_r, p.color2_g, p.color2_b, 1.0],
             bright_min: p.bright_min,
             bright_max: p.bright_max,
             _pad: [0.0, 0.0],
        };
        
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::cast_slice(&[uniforms]));
        
        // Dispatch Logic: One thread per 'macro-pixel' of size 'step'.
        // Grid size: width / step.
        let grid_w = self.width.div_ceil(p.step);
        let grid_h = self.height.div_ceil(p.step);
        
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        
        // Compute Pass
        {
            let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: None, timestamp_writes: None });
            cpass.set_pipeline(&self.compute_pipeline);
            cpass.set_bind_group(0, &self.compute_bind_group, &[]);
            let workgroup_size = 8;
            cpass.dispatch_workgroups(grid_w.div_ceil(workgroup_size), grid_h.div_ceil(workgroup_size), 1);
        }
        
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(e) => {
                 console::log_1(&format!("Surface Error: {:?}", e).into());
                 return;
            },
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Render Pass (Blit to screen)
        {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Blit Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLUE),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            rpass.set_pipeline(&self.render_pipeline);
            rpass.set_bind_group(0, &self.render_bind_group, &[]);
            rpass.draw(0..3, 0..1);
        }

        self.queue.submit(Some(encoder.finish()));
        frame.present();
    }

    pub async fn read_pixels(&self) -> Result<Vec<u8>, JsValue> {
        let align = 256;
        let unpadded_bytes_per_row = self.width * 4;
        let padding = (align - unpadded_bytes_per_row % align) % align;
        let padded_bytes_per_row = unpadded_bytes_per_row + padding;
        let size = (padded_bytes_per_row * self.height) as u64;

        let staging_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Staging Buffer"),
            size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        
        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &staging_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(self.height),
                },
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        let slice = staging_buffer.slice(..);
        let (tx, rx) = futures::channel::oneshot::channel();
        
        slice.map_async(wgpu::MapMode::Read, move |v| {
            tx.send(v).ok();
        });

        match rx.await {
            Ok(Ok(())) => {},
            _ => return Err("Failed to map buffer".into()),
        }

        let data = slice.get_mapped_range();
        let result = data.to_vec();
        drop(data);
        staging_buffer.unmap();

        if padding > 0 {
             let mut unpadded = Vec::with_capacity((unpadded_bytes_per_row * self.height) as usize);
             for chunk in result.chunks(padded_bytes_per_row as usize) {
                 unpadded.extend_from_slice(&chunk[..unpadded_bytes_per_row as usize]);
             }
             Ok(unpadded)
        } else {
             Ok(result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_f64() {
        let (hi, lo) = split_f64(1.0);
        assert_eq!(hi, 1.0);
        assert_eq!(lo, 0.0);

        let val = 1.23456789e5;
        let (hi, lo) = split_f64(val);
        assert_eq!(hi, 123456.79); // Approximate float
        assert!((val - (hi as f64 + lo as f64)).abs() < 1e-10);
    }
}
