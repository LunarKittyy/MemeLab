import { state, getSelected, ensureImage, getLayerById } from '../core/state.js';
import { clamp, deg2rad } from '../core/utils.js';
import { drawTextLayer } from './text.js';
import { drawImageLayer, drawRectLayer, drawCover } from './shapes.js';
import { drawDrawLayer, invalidateAllDrawCaches, rasterizeDrawLayer } from './drawLayer.js';
import { viewport, resetViewport } from '../core/viewport.js';
import { overlay } from '../interactions/toolOverlay.js';

export let stage = null;
export let stageCtx = null;
let dpr = 1;
let _fitScale = 1;

export function getViewportFitScale() { return _fitScale; }

export function applyViewportToStage() {
  const z = viewport.zoom;
  const w = Math.round(state.width * _fitScale * z);
  const h = Math.round(state.height * _fitScale * z);
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  stage.style.transform = `translate(${viewport.panX}px,${viewport.panY}px)`;
  const pct = byZoomId('zoomPct');
  if (pct) pct.textContent = Math.round(z * 100) + '%';
}

function byZoomId(id) { return document.getElementById(id); }

export function bindStage(canvasEl) {
  stage = canvasEl;
  stageCtx = stage.getContext('2d');
}

export function dispScaleFactor() {
  const rect = stage.getBoundingClientRect();
  if (!rect.width) return 1;
  return state.width / rect.width;
}

