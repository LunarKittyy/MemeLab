/**
 * Draw tools: brush, eraser, line, ellipse, polygon, gradient fill, bucket fill, eyedropper.
 *
 * All tools store strokes as vector data on layer.strokes.
 * Rasterization happens in src/render/drawLayer.js.
 *
 * Live preview: a per-layer overlay canvas sits on top of the stage canvas during
 * an active stroke. On commit it's discarded and the stroke is pushed to layer.strokes.
 */

import { state, getSelected, drawState } from '../core/state.js';
import { stage, stageCtx, scheduleRender, dispScaleFactor } from '../render/renderer.js';
import { pushHistory } from '../core/history.js';
import { invalidateDrawCache, paintStroke, rasterizeStrokes } from '../render/drawLayer.js';

// ---- Live preview overlay ----

let _overlayCanvas = null;
let _overlayCtx = null;

function ensureOverlay(layer) {
  if (!_overlayCanvas) {
    _overlayCanvas = document.createElement('canvas');
    _overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    const wrap = document.getElementById('canvasWrap');
    if (wrap) wrap.appendChild(_overlayCanvas);
  }
  _overlayCanvas.width = layer.w;
  _overlayCanvas.height = layer.h;
  _overlayCtx = _overlayCanvas.getContext('2d');
  _overlayCtx.clearRect(0, 0, layer.w, layer.h);
}

function clearOverlay() {
  if (_overlayCanvas) {
    const ctx = _overlayCtx || _overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
  }
}

// ---- Coordinate mapping ----

function projectCoords(evt) {
  const rect = stage.getBoundingClientRect();
  const sx = state.width / rect.width;
  const sy = state.height / rect.height;
  return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
}

// ---- Active stroke state ----

let _activeStroke = null; // current in-progress stroke
let _committedBitmap = null; // pre-rendered bitmap of all committed strokes

// ---- Pointer event handlers ----

export function drawToolsPointerDown(evt) {
  const layer = getActiveDrawLayer();
  if (!layer) return;

  const p = projectCoords(evt);
  const tool = drawState.activeTool;

  if (tool === 'eyedropper') {
    handleEyedropper(p, layer);
    return;
  }

  if (tool === 'bucket') {
    handleBucketFill(p, layer);
    return;
  }

  // For drawing tools begin an active stroke
  if (tool === 'brush' || tool === 'eraser') {
    _activeStroke = {
      tool,
      color: drawState.brushColor,
      opacity: drawState.brushOpacity,
      size: drawState.brushSize,
      hardness: drawState.brushHardness,
      points: [[p.x, p.y, evt.pressure || 0.5]],
    };
    ensureOverlay(layer);
    // Render committed strokes into the pre-fill bitmap
    _committedBitmap = rasterizeStrokes(layer);
    renderLivePreview(layer);
    return;
  }

  if (tool === 'line' || tool === 'ellipse' || tool === 'gradient') {
    _activeStroke = {
      tool,
      color: drawState.brushColor,
      color2: drawState.gradientType ? drawState.gradientColor2 : '#0000ff',
      gradientType: drawState.gradientType || 'linear',
      opacity: drawState.brushOpacity,
      size: drawState.brushSize,
      x1: p.x, y1: p.y, x2: p.x, y2: p.y,
    };
    ensureOverlay(layer);
    _committedBitmap = rasterizeStrokes(layer);
    renderLivePreview(layer);
    return;
  }

  if (tool === 'polygon') {
    // First click starts; subsequent clicks add vertices; double-click closes
    if (!_activeStroke) {
      _activeStroke = {
        tool: 'polygon',
        color: drawState.brushColor,
        opacity: drawState.brushOpacity,
        size: drawState.brushSize,
        vertices: [[p.x, p.y]],
        _open: true,
        _lastX: p.x, _lastY: p.y,
      };
      ensureOverlay(layer);
      _committedBitmap = rasterizeStrokes(layer);
    } else if (_activeStroke.tool === 'polygon') {
      // Check for double-click (close polygon)
      const last = _activeStroke.vertices[_activeStroke.vertices.length - 1];
      const dist = Math.hypot(p.x - last[0], p.y - last[1]);
      if (dist < 10 && _activeStroke.vertices.length > 2) {
        // Close and commit
        commitPolygon(layer);
        return;
      }
      _activeStroke.vertices.push([p.x, p.y]);
      _activeStroke._lastX = p.x; _activeStroke._lastY = p.y;
    }
    renderLivePreview(layer);
  }
}

