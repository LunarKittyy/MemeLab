import { drawRoundedRect } from './text.js';

// Sample pixels already composited beneath a layer's rect and apply blur/pixelate.
//
// Called by drawRectLayer (shapes.js) when layer.mode is 'blur' or 'pixelate'.
// Layer fields used: x, y, w, h, rotation, mode, amount, radius (all on rect layers).
//
// Reading from ctx.canvas (not a hardcoded `stage` reference) means this works
// identically for both the live-preview canvas and the export offscreen canvas.
// ctx.getTransform() gives us the current scale (devicePixelRatio for preview,
// export scale for export) so we can map layer-local coords → device pixels
// without importing anything from renderer.js.
//
// Scope note: only handles the unrotated case; rotated censor boxes are a
// deliberate follow-up (see PLAN.md §2 scope note).
// Persistent scratch canvases to avoid per-frame allocations.
const _pixelateCanvas = document.createElement('canvas');
const _pixelateCtx = _pixelateCanvas.getContext('2d');

export function applyBoxEffect(ctx, layer, backdrop) {
  if (layer.rotation % 360 !== 0) return;

  const mode = layer.mode || 'color';
  const amount = Math.max(1, layer.amount || 16);
  const radius = layer.radius || 0;

  ctx.save();
  drawRoundedRect(ctx, 0, 0, layer.w, layer.h, radius);
  ctx.clip();

  if (backdrop) {
    // GPU-only path: sample from the pre-built backdrop canvas via drawImage.
    // backdrop is at logical (state.width x state.height) with no DPR scaling,
    // so layer.x/y/w/h map directly to source coords.
    if (mode === 'blur') {
      // Sample a padded region so the blur kernel has real pixels at the edges
      // instead of blending against transparent (which causes hazy wash-out).
      const pad = amount * 2;
      ctx.filter = `blur(${amount}px)`;
      ctx.drawImage(backdrop,
        layer.x - pad, layer.y - pad, layer.w + pad * 2, layer.h + pad * 2,
        -pad, -pad, layer.w + pad * 2, layer.h + pad * 2
      );
      ctx.filter = 'none';
    } else if (mode === 'pixelate') {
      const tinyW = Math.max(1, Math.round(layer.w / amount));
      const tinyH = Math.max(1, Math.round(layer.h / amount));
      _pixelateCanvas.width = tinyW;
      _pixelateCanvas.height = tinyH;
      _pixelateCtx.drawImage(backdrop, layer.x, layer.y, layer.w, layer.h, 0, 0, tinyW, tinyH);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(_pixelateCanvas, 0, 0, layer.w, layer.h);
      ctx.imageSmoothingEnabled = true;
    }
  } else {
    // Fallback (export path): read pixels from the in-progress canvas.
    const canvas = ctx.canvas;
    if (!canvas) { ctx.restore(); return; }
    const t = ctx.getTransform();
    const scaleX = Math.hypot(t.a, t.b) || 1;
    const scaleY = Math.hypot(t.c, t.d) || 1;
    const sx = Math.round(t.e), sy = Math.round(t.f);
    const sw = Math.round(layer.w * scaleX), sh = Math.round(layer.h * scaleY);
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(canvas.width, sx + sw), y1 = Math.min(canvas.height, sy + sh);
    if (x1 > x0 && y1 > y0) {
      const imgData = canvas.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0);
      const off = document.createElement('canvas');
      off.width = x1 - x0; off.height = y1 - y0;
      off.getContext('2d').putImageData(imgData, 0, 0);
      if (mode === 'blur') {
        const pad = amount * 2;
        ctx.filter = `blur(${amount}px)`;
        ctx.drawImage(off, -pad, -pad, layer.w + pad * 2, layer.h + pad * 2);
        ctx.filter = 'none';
      } else if (mode === 'pixelate') {
        const tinyW = Math.max(1, Math.round(layer.w / amount));
        const tinyH = Math.max(1, Math.round(layer.h / amount));
        _pixelateCanvas.width = tinyW; _pixelateCanvas.height = tinyH;
        _pixelateCtx.drawImage(off, 0, 0, tinyW, tinyH);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(_pixelateCanvas, 0, 0, layer.w, layer.h);
        ctx.imageSmoothingEnabled = true;
      }
    }
  }

  ctx.restore();
}
