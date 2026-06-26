/**
 * Rasterize a draw layer's strokes array to a 2D canvas context.
 *
 * Design:
 * - Each draw layer maintains a "committed" offscreen bitmap (committed strokes rendered).
 * - During active drawing the live canvas in drawTools.js renders on top (O(new points)).
 * - On stroke commit the cache is invalidated and rebuilt from scratch.
 * - The cache key is layer.id + strokes.length + JSON of last stroke (cheap enough).
 */

// Cache: layerId → { bitmap: OffscreenCanvas|HTMLCanvasElement, key: string }
const _cache = new Map();

function makeCacheKey(layer) {
  const strokes = layer.strokes || [];
  const last = strokes.length > 0 ? JSON.stringify(strokes[strokes.length - 1]) : '';
  return strokes.length + '|' + last;
}

export function invalidateDrawCache(layerId) {
  _cache.delete(layerId);
}

export function invalidateAllDrawCaches() {
  _cache.clear();
}

/**
 * Paint a single stroke onto an existing 2D canvas context.
 * The context must already be set up (cleared or composited as needed by caller).
 */
export function paintStroke(ctx, stroke, w, h, srcCanvas) {
  ctx.save();
  const tool = stroke.tool || 'brush';

  if (tool === 'brush' || tool === 'eraser') {
    const pts = stroke.points || [];
    if (pts.length === 0) { ctx.restore(); return; }
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;

    const r = Math.max(1, stroke.size || 10);
    const hardness = stroke.hardness != null ? stroke.hardness : 1;
    const color = stroke.color || '#000000';

    // For single-point strokes draw one dab
    const allPts = pts.length === 1 ? [pts[0], pts[0]] : pts;

    for (let i = 0; i < allPts.length; i++) {
      const [x, y] = allPts[i];
      if (hardness >= 0.99) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        // Soft brush: radial gradient dab
        const inner = r * hardness;
        const grad = ctx.createRadialGradient(x, y, inner * 0.5, x, y, r);
        // Parse color to rgba
        const rgba = hexToRgba(color);
        grad.addColorStop(0, `rgba(${rgba.r},${rgba.g},${rgba.b},1)`);
        grad.addColorStop(1, `rgba(${rgba.r},${rgba.g},${rgba.b},0)`);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
  } else if (tool === 'line') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
    ctx.strokeStyle = stroke.color || '#000000';
    ctx.lineWidth = stroke.size || 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(stroke.x1, stroke.y1);
    ctx.lineTo(stroke.x2, stroke.y2);
    ctx.stroke();
  } else if (tool === 'ellipse') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
    ctx.fillStyle = stroke.color || '#000000';
    ctx.beginPath();
    const ex = Math.min(stroke.x1, stroke.x2);
    const ey = Math.min(stroke.y1, stroke.y2);
    const ew = Math.abs(stroke.x2 - stroke.x1);
    const eh = Math.abs(stroke.y2 - stroke.y1);
    if (ew < 1 || eh < 1) { ctx.restore(); return; }
    ctx.ellipse(ex + ew / 2, ey + eh / 2, ew / 2, eh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (tool === 'polygon') {
    const verts = stroke.vertices || [];
    if (verts.length < 2) { ctx.restore(); return; }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
    ctx.fillStyle = stroke.color || '#000000';
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i][0], verts[i][1]);
    ctx.closePath();
    ctx.fill();
  } else if (tool === 'gradient') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
    let grad;
    if (stroke.gradientType === 'radial') {
      const dist = Math.hypot(stroke.x2 - stroke.x1, stroke.y2 - stroke.y1);
      grad = ctx.createRadialGradient(stroke.x1, stroke.y1, 0, stroke.x1, stroke.y1, dist || 1);
    } else {
      grad = ctx.createLinearGradient(stroke.x1, stroke.y1, stroke.x2, stroke.y2);
    }
    grad.addColorStop(0, stroke.color || '#ff0000');
    grad.addColorStop(1, stroke.color2 || '#0000ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (tool === 'fill') {
    // Rasterize a flood-fill stroke: replay the filled region
    if (stroke.filledData) {
      // filledData is an ImageData-like {width, height, data (base64 encoded pixel bytes)}
      // Store as plain pixel array directly on the stroke at commit time
      const id = new ImageData(new Uint8ClampedArray(stroke.filledData), stroke.fw, stroke.fh);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
      ctx.putImageData(id, stroke.fx, stroke.fy);
    }
  } else if (tool === 'heal') {
    const pts = stroke.points || [];
    if (pts.length === 0 || !srcCanvas) { ctx.restore(); return; }
    const r = Math.max(1, stroke.size || 20);
    const allPts = pts.length === 1 ? [pts[0], pts[0]] : pts;

    for (let i = 0; i < allPts.length; i++) {
      const [x, y] = allPts[i];
      const temp = document.createElement('canvas');
      temp.width = r * 2; temp.height = r * 2;
      const tCtx = temp.getContext('2d');

      const sx = x - r * 1.5;
      const sy = y - r * 1.5;

      tCtx.drawImage(srcCanvas, sx - r, sy - r, r * 2, r * 2, 0, 0, r * 2, r * 2);

      tCtx.globalCompositeOperation = 'destination-in';
      const grad = tCtx.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.8)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      tCtx.fillStyle = grad;
      tCtx.fillRect(0, 0, r * 2, r * 2);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(temp, x - r, y - r);
      ctx.restore();
    }
  } else if (tool === 'clone') {
    const pts = stroke.points || [];
    if (pts.length === 0 || !srcCanvas) { ctx.restore(); return; }
    const r = Math.max(1, stroke.size || 20);
    const allPts = pts.length === 1 ? [pts[0], pts[0]] : pts;
    const startX = allPts[0][0];
    const startY = allPts[0][1];
    const sourceX = stroke.sourceX != null ? stroke.sourceX : startX;
    const sourceY = stroke.sourceY != null ? stroke.sourceY : startY;

    for (let i = 0; i < allPts.length; i++) {
      const [x, y] = allPts[i];
      const dx = x - startX;
      const dy = y - startY;
      const sx = sourceX + dx;
      const sy = sourceY + dy;

      const temp = document.createElement('canvas');
      temp.width = r * 2; temp.height = r * 2;
      const tCtx = temp.getContext('2d');

      tCtx.drawImage(srcCanvas, sx - r, sy - r, r * 2, r * 2, 0, 0, r * 2, r * 2);

      tCtx.globalCompositeOperation = 'destination-in';
      const grad = tCtx.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      tCtx.fillStyle = grad;
      tCtx.fillRect(0, 0, r * 2, r * 2);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
      ctx.drawImage(temp, x - r, y - r);
      ctx.restore();
    }
  } else if (tool === 'dodge' || tool === 'burn') {
    const pts = stroke.points || [];
    if (pts.length === 0) { ctx.restore(); return; }
    const r = Math.max(1, stroke.size || 20);
    const exposure = stroke.exposure != null ? stroke.exposure : 0.5;
    const allPts = pts.length === 1 ? [pts[0], pts[0]] : pts;

    for (let i = 0; i < allPts.length; i++) {
      const [x, y] = allPts[i];
      const temp = document.createElement('canvas');
      temp.width = r * 2; temp.height = r * 2;
      const tCtx = temp.getContext('2d');

      const imgData = getBaseRegion(ctx, srcCanvas, x - r, y - r, r * 2, r * 2);
      const data = imgData.data;

      for (let j = 0; j < data.length; j += 4) {
        if (tool === 'dodge') {
          data[j]     = data[j]     + exposure * (255 - data[j]);
          data[j + 1] = data[j + 1] + exposure * (255 - data[j + 1]);
          data[j + 2] = data[j + 2] + exposure * (255 - data[j + 2]);
        } else {
          data[j]     = data[j]     * (1 - exposure);
          data[j + 1] = data[j + 1] * (1 - exposure);
          data[j + 2] = data[j + 2] * (1 - exposure);
        }
        data[j + 3] = 255;
      }
      tCtx.putImageData(imgData, 0, 0);

      tCtx.globalCompositeOperation = 'destination-in';
      const grad = tCtx.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.8)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      tCtx.fillStyle = grad;
      tCtx.fillRect(0, 0, r * 2, r * 2);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(temp, x - r, y - r);
      ctx.restore();
    }
  } else if (tool === 'redeye') {
    const cx = stroke.cx;
    const cy = stroke.cy;
    const r = stroke.radius || 20;

    const temp = document.createElement('canvas');
    temp.width = r * 2; temp.height = r * 2;
    const tCtx = temp.getContext('2d');

    const imgData = getBaseRegion(ctx, srcCanvas, cx - r, cy - r, r * 2, r * 2);
    const data = imgData.data;

    for (let j = 0; j < data.length; j += 4) {
      const red = data[j];
      const green = data[j + 1];
      const blue = data[j + 2];
      if (red > 80 && red > green * 1.5 && red > blue * 1.5) {
        data[j] = (green + blue) / 2;
      }
      data[j + 3] = 255;
    }
    tCtx.putImageData(imgData, 0, 0);

    tCtx.globalCompositeOperation = 'destination-in';
    const grad = tCtx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.8, 'rgba(0,0,0,0.8)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    tCtx.fillStyle = grad;
    tCtx.fillRect(0, 0, r * 2, r * 2);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(temp, cx - r, cy - r);
    ctx.restore();
  } else if (tool === 'liquify') {
    const pts = stroke.points || [];
    if (pts.length === 0) { ctx.restore(); return; }
    const r = Math.max(1, stroke.size || 20);
    const strength = stroke.strength != null ? stroke.strength : 0.5;

    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const px = pt[0], py = pt[1], dx = pt[2] || 0, dy = pt[3] || 0;
      if (Math.hypot(dx, dy) < 0.1) continue;

      const imgData = getBaseRegion(ctx, srcCanvas, px - r, py - r, r * 2, r * 2);
      const outData = ctx.createImageData(r * 2, r * 2);

      for (let iy = 0; iy < r * 2; iy++) {
        for (let ix = 0; ix < r * 2; ix++) {
          const dist = Math.hypot(ix - r, iy - r);
          const outIdx = (iy * r * 2 + ix) * 4;
          if (dist < r) {
            const w_warp = Math.pow(1 - dist / r, 2);
            const sx = ix - dx * strength * w_warp;
            const sy = iy - dy * strength * w_warp;
            const [sr, sg, sb, sa] = sampleBilinear(imgData, sx, sy, r * 2, r * 2);
            outData.data[outIdx]     = sr;
            outData.data[outIdx + 1] = sg;
            outData.data[outIdx + 2] = sb;
            outData.data[outIdx + 3] = sa;
          } else {
            outData.data[outIdx]     = imgData.data[outIdx];
            outData.data[outIdx + 1] = imgData.data[outIdx + 1];
            outData.data[outIdx + 2] = imgData.data[outIdx + 2];
            outData.data[outIdx + 3] = imgData.data[outIdx + 3];
          }
        }
      }
      
      const temp = document.createElement('canvas');
      temp.width = r * 2; temp.height = r * 2;
      const tCtx = temp.getContext('2d');
      tCtx.putImageData(outData, 0, 0);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(temp, px - r, py - r);
      ctx.restore();
    }
  }

  ctx.restore();
}

