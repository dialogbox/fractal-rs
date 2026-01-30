# Fractal RS - High Performance Mandelbrot Renderer

A WebAssembly-powered Mandelbrot set renderer built with Rust (WGPU) and TypeScript.

## Features

- **High Performance**: Uses WGPU compute shaders for massively parallel rendering.
- **Deep Zoom**: Correctly handles zooms down to $10^{-14}$ using emulated double-precision (Double-Single) math.
- **Smooth Coloring**: Continuous potential coloring with cyclic cosine palettes.
- **Interactive**: Real-time color customization and keyboard navigation.

## Building

### Prerequisites

- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/)
- `wasm-pack`: `cargo install wasm-pack`

### Web Version

1.  **Build WASM**:
    - **Release (Optimized)**:
      ```bash
      wasm-pack build --target web
      ```
    - **Dev (Fast/Unoptimized)**:
      ```bash
      wasm-pack build --target web --dev
      ```
2.  **Run Frontend**:

    ```bash
    cd www
    npm install
    npm run dev
    ```

    Open `http://localhost:5173`.

3.  **Build for Production**:
    ```bash
    cd www
    npm run build
    ```
    The static site will be in `www/dist`.

### Desktop App (Tauri)

**Linux Prerequisites:**

```bash
sudo apt-get update
sudo apt-get install libwebkit2gtk-4.0-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

1.  **Run in Development**:

    ```bash
    npx tauri dev
    ```

2.  **Build Release Bundle**:
    ```bash
    npx tauri build
    ```
    The installer/binary will be in `src-tauri/target/release/bundle/`.
