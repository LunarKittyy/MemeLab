/**
 * brushMask.js — Brush-paint mask tool.
 *
 * Paints directly onto the layer mask by drawing white (reveal) or black (hide)
 * circles on an offscreen canvas that represents the running mask state.
 * On pointerup the canvas is serialized to layer.mask.src and pushed to history.
 */
import { getSelected } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender } from '../render/renderer.js';
import { deg2rad, rotVec } from '../core/utils.js';
import { overlay } from './toolOverlay.js';

export function setBrushSize(v) {
  overlay.brushSize = v;
}
export function setBrushMode(v) {
  overlay.brushMode = v;
}

// Convenience getters for the UI to read current values
export const brushSize = { get value() { return overlay.brushSize; } };
export const brushMode = { get value() { return overlay.brushMode; } };

// ---- internal ----
let _brushCanvas = null;   // offscreen canvas holding the current mask
let _brushCtx = null;
let _painting = false;
let _targetLayer = null;
let _lastPt = null;        // last painted point (for smooth strokes)

// ---- coordinate transform ----
function toLayerLocal(layer, px, py) {
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  const local = rotVec(px - cx, py - cy, -deg2rad(layer.rotation));
  return { x: local.x + layer.w / 2, y: local.y + layer.h / 2 };
}

// ---- load the current mask into the working canvas ----
async function activateBrushLayer(layer) {
  const w = Math.ceil(layer.w), h = Math.ceil(layer.h);
  _brushCanvas = document.createElement('canvas');
  _brushCanvas.width = w;
  _brushCanvas.height = h;
  _brushCtx = _brushCanvas.getContext('2d');

  if (layer.mask?.src) {
    // Decode existing mask
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        _brushCtx.drawImage(img, 0, 0, w, h);
        resolve();
      };
      img.onerror = resolve; // fall through: start with black canvas
      img.src = layer.mask.src;
    });
  } else {
    // No existing mask: start fully white (reveal everything)
    _brushCtx.fillStyle = '#ffffff';
    _brushCtx.fillRect(0, 0, w, h);
  }
  _targetLayer = layer;
}

// ---- draw a paint stroke circle ----
function paintAt(lx, ly) {
  if (!_brushCtx) return;
  _brushCtx.beginPath();
  _brushCtx.arc(lx, ly, overlay.brushSize, 0, Math.PI * 2);
  _brushCtx.fillStyle = overlay.brushMode === 'reveal' ? '#ffffff' : '#000000';
  _brushCtx.fill();
}

// ---- paint a line segment between two points for smooth strokes ----
function paintLine(ax, ay, bx, by) {
  if (!_brushCtx) return;
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / (overlay.brushSize * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintAt(ax + (bx - ax) * t, ay + (by - ay) * t);
  }
}

// ---- public event handlers (called from pointer.js) ----

export async function brushPointerDown(p) {
  const layer = getSelected();
  if (!layer || layer.type !== 'image') return;

  if (!_brushCanvas || _targetLayer !== layer ||
      _brushCanvas.width !== Math.ceil(layer.w) ||
      _brushCanvas.height !== Math.ceil(layer.h)) {
    await activateBrushLayer(layer);
  }

  _painting = true;
  if (!layer.mask) layer.mask = { enabled: false, src: null, invert: false, feather: 0 };
  layer.mask.enabled = true;

  const local = toLayerLocal(layer, p.x, p.y);
  paintAt(local.x, local.y);
  _lastPt = local;

  // Preview: write to mask.src for live render
  layer.mask.src = _brushCanvas.toDataURL('image/png');
  scheduleRender();
}

export function brushPointerMove(p) {
  overlay.brushCursorPos = p;
  if (!_painting || !_brushCanvas || !_targetLayer) {
    scheduleRender(); // repaint cursor overlay
    return;
  }
  const layer = _targetLayer;
  const local = toLayerLocal(layer, p.x, p.y);
  if (_lastPt) {
    paintLine(_lastPt.x, _lastPt.y, local.x, local.y);
  } else {
    paintAt(local.x, local.y);
  }
  _lastPt = local;
  // Live preview
  layer.mask.src = _brushCanvas.toDataURL('image/png');
  scheduleRender();
}

export function brushPointerUp() {
  if (!_painting || !_brushCanvas || !_targetLayer) {
    _painting = false;
    return;
  }
  const layer = _targetLayer;
  layer.mask.src = _brushCanvas.toDataURL('image/png');
  layer.mask.enabled = true;
  scheduleRender();
  pushHistory('Brush mask');
  _painting = false;
  _lastPt = null;
}

/** Called when tool is deactivated — flush any pending brush state. */
export function brushDeactivate() {
  if (_painting) brushPointerUp();
  _brushCanvas = null;
  _brushCtx = null;
  _targetLayer = null;
  overlay.brushCursorPos = null;
  _painting = false;
  _lastPt = null;
}

export function brushUpdateCursor(p) {
  overlay.brushCursorPos = p;
  scheduleRender();
}

export function brushClearCursor() {
  overlay.brushCursorPos = null;
  scheduleRender();
}
