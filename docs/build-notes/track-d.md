# Track D — Brush & Paint Engine: Build Notes

## What was built

A complete freehand drawing system for MemeLab with seven tools, vector stroke storage, live preview, and a full props panel.

### Tools implemented
- **Brush** — freehand paint strokes with configurable size, opacity, hardness. Soft brushes use radial gradient dabs.
- **Eraser** — same as brush but uses `destination-out` composite op to erase pixels.
- **Line** — drag to draw a straight line (stamped on pointerup).
- **Ellipse** — drag to define bounding box; fills an ellipse.
- **Polygon** — click to add vertices, click near first point (or double-click) to close and fill.
- **Gradient fill** — drag start→end to fill the layer with a linear or radial gradient between two colors.
- **Bucket fill** — BFS flood-fill at tap point; committed as a `'fill'` stroke type storing a compact pixel bitmask.
- **Eyedropper** — reads a pixel from the stage canvas; sets `drawState.brushColor`; auto-reverts to brush.

### Architecture: vector-first stroke storage

All drawing is stored as a `strokes` array on the draw layer — never as raster bitmaps during editing. Rasterization happens only at render/export time in `src/render/drawLayer.js`.

Stroke objects carry tool-specific fields:
```js
{ tool: 'brush'|'eraser', color, opacity, size, hardness, points: [[x,y,pressure],...] }
{ tool: 'line'|'ellipse'|'gradient', color, opacity, size, x1, y1, x2, y2 }
{ tool: 'polygon', color, opacity, size, vertices: [[x,y],...] }
{ tool: 'fill', color, opacity, filledData: Uint8ClampedArray-as-Array, fx, fy, fw, fh }
{ tool: 'gradient', color, color2, gradientType, opacity, x1, y1, x2, y2 }
```

Undo is free: `pushHistory` snapshots the full layer (tiny — just an array of point arrays), and `restoreSnapshot` replaces the layer object, which automatically invalidates the raster cache.

### Live preview performance

A per-session overlay `<canvas>` is placed over `#canvasWrap` during an active stroke. On each `pointermove`:
1. The overlay is cleared.
2. The pre-committed bitmap (cached `rasterizeStrokes` output) is blitted.
3. Only the current in-progress stroke is rendered on top.

This means pointermove is O(new points since last tick), not O(all strokes ever drawn).

On `pointerup` the stroke is committed to `layer.strokes`, the cache is invalidated, and `scheduleRender()` triggers a full rasterize of all strokes (which is then cached for future frames).

### Cache strategy

`src/render/drawLayer.js` keeps an in-memory Map from `layerId` → `{bitmap, key}`. The cache key is `strokes.length + '|' + JSON(lastStroke)`. On `restoreSnapshot` (undo/redo), `invalidateAllDrawCaches()` is called. On single-stroke commit, `invalidateDrawCache(layerId)` is called.

## Files touched

### New files
- `src/render/drawLayer.js` — rasterization engine with LRU-like cache
- `src/interactions/drawTools.js` — pointer handlers for all draw tools, live preview overlay, mini-toolbar, cursor management
- `src/ui/props/drawProps.js` — props panel for draw layers (tool selector, color, size, opacity, hardness, gradient controls, clear/flatten buttons)

### Modified files
- `src/core/state.js` — added `counters.draw`, `drawState` object (activeTool, brushColor, brushSize, brushOpacity, brushHardness, gradientType, gradientColor2)
- `src/core/layers.js` — added `defaultDrawLayer()`
- `src/core/history.js` — calls `invalidateAllDrawCaches()` on `restoreSnapshot()`
- `src/render/renderer.js` — imports `drawDrawLayer`; adds `draw` branch in `drawLayer()`; added draw type to thumbnail renderer; exported `stageCtx` (needed for eyedropper pixel sampling)
- `src/interactions/pointer.js` — routes pointer events to drawTools when `drawState.activeTool !== 'select'` and selected layer is `type==='draw'`
- `src/ui/props/panel.js` — adds draw props branch
- `src/ui/toolbar.js` — adds `addDrawLayerAction()`, wires `#btnAddDraw`, sets brush as default tool
- `src/persistence/autosave.js` — migration: ensures `strokes`, `blendMode`, `adjustments` on loaded draw layers; extends `reconcileIdsAndCounters` for draw counter
- `index.html` — adds `#btnAddDraw` button
- `tests/index.test.html` — mirrors the same button
- `tests/test_full.py` — 19 new test cases for draw layer

