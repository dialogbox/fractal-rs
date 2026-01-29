import init, { GpuRenderer, setup } from '../../pkg/fractal_rs';

async function run() {
  console.log("Starting App...");
  await init();
  setup();
  console.log("Wasm initialized");

  const canvas = document.getElementById('mandelbrot-canvas') as HTMLCanvasElement;
  // Use 'canvas' as the main GPU canvas or just remove it and use gpuCanvas?
  // User removed CPU. Let's just use the 'gpuCanvas' we created or repurpose 'canvas'?
  // Existing code creates 'gpuCanvas'. Let's stick to that but maybe attach it better.
  // Actually, 'canvas' was the original from HTML. 'gpuCanvas' was dynamic.
  // Let's hide the original canvas or remove it.

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

  let gpuRenderer: GpuRenderer | null = null;

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
  // NO. `canvas { position: absolute; } ` inside a flex container centers them if we use margin:auto? No.

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
      infoDiv.innerText = "GPU Ready";
      startRender();
    }).catch(e => {
      console.error("GPU Fail", e);
      infoDiv.innerText = "GPU Failed to initialize";
    });
  } catch (e) { }

  // --- RENDERING VARS ---
  let pendingRenderId = 0;

  // Progressive Rendering State
  const renderPass = (step: number, renderId: number) => {
    if (renderId !== pendingRenderId) return;

    // Info
    const zoomLevel = Math.log10(3.0 / zoomWidth);
    const maxIter = Math.floor(100 + zoomLevel * 100);
    const resPercent = (100.0 / step).toFixed(1);
    infoDiv.innerText = `Zoom: ${zoomWidth.toExponential(2)} | Iters: ${maxIter} | Res: ${resPercent}% (Step ${step})`;

    const zoomHeight = zoomWidth / FRACTAL_ASPECT;
    const xMin = centerX - zoomWidth / 2;
    const xMax = centerX + zoomWidth / 2;
    const yMin = centerY - zoomHeight / 2;
    const yMax = centerY + zoomHeight / 2;

    if (gpuRenderer) {
      if (gpuCanvas.width !== width) {
        gpuCanvas.width = width;
        gpuCanvas.height = height;
      }
      // Resize is handled once? Or always?
      // Let's ensure renderer is resized to logical dims
      // gpuRenderer.resize(width, height); // This destroys texture!
      // We only resize if dimensions change or initially.
      // Handled in updateLayout.
      // Progressive pass just calls render.

      let startStep = Math.floor(Math.min(width, height) / 2);
      startStep = Math.min(startStep, 64);
      startStep = Math.pow(2, Math.floor(Math.log2(startStep)));
      if (startStep < 1) startStep = 1;

      const reuse = (step < startStep);

      gpuRenderer.render(xMin, xMax, yMin, yMax, maxIter, step, reuse);
    }

    if (step > 1) {
      let nextStep = Math.floor(step / 2);
      if (nextStep < 1) nextStep = 1;
      requestAnimationFrame(() => renderPass(nextStep, renderId));
    }
  };

  const startRender = () => {
    pendingRenderId++;
    const myId = pendingRenderId;
    let startStep = Math.floor(Math.min(width, height) / 2);
    // Cap start step to avoided massive splats (TDR)
    startStep = Math.min(startStep, 64);

    startStep = Math.pow(2, Math.floor(Math.log2(startStep)));
    if (startStep < 1) startStep = 1;

    requestAnimationFrame(() => renderPass(startStep, myId));
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
