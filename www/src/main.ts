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

  const render = () => {
    const aspectRatio = width / height;
    const zoomHeight = zoomWidth / aspectRatio;

    const xMin = centerX - zoomWidth / 2;
    const xMax = centerX + zoomWidth / 2;
    const yMin = centerY - zoomHeight / 2;
    const yMax = centerY + zoomHeight / 2;

    // Reduce logging frequency or level
    // console.log(`Rendering: mode=${mode}, center=(${centerX}, ${centerY}), width=${zoomWidth}`);

    const zoomLevel = Math.log10(3.0 / zoomWidth);
    const maxIter = Math.floor(100 + zoomLevel * 100);

    infoDiv.innerText = `Zoom: ${zoomWidth.toExponential(2)} | Iters: ${maxIter}`;

    if (mode === 'cpu' && cpuRenderer && ctx) {
      cpuRenderer.render(xMin, xMax, yMin, yMax, maxIter);
      const pixelsPtr = cpuRenderer.get_pixels();
      const pixelsLen = cpuRenderer.get_pixels_len();
      const memory = wasm.memory;
      const pixels = new Uint8ClampedArray(memory.buffer, pixelsPtr, pixelsLen);
      const imageData = new ImageData(pixels, width, height);
      ctx.putImageData(imageData, 0, 0);
    } else if (mode === 'gpu' && gpuRenderer) {
      gpuRenderer.render(xMin, xMax, yMin, yMax, maxIter);
    }
  };

  const switchMode = (newMode: 'cpu' | 'gpu') => {
    if (newMode === mode) return;
    mode = newMode;

    if (mode === 'cpu') {
      canvas.style.display = 'block';
      gpuCanvas.style.display = 'none';
      if (cpuRenderer) render();
    } else {
      canvas.style.display = 'none';
      gpuCanvas.style.display = 'block';
      if (gpuRenderer) render();
    }
  };

  // Helper: Map pixel to complex
  const toComplex = (x: number, y: number) => {
    // x, y are LOGICAL pixels from mouse event
    const aspectRatio = logicalWidth / logicalHeight;
    const zoomHeight = zoomWidth / aspectRatio;
    // Map relative to LOGICAL width/height
    const mapX = centerX - zoomWidth / 2 + (x / logicalWidth) * zoomWidth;
    const mapY = centerY - zoomHeight / 2 + (y / logicalHeight) * zoomHeight;
    return { cx: mapX, cy: mapY };
  };

  render();

  // Interaction (Attached to Window to catch both canvases)
  window.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
  });

  // UI Overlay Canvas
  const uiCanvas = document.createElement('canvas');
  uiCanvas.style.position = 'absolute';
  uiCanvas.style.top = '0';
  uiCanvas.style.left = '0';
  uiCanvas.style.pointerEvents = 'none'; // Let clicks pass through
  uiCanvas.width = width;
  uiCanvas.height = height;
  uiCanvas.style.width = logicalWidth + 'px';
  uiCanvas.style.height = logicalHeight + 'px';
  uiCanvas.style.zIndex = '50'; // On top of render canvases, below controls
  document.body.appendChild(uiCanvas);
  const uiCtx = uiCanvas.getContext('2d');
  if (uiCtx) {
    uiCtx.scale(dpr, dpr);
  }

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !uiCtx) return;

    uiCtx.clearRect(0, 0, width, height);

    const currentX = e.clientX;
    const currentY = e.clientY;
    const w = currentX - startX;
    const h = currentY - startY;

    uiCtx.strokeStyle = e.shiftKey ? 'red' : 'white';
    uiCtx.lineWidth = 2;
    uiCtx.strokeRect(startX, startY, w, h);
    // Note: We don't need to manually scale strokeRect coords if we called uiCtx.scale(dpr,dpr)
    // because startX/Y are logical, and context scale handles mapping to physical.
  });

  window.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    if (uiCtx) uiCtx.clearRect(0, 0, width, height);

    const endX = e.clientX;
    const endY = e.clientY;
    const deltaX = Math.abs(endX - startX);
    const deltaY = Math.abs(endY - startY);

    if (deltaX < 5 && deltaY < 5) return;

    const boxCenterXPix = (startX + endX) / 2;
    const boxCenterYPix = (startY + endY) / 2;
    const { cx: newCenterX, cy: newCenterY } = toComplex(boxCenterXPix, boxCenterYPix);
    const factor = deltaX / logicalWidth;

    if (factor === 0) return;

    if (e.shiftKey) {
      zoomWidth = zoomWidth / factor;
    } else {
      zoomWidth = zoomWidth * factor;
    }

    centerX = newCenterX;
    centerY = newCenterY;
    render();
  });

  window.addEventListener('resize', () => {
    logicalWidth = window.innerWidth;
    logicalHeight = window.innerHeight;
    width = Math.floor(logicalWidth * dpr);
    height = Math.floor(logicalHeight * dpr);

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = logicalWidth + 'px';
    canvas.style.height = logicalHeight + 'px';

    gpuCanvas.width = width;
    gpuCanvas.height = height;
    gpuCanvas.style.width = logicalWidth + 'px';
    gpuCanvas.style.height = logicalHeight + 'px';

    uiCanvas.width = width;
    uiCanvas.height = height;
    uiCanvas.style.width = logicalWidth + 'px';
    uiCanvas.style.height = logicalHeight + 'px';

    // UI Canvas needs scaling for logical drawing if we rely on transform, 
    // OR we scale coordinates manually. Let's use transform for UI simplicity.
    if (uiCtx) {
      uiCtx.scale(dpr, dpr);
    }

    if (cpuRenderer) cpuRenderer.resize(width, height);
    if (gpuRenderer) gpuRenderer.resize(width, height);

    render();
  });
}

run();