## Key design decisions

1. **No circular dependency via lazy import**: `drawProps.js` would create a cycle (`panel.js → drawProps.js → panel.js`) if it imported `renderPropsPanel` directly. Resolved with a dynamic `import('./panel.js').then(m => m.renderPropsPanel())` for the clear/flatten callbacks.

2. **`stageCtx` exported from renderer**: The eyedropper needs to read pixels from the composited stage. Rather than re-reading the stage canvas via `document.getElementById`, exporting `stageCtx` gives a direct reference and avoids a query on every tap.

3. **Bucket fill stored as pixel region, not full-canvas bitmap**: The `'fill'` stroke type stores only the bounding-box region of filled pixels (`filledData`, `fx`, `fy`, `fw`, `fh`). This is far more compact than storing a full 1080×1080 RGBA array for a typical fill region.

4. **Draw layer covers full canvas**: `x: 0, y: 0, w: state.width, h: state.height`. No cropping/transform on draw layers (rotation/scale in the draw layer transform panel are still available for post-hoc effects but are unusual).

5. **Mini toolbar**: A floating read-only indicator (color swatch, size, opacity, tool name) appears over the canvas whenever a draw tool is active. It is `pointer-events: none` so it doesn't interfere with drawing.

6. **Polygon close**: Polygon closes when the user clicks within 10px of the last vertex (with 3+ vertices). This is a simple double-tap-or-near-start approach that works for both mouse and touch.

## Deviations from spec

- The spec suggests storing `state.activeTool` as a flat state field. Instead, `drawState` is a separate export from `state.js` to avoid polluting the snapshot/history object (tool selection is not undoable). The pointer routing checks `drawState.activeTool` rather than `state.activeTool`.
- The spec mentions `{ tool: 'fill', color, startX, startY, tolerance }` but the implementation stores the actual filled pixel region to avoid re-running BFS on every render frame. The stored form is rasterization-ready.
- `drawCommonTransformProps` is skipped for draw layers in `panel.js` (no transform section) since draw layers have fixed position/size that matches the canvas. The flatten action handles the "convert to movable image" case.

## Known issues / TODOs

- **Polygon double-click on touch**: On touch devices, two rapid taps may not be recognized as "near" the last vertex. A timer-based double-tap could improve this.
- **Pressure sensitivity**: The `pressure` field is collected from pointer events but not yet applied to brush size. Adding `size * pressure` would improve stylus feel.
- **Large bucket fill on big canvases**: BFS on a 4000×4000 canvas with a large contiguous region is slow (up to millions of pixels). A scanline-based fill would be faster.
- **Gradient fill overwrites the full layer**: The gradient `fillRect(0,0,w,h)` paints over everything below it in the stroke stack. This is intentional (it's a fill, not a mask), but may surprise users. A "clip to selection" variant would be useful.
- **No selection/mask integration**: Track C (masking) is not yet merged. When it lands, bucket fill and gradient should respect active selections.

## How it was tested

```bash
python3 -m http.server 8731 &
python3 tests/test_full.py
# 81/81 passed (62 existing + 19 new draw-layer tests)
```

New test coverage:
- Draw layer creation (type, strokes, w, h, blendMode, adjustments)
- Empty draw layer renders valid PNG without error
- Brush drag adds a stroke with correct schema
- Stroke export produces valid PNG
- Undo removes the last stroke
- Flatten converts draw layer to image layer
- Eyedropper auto-reverts to brush after sampling
- No page errors throughout all draw operations
