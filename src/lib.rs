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


