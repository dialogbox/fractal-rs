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
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        return self.render_simd(x_min, x_max, y_min, y_max, max_iter);

        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        return self.render_scalar(x_min, x_max, y_min, y_max, max_iter);
    }

    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    fn render_scalar(&mut self, x_min: f64, x_max: f64, y_min: f64, y_max: f64, max_iter: u32) {
        let mut index = 0;
        let width_f = self.width as f64;
        let height_f = self.height as f64;
        let pw = (x_max - x_min) / width_f;
        let ph = (y_max - y_min) / height_f;
        let offsets = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)];

        for y in 0..self.height {
            let base_cy = y_min + (y as f64) * ph;
            for x in 0..self.width {
                let base_cx = x_min + (x as f64) * pw;
                let mut total_iter = 0;
                for (ox, oy) in offsets.iter() {
                    total_iter += Self::calculate_iter(base_cx + ox * pw, base_cy + oy * ph, max_iter);
                }
                let avg_iter = total_iter as f64 / 4.0;
                let color = if avg_iter >= max_iter as f64 { 0 } else { (avg_iter / max_iter as f64 * 255.0) as u8 };
                self.pixels[index] = color;
                self.pixels[index + 1] = color;
                self.pixels[index + 2] = color;
                self.pixels[index + 3] = 255;
                index += 4;
            }
        }
    }

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    fn render_simd(&mut self, x_min: f64, x_max: f64, y_min: f64, y_max: f64, max_iter: u32) {
        use core::arch::wasm32::*;
        
        let mut index = 0;
        let width_f = self.width as f64;
        let height_f = self.height as f64;
        let pw = (x_max - x_min) / width_f;
        let ph = (y_max - y_min) / height_f;
        
        let ox_1 = f64x2(0.25 * pw, 0.75 * pw);
        let oy_1 = f64x2(0.25 * ph, 0.25 * ph);
        
        let ox_2 = f64x2(0.25 * pw, 0.75 * pw);
        let oy_2 = f64x2(0.75 * ph, 0.75 * ph);
        
        let four = f64x2_splat(4.0);
        let two = f64x2_splat(2.0);

        for y in 0..self.height {
            let base_cy = y_min + (y as f64) * ph;
            let cy_base = f64x2_splat(base_cy);
            let cy1 = f64x2_add(cy_base, oy_1);
            let cy2 = f64x2_add(cy_base, oy_2);

            for x in 0..self.width {
                let base_cx = x_min + (x as f64) * pw;
                let cx_base = f64x2_splat(base_cx);
                
                let cx1 = f64x2_add(cx_base, ox_1);
                let cx2 = f64x2_add(cx_base, ox_2);

                let mut zx1 = f64x2_splat(0.0);
                let mut zy1 = f64x2_splat(0.0);
                let mut zx2 = f64x2_splat(0.0);
                let mut zy2 = f64x2_splat(0.0);
                
                let mut iters1 = i64x2_splat(0);
                let mut iters2 = i64x2_splat(0);
                
                let mut loop_iter = 0;
                while loop_iter < max_iter {
                     let zx1_sq = f64x2_mul(zx1, zx1);
                     let zy1_sq = f64x2_mul(zy1, zy1);
                     let mag1 = f64x2_add(zx1_sq, zy1_sq);
                     let mask1 = f64x2_lt(mag1, four);
                     
                     let zx2_sq = f64x2_mul(zx2, zx2);
                     let zy2_sq = f64x2_mul(zy2, zy2);
                     let mag2 = f64x2_add(zx2_sq, zy2_sq);
                     let mask2 = f64x2_lt(mag2, four);
                     
                     if !v128_any_true(mask1) && !v128_any_true(mask2) {
                         break;
                     }
                     
                     // i64x2_sub works on v128.
                     // mask1 has all bits set (-1) for true. 
                     // Subtraction -(-1) = +1. Correct.
                     iters1 = i64x2_sub(iters1, mask1);
                     iters2 = i64x2_sub(iters2, mask2);
                     
                     let next_zy1 = f64x2_add(f64x2_mul(two, f64x2_mul(zx1, zy1)), cy1);
                     zx1 = f64x2_add(f64x2_sub(zx1_sq, zy1_sq), cx1);
                     zy1 = next_zy1;
                     
                     let next_zy2 = f64x2_add(f64x2_mul(two, f64x2_mul(zx2, zy2)), cy2);
                     zx2 = f64x2_add(f64x2_sub(zx2_sq, zy2_sq), cx2);
                     zy2 = next_zy2;
                     
                     loop_iter += 1;
                }
                
                let i1_0 = i64x2_extract_lane::<0>(iters1);
                let i1_1 = i64x2_extract_lane::<1>(iters1);
                let i2_0 = i64x2_extract_lane::<0>(iters2);
                let i2_1 = i64x2_extract_lane::<1>(iters2);
                
                let total_iter = i1_0 + i1_1 + i2_0 + i2_1;
                
                let avg_iter = total_iter as f64 / 4.0;
                let color = if avg_iter >= max_iter as f64 { 0 } else { (avg_iter / max_iter as f64 * 255.0) as u8 };
                
                unsafe {
                    let ptr = self.pixels.as_mut_ptr().add(index);
                    *ptr = color;
                    *ptr.add(1) = color;
                    *ptr.add(2) = color;
                    *ptr.add(3) = 255;
                }
                index += 4;
            }
        }
    }
}
