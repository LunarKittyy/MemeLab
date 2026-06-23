import { state, getSelected, ensureImage, getLayerById } from '../core/state.js';
import { clamp, deg2rad } from '../core/utils.js';
import { drawTextLayer } from './text.js';
import { drawImageLayer, drawRectLayer, drawCover } from './shapes.js';

export let stage = null;
let stageCtx = null;
let dpr = 1;

export function bindStage(canvasEl) {
  stage = canvasEl;
  stageCtx = stage.getContext('2d');
}

export function dispScaleFactor() {
  const rect = stage.getBoundingClientRect();
  if (!rect.width) return 1;
  return state.width / rect.width;
}

function drawLayer(ctx, layer) {
  if (!layer.visible) return;
  ctx.save();
  const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(deg2rad(layer.rotation));
  ctx.globalAlpha = clamp(layer.opacity, 0, 1);
  ctx.translate(-layer.w / 2, -layer.h / 2);
  if (layer.type === 'image') drawImageLayer(ctx, layer);
  else if (layer.type === 'rect') drawRectLayer(ctx, layer);
  else if (layer.type === 'text') drawTextLayer(ctx, layer);
  ctx.restore();
}

function drawSelectionOverlay(ctx) {
  const layer = getSelected();
  if (!layer) return;
  const ds = dispScaleFactor();
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
  for (const layer of state.layers) drawLayer(ctx, layer);
  if (!opts.forExport) drawSelectionOverlay(ctx);
}

// Draw an explicit list of layers (no background, no selection overlay).
// Used by mergeLayerDown to composite exactly two layers onto an offscreen canvas.
export function renderLayersToCtx(ctx, layers) {
  for (const layer of layers) drawLayer(ctx, layer);
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

export function updateThumbnails() {
  const canvases = document.querySelectorAll('.thumb-canvas');
  canvases.forEach((canvas) => {
    const id = canvas.dataset.id;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Draw dark checkerboard pattern
    ctx.save();
    ctx.fillStyle = '#16131c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#24202d';
    const size = 6;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
          ctx.fillRect(x, y, size, size);
        }
      }
    }
    ctx.restore();

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
      return;
    }

    const layer = getLayerById(id);
    if (!layer) return;

    if (layer.w > 0 && layer.h > 0) {
      ctx.save();
      // Center of thumbnail
      ctx.translate(w / 2, h / 2);
      // Scale to fit the layer's bounding box
      const scale = Math.min(w / layer.w, h / layer.h);
      ctx.scale(scale, scale);
      // Apply rotation, opacity, etc.
      ctx.rotate(deg2rad(layer.rotation));
      ctx.globalAlpha = clamp(layer.opacity, 0, 1);
      // Translate back so the layer's top-left draws relative to 0, 0
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
  const finalScale = scale > 0 ? scale : 1;
  stage.style.width = Math.round(state.width * finalScale) + 'px';
  stage.style.height = Math.round(state.height * finalScale) + 'px';
  scheduleRender();
}

export async function exportPng(scale) {
  const off = document.createElement('canvas');
  off.width = Math.round(state.width * scale);
  off.height = Math.round(state.height * scale);
  const ctx = off.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderScene(ctx, { forExport: true });
  return new Promise((resolve) => off.toBlob((blob) => resolve(blob), 'image/png'));
}
