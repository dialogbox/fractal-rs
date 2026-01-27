import init, { FractalRenderer, GpuRenderer, setup } from '../../pkg/fractal_rs';

async function run() {
  console.log("Starting App...");
  const wasm = await init();
  setup();
  console.log("Wasm initialized");

  const canvas = document.getElementById('mandelbrot-canvas') as HTMLCanvasElement;
  canvas.style.display = 'block';
  canvas.style.zIndex = '1';

  // UI Controls
  const controls = document.createElement('div');
  controls.style.position = 'absolute';
  controls.style.top = '10px';
  controls.style.left = '10px';
  controls.style.background = 'rgba(0, 0, 0, 0.7)';
  controls.style.color = 'white';
  controls.style.padding = '10px';
  controls.style.borderRadius = '5px';
  controls.style.zIndex = '100'; // Topmost
  document.body.appendChild(controls);

  const modeLabel = document.createElement('div');
  modeLabel.innerText = "Mode: ";
  controls.appendChild(modeLabel);

  const cpuBtn = document.createElement('button');
  cpuBtn.innerText = "CPU (Wasm)";
  cpuBtn.onclick = () => switchMode('cpu');
  controls.appendChild(cpuBtn);

  const gpuBtn = document.createElement('button');
  gpuBtn.innerText = "GPU (WebGPU)";
  gpuBtn.style.marginLeft = '10px';
  gpuBtn.onclick = () => switchMode('gpu');
  controls.appendChild(gpuBtn);

  const infoDiv = document.createElement('div');
  infoDiv.style.marginTop = '5px';
  controls.appendChild(infoDiv);

  // --- DIMENSIONS & CONSTANTS ---
  const BOUND_X_MIN = -2.0;
  const BOUND_X_MAX = 1.0;
  const BOUND_Y_MIN = -1.2;
  const BOUND_Y_MAX = 1.2;
  const FRACTAL_W = BOUND_X_MAX - BOUND_X_MIN; // 3.0
  const FRACTAL_H = BOUND_Y_MAX - BOUND_Y_MIN; // 2.4
  const FRACTAL_ASPECT = FRACTAL_W / FRACTAL_H; // 1.25

  const dpr = window.devicePixelRatio || 1;
  let logicalWidth = 800;
  let logicalHeight = 600;
  let width = 800;
  let height = 600;

  // View State
  let centerX = -0.5;
  let centerY = 0.0;
  let zoomWidth = 3.0; // Starts showing full width

  // --- PERSISTENCE & STYLING ---
  const savedMode = localStorage.getItem('fractalMode');
  let mode: 'cpu' | 'gpu' = (savedMode === 'gpu') ? 'gpu' : 'cpu';

  const updateButtonStyles = () => {
    if (mode === 'cpu') {
      cpuBtn.style.background = '#4CAF50';
      cpuBtn.style.color = 'white';
      gpuBtn.style.background = '#555';
      gpuBtn.style.color = '#ccc';
    } else {
      cpuBtn.style.background = '#555';
      cpuBtn.style.color = '#ccc';
      gpuBtn.style.background = '#4CAF50';
      gpuBtn.style.color = 'white';
    }
  };
  updateButtonStyles();

  let cpuRenderer: FractalRenderer | null = null;
  let gpuRenderer: GpuRenderer | null = null;
  let ctx: CanvasRenderingContext2D | null = null;

  // Init CPU
  try {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Note: We delay .new() until we know the size in updateLayout()
  } catch (e) {
    console.error("CPU Init Error", e);
  }

  // Dual Canvas Setup
  const gpuCanvas = document.createElement('canvas');
  gpuCanvas.id = 'gpu-canvas';
  gpuCanvas.style.display = 'none';
  // We don't set absolute positioning here because we want Flexbox to handle it (implicit)
  // BUT we need them to stack.
  // Actually, Flexbox items stack horizontally/vertically.
  // To stack ON TOP of each other, we need a wrapper container or absolute positioning logic within the flex item.
  // Wait, index.html just centers BODY content.
  // Simplest: Make canvases absolute + one Wrapper?
  // Or just keep absolute positioning but center the canvases via JS?
  // No, user asked for CSS.
  // Let's use a Wrapper Div.

  // Actually, easiest way with existing DOM:
  // Canvases are absolute, but centered?
  // Let's make a wrapper logic inside updateLayout.
  // NO. `canvas { position: absolute; }` inside a flex container centers them if we use margin:auto? No.

  // Let's inject a Wrapper.
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'flex';
  wrapper.style.justifyContent = 'center';
  wrapper.style.alignItems = 'center';
  wrapper.style.boxShadow = '0 0 50px black';
  document.body.appendChild(wrapper);

  // Move canvases into wrapper
  // We need to ensuring they overlap.
  // Grid stack trick:
  wrapper.style.display = 'grid';
  // canvas { grid-area: 1 / 1; }

  // Let's apply styles directly
  const stackStyle = (el: HTMLElement) => {
    el.style.gridArea = "1 / 1";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.display = "block"; // Overridden by mode switcher
  };

  // Re-parent existing canvas
  if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  wrapper.appendChild(canvas);
  stackStyle(canvas);

  wrapper.appendChild(gpuCanvas);
  stackStyle(gpuCanvas);

  // UI Overlay
  const uiCanvas = document.createElement('canvas');
  uiCanvas.style.pointerEvents = 'none';
  uiCanvas.style.zIndex = '50';
  wrapper.appendChild(uiCanvas);
  stackStyle(uiCanvas);
  const uiCtx = uiCanvas.getContext('2d');

  // --- LAYOUT LOGIC ---
  const updateLayout = () => {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const winAspect = winW / winH;

    // Calculate Fit Dimensions
    if (winAspect > FRACTAL_ASPECT) {
      // Window is wider than fractal -> Fit to Height
      logicalHeight = winH;
      logicalWidth = winH * FRACTAL_ASPECT;
    } else {
      // Window is taller -> Fit to Width
      logicalWidth = winW;
      logicalHeight = winW / FRACTAL_ASPECT;
    }

    // Snap to integers
    logicalWidth = Math.floor(logicalWidth);
    logicalHeight = Math.floor(logicalHeight);

    // Wrapper Size (CSS handles centering in Body)
    wrapper.style.width = logicalWidth + 'px';
    wrapper.style.height = logicalHeight + 'px';

    // Physical Resolution
    width = Math.floor(logicalWidth * dpr);
    height = Math.floor(logicalHeight * dpr);

    // Resize Canvases
    [canvas, gpuCanvas, uiCanvas].forEach(el => {
      el.width = width;
      el.height = height;
      // CSS width is handled by Wrapper + 100% style
    });

    // Context Scaling
    if (uiCtx) {
      uiCtx.setTransform(1, 0, 0, 1, 0, 0);
      uiCtx.scale(dpr, dpr);
    }

    // Initialize or Resize Renderers
    if (!cpuRenderer) {
      try {
        cpuRenderer = FractalRenderer.new(width, height);
      } catch (e) { }
    } else {
      cpuRenderer.resize(width, height);
    }

    if (!gpuRenderer) {
      // Async init handled later/below
      // but if it exists:
    } else {
      gpuRenderer.resize(width, height);
    }

    startRender();
  };


  // Initialize GPU
  try {
    GpuRenderer.new(gpuCanvas).then(r => {
      gpuRenderer = r;
      gpuRenderer.resize(width, height); // Initial size
      console.log("GPU Ready");
      gpuBtn.title = "Ready";
      if (mode === 'gpu') startRender();
    }).catch(e => {
      console.error("GPU Fail", e);
      gpuBtn.disabled = true;
    });
  } catch (e) { }

  // --- RENDERING VARS ---
  // ... (Same as before)
  let pendingRenderId = 0;
  const passScales = [0.125, 0.25, 0.5, 1.0];

  const renderPass = (passIndex: number, renderId: number) => {
    if (renderId !== pendingRenderId) return;
    const scale = passScales[passIndex];
    const scaledWidth = Math.floor(width * scale);
    const scaledHeight = Math.floor(height * scale);

    // Info
    const zoomLevel = Math.log10(3.0 / zoomWidth);
    const maxIter = Math.floor(100 + zoomLevel * 100);
    infoDiv.innerText = `Zoom: ${zoomWidth.toExponential(2)} | Iters: ${maxIter} | Res: ${(scale * 100).toFixed(1)}%`;

    const aspectRatio = width / height; // Should strictly match FRACTAL_ASPECT
    // const zoomHeight = zoomWidth / aspectRatio; // Derived
    const zoomHeight = zoomWidth / FRACTAL_ASPECT;

    const xMin = centerX - zoomWidth / 2;
    const xMax = centerX + zoomWidth / 2;
    const yMin = centerY - zoomHeight / 2;
    const yMax = centerY + zoomHeight / 2;

    if (mode === 'cpu' && cpuRenderer && ctx) {
      // Helper to handle partial updates? No, just full resize usually.
      // But for progressive, we use smaller buffers.
      if (canvas.width !== scaledWidth) {
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
      }
      cpuRenderer.resize(scaledWidth, scaledHeight);
      cpuRenderer.render(xMin, xMax, yMin, yMax, maxIter);

      const pixelsPtr = cpuRenderer.get_pixels();
      const pixelsLen = cpuRenderer.get_pixels_len();
      const memory = wasm.memory;
      const pixels = new Uint8ClampedArray(memory.buffer, pixelsPtr, pixelsLen);
      const imageData = new ImageData(pixels, scaledWidth, scaledHeight);
      ctx.putImageData(imageData, 0, 0);

      // Restore full size for layout if last pass? 
      // Actually canvas.width controls display res. This works fine essentially upscaling via CSS.

    } else if (mode === 'gpu' && gpuRenderer) {
      if (gpuCanvas.width !== scaledWidth) {
        gpuCanvas.width = scaledWidth;
        gpuCanvas.height = scaledHeight;
      }
      gpuRenderer.resize(scaledWidth, scaledHeight);
      gpuRenderer.render(xMin, xMax, yMin, yMax, maxIter);
    }

    if (passIndex < passScales.length - 1) {
      requestAnimationFrame(() => renderPass(passIndex + 1, renderId));
    }
  };

  const startRender = () => {
    pendingRenderId++;
    const myId = pendingRenderId;
    requestAnimationFrame(() => renderPass(0, myId));
  };

  const switchMode = (newMode: 'cpu' | 'gpu') => {
    if (newMode === mode) return;
    mode = newMode;
    localStorage.setItem('fractalMode', newMode);
    updateButtonStyles();

    // Visibility handled by CSS classes or explicit style?
    // Wrapper uses Grid. We need to toggle 'display' or z-index.
    // Display none removes it from layout? No, Grid stack.
    if (mode === 'cpu') {
      canvas.style.display = 'block';
      gpuCanvas.style.display = 'none'; // safe
      infoDiv.innerText = "Switched to CPU";
    } else {
      canvas.style.display = 'none';
      gpuCanvas.style.display = 'block';
      infoDiv.innerText = "Switched to GPU";
    }
    startRender();
  };

  // --- CONSTRAINTS ---
  const applyConstraints = () => {
    // 1. Zoom Limits
    // Max Precision
    const PRECISION_PER_PIXEL = 5.0e-15;
    const MIN_ZOOM = logicalWidth * PRECISION_PER_PIXEL;
    // Max Zoom Out = FRACTAL_W (strict)
    const MAX_ZOOM = FRACTAL_W;

    if (zoomWidth < MIN_ZOOM) zoomWidth = MIN_ZOOM;
    if (zoomWidth > MAX_ZOOM) zoomWidth = MAX_ZOOM;

    // 2. Pan Limits
    // Bounds checks are now strictly edges because V_AR == F_AR
    const zoomHeight = zoomWidth / FRACTAL_ASPECT;
    const minCenterX = BOUND_X_MIN + zoomWidth / 2;
    const maxCenterX = BOUND_X_MAX - zoomWidth / 2;
    const minCenterY = BOUND_Y_MIN + zoomHeight / 2;
    const maxCenterY = BOUND_Y_MAX - zoomHeight / 2;

    // Panning check
    // If fully zoomed out, minCenterX == maxCenterX (-0.5).
    // If we drift, clamp back.
    if (minCenterX > maxCenterX) {
      centerX = (BOUND_X_MIN + BOUND_X_MAX) / 2;
    } else {
      centerX = Math.max(minCenterX, Math.min(centerX, maxCenterX));
    }

    if (minCenterY > maxCenterY) {
      centerY = (BOUND_Y_MIN + BOUND_Y_MAX) / 2;
    } else {
      centerY = Math.max(minCenterY, Math.min(centerY, maxCenterY));
    }
  };

  // --- INTERACTION ---
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let dragStartComplexX = 0;
  let dragStartComplexY = 0;

  wrapper.addEventListener('mousedown', (e) => {
    // Use Wrapper to capture events on any canvas
    isDragging = true;
    // Get Mouse Pos relative to Wrapper (Canvas)
    const rect = wrapper.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

    dragStartComplexX = centerX;
    dragStartComplexY = centerY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = wrapper.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const deltaX = currentX - startX;
    const deltaY = currentY - startY;

    const mapPixelW = zoomWidth / logicalWidth; // logicalWidth is accurate to layout
    const mapPixelH = (zoomWidth / FRACTAL_ASPECT) / logicalHeight;

    centerX = dragStartComplexX - deltaX * mapPixelW;
    centerY = dragStartComplexY - deltaY * mapPixelH;

    applyConstraints(); // Clamp it

    startRender();
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  wrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
    let newZoomWidth = zoomWidth * zoomFactor;

    const rect = wrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // UV Logic
    const uvX = mouseX / logicalWidth;
    const uvY = mouseY / logicalHeight;
    const currentZoomHeight = zoomWidth / FRACTAL_ASPECT;
    const newZoomHeight = newZoomWidth / FRACTAL_ASPECT;

    // Offset
    let nextCenterX = centerX + (uvX - 0.5) * (zoomWidth - newZoomWidth);
    let nextCenterY = centerY + (uvY - 0.5) * (currentZoomHeight - newZoomHeight);

    centerX = nextCenterX;
    centerY = nextCenterY;
    zoomWidth = newZoomWidth;

    applyConstraints(); // Clamp
    startRender();
  }, { passive: false });

  window.addEventListener('resize', () => {
    updateLayout();
    // startRender called inside updateLayout
  });

  // Start
  updateLayout(); // Sets sizes, creates renderer
}

run();