export function drawToolsPointerMove(evt) {
  if (!_activeStroke) return;
  const layer = getActiveDrawLayer();
  if (!layer) return;

  const p = projectCoords(evt);
  const tool = _activeStroke.tool;

  if (tool === 'brush' || tool === 'eraser') {
    _activeStroke.points.push([p.x, p.y, evt.pressure || 0.5]);
    renderLivePreview(layer);
  } else if (tool === 'line' || tool === 'ellipse' || tool === 'gradient') {
    _activeStroke.x2 = p.x;
    _activeStroke.y2 = p.y;
    renderLivePreview(layer);
  } else if (tool === 'polygon') {
    _activeStroke._lastX = p.x;
    _activeStroke._lastY = p.y;
    renderLivePreview(layer);
  }
}

export function drawToolsPointerUp(evt) {
  if (!_activeStroke) return;
  const layer = getActiveDrawLayer();
  if (!layer) return;

  const tool = _activeStroke.tool;

  if (tool === 'polygon') {
    // Polygon is committed on double-click (handled in pointerDown), not pointerUp
    return;
  }

  commitStroke(layer);
}

// ---- Stroke commit ----

function commitStroke(layer) {
  if (!_activeStroke) return;

  // Skip degenerate strokes
  if (_activeStroke.tool === 'brush' || _activeStroke.tool === 'eraser') {
    if (!_activeStroke.points || _activeStroke.points.length === 0) {
      _activeStroke = null;
      clearOverlay();
      return;
    }
  }

  const stroke = { ..._activeStroke };
  delete stroke._open;
  delete stroke._lastX;
  delete stroke._lastY;

  layer.strokes = (layer.strokes || []);
  layer.strokes.push(stroke);
  invalidateDrawCache(layer.id);
  _activeStroke = null;
  _committedBitmap = null;
  clearOverlay();
  pushHistory('Brush stroke');
  scheduleRender();
  // Refresh props panel stroke count
  const body = document.getElementById('propsBody');
  const cnt = body && body.querySelector('#drawStrokeCount');
  if (cnt) cnt.textContent = layer.strokes.length + ' stroke' + (layer.strokes.length === 1 ? '' : 's');
}

function commitPolygon(layer) {
  if (!_activeStroke || _activeStroke.tool !== 'polygon') return;
  const stroke = {
    tool: 'polygon',
    color: _activeStroke.color,
    opacity: _activeStroke.opacity,
    size: _activeStroke.size,
    vertices: _activeStroke.vertices,
  };
  layer.strokes = (layer.strokes || []);
  layer.strokes.push(stroke);
  invalidateDrawCache(layer.id);
  _activeStroke = null;
  _committedBitmap = null;
  clearOverlay();
  pushHistory('Polygon stroke');
  scheduleRender();
}

// ---- Live preview rendering ----

function renderLivePreview(layer) {
  if (!_overlayCtx || !_activeStroke) return;
  const w = layer.w, h = layer.h;
  _overlayCtx.clearRect(0, 0, w, h);

  // Draw committed strokes base
  if (_committedBitmap) {
    _overlayCtx.drawImage(_committedBitmap, 0, 0, w, h);
  }

  // Draw active stroke on top
  const stroke = _activeStroke;
  if (stroke.tool === 'polygon') {
    // Draw polyline in progress
    const verts = stroke.vertices;
    if (verts.length < 1) return;
    _overlayCtx.save();
    _overlayCtx.strokeStyle = stroke.color || '#000000';
    _overlayCtx.lineWidth = stroke.size || 2;
    _overlayCtx.lineCap = 'round';
    _overlayCtx.lineJoin = 'round';
    _overlayCtx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
    _overlayCtx.beginPath();
    _overlayCtx.moveTo(verts[0][0], verts[0][1]);
    for (let i = 1; i < verts.length; i++) _overlayCtx.lineTo(verts[i][0], verts[i][1]);
    // Rubber-band to cursor
    if (stroke._lastX != null) _overlayCtx.lineTo(stroke._lastX, stroke._lastY);
    _overlayCtx.stroke();
    _overlayCtx.restore();
  } else {
    paintStroke(_overlayCtx, stroke, w, h);
  }
}

