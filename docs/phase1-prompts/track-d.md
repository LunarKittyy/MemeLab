# Track D — Brush & Paint Engine

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed blend modes and the adjustment stack. This track builds the freehand drawing tools: brush, eraser, ellipse/polygon/line shapes, gradient fill, bucket fill, and eyedropper.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Sequence: Run after or in parallel with Track C (masking). Track D does not depend on Track C but both touch `pointer.js` — coordinate carefully to avoid merge conflicts, or run D after C merges.**

---

## What you are building

1. **Freehand brush** — paint strokes on a draw layer with configurable size, opacity, color, hardness.
2. **Eraser** — same as brush but erases (sets pixels to transparent).
3. **Ellipse, polygon, and line shape tools** — stamp a shape onto the draw layer.
4. **Gradient fill** — fill the draw layer (or selection) with a linear or radial gradient.
5. **Bucket fill** — flood-fill a region on the draw layer with the current color.
6. **Eyedropper** — tap to sample a color from anywhere on the canvas.

**Critical design constraint: store strokes as vector data, not raster dabs.**

Do NOT stamp dabs onto a permanent bitmap as the live editing representation. Instead, store strokes as:
```js
// A stroke object:
{
  tool: 'brush'|'eraser'|'line'|'ellipse'|'polygon',
  color: '#ff0000',
  opacity: 0.8,
  size: 20,           // brush radius in canvas px
  hardness: 0.8,      // 0 = soft gaussian, 1 = hard circle
  points: [[x,y,pressure], ...],   // for brush/eraser
  // or for shapes:
  x1, y1, x2, y2,   // for line/ellipse
  vertices: [[x,y]], // for polygon
}
```

Reasons:
- Vector strokes are cheap to undo (remove the last stroke from the array).
- They stay crisp at any export resolution.
- They don't bloat snapshot/undo storage — a stroke is a small array of points, not a full-resolution bitmap.
- Rasterize to a bitmap only at merge/export time, not as the live editing representation.

---

## Files you will touch

### Primary
- `src/core/layers.js` — add a `'draw'` layer type with `strokes` array.
- `src/render/renderer.js` — `drawLayer()` must handle `type === 'draw'`; dispatch to a new draw-layer renderer.
- New file: `src/render/drawLayer.js` — rasterize a draw layer's `strokes` array to a 2D canvas.
- `src/interactions/pointer.js` — add tool-mode awareness (same pattern as Track C); route events to draw tools.
- New file: `src/interactions/drawTools.js` — freehand brush, eraser, shape tools, bucket fill, eyedropper.
- `src/ui/toolbar.js` — add a "Draw" button that creates a new draw layer and activates the brush tool.

