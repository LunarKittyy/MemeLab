// Per-layer bitmap cache for expensive adjustment passes.
// Keyed by layer.id; invalidated when src/crop/flip/adjustments change.
// Size is excluded from the key — the cached canvas lives at cropped natural
// resolution and is scaled to layer.w/layer.h at draw time.
//
// Also caches masked layer composites (mask + image merged into one bitmap),
// since these allocate a temporary canvas on every draw call otherwise.

import { ensureImage } from '../core/state.js';
import { applyAdjustments } from './glAdjust.js';

const _cache = new Map(); // id -> { serial, canvas }
const _maskCache = new Map(); // id -> { serial, canvas }

export function clearAdjustCache(layerId) {
  if (layerId !== undefined) {
    _cache.delete(layerId);
    _maskCache.delete(layerId);
  } else {
    _cache.clear();
    _maskCache.clear();
  }
}

function makeSerial(layer) {
  const adjs = layer.adjustments;
  const c = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  const pw = layer.perspectiveWarp;
  return JSON.stringify({
    adjs,
    src: layer.src ? layer.src.slice(-32) : null,
    cx: c.x, cy: c.y, cw: c.w, ch: c.h,
    fx: layer.flipX, fy: layer.flipY,
    pw: pw ? JSON.stringify(pw) : null,
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

// Cache for masked layer composites.  The mask is applied at display size
// (layer.w x layer.h), so w/h are part of the serial.
function makeMaskSerial(layer) {
  const base = makeSerial(layer);
  const m = layer.mask;
  return base + '|mask:' + JSON.stringify({
    enabled: m.enabled,
    src: m.src ? m.src.slice(-32) : null,
    invert: m.invert,
    feather: m.feather,
    w: Math.ceil(layer.w),
    h: Math.ceil(layer.h),
  });
}

// Returns a cached offscreen canvas with the layer's image composited through
// its mask, or null if either the image or mask isn't loaded yet.
// The returned canvas is at (Math.ceil(layer.w) x Math.ceil(layer.h)).
export function getMaskedCanvas(layer, drawFn) {
  const serial = makeMaskSerial(layer);
  const cached = _maskCache.get(layer.id);
  if (cached && cached.serial === serial) return cached.canvas;

  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return null;
  const maskImg = ensureImage(layer.mask.src);
  if (!maskImg || !maskImg.complete || !maskImg.naturalWidth) return null;

  const w = Math.ceil(layer.w), h = Math.ceil(layer.h);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  // drawFn draws the layer content and applies the mask onto this canvas
  drawFn(canvas);
  _maskCache.set(layer.id, { serial, canvas });
  return canvas;
}
