// Per-layer bitmap cache for expensive adjustment passes.
// Keyed by layer.id; invalidated when src/crop/flip/adjustments change.
// Size is excluded from the key — the cached canvas lives at cropped natural
// resolution and is scaled to layer.w/layer.h at draw time.

import { ensureImage } from '../core/state.js';
import { applyAdjustments } from './glAdjust.js';

const _cache = new Map(); // id -> { serial, canvas }

export function clearAdjustCache() {
  _cache.clear();
}

function makeSerial(layer) {
  const adjs = layer.adjustments;
  const c = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  return JSON.stringify({
    adjs,
    src: layer.src ? layer.src.slice(-32) : null,
    cx: c.x, cy: c.y, cw: c.w, ch: c.h,
    fx: layer.flipX, fy: layer.flipY,
  });
}

function extractSourceCanvas(layer) {
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return null;

  const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const sw = Math.max(1, Math.round(crop.w * nw));
  const sh = Math.max(1, Math.round(crop.h * nh));

  const off = document.createElement('canvas');
  off.width = sw; off.height = sh;
  const ctx = off.getContext('2d');

  ctx.save();
  if (layer.flipX || layer.flipY) {
    ctx.translate(layer.flipX ? sw : 0, layer.flipY ? sh : 0);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  }
  ctx.drawImage(img,
    crop.x * nw, crop.y * nh, crop.w * nw, crop.h * nh,
    0, 0, sw, sh);
  ctx.restore();
  return off;
}

// Returns the adjusted canvas (at cropped natural resolution) for a layer,
// or null if the image isn't loaded yet.
export function getAdjustedCanvas(layer) {
  const adjs = layer.adjustments;
  const hasAdj = adjs && adjs.length > 0 && adjs.some(a => a.value !== 0);
  if (!hasAdj) return null; // caller should use raw image path

  const serial = makeSerial(layer);
  const cached = _cache.get(layer.id);
  if (cached && cached.serial === serial) return cached.canvas;

  const src = extractSourceCanvas(layer);
  if (!src) return null;

  const result = applyAdjustments(src, adjs) || src;
  _cache.set(layer.id, { serial, canvas: result });
  return result;
}
