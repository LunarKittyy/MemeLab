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
export function paintStroke(ctx, stroke, w, h) {
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
  }

  ctx.restore();
}

/** Rasterize all committed strokes for a layer, with cache. */
export function rasterizeStrokes(layer) {
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
    paintStroke(ctx, stroke, w, h);
  }

  _cache.set(layer.id, { bitmap: canvas, key });
  return canvas;
}

/**
 * Main entry point called from renderer.js drawLayer().
 * ctx is already translated/scaled/alpha'd by the caller.
 */
export function drawDrawLayer(ctx, layer) {
  const strokes = layer.strokes || [];
  if (strokes.length === 0) return;
  const bmp = rasterizeStrokes(layer);
  if (!bmp) return;
  ctx.drawImage(bmp, 0, 0, layer.w, layer.h);
}

export function rasterizeDrawLayer(ctx, layer, _srcCanvas) {
  drawDrawLayer(ctx, layer);
}

// ---- Utility ----

function hexToRgba(hex) {
  // Supports #rrggbb and #rgb
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
