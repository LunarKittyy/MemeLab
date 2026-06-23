import { ensureImage } from '../core/state.js';
import { drawRoundedRect } from './text.js';

export { drawRoundedRect };

export function drawImageLayer(ctx, layer) {
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.save();
  if (layer.flipX || layer.flipY) {
    ctx.translate(layer.w / 2, layer.h / 2);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.translate(-layer.w / 2, -layer.h / 2);
  }
  if (layer.exposure !== 0) ctx.filter = `brightness(${100 + layer.exposure}%)`;
  ctx.drawImage(img, 0, 0, layer.w, layer.h);
  ctx.filter = 'none';
  ctx.restore();
}

export function drawRectLayer(ctx, layer) {
  drawRoundedRect(ctx, 0, 0, layer.w, layer.h, layer.radius);
  ctx.fillStyle = layer.color;
  ctx.fill();
  if (layer.strokeWidth > 0) {
    ctx.lineWidth = layer.strokeWidth;
    ctx.strokeStyle = layer.strokeColor;
    ctx.stroke();
  }
}

export function drawCover(ctx, img, x, y, w, h, fit) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  if (fit === 'stretch') {
    ctx.drawImage(img, x, y, w, h);
    return;
  }
  const scale = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  if (fit === 'contain') {
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    ctx.save();
    drawRoundedRect(ctx, x, y, w, h, 0);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }
}
