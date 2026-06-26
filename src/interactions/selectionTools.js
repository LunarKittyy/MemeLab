/**
 * selectionTools.js — Lasso, Polygon, Magic Wand, and Gradient Mask tools.
 *
 * All tools produce a mask PNG stored as a dataURL string in layer.mask.src.
 * Format: R=G=B=gray, A=255. White=reveal, black=hide (matches drawImageLayer).
 */
import { getSelected } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender } from '../render/renderer.js';
import { deg2rad, rotVec } from '../core/utils.js';
import { overlay } from './toolOverlay.js';

// ---- public accessors for overlay state (read by renderer via toolOverlay) ----
// Everything is stored in the shared `overlay` object.

/** Magic wand tolerance (0–255). */
let _wandTolerance = 30;
export function setWandTolerance(v) { _wandTolerance = v; }
export function getWandTolerance() { return _wandTolerance; }

/** Gradient type: 'linear' | 'radial' */
let _gradientType = 'linear';
export function setGradientType(t) { _gradientType = t; }
export function getGradientType() { return _gradientType; }

// For the UI to read initial values
export const wandTolerance = { get value() { return _wandTolerance; } };
export const gradientType = { get value() { return _gradientType; } };

// ---- helper: convert canvas-space point to layer-local space ----
function toLayerLocal(layer, px, py) {
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  const local = rotVec(px - cx, py - cy, -deg2rad(layer.rotation));
  // layer-local coords: (0,0) at layer top-left
  return { x: local.x + layer.w / 2, y: local.y + layer.h / 2 };
}

