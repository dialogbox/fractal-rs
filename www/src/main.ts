import init, { GpuRenderer, setup, RenderParams } from '../../pkg/fractal_rs';
import { PreciseNumber } from './PreciseNumber';

async function run() {
  console.log('Starting App...');
  await init(); 
  setup();
  console.log('Wasm initialized');

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
  const BOUND_X_MIN = -2.5;
  const BOUND_X_MAX = 0.5;
  const BOUND_Y_MIN = -1.5;
  const BOUND_Y_MAX = 1.5;
  /* FRACTAL_W removed */

  const dpr = window.devicePixelRatio || 1;
  let logicalWidth = 800;
  let logicalHeight = 600;
  let width = 800;
  let height = 600;

  // --- STATE ---
  let centerX = PreciseNumber.fromNumber(-1.0);
  let centerY = PreciseNumber.fromNumber(0.0);
  let zoomWidth = PreciseNumber.fromNumber(3.0);

  // Appearance State
  let color1 = '#9cacba';
  let color2 = '#1049ac';
  let brightMin = 0.0;
  let brightMax = 0.8;

  // --- NAVIGATION PHYSICS ---
  const keysHeld = new Set<string>();
  let velX = 0;
  let velY = 0;
  let velZoom = 0;
  const ACCEL = 0.05;
  const FRICTION = 0.85;
  const BASE_MOVE_SPEED = 0.02; // Fraction of screen per frame
  const BASE_ZOOM_SPEED = 0.02;

  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  };

  // URL Params Initialization
  const params = new URLSearchParams(window.location.search);
  const pX = params.get('x');
  const pY = params.get('y');
  const pW = params.get('w');

  if (pX) {
    try {
      centerX = PreciseNumber.fromString(pX);
    } catch (e) {
      console.error('Invalid x param', e);
    }
  }
  if (pY) {
    try {
      centerY = PreciseNumber.fromString(pY);
    } catch (e) {
      console.error('Invalid y param', e);
    }
  }
  if (pW) {
    try {
      zoomWidth = PreciseNumber.fromString(pW);
    } catch (e) {
      console.error('Invalid w param', e);
    }
  } else {
    // If no URL param, defaulting to "contain" logic:
    // We want the shorter axis to cover 3.0 in problem space.
    // If aspect > 1 (Landscape), Height is shorter -> Height=3.0 -> Width = 3.0 * aspect.
    // If aspect < 1 (Portrait), Width is shorter -> Width=3.0.
    const aspect = window.innerWidth / window.innerHeight;
    const initialW = 3.0 * Math.max(1.0, aspect);
    zoomWidth = PreciseNumber.fromNumber(initialW);
  } // Starts showing full width

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

  // Buttons (created once)
  const btnContainer = document.createElement('div');
  btnContainer.id = 'btn-container'; // Add ID for retrieval
  btnContainer.style.marginTop = '8px';
  btnContainer.style.display = 'none'; // Hidden by default
  btnContainer.style.gap = '8px';
  infoDiv.appendChild(btnContainer); // Add to infoDiv

  const btnCopyCoords = document.createElement('button');
  btnCopyCoords.innerText = 'Copy Coords';
  btnCopyCoords.style.cursor = 'pointer';
  btnCopyCoords.style.padding = '4px 8px';

  const btnCopyUrl = document.createElement('button');
  btnCopyUrl.innerText = 'Copy URL';
  btnCopyUrl.style.cursor = 'pointer';
  btnCopyUrl.style.padding = '4px 8px';

  btnContainer.appendChild(btnCopyCoords);
  btnContainer.appendChild(btnCopyUrl);

  // --- APPEARANCE UI ---
  const appearanceDiv = document.createElement('div');
  appearanceDiv.style.marginTop = '15px';
  appearanceDiv.style.display = 'flex';
  appearanceDiv.style.flexDirection = 'column';
  appearanceDiv.style.gap = '10px';
  appearanceDiv.style.borderTop = '1px solid rgba(255,255,255,0.2)';
  appearanceDiv.style.paddingTop = '10px';
  controls.appendChild(appearanceDiv);

  const createControl = (label: string, input: HTMLElement) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.fontSize = '0.9em';
    const l = document.createElement('label');
    l.innerText = label;
    row.appendChild(l);
    row.appendChild(input);
    appearanceDiv.appendChild(row);
  };

  const cp1 = document.createElement('input');
  cp1.type = 'color';
  cp1.value = color1;
  cp1.oninput = () => { color1 = cp1.value; startRender(); };
  createControl('Color 1', cp1);

  const cp2 = document.createElement('input');
  cp2.type = 'color';
  cp2.value = color2;
  cp2.oninput = () => { color2 = cp2.value; startRender(); };
  createControl('Color 2', cp2);

  const sMin = document.createElement('input');
  sMin.type = 'range';
  sMin.min = '0';
  sMin.max = '1';
  sMin.step = '0.01';
  sMin.value = brightMin.toString();
  sMin.oninput = () => { brightMin = parseFloat(sMin.value); startRender(); };
  createControl('Min Bright', sMin);

  const sMax = document.createElement('input');
  sMax.type = 'range';
  sMax.min = '0';
  sMax.max = '1';
  sMax.step = '0.01';
  sMax.value = brightMax.toString();
  sMax.oninput = () => { brightMax = parseFloat(sMax.value); startRender(); };
  createControl('Max Bright', sMax);

  // Copy Logic
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      const originalBg = infoDiv.style.backgroundColor;
      infoDiv.style.backgroundColor = 'rgba(0, 100, 0, 0.8)'; // Flash Green
      setTimeout(() => (infoDiv.style.backgroundColor = originalBg), 200);
    } catch (err) {
      // Fallback for non-secure context (dev) if needed, but modern browsers usually support writeText on localhost
      console.error('Failed to copy', err);
      alert('Clipboard API failed (Context not secure?): ' + err);
    }
  };

  btnCopyCoords.onclick = () => {
    const txt = `x=${centerX.toString()}\ny=${centerY.toString()}\nw=${zoomWidth.toString()}`;
    copyToClipboard(txt);
  };

  btnCopyUrl.onclick = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('x', centerX.toString());
    url.searchParams.set('y', centerY.toString());
    url.searchParams.set('w', zoomWidth.toString());
    copyToClipboard(url.toString());
  };

  // Let's inject a Wrapper.
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'flex';
  wrapper.style.justifyContent = 'center';
  wrapper.style.alignItems = 'center';
  wrapper.style.boxShadow = '0 0 50px black';
  wrapper.style.touchAction = 'none'; // Critical for iOS/Chrome mobile to avoid page scaling
  // CSS for Limit Effects
  const style = document.createElement('style');
  style.innerHTML = `
    .limit-glow {
      box-shadow: inset 0 0 30px 10px rgba(255, 100, 50, 0.8);
      transition: box-shadow 0.05s ease-out; /* Immediate attack */
    }
  `;
  document.head.appendChild(style);
  // Base transition for fade out
  wrapper.style.transition = 'box-shadow 0.5s ease-out';
  document.body.appendChild(wrapper);

  // Glow Overlay (Independent of Wrapper Shadow)
  const glowOverlay = document.createElement('div');
  glowOverlay.style.pointerEvents = 'none'; // Click-through
  glowOverlay.style.zIndex = '100'; // Topmost
  glowOverlay.style.position = 'absolute'; // Or grid area 1/1
  // We'll use grid stack style below
  wrapper.appendChild(glowOverlay);

  // Move canvases into wrapper
  // We need to ensuring they overlap.
  // Grid stack trick:
  wrapper.style.display = 'grid';
  // canvas { grid-area: 1 / 1; }

  // Let's apply styles directly
  const stackStyle = (el: HTMLElement) => {
    el.style.gridArea = '1 / 1';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.display = 'block'; // Overridden by mode switcher
  };

  // Re-parent existing canvas
  if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  wrapper.appendChild(canvas);
  stackStyle(canvas);
  // Stack Glow Overlay too
  stackStyle(glowOverlay);

  wrapper.appendChild(gpuCanvas);
  stackStyle(gpuCanvas);

  // UI Overlay
  const uiCanvas = document.createElement('canvas');
  uiCanvas.style.pointerEvents = 'none';
  uiCanvas.style.zIndex = '50';
  wrapper.appendChild(uiCanvas);
  stackStyle(uiCanvas);
  const uiCtx = uiCanvas.getContext('2d');

  // --- CONSTRAINTS --- (Moved up)
  const applyConstraints = () => {
    let changed = false;

    // 1. Zoom Limits
    // Calculate aspect ratio safe guarding against zero division
    const currentAspect = (width > 0 && height > 0) ? width / height : 1.0;
    const maxZ = 3.0 * Math.max(1.0, currentAspect);
    const MAX_ZOOM = PreciseNumber.fromNumber(maxZ);

    // MIN_ZOOM: Based on F64 precision limit.
    const minZ = (width || 800) * Number.EPSILON * 2.0;
    const MIN_ZOOM = PreciseNumber.fromNumber(minZ);

    let atMin = false;
    let atMax = false;

    if (zoomWidth.lt(MIN_ZOOM)) {
      zoomWidth = MIN_ZOOM;
      changed = true;
      atMin = true;
    }
    if (zoomWidth.toNumber() <= minZ * 1.01) atMin = true;

    if (zoomWidth.gt(MAX_ZOOM)) {
      zoomWidth = MAX_ZOOM;
      changed = true;
      atMax = true;
    }
    if (zoomWidth.toNumber() >= maxZ * 0.99) atMax = true;

    const zoomHeight = zoomWidth.div(currentAspect);

    // Bounds
    const bXMin = PreciseNumber.fromNumber(BOUND_X_MIN);
    const bXMax = PreciseNumber.fromNumber(BOUND_X_MAX);
    const bYMin = PreciseNumber.fromNumber(BOUND_Y_MIN);
    const bYMax = PreciseNumber.fromNumber(BOUND_Y_MAX);

    const minCenterX = bXMin.add(zoomWidth.div(2));
    const maxCenterX = bXMax.sub(zoomWidth.div(2));
    const minCenterY = bYMin.add(zoomHeight.div(2));
    const maxCenterY = bYMax.sub(zoomHeight.div(2));

    let clampedCenterX = centerX;
    let clampedCenterY = centerY;

    // Clamp Center
    if (minCenterX.gt(maxCenterX)) {
      clampedCenterX = bXMin.add(bXMax).div(2);
    } else {
      if (clampedCenterX.lt(minCenterX)) clampedCenterX = minCenterX;
      if (clampedCenterX.gt(maxCenterX)) clampedCenterX = maxCenterX;
    }

    if (minCenterY.gt(maxCenterY)) {
      clampedCenterY = bYMin.add(bYMax).div(2);
    } else {
      if (clampedCenterY.lt(minCenterY)) clampedCenterY = minCenterY;
      if (clampedCenterY.gt(maxCenterY)) clampedCenterY = maxCenterY;
    }

    if (clampedCenterX !== centerX) { centerX = clampedCenterX; changed = true; }
    if (clampedCenterY !== centerY) { centerY = clampedCenterY; changed = true; }

    return { changed, atMin, atMax };
  };

  // --- LAYOUT LOGIC ---
  const updateLayout = () => {
    // Fill the window
    logicalWidth = window.innerWidth;
    logicalHeight = window.innerHeight;

    // Wrapper Size
    wrapper.style.width = '100vw';
    wrapper.style.height = '100vh';
    wrapper.style.margin = '0';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';

    // Physical Resolution
    width = Math.floor(logicalWidth * dpr);
    height = Math.floor(logicalHeight * dpr);

    // Resize Canvases
    [canvas, gpuCanvas, uiCanvas].forEach((el) => {
      el.width = width;
      el.height = height;
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


    // Enforce constraints (handles initial URL params or resize events)
    applyConstraints();

    startRender();
  };

  // Initialize GPU
  try {
    GpuRenderer.new(gpuCanvas)
      .then((r) => {
        gpuRenderer = r;
        gpuRenderer.resize(width, height); // Initial size
        console.log('GPU Ready');
        // infoDiv.innerText = "GPU Ready";
        startRender();
      })
      .catch((e) => {
        console.error('GPU Fail', e);
        infoDiv.innerText = 'GPU Failed to initialize';
      });
  } catch (e) {}

  // --- RENDERING VARS ---
  let pendingRenderId = 0;

  // Progressive Rendering State
  const renderPass = (step: number, renderId: number) => {
    if (renderId !== pendingRenderId) return;

    // Info
    const zoomLevel = Math.log10(3.0 / zoomWidth.toNumber());
    const maxIter = Math.floor(100 + zoomLevel * 100);
    const resPercent = (100.0 / step).toFixed(1);

    // Use a specific span for text to avoid overwriting buttons
    let textSpan = infoDiv.querySelector('#info-text');
    let btnContainer = infoDiv.querySelector('#btn-container') as HTMLElement;

    if (!textSpan) {
      textSpan = document.createElement('div');
      textSpan.id = 'info-text';
      if (btnContainer) {
        infoDiv.insertBefore(textSpan, btnContainer);
      } else {
        infoDiv.appendChild(textSpan);
      }
    }

    textSpan.innerHTML = `
      <div>Zoom: ${zoomWidth.toExponential(2)}</div>
      <div>Iters: ${maxIter}</div>
      <div>Res: ${resPercent}% (Step ${step})</div>
      <div id="coords-detail" style="display: none; font-size: 0.8em; margin-top: 5px; color: #aaa;">
        x=${centerX.toString()}<br>
        y=${centerY.toString()}<br>
        w=${zoomWidth.toString()}
      </div>
    `;

    const details = textSpan.querySelector('#coords-detail') as HTMLElement;

    // We need to attach the hover listener to infoDiv to toggle this specific element too
    infoDiv.onmouseenter = () => {
      if (btnContainer) btnContainer.style.display = 'flex';
      if (details) details.style.display = 'block';
    };
    infoDiv.onmouseleave = () => {
      if (btnContainer) btnContainer.style.display = 'none';
      if (details) details.style.display = 'none';
    };

    // Aspect Ratio Calculation
    // Ensure we don't divide by zero
    const currentAspect = width > 0 && height > 0 ? width / height : 1.0;
    const zoomHeight = zoomWidth.div(currentAspect);

    const xMin = centerX.sub(zoomWidth.div(2));
    const xMax = centerX.add(zoomWidth.div(2));
    const yMin = centerY.sub(zoomHeight.div(2));
    const yMax = centerY.add(zoomHeight.div(2));

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

      const reuse = step < startStep;

      const [c1r, c1g, c1b] = hexToRgb(color1);
      const [c2r, c2g, c2b] = hexToRgb(color2);

      const [xmi_h, xmi_l] = xMin.split();
      const [xma_h, xma_l] = xMax.split();
      const [ymi_h, ymi_l] = yMin.split();
      const [yma_h, yma_l] = yMax.split();

      const params = new RenderParams(
        xmi_h, xmi_l, xma_h, xma_l,
        ymi_h, ymi_l, yma_h, yma_l,
        maxIter, step, reuse,
        c1r, c1g, c1b,
        c2r, c2g, c2b,
        brightMin, brightMax
      );
      gpuRenderer.render(params);
    }

    if (step > 1) {
      let nextStep = Math.floor(step / 2);
      if (nextStep < 1) nextStep = 1;
      requestAnimationFrame(() => renderPass(nextStep, renderId));
    }
  };

  // Limit Effect Helper
  let limitTimer: number | null = null;
  const triggerLimitEffect = () => {
    // Attack: Fast transition
    glowOverlay.style.transition = 'box-shadow 0.05s ease-out';
    glowOverlay.classList.add('limit-glow');
    
    // Clear existing timer (debounce/sustain)
    if (limitTimer) clearTimeout(limitTimer);
    
    // Set timer to remove glow
    limitTimer = window.setTimeout(() => {
      // Decay: Slow fade out
      glowOverlay.style.transition = 'box-shadow 2s ease-out';
      glowOverlay.classList.remove('limit-glow');
      limitTimer = null;
    }, 50); // Match attack time
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


  // --- INTERACTION ---
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let dragStartComplexX = PreciseNumber.fromNumber(0);
  let dragStartComplexY = PreciseNumber.fromNumber(0);

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

    // Map Pixel to Complex (delta)
    const aspect = width / height;
    const mapPixelW = zoomWidth.toNumber() / logicalWidth;
    const mapPixelH = zoomWidth.toNumber() / aspect / logicalHeight;

    // Check limits for panning
    // User requested explicit panning to work even at limits
    // const { atMin } = applyConstraints();
    // if (atMin) return;

    const dX = PreciseNumber.fromNumber(deltaX * mapPixelW);
    const dY = PreciseNumber.fromNumber(deltaY * mapPixelH);

    const prevX = centerX;
    const prevY = centerY;

    centerX = dragStartComplexX.sub(dX);
    centerY = dragStartComplexY.sub(dY);

    applyConstraints(); // Clamp it

    // Only render if changed
    const changed = centerX.toString() !== prevX.toString() ||
                    centerY.toString() !== prevY.toString();
    
    if (changed) startRender();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // --- TOUCH SUPPORT ---
  let initialPinchDistance: number | null = null;
  let initialPinchZoom: PreciseNumber | null = null;
  let initialPinchCenterX: number | null = null;
  let initialPinchCenterY: number | null = null;
  let initialPinchComplexX: PreciseNumber | null = null;
  let initialPinchComplexY: PreciseNumber | null = null;

  const debugTouch = document.createElement('div');
  debugTouch.style.position = 'absolute';
  debugTouch.style.bottom = '10px';
  debugTouch.style.right = '10px';
  debugTouch.style.background = 'rgba(0,0,0,0.5)';
  debugTouch.style.color = 'lime';
  debugTouch.style.padding = '5px';
  debugTouch.style.pointerEvents = 'none';
  debugTouch.style.zIndex = '1000';
  document.body.appendChild(debugTouch);

  const getDistance = (t1: Touch, t2: Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };



  wrapper.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Stop default browser gestures immediately
    if (e.touches.length === 1) {
      // Single Touch Pan
      isDragging = true; // Use existing flag logic for ease
      const t = e.touches[0];
      const rect = wrapper.getBoundingClientRect();
      startX = t.clientX - rect.left;
      startY = t.clientY - rect.top;
      dragStartComplexX = centerX;
      dragStartComplexY = centerY;
    } else if (e.touches.length === 2) {
      // Pinch Zoom
      isDragging = false; // Stop Panning logic
      initialPinchDistance = getDistance(e.touches[0], e.touches[1]);
      initialPinchZoom = zoomWidth;
      
      const rect = wrapper.getBoundingClientRect();
      initialPinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      initialPinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      
      initialPinchComplexX = centerX;
      initialPinchComplexY = centerY;
      
      debugTouch.innerText = `Pinch Start: d=${initialPinchDistance.toFixed(1)}`;
    }
  }, { passive: false });

  wrapper.addEventListener('touchmove', (e) => {
    e.preventDefault(); // Prevent scrolling
    if (e.touches.length === 1 && isDragging) {
      // Pan Logic (Copy of Mouse Logic essentially)
      const t = e.touches[0];
      const rect = wrapper.getBoundingClientRect();
      const currentX = t.clientX - rect.left;
      const currentY = t.clientY - rect.top;

      const deltaX = currentX - startX;
      const deltaY = currentY - startY;

      const aspect = width / height;
      const mapPixelW = zoomWidth.toNumber() / logicalWidth;
      const mapPixelH = zoomWidth.toNumber() / aspect / logicalHeight;

      const dX = PreciseNumber.fromNumber(deltaX * mapPixelW);
      const dY = PreciseNumber.fromNumber(deltaY * mapPixelH);
      
      const prevX = centerX;
      const prevY = centerY;

      centerX = dragStartComplexX.sub(dX);
      centerY = dragStartComplexY.sub(dY);

      applyConstraints(); 
      const changed = centerX.toString() !== prevX.toString() ||
                      centerY.toString() !== prevY.toString();
      if (changed) startRender();

    } else if (e.touches.length === 2 && initialPinchDistance !== null && initialPinchZoom && initialPinchCenterX !== null && initialPinchCenterY !== null && initialPinchComplexX && initialPinchComplexY) {
       // Pinch Logic
       const currentDist = getDistance(e.touches[0], e.touches[1]);
       const scale = initialPinchDistance / currentDist; 
       
       const prevZoom = zoomWidth;
       let newZoomWidth = initialPinchZoom.scale(scale);

       debugTouch.innerText = `Pinch Move: scale=${scale.toFixed(2)} d=${currentDist.toFixed(1)}`;

       // Apply Constraints similar to wheel
       const currentAspect = width / height;
       const maxZ = 3.0 * Math.max(1.0, currentAspect);
       const MAX_ZOOM = PreciseNumber.fromNumber(maxZ);
       const minZ = (width || 800) * Number.EPSILON * 2.0;
       const MIN_ZOOM = PreciseNumber.fromNumber(minZ);

       let hitMin = false;
       let hitMax = false;

       if (newZoomWidth.lt(MIN_ZOOM)) { newZoomWidth = MIN_ZOOM; hitMin = true; }
       if (newZoomWidth.gt(MAX_ZOOM)) { newZoomWidth = MAX_ZOOM; hitMax = true; }

       // Visual Feedback logic reuse
       if (scale < 1.0 && hitMin) triggerLimitEffect(); // Pinch Out (Zoom In)
       if (scale > 1.0 && hitMax) triggerLimitEffect(); // Pinch In (Zoom Out)

       // Center Logic: Zoom towards pinch center
       const uvX = initialPinchCenterX / logicalWidth;
       const uvY = initialPinchCenterY / logicalHeight;

       const currentZoomHeight = initialPinchZoom.div(currentAspect);
       const newZoomHeight = newZoomWidth.div(currentAspect);

       const diffW = initialPinchZoom.sub(newZoomWidth);
       const diffH = currentZoomHeight.sub(newZoomHeight);

       const offX = diffW.mul(uvX - 0.5);
       const offY = diffH.mul(uvY - 0.5);

       centerX = initialPinchComplexX.add(offX);
       centerY = initialPinchComplexY.add(offY);
       zoomWidth = newZoomWidth;

       applyConstraints();
       if (!zoomWidth.eq(prevZoom) || !centerX.eq(initialPinchComplexX) || !centerY.eq(initialPinchComplexY)) startRender();
    }
  }, { passive: false });

  wrapper.addEventListener('touchend', () => {
    isDragging = false;
    initialPinchDistance = null;
    initialPinchZoom = null;
    initialPinchCenterX = null;
    initialPinchCenterY = null;
    initialPinchComplexX = null;
    initialPinchComplexY = null;
    debugTouch.innerText = 'Touch End';
  });

  wrapper.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      
      const prevZoom = zoomWidth;
      const prevX = centerX;
      const prevY = centerY;

      const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;
      let newZoomWidth = zoomWidth.scale(zoomFactor);

      // --- CLAMP PRE-CALCULATION ---
      const currentAspect = width / height;
      const maxZ = 3.0 * Math.max(1.0, currentAspect);
      const MAX_ZOOM = PreciseNumber.fromNumber(maxZ);
      // Ensure minZ matches applyConstraints logic
      const minZ = (width || 800) * Number.EPSILON * 2.0;
      const MIN_ZOOM = PreciseNumber.fromNumber(minZ);

      let hitMin = false;
      let hitMax = false;

      // Check Limits
      if (newZoomWidth.lt(MIN_ZOOM)) {
          newZoomWidth = MIN_ZOOM;
          hitMin = true;
      }
      // Check for effective reach of min limit (epsilon check for logic)
      if (newZoomWidth.toNumber() <= minZ * 1.01) hitMin = true;

      if (newZoomWidth.gt(MAX_ZOOM)) {
          newZoomWidth = MAX_ZOOM;
          hitMax = true;
      }
      if (newZoomWidth.toNumber() >= maxZ * 0.99) hitMax = true;

      // Visual Feedback Logic
      // If we tried to zoom IN (factor < 1) and are hitting MIN
      if (zoomFactor < 1.0 && hitMin) {
        triggerLimitEffect();
      }
      // If we tried to zoom OUT (factor > 1) and are hitting MAX
      if (zoomFactor > 1.0 && hitMax) {
         triggerLimitEffect();
      }

      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // UV Logic (Using clamped newZoomWidth)
      const uvX = mouseX / logicalWidth;
      const uvY = mouseY / logicalHeight;

      const currentZoomHeight = zoomWidth.div(currentAspect);
      const newZoomHeight = newZoomWidth.div(currentAspect);

      // If limits hit, newZoomWidth == zoomWidth (or close), so diffW ~ 0 -> offX ~ 0
      const diffW = zoomWidth.sub(newZoomWidth);
      const diffH = currentZoomHeight.sub(newZoomHeight);

      const offX = diffW.mul(uvX - 0.5);
      const offY = diffH.mul(uvY - 0.5);

      const nextCenterX = centerX.add(offX);
      const nextCenterY = centerY.add(offY);

      centerX = nextCenterX;
      centerY = nextCenterY;
      zoomWidth = newZoomWidth;

      // Apply Constraints for Bounds (zoom is already clamped safely)
      applyConstraints(); 

      // Visual Feedback Logic moved up to happen before offset calc
      // So we can remove the old block

      // Only render if effectively changed
      const effectivelyChanged = !zoomWidth.eq(prevZoom) || 
                      !centerX.eq(prevX) ||
                      !centerY.eq(prevY);

      if (effectivelyChanged) {
         startRender();
      }
    },
    { passive: false },
  );

  window.addEventListener('resize', () => {
    updateLayout();
    applyConstraints(); // Re-clamp zoom based on new aspect ratio
    // startRender called inside updateLayout
  });

  // --- KEYBOARD LOOP ---
  window.addEventListener('keydown', (e) => {
    keysHeld.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    keysHeld.delete(e.code);
  });

  const updatePhysics = () => {
    const prevZoom = zoomWidth;
    const prevX = centerX;
    const prevY = centerY;
    let changed = false;

    // Panning Acceleration
    if (keysHeld.has('ArrowUp')) velY -= ACCEL;
    if (keysHeld.has('ArrowDown')) velY += ACCEL;
    if (keysHeld.has('ArrowLeft')) velX -= ACCEL;
    if (keysHeld.has('ArrowRight')) velX += ACCEL;

    // Zooming Acceleration
    if (keysHeld.has('PageUp')) velZoom -= ACCEL;
    if (keysHeld.has('PageDown')) velZoom += ACCEL;

    // Apply Friction
    velX *= FRICTION;
    velY *= FRICTION;
    velZoom *= FRICTION;

    // Thresholds
    if (Math.abs(velX) < 0.001) velX = 0;
    if (Math.abs(velY) < 0.001) velY = 0;
    if (Math.abs(velZoom) < 0.001) velZoom = 0;

    if (velX !== 0 || velY !== 0) {
      const aspect = width / height;
      const moveScale = zoomWidth.toNumber() * BASE_MOVE_SPEED;
      // Prevent panning if at max zoom in (pincushion state) removed
      // We allow panning attempts, but applyConstraints will clamp them.
      centerX = centerX.add(PreciseNumber.fromNumber(velX * moveScale));
      centerY = centerY.add(PreciseNumber.fromNumber(velY * moveScale / aspect));
      changed = true;
    }

    if (velZoom !== 0) {
      const zoomFactor = 1.0 + velZoom * BASE_ZOOM_SPEED;
      zoomWidth = zoomWidth.scale(zoomFactor);
      changed = true;
    }

    if (changed) {
      applyConstraints();
      
      const effectivelyChanged = !zoomWidth.eq(prevZoom) || 
                                 !centerX.eq(prevX) || 
                                 !centerY.eq(prevY);

      if (effectivelyChanged) {
        startRender();
      } else {
        // If Logic pushed, but Constraint blocked -> Trigger Limit Effect
        const { atMin, atMax } = applyConstraints(); // Re-check state
        // Check intent vs limit
        if (velZoom > 0 && atMax) triggerLimitEffect();
        if (velZoom < 0 && atMin) triggerLimitEffect();
      }
    }

    requestAnimationFrame(updatePhysics);
  };

  updatePhysics();

  // Start
  updateLayout(); // Sets sizes, creates renderer
}

run();
