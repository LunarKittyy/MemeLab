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
export function applyBoxEffect(ctx, layer) {
  const canvas = ctx.canvas;
  if (!canvas) return;

  // Skip rotated layers — correct handling requires un-rotating the sampled
  // region before processing and re-rotating on the way back.  That's a
  // deliberate follow-up; ship the unrotated case first (PLAN.md §2 scope note).
  if (layer.rotation % 360 !== 0) return;

  // Extract the pure scale factor from the current transform.  We use the
  // vector magnitude of the first column (a, b) rather than just t.a so the
  // result is correct even when a rotation is encoded in the matrix (which
  // can happen if callers stack transforms). For our unrotated layers b≈0,
  // so Math.hypot(t.a, 0) === t.a, but being explicit is safer.
  const t = ctx.getTransform();
  const scaleX = Math.hypot(t.a, t.b) || 1;
  const scaleY = Math.hypot(t.c, t.d) || 1;

  // Use the translation from the transformation matrix, which is more robust
  // when drawing to offset or scaled contexts (like layer list thumbnails).
  const sx = Math.round(t.e);
  const sy = Math.round(t.f);
  const sw = Math.round(layer.w * scaleX);
  const sh = Math.round(layer.h * scaleY);

  // Clamp to canvas bounds.
  const x0 = Math.max(0, sx);
  const y0 = Math.max(0, sy);
  const x1 = Math.min(canvas.width, sx + sw);
  const y1 = Math.min(canvas.height, sy + sh);
  if (x1 <= x0 || y1 <= y0) return;

  const readCtx = canvas.getContext('2d');
  const imgData = readCtx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const off = document.createElement('canvas');
  off.width = x1 - x0;
  off.height = y1 - y0;
  off.getContext('2d').putImageData(imgData, 0, 0);

  // mode and amount live directly on rect layers.
  const mode = layer.mode || 'color';
  const amount = Math.max(1, layer.amount || 16);
  // Respect the layer's corner radius when clipping (rect layers have `radius`).
  const radius = layer.radius || 0;

  // Draw result back into the layer-local coordinate space.
  // The ctx is already translated so (0,0) is the layer's top-left.
  ctx.save();
  drawRoundedRect(ctx, 0, 0, layer.w, layer.h, radius);
  ctx.clip();

  if (mode === 'blur') {
    // blur() value is in CSS pixels (logical), not device pixels.
    ctx.filter = `blur(${amount}px)`;
    ctx.drawImage(off, 0, 0, layer.w, layer.h);
    ctx.filter = 'none';
  } else if (mode === 'pixelate') {
    // Shrink to tiny canvas, draw back up with smoothing off for blocky look.
    const tinyW = Math.max(1, Math.round(layer.w / amount));
    const tinyH = Math.max(1, Math.round(layer.h / amount));
    const tiny = document.createElement('canvas');
    tiny.width = tinyW;
    tiny.height = tinyH;
    tiny.getContext('2d').drawImage(off, 0, 0, tinyW, tinyH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, layer.w, layer.h);
    ctx.imageSmoothingEnabled = true;
  }

  ctx.restore();
}
