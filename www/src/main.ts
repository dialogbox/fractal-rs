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

  // HiDPI Scaling
  const dpr = window.devicePixelRatio || 1;
  let logicalWidth = window.innerWidth;
  let logicalHeight = window.innerHeight;
  let width = Math.floor(logicalWidth * dpr);
  let height = Math.floor(logicalHeight * dpr);

  canvas.width = width;
  canvas.height = height;
  // Canvas CSS size is handled by style usually, but explicit set is good
  canvas.style.width = logicalWidth + 'px';
  canvas.style.height = logicalHeight + 'px';

  let centerX = -0.5;
  let centerY = 0.0;
  let zoomWidth = 3.0;

  let mode: 'cpu' | 'gpu' = 'cpu';
  let cpuRenderer: FractalRenderer | null = null;
  let gpuRenderer: GpuRenderer | null = null;
  let ctx: CanvasRenderingContext2D | null = null;

  // Initialize CPU Renderer
  try {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    cpuRenderer = FractalRenderer.new(width, height);
    console.log(`CPU Renderer Initialized (Logical: ${logicalWidth}x${logicalHeight}, Physical: ${width}x${height}, DPR: ${dpr})`);
  } catch (e) {
    console.error("CPU Renderer Init Error", e);
    infoDiv.innerText = "Error initializing CPU Renderer: " + e;
  }

  // Dual Canvas Setup
  const gpuCanvas = document.createElement('canvas');
  gpuCanvas.id = 'gpu-canvas';
  gpuCanvas.style.display = 'none'; // hidden by default
  gpuCanvas.style.position = 'absolute';
  gpuCanvas.style.top = '0';
  gpuCanvas.style.left = '0';
  gpuCanvas.width = width;
  gpuCanvas.height = height;
  gpuCanvas.style.width = logicalWidth + 'px';
  gpuCanvas.style.height = logicalHeight + 'px';
  gpuCanvas.style.zIndex = '1';
  document.body.appendChild(gpuCanvas);

  // Initialize GPU
  try {
    // Only init GPU if available, don't block main thread
    GpuRenderer.new(gpuCanvas).then(r => {
      gpuRenderer = r;
      // Immediate resize to ensure internal buffer matches physical size
      gpuRenderer.resize(width, height);
      console.log("GPU Renderer Initialized asynchronously");
      gpuBtn.title = "Ready";
    }).catch(e => {
      console.error("WebGPU init failed:", e);
      gpuBtn.disabled = true;
      gpuBtn.innerText += " (N/A)";
      gpuBtn.title = "WebGPU failure: " + e;
    });
  } catch (e) {
    console.error("WebGPU unexpected error", e);
  }

  let isDragging = false;
  let startX = 0;
  let startY = 0;

  // --- Progressive Rendering State ---
  let pendingRenderId = 0;
  const passScales = [0.125, 0.25, 0.5, 1.0]; // 1/8, 1/4, 1/2, 1/1


  // Render function that processes one pass
  const renderPass = (passIndex: number, renderId: number) => {
    if (renderId !== pendingRenderId) return; // Cancelled

    const scale = passScales[passIndex];
    const scaledWidth = Math.floor(width * scale);
    const scaledHeight = Math.floor(height * scale);

    // Log only on first pass to avoid spam
    if (passIndex === 0) {
      // console.log(`Starting Render: Zoom=${zoomWidth.toExponential(2)}`);
    }

    // Update UI Info
    const zoomLevel = Math.log10(3.0 / zoomWidth);
    const maxIter = Math.floor(100 + zoomLevel * 100);
    infoDiv.innerText = `Zoom: ${zoomWidth.toExponential(2)} | Iters: ${maxIter} | Res: ${(scale * 100).toFixed(1)}%`;

    const aspectRatio = width / height;
    const zoomHeight = zoomWidth / aspectRatio;
    const xMin = centerX - zoomWidth / 2;
    const xMax = centerX + zoomWidth / 2;
    const yMin = centerY - zoomHeight / 2;
    const yMax = centerY + zoomHeight / 2;

    // Resize Render Target (but keep CSS size)
    if (mode === 'cpu' && cpuRenderer && ctx) {
      canvas.width = scaledWidth;
      canvas.height = scaledHeight;
      // IMPORTANT: restore context after resize (context is mostly reset)
      // Actually getContext is persistent, but properties might reset?
      // For putImageData it doesn't matter.

      cpuRenderer.resize(scaledWidth, scaledHeight);
      cpuRenderer.render(xMin, xMax, yMin, yMax, maxIter);

      const pixelsPtr = cpuRenderer.get_pixels();
      const pixelsLen = cpuRenderer.get_pixels_len();
      const memory = wasm.memory;
      const pixels = new Uint8ClampedArray(memory.buffer, pixelsPtr, pixelsLen);
      const imageData = new ImageData(pixels, scaledWidth, scaledHeight);
      ctx.putImageData(imageData, 0, 0);

    } else if (mode === 'gpu' && gpuRenderer) {
      gpuCanvas.width = scaledWidth;
      gpuCanvas.height = scaledHeight;
      gpuRenderer.resize(scaledWidth, scaledHeight);
      gpuRenderer.render(xMin, xMax, yMin, yMax, maxIter);
    }

    // Schedule next pass
    if (passIndex < passScales.length - 1) {
      requestAnimationFrame(() => renderPass(passIndex + 1, renderId));
    }
  };

  const startRender = () => {
    pendingRenderId++; // Invalidate previous renders
    const myId = pendingRenderId;
    requestAnimationFrame(() => renderPass(0, myId));
  };

  const switchMode = (newMode: 'cpu' | 'gpu') => {
    if (newMode === mode) return;
    mode = newMode;

    if (mode === 'cpu') {
      canvas.style.display = 'block';
      gpuCanvas.style.display = 'none';
    } else {
      canvas.style.display = 'none';
      gpuCanvas.style.display = 'block';
    }
    startRender();
  };

  // Initial Render
  startRender();

  // Interaction (Attached to Window to catch both canvases)
  let dragStartComplexX = 0;
  let dragStartComplexY = 0;

  window.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    dragStartComplexX = centerX;
    dragStartComplexY = centerY;
  });

  // UI Overlay Canvas logic (Unchanged mostly)
  const uiCanvas = document.createElement('canvas');
  uiCanvas.style.position = 'absolute';
  uiCanvas.style.top = '0';
  uiCanvas.style.left = '0';
  uiCanvas.style.pointerEvents = 'none';
  uiCanvas.width = width;
  uiCanvas.height = height;
  uiCanvas.style.width = logicalWidth + 'px';
  uiCanvas.style.height = logicalHeight + 'px';
  uiCanvas.style.zIndex = '50';
  document.body.appendChild(uiCanvas);
  const uiCtx = uiCanvas.getContext('2d');
  if (uiCtx) {
    uiCtx.scale(dpr, dpr);
  }

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const currentX = e.clientX;
    const currentY = e.clientY;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;

    // Pan Logic:
    const aspectRatio = logicalWidth / logicalHeight;
    const zoomHeight = zoomWidth / aspectRatio;
    const mapPixelW = zoomWidth / logicalWidth;
    const mapPixelH = zoomHeight / logicalHeight;

    centerX = dragStartComplexX - deltaX * mapPixelW;
    centerY = dragStartComplexY - deltaY * mapPixelH;

    startRender();
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
  });

  // Bounce Animation Helper
  let isBouncing = false;
  let lastBounceTime = 0;

  const triggerBounce = (direction: 'in' | 'out') => {
    const now = Date.now();
    if (isBouncing || (now - lastBounceTime < 500)) return; // Debounce 500ms

    isBouncing = true;
    lastBounceTime = now;

    const targets = [canvas, gpuCanvas, uiCanvas];
    const scale = direction === 'out' ? 0.95 : 1.05;

    // Apply CSS transition
    targets.forEach(el => {
      el.style.transition = 'transform 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      el.style.transform = `scale(${scale})`;
    });

    setTimeout(() => {
      targets.forEach(el => {
        el.style.transform = 'scale(1.0)';
      });
      setTimeout(() => {
        targets.forEach(el => {
          el.style.transition = '';
        });
        isBouncing = false;
      }, 100);
    }, 100);
  };

  // Wheel Zoom
  window.addEventListener('wheel', (e) => {
    e.preventDefault();

    const mouseX = e.clientX;
    const mouseY = e.clientY;

    const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
    let newZoomWidth = zoomWidth * zoomFactor;

    // Bounds definitions

    // Bounding Box (Allowed Visible Area)
    const BOUND_X_MIN = -2.0;
    const BOUND_X_MAX = 1.0;
    const BOUND_Y_MIN = -1.2; // approx -1.0 with padding
    const BOUND_Y_MAX = 1.2;

    // Max Precision Limit (Zoom In)
    // We want 1 pixel > Precision Epsilon
    // DS (Double Single) has ~48 bits precision => 2^-48 ~= 3.55e-15
    // Let's use a safe limit of 5.0e-15 per pixel.
    const PRECISION_PER_PIXEL = 5.0e-15;
    const MIN_ZOOM_WIDTH = logicalWidth * PRECISION_PER_PIXEL;

    // Check Limits
    if (newZoomWidth < MIN_ZOOM_WIDTH) {
      if (zoomWidth <= MIN_ZOOM_WIDTH) {
        triggerBounce('in');
        return;
      }
      newZoomWidth = MIN_ZOOM_WIDTH;
    } else {
      // Valid range
    }

    // Determine proposed center
    const aspectRatio = logicalWidth / logicalHeight;
    const uvX = mouseX / logicalWidth;
    const uvY = mouseY / logicalHeight;

    let nextCenterX = centerX + (uvX - 0.5) * (zoomWidth - newZoomWidth);
    let nextCenterY = centerY + (uvY - 0.5) * (zoomWidth / aspectRatio - newZoomWidth / aspectRatio);

    // Constraint Logic (Zoom Out / Panning)
    const nextZoomHeight = newZoomWidth / aspectRatio;
    let nextXMin = nextCenterX - newZoomWidth / 2;
    let nextXMax = nextCenterX + newZoomWidth / 2;
    let nextYMin = nextCenterY - nextZoomHeight / 2;
    let nextYMax = nextCenterY + nextZoomHeight / 2;

    // 2. Shift center if strictly inside bounds but hitting edge (Drift correction)
    // If width > max allowed width (3.0), we clamp width.
    if (newZoomWidth > 3.0) {
      newZoomWidth = 3.0;
      // Re-center if maxed out
      nextCenterX = -0.5;
      nextCenterY = 0.0;

      // Max Width Bounce Logic
      if (zoomWidth >= 3.0) {
        triggerBounce('out');
        return;
      }
    } else {
      // Normal bound checking
      if (nextXMin < BOUND_X_MIN) {
        const shift = BOUND_X_MIN - nextXMin;
        nextCenterX += shift;
      }
      if (nextXMax > BOUND_X_MAX) {
        const shift = BOUND_X_MAX - nextXMax;
        nextCenterX += shift;
        // If double-constrained (width too big), clamp width effectively handled by max width check above? 
        // No, we might be wider than interval but < 3.0? No, 3.0 IS the interval size.
      }

      // Recalculate Y based on new X
      // Actually Y bounds are looser usually, but let's apply same logic
      const maxH = 2.4;
      if (nextZoomHeight > maxH) {
        // If height exceeds max, we might need to clamp width based on aspect ratio
        // But let's just clamp position first
        nextCenterY = 0.0;
      } else {
        if (nextYMin < BOUND_Y_MIN) nextCenterY += (BOUND_Y_MIN - nextYMin);
        if (nextYMax > BOUND_Y_MAX) nextCenterY += (BOUND_Y_MAX - nextYMax);
      }
    }

    // Check if we effectively didn't move/zoom because of constraints, AND we tried to zoom out
    // if (zoomFactor > 1.0) { ... } // Logic moved above

    centerX = nextCenterX;
    centerY = nextCenterY;
    zoomWidth = newZoomWidth;

    startRender();
  }, { passive: false });

  window.addEventListener('resize', () => {
    logicalWidth = window.innerWidth;
    logicalHeight = window.innerHeight;
    width = Math.floor(logicalWidth * dpr);
    height = Math.floor(logicalHeight * dpr);

    // Initial resize to max for buffers (optional, but good practice)
    if (cpuRenderer) cpuRenderer.resize(width, height);
    if (gpuRenderer) gpuRenderer.resize(width, height);

    uiCanvas.width = width;
    uiCanvas.height = height;
    uiCanvas.style.width = logicalWidth + 'px';
    uiCanvas.style.height = logicalHeight + 'px';

    if (uiCtx) {
      uiCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset
      uiCtx.scale(dpr, dpr);
    }

    // Canvas resizing happens inside startRender now
    canvas.style.width = logicalWidth + 'px';
    canvas.style.height = logicalHeight + 'px';
    gpuCanvas.style.width = logicalWidth + 'px';
    gpuCanvas.style.height = logicalHeight + 'px';

    startRender();
  });
}

run();