// ---- Eyedropper ----

function handleEyedropper(p, layer) {
  // Sample from the stage canvas (composite of all layers)
  const rect = stage.getBoundingClientRect();
  const px = Math.round(p.x / state.width * rect.width);
  const py = Math.round(p.y / state.height * rect.height);

  // Use the actual canvas pixel (the canvas is scaled by dpr)
  const canvasX = Math.round(p.x * (stage.width / state.width));
  const canvasY = Math.round(p.y * (stage.height / state.height));

  try {
    const data = stageCtx.getImageData(canvasX, canvasY, 1, 1).data;
    const hex = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    drawState.brushColor = hex;
    // Update the mini-toolbar color swatch if present
    updateMiniToolbar();
    // Update props panel color input if visible
    const colorEl = document.getElementById('dBrushColor');
    if (colorEl) colorEl.value = hex;
  } catch (e) {
    // Cross-origin or security error — ignore
    console.warn('Eyedropper: could not read pixel', e);
  }
  // Revert to brush after eyedrop
  drawState.activeTool = 'brush';
  updateToolSegButtons();
  updateCursor();
}

// ---- Bucket fill (BFS flood fill) ----

function handleBucketFill(p, layer) {
  const w = layer.w, h = layer.h;

  // Rasterize current strokes to a temp canvas to get existing pixels
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w; tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');
  const existing = rasterizeStrokes(layer);
  if (existing) tempCtx.drawImage(existing, 0, 0);

  const imgData = tempCtx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const sx = Math.round(p.x);
  const sy = Math.round(p.y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

  const targetIdx = (sy * w + sx) * 4;
  const tr = data[targetIdx], tg = data[targetIdx + 1], tb = data[targetIdx + 2], ta = data[targetIdx + 3];

  // Parse fill color
  const fillHex = drawState.brushColor.replace('#', '');
  const fr = parseInt(fillHex.slice(0, 2), 16);
  const fg = parseInt(fillHex.slice(2, 4), 16);
  const fb = parseInt(fillHex.slice(4, 6), 16);
  const fa = 255;

  // If target color is same as fill color, do nothing
  if (tr === fr && tg === fg && tb === fb && ta === fa) return;

  const tolerance = 30;
  function colorMatch(idx) {
    return Math.abs(data[idx] - tr) <= tolerance &&
           Math.abs(data[idx + 1] - tg) <= tolerance &&
           Math.abs(data[idx + 2] - tb) <= tolerance &&
           Math.abs(data[idx + 3] - ta) <= tolerance;
  }

  // BFS
  const visited = new Uint8Array(w * h);
  const queue = [sx + sy * w];
  visited[sy * w + sx] = 1;
  const filled = [];

  while (queue.length > 0) {
    const pos = queue.shift();
    filled.push(pos);
    const x = pos % w, y = Math.floor(pos / w);
    const neighbors = [];
    if (x > 0) neighbors.push(pos - 1);
    if (x < w - 1) neighbors.push(pos + 1);
    if (y > 0) neighbors.push(pos - w);
    if (y < h - 1) neighbors.push(pos + w);
    for (const nb of neighbors) {
      if (visited[nb]) continue;
      visited[nb] = 1;
      if (colorMatch(nb * 4)) queue.push(nb);
    }
  }

  // Compute bounding box of filled region to store compact ImageData
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (const pos of filled) {
    const fx2 = pos % w, fy2 = Math.floor(pos / w);
    if (fx2 < minX) minX = fx2; if (fx2 > maxX) maxX = fx2;
    if (fy2 < minY) minY = fy2; if (fy2 > maxY) maxY = fy2;
  }
  if (filled.length === 0) return;

  const fw = maxX - minX + 1;
  const fh = maxY - minY + 1;
  const fillData = new Uint8ClampedArray(fw * fh * 4); // start transparent

  for (const pos of filled) {
    const fx2 = pos % w - minX;
    const fy2 = Math.floor(pos / w) - minY;
    const di = (fy2 * fw + fx2) * 4;
    fillData[di] = fr; fillData[di + 1] = fg; fillData[di + 2] = fb; fillData[di + 3] = fa;
  }

  const stroke = {
    tool: 'fill',
    color: drawState.brushColor,
    opacity: drawState.brushOpacity,
    filledData: Array.from(fillData),
    fx: minX, fy: minY, fw, fh,
  };

  layer.strokes = (layer.strokes || []);
  layer.strokes.push(stroke);
  invalidateDrawCache(layer.id);
  pushHistory('Bucket fill');
  scheduleRender();
}

// ---- Mini toolbar ----

let _miniToolbar = null;

export function ensureMiniToolbar() {
  if (_miniToolbar) return;
  _miniToolbar = document.createElement('div');
  _miniToolbar.id = 'drawMiniToolbar';
  _miniToolbar.style.cssText = `
    position:fixed;
    display:none;
    align-items:center;
    gap:8px;
    background:var(--panel,#1a1625);
    border:1px solid var(--border,#2e2840);
    border-radius:8px;
    padding:6px 10px;
    z-index:1000;
    box-shadow:0 4px 16px rgba(0,0,0,0.4);
    font-size:12px;
    color:var(--text,#e8e0f0);
    pointer-events:none;
  `;
  document.body.appendChild(_miniToolbar);
}

export function updateMiniToolbar() {
  if (!_miniToolbar) ensureMiniToolbar();
  const tool = drawState.activeTool;
  if (!tool || tool === 'select') {
    _miniToolbar.style.display = 'none';
    return;
  }
  _miniToolbar.style.display = 'flex';
  _miniToolbar.innerHTML = `
    <span style="width:14px;height:14px;border-radius:50%;background:${drawState.brushColor};border:2px solid #fff;display:inline-block;"></span>
    <span>${drawState.brushColor}</span>
    <span style="color:var(--text-dim,#9b92b0);">&#8709;${drawState.brushSize}px</span>
    <span style="color:var(--text-dim,#9b92b0);">${Math.round(drawState.brushOpacity * 100)}%</span>
    <span style="color:var(--text-dim,#9b92b0);font-style:italic;">${tool}</span>
  `;
  // Position near top-left of canvas
  const wrap = document.getElementById('canvasWrap');
  if (wrap) {
    const r = wrap.getBoundingClientRect();
    _miniToolbar.style.left = (r.left + 8) + 'px';
    _miniToolbar.style.top = (r.top - 44) + 'px';
  }
}

// ---- Cursor / tool-mode helpers ----

export function updateCursor() {
  const tool = drawState.activeTool;
  if (!stage) return;
  if (tool === 'select' || !tool) {
    stage.style.cursor = '';
  } else if (tool === 'eyedropper') {
    stage.style.cursor = 'crosshair';
  } else if (tool === 'bucket') {
    stage.style.cursor = 'cell';
  } else {
    stage.style.cursor = 'crosshair';
  }
}

export function updateToolSegButtons() {
  document.querySelectorAll('.draw-tool-seg button[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === drawState.activeTool);
  });
}

// ---- Helpers ----

function getActiveDrawLayer() {
  const layer = getSelected();
  if (!layer || layer.type !== 'draw') return null;
  return layer;
}

/**
 * Abort any in-progress stroke without committing. Called when tool changes
 * or layer is deselected mid-stroke.
 */
export function abortActiveStroke() {
  if (_activeStroke) {
    _activeStroke = null;
    _committedBitmap = null;
    clearOverlay();
  }
}
