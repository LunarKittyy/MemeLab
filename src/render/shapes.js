import { ensureImage } from '../core/state.js';
import { drawRoundedRect } from './text.js';
import { applyBoxEffect } from './boxEffects.js';

export { drawRoundedRect };

function _drawImageContent(ctx, img, layer) {
  ctx.save();
  if (layer.flipX || layer.flipY) {
    ctx.translate(layer.w / 2, layer.h / 2);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.translate(-layer.w / 2, -layer.h / 2);
  }
  if (layer.exposure !== 0) ctx.filter = `brightness(${100 + layer.exposure}%)`;
  const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  ctx.drawImage(img,
    crop.x * img.naturalWidth, crop.y * img.naturalHeight,
    crop.w * img.naturalWidth, crop.h * img.naturalHeight,
    0, 0, layer.w, layer.h);
  ctx.filter = 'none';
  ctx.restore();
}

export function drawImageLayer(ctx, layer) {
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return;

  const mask = layer.mask;
  if (mask?.enabled && mask.src) {
    const maskImg = ensureImage(mask.src);
    const w = Math.ceil(layer.w), h = Math.ceil(layer.h);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const offCtx = off.getContext('2d');
    _drawImageContent(offCtx, img, layer);
    if (maskImg && maskImg.complete && maskImg.naturalWidth) {
      if (mask.invert) {
        const inv = document.createElement('canvas');
        inv.width = w; inv.height = h;
        const invCtx = inv.getContext('2d');
        invCtx.fillStyle = '#fff';
        invCtx.fillRect(0, 0, w, h);
        invCtx.globalCompositeOperation = 'destination-out';
        invCtx.drawImage(maskImg, 0, 0, w, h);
        offCtx.globalCompositeOperation = 'destination-in';
        offCtx.drawImage(inv, 0, 0);
      } else {
        offCtx.globalCompositeOperation = 'destination-in';
        offCtx.drawImage(maskImg, 0, 0, w, h);
      }
    }
    ctx.drawImage(off, 0, 0);
    return;
  }

  _drawImageContent(ctx, img, layer);
}

export function drawRectLayer(ctx, layer, backdrop) {
  const mode = layer.mode || 'color';
  if (mode === 'blur' || mode === 'pixelate') {
    applyBoxEffect(ctx, layer, backdrop);
  } else {
    drawRoundedRect(ctx, 0, 0, layer.w, layer.h, layer.radius);
    ctx.fillStyle = layer.color;
    ctx.fill();
  }
  if (layer.strokeWidth > 0) {
    drawRoundedRect(ctx, 0, 0, layer.w, layer.h, layer.radius);
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
