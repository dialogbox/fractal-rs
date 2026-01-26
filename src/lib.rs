use wasm_bindgen::prelude::*;
use web_sys::console;

mod webgpu_renderer;
pub use webgpu_renderer::GpuRenderer;



#[wasm_bindgen]
pub fn setup() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
    console::log_1(&"Hello from Rust/Wasm!".into());
}

#[wasm_bindgen]
pub struct FractalRenderer {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl FractalRenderer {
    pub fn new(width: u32, height: u32) -> FractalRenderer {
        let pixels = vec![0; (width * height * 4) as usize];
        FractalRenderer {
            width,
            height,
            pixels,
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.pixels = vec![0; (width * height * 4) as usize];
    }

    pub fn get_pixels(&self) -> *const u8 {
        self.pixels.as_ptr()
    }
    
    pub fn get_pixels_len(&self) -> usize {
        self.pixels.len()
    }

    fn calculate_iter(cx: f64, cy: f64, max_iter: u32) -> u32 {
        let mut zx = 0.0;
        let mut zy = 0.0;
        let mut zx2 = 0.0;
        let mut zy2 = 0.0;
        let mut iter = 0;

        while (zx2 + zy2) < 4.0 && iter < max_iter {
            zy = 2.0 * zx * zy + cy;
            zx = zx2 - zy2 + cx;
            zx2 = zx * zx;
            zy2 = zy * zy;
            iter += 1;
        }
        iter
    }

    pub fn render(&mut self, x_min: f64, x_max: f64, y_min: f64, y_max: f64, max_iter: u32) {
        let mut index = 0;
        let width_f = self.width as f64;
        let height_f = self.height as f64;
        
        // Pixel dimensions in complex plane
        let pw = (x_max - x_min) / width_f;
        let ph = (y_max - y_min) / height_f;

        // SSAA Offsets (2x2 grid inside pixel)
        // -0.25 and +0.25 from center? 
        // Pixel x covers [cx, cx+pw]. Center is cx + 0.5*pw.
        // Offsets: 0.25*pw, 0.75*pw relative to left edge.
        let offsets = [
            (0.25, 0.25),
            (0.75, 0.25),
            (0.25, 0.75),
            (0.75, 0.75),
        ];

        for y in 0..self.height {
            let base_cy = y_min + (y as f64) * ph;
            
            for x in 0..self.width {
                let base_cx = x_min + (x as f64) * pw;
                
                let mut total_iter = 0;
                
                for (ox, oy) in offsets.iter() {
                    let cx = base_cx + ox * pw;
                    let cy = base_cy + oy * ph;
                    total_iter += Self::calculate_iter(cx, cy, max_iter);
                }

                let avg_iter = total_iter as f64 / 4.0;
                
                // Color mapping
                let color = if avg_iter >= max_iter as f64 {
                    0
                } else {
                    (avg_iter / max_iter as f64 * 255.0) as u8
                };

                // RGBA
                self.pixels[index] = color;
                self.pixels[index + 1] = color;
                self.pixels[index + 2] = color;
                self.pixels[index + 3] = 255;
                
                index += 4;
            }
        }
    }
}
