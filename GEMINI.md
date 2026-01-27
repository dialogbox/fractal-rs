# GEMINI.md - Fractal RS Project Learnings

## 1. WebGPU Troubleshooting & Best Practices

### Uniform Buffer Alignment (Crucial)
**Issue:** WebGPU enforces strict 16-byte alignment for `Uniform` buffer members in WGSL.
**Lesson:**
-   Rust structs must match this alignment exactly.
-   **Bad**: `struct Uniforms { width: f32, height: f32, ... }` (Rust packs tightly, WGSL expects alignment).
-   **Fix**: Use `#[repr(C)]` and manual padding or `bytemuck` safe casting. Ideally, use `vec4<f32>` (16 bytes) where possible or add explicit `padding: u32` fields to align to 16-byte boundaries.
-   **Symptom of Failure**: "Buffer size X is not a multiple of 16" or silent shader failures/misaligned data.

### Double Precision in WGSL
**Issue:** `f64` is not widely supported in WGSL (WebGPU). Standard `f32` fails at zoom levels deeper than $10^{-4}$ (rendering becomes blocky/pixelated).
**Solution:** **Emulated Double-Precision (Double-Single)**.
-   Represent a `f64` value as two `f32` numbers: `high` and `low`.
-   `value = high + low` where `|low| <= 0.5 * ulp(high)`.
-   **Performance**: Slower than native `f32`, so use **Hybrid Rendering**:
    -   Shader: `if (zoom < threshold) { iterate_ds(); } else { iterate_f32(); }`
    -   Rust: Pass separate `f32` arrays/uniforms for `hi` and `lo` components.

## 2. Rust & WebAssembly Improvements

### SIMD Acceleration (target-feature)
**Issue**: Rust's standard `wasm32-unknown-unknown` target does not enable SIMD by default.
**Fix**:
1.  Create `.cargo/config.toml`:
    ```toml
    [target.wasm32-unknown-unknown]
    rustflags = ["-C", "target-feature=+simd128"]
    ```
2.  Use `std::arch::wasm32` or `core::arch::wasm32` intrinsics (e.g., `f64x2_add`).
3.  **Result**: 3-4x performance boost for heavy math loops.

### Wasm-Pack & Bindgen interactions
-   Use `wasm-pack build --target web` for straightforward ES module integration.
-   Avoid large allocations (Images/Buffers) on the JS heap if possible; pass pointers (`get_pixels_ptr()`) to share memory directly between Wasm Linear Memory and JS `Uint8ClampedArray` to avoid copying overhead.

## 3. UX Patterns for Heavy Rendering

### Progressive Rendering
**Issue**: High-resolution fractal rendering takes 500ms+ on CPU, freezing the UI.
**Solution**: **Multi-Pass Rendering**.
-   **Mechanism**: TS Event Loop manages the schedule.
    1.  Pass 1: Render at 1/8 resolution (Mosaic). fast.
    2.  Pass 2: Render at 1/2 resolution.
    3.  Pass 3: Full resolution.
-   **Interruption**: If a new interaction (pan/zoom) occurs, **cancel** the current pass sequence and restart at Pass 1 immediately. This guarantees 60fps interaction feel even with a slow backend.

### Latency Hiding
-   **Bounce Effect**: Use CSS transforms (`scale()`) for bouncing effects. This is "cheap" and doesn't require re-rendering the heavy Canvas content.

## 4. Debugging Checklist
-   **Black Screen (WebGPU)**:
    1.  Check bindings: Do `@group(0) @binding(0)` match the bind group layout order?
    2.  Check buffer sizes: Are the byte sizes *exactly* correct?
    3.  Check `entry_point`: Is the compute shader entry function named correctly?
-   **Panic in Wasm**:
    -   Ensure `console_error_panic_hook` is set up. Check the browser DevTools console for the Rust panic stack trace.
