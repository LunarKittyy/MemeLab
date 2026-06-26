import { ensureImage } from '../core/state.js';
import { drawRoundedRect } from './text.js';
import { applyBoxEffect } from './boxEffects.js';
import { getAdjustedCanvas, getMaskedCanvas } from './adjustCache.js';

export { drawRoundedRect };

// Draws the image (with crop/flip) at (0,0,layer.w,layer.h) in ctx.
// If adjCanvas is provided, draws it scaled instead of the raw src.
function _drawImageContent(ctx, img, layer, adjCanvas) {
  const w = layer.w, h = layer.h;
  if (adjCanvas) {
    // adjCanvas is already at natural cropped resolution; just scale it down
    ctx.drawImage(adjCanvas, 0, 0, w, h);
    return;
  }
  ctx.save();
  if (layer.flipX || layer.flipY) {
    ctx.translate(w / 2, h / 2);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.translate(-w / 2, -h / 2);
  }
  const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  ctx.drawImage(img,
    crop.x * img.naturalWidth, crop.y * img.naturalHeight,
    crop.w * img.naturalWidth, crop.h * img.naturalHeight,
    0, 0, w, h);
  ctx.restore();
}

export function drawImageLayer(ctx, layer) {
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return;

  const adjCanvas = getAdjustedCanvas(layer);
  const mask = layer.mask;

  if (mask?.enabled && mask.src) {
    const maskedCanvas = getMaskedCanvas(layer, (off) => {
      const w = off.width, h = off.height;
      const offCtx = off.getContext('2d');
      _drawImageContent(offCtx, img, layer, adjCanvas);
      const maskImg = ensureImage(mask.src);
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
    });
    if (maskedCanvas) {
      ctx.drawImage(maskedCanvas, 0, 0);
      return;
    }
    // mask or image not loaded yet — fall through to raw draw
  }

  _drawImageContent(ctx, img, layer, adjCanvas);
}

function drawSpeechBubble(ctx, layer) {
  const w = layer.w, h = layer.h;
  const r = Math.max(0, Math.min(layer.radius || 16, Math.min(w, h) / 2));
  const tailDir = layer.tailDir || 'bottom';
  const tailPos = layer.tailPos !== undefined ? layer.tailPos : 0.5;
  const tailLen = layer.tailLen !== undefined ? layer.tailLen : 30;
  const tailW = Math.min(30, Math.min(w, h) * 0.18); // half-width of tail base

  // We draw the rounded rect body with a triangular tail cut in.
  // Strategy: build the path edge by edge, inserting the tail on the correct edge.

  ctx.beginPath();

  if (tailDir === 'bottom') {
    // Start at top-left corner arc, go clockwise
    const tx = w * tailPos; // tail tip x
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.arcTo(w, 0, w, r, r);
    ctx.lineTo(w, h - r);
    ctx.arcTo(w, h, w - r, h, r);
    // right side of tail base to tip to left side
    ctx.lineTo(Math.min(w - r, tx + tailW), h);
    ctx.lineTo(tx, h + tailLen);
    ctx.lineTo(Math.max(r, tx - tailW), h);
    ctx.lineTo(r, h);
    ctx.arcTo(0, h, 0, h - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
  } else if (tailDir === 'top') {
    const tx = w * tailPos;
    ctx.moveTo(r, 0);
    // left side of tail base to tip to right side
    ctx.lineTo(Math.max(r, tx - tailW), 0);
    ctx.lineTo(tx, -tailLen);
    ctx.lineTo(Math.min(w - r, tx + tailW), 0);
    ctx.lineTo(w - r, 0);
    ctx.arcTo(w, 0, w, r, r);
    ctx.lineTo(w, h - r);
    ctx.arcTo(w, h, w - r, h, r);
    ctx.lineTo(r, h);
    ctx.arcTo(0, h, 0, h - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
  } else if (tailDir === 'left') {
    const ty = h * tailPos;
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.arcTo(w, 0, w, r, r);
    ctx.lineTo(w, h - r);
    ctx.arcTo(w, h, w - r, h, r);
    ctx.lineTo(r, h);
    ctx.arcTo(0, h, 0, h - r, r);
    ctx.lineTo(0, Math.min(h - r, ty + tailW));
    ctx.lineTo(-tailLen, ty);
    ctx.lineTo(0, Math.max(r, ty - tailW));
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
  } else { // right
    const ty = h * tailPos;
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.arcTo(w, 0, w, r, r);
    ctx.lineTo(w, Math.max(r, ty - tailW));
    ctx.lineTo(w + tailLen, ty);
    ctx.lineTo(w, Math.min(h - r, ty + tailW));
    ctx.lineTo(w, h - r);
    ctx.arcTo(w, h, w - r, h, r);
    ctx.lineTo(r, h);
    ctx.arcTo(0, h, 0, h - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
  }

  ctx.closePath();
  ctx.fillStyle = layer.color;
  ctx.fill();
  if ((layer.strokeWidth || 0) > 0) {
    ctx.lineWidth = layer.strokeWidth;
    ctx.strokeStyle = layer.strokeColor || '#000000';
    ctx.stroke();
  }
}

export function drawRectLayer(ctx, layer, backdrop) {
  if (layer.subtype === 'speechbubble') {
    drawSpeechBubble(ctx, layer);
    return;
  }
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