// ---- helper: build a mask canvas from a closed polygon (in layer-local coords) ----
function rasterizePolygon(layer, polyPoints) {
  const w = Math.ceil(layer.w), h = Math.ceil(layer.h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  if (polyPoints.length < 2) return canvas;
  // White filled path
  ctx.beginPath();
  ctx.moveTo(polyPoints[0].x, polyPoints[0].y);
  for (let i = 1; i < polyPoints.length; i++) {
    ctx.lineTo(polyPoints[i].x, polyPoints[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return canvas;
}

// ---- helper: commit a mask canvas to the layer ----
function commitMask(layer, maskCanvas, historyLabel) {
  if (!layer.mask) layer.mask = { enabled: false, src: null, invert: false, feather: 0 };
  layer.mask.src = maskCanvas.toDataURL('image/png');
  layer.mask.enabled = true;
  scheduleRender();
  pushHistory(historyLabel);
}

// ============================================================
// LASSO
// ============================================================

export function lassoPointerDown(p) {
  overlay.lassoPoints = [p];
}

export function lassoPointerMove(p) {
  if (overlay.lassoPoints.length === 0) return;
  overlay.lassoPoints.push(p);
  scheduleRender();
}

export function lassoPointerUp() {
  if (overlay.lassoPoints.length < 3) {
    overlay.lassoPoints = [];
    scheduleRender();
    return;
  }
  const layer = getSelected();
  if (!layer || layer.type !== 'image') {
    overlay.lassoPoints = [];
    scheduleRender();
    return;
  }
  const local = overlay.lassoPoints.map((pt) => toLayerLocal(layer, pt.x, pt.y));
  const maskCanvas = rasterizePolygon(layer, local);
  commitMask(layer, maskCanvas, 'Lasso selection');
  overlay.lassoPoints = [];
  scheduleRender();
}

export function lassoCancel() {
  overlay.lassoPoints = [];
  scheduleRender();
}

// ============================================================
// POLYGON
// ============================================================

export function polygonPointerDown(p) {
  if (!overlay.polygonOpen) {
    // Start new polygon
    overlay.polygonVertices = [p];
    overlay.polygonOpen = true;
  } else {
    // Check if close to first vertex (within 20px canvas-space)
    if (overlay.polygonVertices.length >= 3) {
      const first = overlay.polygonVertices[0];
      const dist = Math.hypot(p.x - first.x, p.y - first.y);
      if (dist <= 20) {
        polygonClose();
        return;
      }
    }
    overlay.polygonVertices.push(p);
  }
  scheduleRender();
}

export function polygonClose() {
  if (overlay.polygonVertices.length < 3) {
    polygonCancel();
    return;
  }
  const layer = getSelected();
  if (!layer || layer.type !== 'image') {
    polygonCancel();
    return;
  }
  const local = overlay.polygonVertices.map((pt) => toLayerLocal(layer, pt.x, pt.y));
  const maskCanvas = rasterizePolygon(layer, local);
  commitMask(layer, maskCanvas, 'Polygon selection');
  overlay.polygonVertices = [];
  overlay.polygonOpen = false;
  scheduleRender();
}

export function polygonCancel() {
  overlay.polygonVertices = [];
  overlay.polygonOpen = false;
  scheduleRender();
}

// ============================================================
// MAGIC WAND
// ============================================================

export async function wandPointerDown(p) {
  const layer = getSelected();
  if (!layer || layer.type !== 'image') return;

  // Render the layer (without mask) to an offscreen canvas
  const w = Math.ceil(layer.w), h = Math.ceil(layer.h);
  const offCanvas = document.createElement('canvas');
  offCanvas.width = w;
  offCanvas.height = h;
  const offCtx = offCanvas.getContext('2d');

  const { ensureImage } = await import('../core/state.js');
  const { getAdjustedCanvas } = await import('../render/adjustCache.js');
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return;

  const adjCanvas = getAdjustedCanvas(layer);
  if (adjCanvas) {
    offCtx.drawImage(adjCanvas, 0, 0, w, h);
  } else {
    offCtx.save();
    if (layer.flipX || layer.flipY) {
      offCtx.translate(w / 2, h / 2);
      offCtx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      offCtx.translate(-w / 2, -h / 2);
    }
    const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
    offCtx.drawImage(img,
      crop.x * img.naturalWidth, crop.y * img.naturalHeight,
      crop.w * img.naturalWidth, crop.h * img.naturalHeight,
      0, 0, w, h);
    offCtx.restore();
  }

  let imageData;
  try {
    imageData = offCtx.getImageData(0, 0, w, h);
  } catch (e) {
    console.warn('Magic wand: cannot read pixels (tainted canvas)', e);
    return;
  }

  const data = imageData.data;

  // Convert the tap point from canvas space to layer-local
  const local = toLayerLocal(layer, p.x, p.y);
  const lx = Math.round(local.x);
  const ly = Math.round(local.y);

  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return;

  // Seed pixel color
  const idx0 = (ly * w + lx) * 4;
  const r0 = data[idx0], g0 = data[idx0 + 1], b0 = data[idx0 + 2];

  const tol = _wandTolerance;

  // BFS flood fill
  const visited = new Uint8Array(w * h);
  const mask = new Uint8Array(w * h); // 1 = selected

  const queue = [lx + ly * w];
  visited[lx + ly * w] = 1;
  mask[lx + ly * w] = 1;

  while (queue.length > 0) {
    const pos = queue.shift();
    const qx = pos % w, qy = (pos / w) | 0;
    const neighbors = [
      [qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = nx + ny * w;
      if (visited[ni]) continue;
      visited[ni] = 1;
      const bi = ni * 4;
      const dr = data[bi] - r0, dg = data[bi + 1] - g0, db = data[bi + 2] - b0;
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= tol) {
        mask[ni] = 1;
        queue.push(ni);
      }
    }
  }

  // Build mask canvas: selected = white (255), unselected = black (0), A=255
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d');
  const maskData = maskCtx.createImageData(w, h);
  const md = maskData.data;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0;
    md[i * 4] = v;
    md[i * 4 + 1] = v;
    md[i * 4 + 2] = v;
    md[i * 4 + 3] = 255;
  }
  maskCtx.putImageData(maskData, 0, 0);
  commitMask(layer, maskCanvas, 'Magic wand selection');
}

// ============================================================
// GRADIENT MASK
// ============================================================

export function gradientPointerDown(p) {
  overlay.gradientStart = p;
  overlay.gradientEnd = null;
}

export function gradientPointerMove(p) {
  if (!overlay.gradientStart) return;
  overlay.gradientEnd = p;
  scheduleRender();
}

export function gradientPointerUp(p) {
  if (!overlay.gradientStart) return;
  overlay.gradientEnd = p;

  const layer = getSelected();
  if (!layer || layer.type !== 'image') {
    overlay.gradientStart = null;
    overlay.gradientEnd = null;
    scheduleRender();
    return;
  }

  const startLocal = toLayerLocal(layer, overlay.gradientStart.x, overlay.gradientStart.y);
  const endLocal = toLayerLocal(layer, overlay.gradientEnd.x, overlay.gradientEnd.y);

  const w = Math.ceil(layer.w), h = Math.ceil(layer.h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  let grad;
  if (_gradientType === 'radial') {
    const dist = Math.hypot(endLocal.x - startLocal.x, endLocal.y - startLocal.y);
    if (dist < 1) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    } else {
      grad = ctx.createRadialGradient(startLocal.x, startLocal.y, 0, startLocal.x, startLocal.y, dist);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#000000');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    // Linear
    const dx = endLocal.x - startLocal.x, dy = endLocal.y - startLocal.y;
    if (Math.hypot(dx, dy) < 1) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    } else {
      grad = ctx.createLinearGradient(startLocal.x, startLocal.y, endLocal.x, endLocal.y);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#000000');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  commitMask(layer, canvas, 'Gradient mask');
  overlay.gradientStart = null;
  overlay.gradientEnd = null;
  scheduleRender();
}

export function gradientCancel() {
  overlay.gradientStart = null;
  overlay.gradientEnd = null;
  scheduleRender();
}

// ---- cursor tracking (for overlay) ----
export function updateCursor(p) {
  overlay.cursorPos = p;
}

export function clearCursor() {
  overlay.cursorPos = null;
}
