import { drawRoundedRect } from './text.js';

// Persistent scratch canvas to avoid per-frame allocations.
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
    if (mode === 'blur') {
      // Pad the sampled region so the blur kernel has real pixels at edges instead of transparent.
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
    // Export path: no backdrop available, read pixels from the in-progress canvas.
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