### Supporting
- `src/core/state.js` — add `state.activeTool` (if Track C hasn't added it yet), `state.brushColor`, `state.brushSize`, `state.brushOpacity`, `state.brushHardness`.
- `src/core/history.js` — `pushHistory('Brush stroke')` after each stroke is committed.
- `src/persistence/autosave.js` — `applyLoadedSnapshot()` must add defaults for draw layers.
- `src/ui/props/shared.js` — `collapsibleHtml()`, `wireCollapsible()`, `byId()`, `rangeRow()`.
- New file: `src/ui/props/drawProps.js` — props panel for draw layers (color, size, opacity, hardness; list of strokes; clear/flatten buttons).

---

## Real API shapes from Phase 0

### Layer schema (existing types)
```js
layer.id, layer.type ('image'|'text'|'rect'), layer.name
layer.x, layer.y, layer.w, layer.h, layer.rotation
layer.opacity, layer.visible, layer.locked
layer.blendMode   // always access as layer.blendMode || 'normal'
layer.adjustments // always access as layer.adjustments || []
```

### New draw layer schema (you will define and add this)
```js
{
  id: 'L5', type: 'draw', name: 'Drawing 1',
  x: 0, y: 0,                     // draw layers cover the full canvas
  w: state.width, h: state.height, // same as canvas dimensions
  rotation: 0, opacity: 1, visible: true, locked: false,
  blendMode: 'normal',
  adjustments: [],
  strokes: [],    // array of stroke objects (see above)
}
```

### renderer.js internals (extend drawLayer, do NOT change exported signatures)
```js
// Internal function in renderer.js — extend, not export:
function drawLayer(ctx, layer, backdrop) {
  if (!layer.visible) return;
  ctx.save();
  ctx.globalCompositeOperation = layer.blendMode || 'normal';
  // ... existing translate/rotate/opacity setup ...
  if (layer.type === 'image') drawImageLayer(ctx, layer);
  else if (layer.type === 'rect') drawRectLayer(ctx, layer, backdrop);
  else if (layer.type === 'text') drawTextLayer(ctx, layer);
  // ADD:
  else if (layer.type === 'draw') drawDrawLayer(ctx, layer);
  ctx.restore();
}
```

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function scheduleRender()
export function dispScaleFactor()
export let stage
```

### adjustCache.js (do NOT change)
```js
export function clearAdjustCache()
```

### history.js
```js
export function pushHistory(label)
export function restoreSnapshot(snap)
```

### viewport.js
```js
export const viewport = { zoom: 1, panX: 0, panY: 0 }
```

---

## Implementation steps

### 1. Draw layer type (src/core/layers.js)

Add `defaultDrawLayer()`:
```js
export function defaultDrawLayer() {
  counters.draw = (counters.draw || 0) + 1;
  return {
    id: nextId(), type: 'draw', name: 'Drawing ' + counters.draw,
    x: 0, y: 0, w: state.width, h: state.height,
    rotation: 0, opacity: 1, visible: true, locked: false, aspectLocked: false,
    blendMode: 'normal', adjustments: [],
    strokes: [],
  };
}
```

Add migration in `applyLoadedSnapshot()` in `autosave.js`:
```js
if (l.type === 'draw' && !Array.isArray(l.strokes)) l.strokes = [];
```

### 2. Rasterize draw layer (src/render/drawLayer.js)

```js
export function drawDrawLayer(ctx, layer) {
  // Rasterize all strokes to a temp canvas, then draw to ctx.
  // For performance: cache the rasterized bitmap, invalidate when strokes change.
  if (!layer.strokes || layer.strokes.length === 0) return;
  const bmp = rasterizeStrokes(layer.strokes, layer.w, layer.h);
  ctx.drawImage(bmp, 0, 0, layer.w, layer.h);
}
```

`rasterizeStrokes(strokes, w, h)`:
- Create (or reuse a cached) offscreen canvas at `w × h`.
- For each stroke in order:
  - **brush**: draw a series of circles along the points, using `ctx.globalAlpha = stroke.opacity`, `ctx.fillStyle = stroke.color`. For soft brushes (hardness < 1), use a radial gradient fill instead of a solid circle.
  - **eraser**: same as brush but `ctx.globalCompositeOperation = 'destination-out'`.
  - **line**: `ctx.moveTo` / `ctx.lineTo` / `ctx.stroke`.
  - **ellipse**: `ctx.ellipse` / `ctx.fill`.
  - **polygon**: `ctx.moveTo` + `ctx.lineTo` path / `ctx.fill`.
- Return the canvas.

Cache by `layer.id` + `layer.strokes.length` + a hash of the last stroke. Invalidate on undo (which replaces the layer object via `restoreSnapshot`).

### 3. Live preview during drawing

The challenge: `scheduleRender()` re-rasterizes all strokes on every rAF tick. While dragging a brush stroke, you're adding points to the active (in-progress) stroke on every pointermove. This would be slow if you rasterize all strokes from scratch.

Solution: keep a separate "live preview canvas" at `layer.w × layer.h` that is:
1. Pre-filled with the rasterized bitmap of all committed strokes (updated only when a stroke is committed).
2. On every pointermove during an active stroke, draw only the current in-progress stroke on top of the pre-filled canvas.
3. On pointerup (stroke commit), commit the stroke to `layer.strokes`, update the pre-filled canvas.

This way, pointermove only needs to draw the current stroke increment — O(new points since last tick), not O(all strokes).

### 4. Pointer routing (pointer.js)

Extend the existing pointer handler to check `state.activeTool` at the start of `onPointerDown`:
```js
function onPointerDown(evt) {
  if (state.activeTool && state.activeTool !== 'select') {
    // Route to the active tool
    drawToolsPointerDown(evt);
    return;
  }
  // ... existing move/resize/rotate logic ...
}
```

Same for `onPointerMove` and `onPointerUp`. This is the same pattern Track C uses — if C has already landed, reuse its tool-routing pattern exactly.

### 5. Draw tools (src/interactions/drawTools.js)

```js
export function drawToolsPointerDown(evt) { ... }
export function drawToolsPointerMove(evt) { ... }
export function drawToolsPointerUp(evt) { ... }
```

**Brush/eraser flow:**
- pointerdown: begin stroke, record first point.
- pointermove: append point; render preview.
- pointerup: commit stroke to `getSelected().strokes`, call `pushHistory('Brush stroke')`, `scheduleRender()`.

**Eyedropper:**
- pointerdown: read pixel at the tapped point from the stage canvas (`stageCtx.getImageData(..., ..., 1, 1)`). Set `state.brushColor` to the sampled color. Deactivate tool.

**Bucket fill:**
- pointerdown: flood-fill the draw layer at the tapped point.
- Implementation: same BFS flood-fill as Track C's magic wand, but applied to the draw layer's rasterized bitmap. Flood-fill from the tapped point, painting filled pixels in `state.brushColor`.
- Commit the result as a single `'fill'` stroke type: `{ tool: 'fill', color, startX, startY, tolerance }` — store as a stroke so undo removes it cleanly; rasterize it during `rasterizeStrokes`.

**Gradient fill:**
- drag start to end; generate a gradient stroke: `{ tool: 'gradient', type: 'linear'|'radial', color1, color2, x1, y1, x2, y2 }`.

### 6. Shape tools

For ellipse, polygon, line — similar to brush but stamp a shape:
- Live preview: draw the in-progress shape on the preview layer as the user drags.
- On pointerup: commit as a shape stroke object.

### 7. Brush tool props panel (src/ui/props/drawProps.js)

Props for the selected draw layer:
- Color picker (use `<input type="color">`) wired to `state.brushColor`.
- Size slider (1–200px).
- Opacity slider (0–1).
- Hardness slider (0–1).
- Tool mode segmented button: brush / eraser / line / ellipse / polygon / gradient / bucket / eyedropper.
- "Clear all strokes" button: `layer.strokes = []; clearAdjustCache(); scheduleRender(); pushHistory('Clear drawing')`.
- "Flatten to image" button: rasterize all strokes to a PNG dataURL, replace the draw layer with an image layer. This is the merge/export rasterization path.

Also show current brush settings in a persistent floating mini-toolbar above the canvas when a draw tool is active (color swatch, size, opacity) so the user doesn't need to open the panel to see them.

---

## Migration

Add to `applyLoadedSnapshot()` in `autosave.js`:
```js
if (l.type === 'draw') {
  if (!Array.isArray(l.strokes)) l.strokes = [];
  if (l.blendMode === undefined) l.blendMode = 'normal';
  if (l.adjustments === undefined) l.adjustments = [];
}
```

Access defensively at all read sites: `layer.strokes || []`.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Creating a draw layer adds it to `state.layers` with `type === 'draw'` and `strokes === []`.
- Simulating a brush drag on a draw layer adds a stroke to `layer.strokes`.
- The draw layer renders without errors (valid export PNG).
- Undo removes the last stroke.
- "Flatten to image" converts the draw layer to an image layer.
- Eyedropper tap samples the correct color.
- A draw layer with empty strokes renders as transparent (no visible change to export).

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`. Add the draw layer type inside `drawLayer()` only.
- Store strokes as vector data (`layer.strokes` array), NOT as raster bitmaps — rasterize only at draw/export time.
- Defensive access: `layer.strokes || []`, `layer.blendMode || 'normal'`, `layer.adjustments || []`.
- New schema fields need defaults in `applyLoadedSnapshot()` AND defensive access at every read site.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-d.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