/** Rasterize all committed strokes for a layer, with cache. */
export function rasterizeStrokes(layer, srcCanvas) {
  const strokes = layer.strokes || [];
  if (strokes.length === 0) return null;

  const key = makeCacheKey(layer);
  const cached = _cache.get(layer.id);
  if (cached && cached.key === key) return cached.bitmap;

  const w = layer.w || 1;
  const h = layer.h || 1;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  for (const stroke of strokes) {
    paintStroke(ctx, stroke, w, h, srcCanvas);
  }

  _cache.set(layer.id, { bitmap: canvas, key });
  return canvas;
}

/**
 * Main entry point called from renderer.js drawLayer().
 * ctx is already translated/scaled/alpha'd by the caller.
 */
export function drawDrawLayer(ctx, layer, srcCanvas) {
  const strokes = layer.strokes || [];
  if (strokes.length === 0) return;
  const bmp = rasterizeStrokes(layer, srcCanvas);
  if (!bmp) return;
  ctx.drawImage(bmp, 0, 0, layer.w, layer.h);
}

export function rasterizeDrawLayer(ctx, layer, srcCanvas) {
  drawDrawLayer(ctx, layer, srcCanvas);
}

// ---- Helper functions for retouching ----

function getBaseRegion(ctx, srcCanvas, rx, ry, rw, rh) {
  const canvas = document.createElement('canvas');
  canvas.width = rw; canvas.height = rh;
  const cCtx = canvas.getContext('2d');
  cCtx.clearRect(0, 0, rw, rh);

  // Draw from srcCanvas first
  if (srcCanvas) {
    cCtx.drawImage(srcCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
  }
  // Draw current ctx on top
  cCtx.drawImage(ctx.canvas, rx, ry, rw, rh, 0, 0, rw, rh);

  return cCtx.getImageData(0, 0, rw, rh);
}

function sampleBilinear(imgData, x, y, w, h) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const tx = x - x0;
  const ty = y - y0;

  const idx00 = (y0 * w + x0) * 4;
  const idx10 = (y0 * w + x1) * 4;
  const idx01 = (y1 * w + x0) * 4;
  const idx11 = (y1 * w + x1) * 4;

  const data = imgData.data;

  const r = (1 - tx) * (1 - ty) * data[idx00] + tx * (1 - ty) * data[idx10] + (1 - tx) * ty * data[idx01] + tx * ty * data[idx11];
  const g = (1 - tx) * (1 - ty) * data[idx00 + 1] + tx * (1 - ty) * data[idx10 + 1] + (1 - tx) * ty * data[idx01 + 1] + tx * ty * data[idx11 + 1];
  const b = (1 - tx) * (1 - ty) * data[idx00 + 2] + tx * (1 - ty) * data[idx10 + 2] + (1 - tx) * ty * data[idx01 + 2] + tx * ty * data[idx11 + 2];
  const a = (1 - tx) * (1 - ty) * data[idx00 + 3] + tx * (1 - ty) * data[idx10 + 3] + (1 - tx) * ty * data[idx01 + 3] + tx * ty * data[idx11 + 3];

  return [r, g, b, a];
}

// ---- Utility ----

function hexToRgba(hex) {
  // Supports #rrggbb and #rgb
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