function drawLayer(ctx, layer, backdrop) {
  if (!layer.visible) return;

  // Draw layers are full-canvas overlays; skip the per-layer transform.
  if (layer.type === 'draw') {
    ctx.save();
    ctx.globalCompositeOperation = layer.blendMode || 'normal';
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    const srcCanvas = _bakeSourceForDrawLayer(layer);
    const off = document.createElement('canvas');
    off.width = state.width; off.height = state.height;
    const offCtx = off.getContext('2d');
    rasterizeDrawLayer(offCtx, layer, srcCanvas);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = layer.blendMode || 'normal';
  const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(deg2rad(layer.rotation));
  ctx.globalAlpha = clamp(layer.opacity, 0, 1);
  ctx.translate(-layer.w / 2, -layer.h / 2);
  if (layer.type === 'image') drawImageLayer(ctx, layer);
  else if (layer.type === 'rect') drawRectLayer(ctx, layer, backdrop);
  else if (layer.type === 'text') drawTextLayer(ctx, layer);
  else if (layer.type === 'draw') drawDrawLayer(ctx, layer);
  ctx.restore();
}

function drawSelectionOverlay(ctx) {
  const layer = getSelected();
  const ds = dispScaleFactor();

  // Draw border-only outlines for secondary selections (when no tool active)
  if (!state.activeTool) {
    for (const id of state.selectedIds) {
      if (id === state.selectedId) continue;
      const sl = state.layers.find(l => l.id === id);
      if (!sl) continue;
      ctx.save();
      const scx = sl.x + sl.w / 2, scy = sl.y + sl.h / 2;
      ctx.translate(scx, scy);
      ctx.rotate(deg2rad(sl.rotation));
      ctx.strokeStyle = 'rgba(255, 61, 138, 0.55)';
      ctx.lineWidth = 1.4 * ds;
      ctx.setLineDash([4 * ds, 3 * ds]);
      ctx.strokeRect(-sl.w / 2, -sl.h / 2, sl.w, sl.h);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ---- Draw standard transform handles when no tool is active ----
  if (!state.activeTool && layer) {
    ctx.save();
    const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(deg2rad(layer.rotation));
    ctx.strokeStyle = '#FF3D8A';
    ctx.lineWidth = 1.6 * ds;
    ctx.setLineDash(layer.locked ? [6 * ds, 4 * ds] : []);
    ctx.strokeRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
    ctx.setLineDash([]);

    if (!layer.locked) {
      const hs = 9 * ds;
      const corners = [[-layer.w / 2, -layer.h / 2], [layer.w / 2, -layer.h / 2], [-layer.w / 2, layer.h / 2], [layer.w / 2, layer.h / 2]];
      corners.forEach(([x, y]) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
        ctx.lineWidth = 1.6 * ds; ctx.strokeStyle = '#FF3D8A';
        ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
      });
      const rhY = -layer.h / 2 - 30 * ds;
      ctx.beginPath(); ctx.moveTo(0, -layer.h / 2); ctx.lineTo(0, rhY);
      ctx.strokeStyle = '#FF3D8A'; ctx.lineWidth = 1.6 * ds; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, rhY, hs * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 1.6 * ds; ctx.strokeStyle = '#FF3D8A'; ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // ---- Tool overlays ----
  if (!state.activeTool) return;
  const tool = state.activeTool;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5 * ds;
  ctx.setLineDash([5 * ds, 4 * ds]);

  if (tool === 'lasso' && overlay.lassoPoints.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(overlay.lassoPoints[0].x, overlay.lassoPoints[0].y);
    for (let i = 1; i < overlay.lassoPoints.length; i++) {
      ctx.lineTo(overlay.lassoPoints[i].x, overlay.lassoPoints[i].y);
    }
    ctx.stroke();
  }

  if (tool === 'polygon' && overlay.polygonVertices.length >= 1) {
    ctx.beginPath();
    ctx.moveTo(overlay.polygonVertices[0].x, overlay.polygonVertices[0].y);
    for (let i = 1; i < overlay.polygonVertices.length; i++) {
      ctx.lineTo(overlay.polygonVertices[i].x, overlay.polygonVertices[i].y);
    }
    if (overlay.cursorPos && overlay.polygonOpen) {
      ctx.lineTo(overlay.cursorPos.x, overlay.cursorPos.y);
    }
    ctx.stroke();
    // Draw vertex dots
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    const dotR = 4 * ds;
    for (const v of overlay.polygonVertices) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    // Highlight close zone on first vertex
    if (overlay.polygonVertices.length >= 3 && overlay.cursorPos) {
      const dist = Math.hypot(overlay.cursorPos.x - overlay.polygonVertices[0].x, overlay.cursorPos.y - overlay.polygonVertices[0].y);
      if (dist <= 20) {
        ctx.beginPath();
        ctx.arc(overlay.polygonVertices[0].x, overlay.polygonVertices[0].y, 10 * ds, 0, Math.PI * 2);
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2 * ds;
        ctx.stroke();
      }
    }
  }

  if (tool === 'gradientMask' && overlay.gradientStart) {
    ctx.setLineDash([4 * ds, 3 * ds]);
    const end = overlay.gradientEnd || overlay.cursorPos;
    if (end) {
      ctx.beginPath();
      ctx.moveTo(overlay.gradientStart.x, overlay.gradientStart.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.stroke();
      // Arrow head at end
      const dx = end.x - overlay.gradientStart.x, dy = end.y - overlay.gradientStart.y;
      const len = Math.hypot(dx, dy);
      if (len > 5) {
        const ux = dx / len, uy = dy / len;
        const aw = 8 * ds;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - ux * aw - uy * aw * 0.5, end.y - uy * aw + ux * aw * 0.5);
        ctx.lineTo(end.x - ux * aw + uy * aw * 0.5, end.y - uy * aw - ux * aw * 0.5);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fill();
      }
    }
    // Start dot
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(overlay.gradientStart.x, overlay.gradientStart.y, 5 * ds, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  ctx.restore();

  // ---- Brush cursor: a circle at the current cursor position ----
  if (tool === 'brushMask' && overlay.brushCursorPos) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(overlay.brushCursorPos.x, overlay.brushCursorPos.y, overlay.brushSize, 0, Math.PI * 2);
    ctx.strokeStyle = overlay.brushMode === 'reveal' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 1.5 * ds;
    ctx.setLineDash([3 * ds, 2 * ds]);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Bake all layers below the given draw layer (plus the background) into a flat source canvas.
 * This is used by retouch tools (heal, clone, dodge/burn, liquify) to sample from the underlying image.
 */
function _bakeSourceForDrawLayer(targetLayer) {
  // Use transient cached canvas if available (set by drawTools.js during an active stroke)
  if (state._healSourceCanvas) return state._healSourceCanvas;

  const W = state.width, H = state.height;
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sCtx = src.getContext('2d');

  // Background
  if (state.background.type === 'image' && state.background.src) {
    const img = ensureImage(state.background.src);
    if (img && img.complete && img.naturalWidth) {
      drawCover(sCtx, img, 0, 0, W, H, state.background.fit);
    } else {
      sCtx.fillStyle = '#ffffff'; sCtx.fillRect(0, 0, W, H);
    }
  } else {
    sCtx.fillStyle = state.background.color || '#ffffff'; sCtx.fillRect(0, 0, W, H);
  }

  // Layers below
  for (const l of state.layers) {
    if (l.id === targetLayer.id) break;
    drawLayer(sCtx, l, null);
  }
  return src;
}

let backdropCanvas = null;
let backdropCtx = null;

function buildBackdrop(W, H) {
  if (!backdropCanvas || backdropCanvas.width !== W || backdropCanvas.height !== H) {
    backdropCanvas = document.createElement('canvas');
    backdropCanvas.width = W;
    backdropCanvas.height = H;
    backdropCtx = backdropCanvas.getContext('2d');
  }
  backdropCtx.clearRect(0, 0, W, H);
  if (state.background.type === 'image' && state.background.src) {
    const img = ensureImage(state.background.src);
    if (img && img.complete && img.naturalWidth) {
      drawCover(backdropCtx, img, 0, 0, W, H, state.background.fit);
    } else {
      backdropCtx.fillStyle = '#ffffff'; backdropCtx.fillRect(0, 0, W, H);
    }
  } else {
    backdropCtx.fillStyle = state.background.color; backdropCtx.fillRect(0, 0, W, H);
  }
  for (const layer of state.layers) {
    if (layer.type === 'rect' && (layer.mode === 'blur' || layer.mode === 'pixelate')) continue;
    drawLayer(backdropCtx, layer, null);
  }
  return backdropCanvas;
}

export function renderScene(ctx, opts) {
  opts = opts || {};
  const W = state.width, H = state.height;
  ctx.clearRect(0, 0, W, H);
  if (state.background.type === 'image' && state.background.src) {
    const img = ensureImage(state.background.src);
    if (img && img.complete && img.naturalWidth) {
      drawCover(ctx, img, 0, 0, W, H, state.background.fit);
    } else {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = state.background.color; ctx.fillRect(0, 0, W, H);
  }
  const hasBoxEffect = !opts.forExport && state.layers.some(
    l => l.visible && l.type === 'rect' && (l.mode === 'blur' || l.mode === 'pixelate')
  );
  const backdrop = hasBoxEffect ? buildBackdrop(W, H) : null;
  for (const layer of state.layers) drawLayer(ctx, layer, backdrop);
  if (!opts.forExport) drawSelectionOverlay(ctx);
}

export function renderLayersToCtx(ctx, layers) {
  for (const layer of layers) drawLayer(ctx, layer, null);
}

let renderScheduled = false;
export function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => { renderScheduled = false; doRender(); });
}

function doRender() {
  stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderScene(stageCtx, { forExport: false });
  updateThumbnails();
}

const _thumbCanvas = document.createElement('canvas');
_thumbCanvas.width = 60;
_thumbCanvas.height = 60;
const _thumbCtx = _thumbCanvas.getContext('2d');

// Pre-rendered checkerboard background for thumbnails — built once, reused every call.
const _thumbBg = document.createElement('canvas');
_thumbBg.width = 60;
_thumbBg.height = 60;
(function buildThumbBg() {
  const ctx = _thumbBg.getContext('2d');
  ctx.fillStyle = '#16131c';
  ctx.fillRect(0, 0, 60, 60);
  ctx.fillStyle = '#24202d';
  const size = 6;
  for (let y = 0; y < 60; y += size) {
    for (let x = 0; x < 60; x += size) {
      if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
        ctx.fillRect(x, y, size, size);
      }
    }
  }
})();

// Thumbnail dirty-tracking: cache dataURL per id, keyed by a serial that
// encodes the content that affects that thumbnail.  Only re-render when the
// serial changes.  Keyed by layer id (or 'background').
const _thumbCache = new Map(); // id -> { serial, dataURL }

function imgLoaded(src) {
  if (!src) return false;
  const img = ensureImage(src);
  return !!(img && img.complete && img.naturalWidth);
}

function thumbSerial(id) {
  if (id === 'background') {
    const bg = state.background;
    return JSON.stringify({ type: bg.type, color: bg.color, src: bg.src ? bg.src.slice(-32) : null, fit: bg.fit, loaded: imgLoaded(bg.src) });
  }
  const layer = getLayerById(id);
  if (!layer) return '';
  return JSON.stringify({
    x: layer.x, y: layer.y, w: layer.w, h: layer.h,
    rotation: layer.rotation, opacity: layer.opacity,
    visible: layer.visible,
    // type-specific fields
    src: layer.src ? layer.src.slice(-32) : null,
    srcLoaded: imgLoaded(layer.src),
    text: layer.text, font: layer.font, color: layer.color,
    bold: layer.bold, italic: layer.italic, size: layer.sizeScale || layer.size,
    align: layer.align, vAlign: layer.vAlign, lineHeight: layer.lineHeight,
    padding: layer.padding, letterSpacing: layer.letterSpacing,
    stroke: JSON.stringify(layer.stroke), box: JSON.stringify(layer.box),
    mode: layer.mode, radius: layer.radius, amount: layer.amount,
    strokeWidth: layer.strokeWidth, strokeColor: layer.strokeColor,
    flipX: layer.flipX, flipY: layer.flipY,
    crop: JSON.stringify(layer.crop),
    adjustments: JSON.stringify(layer.adjustments),
    mask: layer.mask ? JSON.stringify({ enabled: layer.mask.enabled, invert: layer.mask.invert, feather: layer.mask.feather, src: layer.mask.src ? layer.mask.src.slice(-32) : null, maskLoaded: imgLoaded(layer.mask.src) }) : null,
  });
}

export function invalidateThumbCache(id) {
  if (id !== undefined) {
    _thumbCache.delete(id);
  } else {
    _thumbCache.clear();
  }
}

function renderThumbToDataURL(id) {
  const w = 60, h = 60;
  const ctx = _thumbCtx;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(_thumbBg, 0, 0);

  if (id === 'background') {
    const bg = state.background;
    if (bg.type === 'image' && bg.src) {
      const img = ensureImage(bg.src);
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        drawCover(ctx, img, 0, 0, w, h, bg.fit);
        ctx.restore();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    const layer = getLayerById(id);
    if (layer) {
      if (layer.type === 'draw') {
        ctx.save();
        const thumbScale = w / state.width;
        ctx.scale(thumbScale, thumbScale);
        ctx.globalAlpha = clamp(layer.opacity, 0, 1);
        const srcCanvas = _bakeSourceForDrawLayer(layer);
        const off = document.createElement('canvas');
        off.width = state.width; off.height = state.height;
        const offCtx = off.getContext('2d');
        rasterizeDrawLayer(offCtx, layer, srcCanvas);
        ctx.drawImage(off, 0, 0);
        ctx.restore();
      } else if (layer.w > 0 && layer.h > 0) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        const scale = Math.min(w / layer.w, h / layer.h);
        ctx.scale(scale, scale);
        ctx.rotate(deg2rad(layer.rotation));
        ctx.globalAlpha = clamp(layer.opacity, 0, 1);
        ctx.translate(-layer.w / 2, -layer.h / 2);
        if (layer.type === 'image') {
          drawImageLayer(ctx, layer);
        } else if (layer.type === 'rect') {
          drawRectLayer(ctx, layer);
        } else if (layer.type === 'text') {
          drawTextLayer(ctx, layer);
        }
        ctx.restore();
      }
    }
  }

  return _thumbCanvas.toDataURL('image/png');
}

export function updateThumbnails() {
  document.querySelectorAll('.thumb-img').forEach((img) => {
    const id = img.dataset.id;
    const serial = thumbSerial(id);
    const cached = _thumbCache.get(id);
    if (cached && cached.serial === serial) {
      // Content hasn't changed — skip re-render, reuse cached dataURL
      return;
    }
    const dataURL = renderThumbToDataURL(id);
    _thumbCache.set(id, { serial, dataURL });
    img.src = dataURL;
  });
}

export function resizeStageBuffer() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  stage.width = Math.round(state.width * dpr);
  stage.height = Math.round(state.height * dpr);
  const area = document.getElementById('canvasArea');
  const maxW = Math.max(60, area.clientWidth - 48);
  const maxH = Math.max(60, area.clientHeight - 48);
  const scale = Math.min(maxW / state.width, maxH / state.height, 1);
  _fitScale = scale > 0 ? scale : 1;
  applyViewportToStage();
  scheduleRender();
}

export async function exportPng(scale) {
  const off = document.createElement('canvas');
  off.width = Math.round(state.width * scale);
  off.height = Math.round(state.height * scale);
  const ctx = off.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderScene(ctx, { forExport: true });
  return new Promise((resolve, reject) => off.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Export failed: canvas too large or out of memory')), 'image/png'));
}

/**
 * Export the current scene as a specific format.
 * @param {'png'|'jpeg'|'webp'} format
 * @param {number} quality  0–1 (ignored for png)
 * @param {number} scale    multiplier on state.width/height
 * @returns {Promise<Blob>}
 */
export async function exportAs(format, quality, scale) {
  if (format === 'png') return exportPng(scale);
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const off = document.createElement('canvas');
  off.width = Math.round(state.width * scale);
  off.height = Math.round(state.height * scale);
  const ctx = off.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderScene(ctx, { forExport: true });
  return new Promise((resolve, reject) =>
    off.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Export failed: canvas too large or out of memory')),
      mime,
      quality
    )
  );
}
