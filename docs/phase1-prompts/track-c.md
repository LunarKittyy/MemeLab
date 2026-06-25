# Track C — Selection & Masking UI

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed a real non-destructive mask schema (`layer.mask: { enabled, src, invert, feather }`) for image layers. The mask compositing path in `src/render/shapes.js` (`drawImageLayer`) already applies masks stored as dataURL strings. Track C builds the interactive tools for creating and editing those masks.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Depends on: Phase 0 section 3 (mask schema and compositing must exist — they do).**

---

## What you are building

1. **Lasso / freehand selection** — draw a freehand selection boundary by dragging on the selected image layer; convert the resulting shape to a mask.
2. **Polygon selection** — tap to place vertices, close by tapping near the first vertex; convert to a mask.
3. **Magic wand** — tap a color region to select it (flood-fill based selection).
4. **Brush-paint mask** — paint directly on the mask in white (reveal) or black (hide); uses a brush cursor on the canvas.
5. **Gradient mask** — drag to create a linear or radial gradient mask.
6. **Invert selection/mask** — toggles `layer.mask.invert`.

All selection tools produce a mask that is stored as `layer.mask.src` (a dataURL string, greyscale PNG, same as the AI background-removal output from Phase 0). The existing mask compositing in `drawImageLayer` handles the rest automatically.

---

## Files you will touch

### Primary
- `src/interactions/pointer.js` — all pointer interactions go through here; you will add tool-mode awareness.
- New file: `src/interactions/selectionTools.js` — lasso, polygon, magic wand, gradient mask logic.
- New file: `src/interactions/brushMask.js` — brush-paint mask tool.
- `src/ui/props/imageProps.js` — add selection tool buttons to the image layer props panel.
- `src/render/renderer.js` — add a selection overlay (marching ants or solid outline) for the in-progress selection.

### Supporting
- `src/core/layers.js` — mask schema: `layer.mask = { enabled, src, invert, feather }` — already exists.
- `src/core/state.js` — you may add `state.activeTool: 'select'|'lasso'|'polygon'|'wand'|'brushMask'|'gradientMask'|null` to track which tool is active.
- `src/core/history.js` — `pushHistory('Apply mask')` after committing a selection to the mask.
- `src/render/shapes.js` — `drawImageLayer(ctx, layer)` already composites `layer.mask`; do NOT change this function's signature.
- `src/ui/props/shared.js` — `collapsibleHtml()`, `wireCollapsible()`, `byId()`, `rangeRow()`.

---

## Real API shapes from Phase 0

### Mask schema (as it exists in the codebase)
```js
layer.mask = {
  enabled: false,    // boolean — compositing is skipped when false
  src: null,         // string|null — dataURL of a greyscale PNG mask
                     // White pixels = fully visible, Black = fully hidden
                     // Alpha channel not used; compositing reads the R channel as alpha
                     // See drawImageLayer in shapes.js for exact compositing code
  invert: false,     // boolean — swaps white/black in compositing
  feather: 0,        // number, 0–50 — currently stored but feather rendering TBD
}
// Always access as layer.mask?.enabled
```

### How the mask compositing works (src/render/shapes.js)
```js
// drawImageLayer uses destination-in compositing:
offCtx.globalCompositeOperation = 'destination-in';
offCtx.drawImage(maskImg, 0, 0, w, h);
// When invert is true, it first creates an inverted mask canvas:
invCtx.fillStyle = '#fff';
invCtx.fillRect(0, 0, w, h);
invCtx.globalCompositeOperation = 'destination-out';
invCtx.drawImage(maskImg, 0, 0, w, h);
// Then uses destination-in with the inverted canvas.
// The mask PNG stores: R=G=B=gray, A=255
// (white = reveal, black = hide, gray = partial)
```

Your selection tools must produce mask PNGs in exactly this format: RGB all equal to the gray value, A=255. Same as the AI background-removal output already does.

### pointer.js exports
```js
export function applyZoom(factor, originX, originY)
export function selectLayer(id)
export function onSelectionChange(fn)
export function onDragTick(fn)
export function pointInLayerBounds(layer, px, py)
export function stageEventsInit()
export let stage    // imported from renderer.js originally
```

The current `onPointerDown`/`onPointerMove`/`onPointerUp` handlers in `pointer.js` implement layer move/resize/rotate. You will extend these to check `state.activeTool` and route to the appropriate tool handler when a tool is active.

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)          // opts: { forExport: boolean }
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function scheduleRender()
export function dispScaleFactor()
export let stage
```

The internal `drawSelectionOverlay(ctx)` in `renderer.js` currently draws the transform handles for the selected layer. You will extend it to also draw the in-progress selection path (marching ants or a simple dashed stroke) when a selection tool is active.

### viewport.js
```js
export const viewport = { zoom: 1, panX: 0, panY: 0 }
```

Pointer coordinates must be projected through the viewport when a tool is active — use `projectCoords(evt)` from `pointer.js` which already accounts for the stage's current bounding rect (which includes zoom/pan via CSS transform).

---

## Implementation steps

### 1. Tool state

Add to `src/core/state.js`:
```js
state.activeTool = null;  // 'lasso'|'polygon'|'wand'|'brushMask'|'gradientMask'|null
```

When a tool is active:
- The layer move/resize/rotate behavior in `pointer.js` is suspended.
- The pointer events are routed to the active tool handler.
- A tool cursor is shown (CSS `cursor` property on the stage).
- Clicking the active tool button a second time deactivates the tool.

### 2. Lasso selection (src/interactions/selectionTools.js)

On pointerdown: start recording path points.
On pointermove: append `projectCoords(evt)` to the path.
On pointerup: close the path, rasterize to a mask canvas, commit.

Rasterization — convert the path to a mask:
1. Create an offscreen canvas at `layer.w × layer.h`.
2. Transform the recorded path points from canvas space to layer-local space (subtract `layer.x, layer.y`; account for layer rotation).
3. Draw the closed path with `ctx.fill()` in white on a black background.
4. The result is the mask PNG: `canvas.toDataURL('image/png')`.
5. Assign to `layer.mask.src`, set `layer.mask.enabled = true`, call `scheduleRender()` and `pushHistory('Lasso selection')`.

### 3. Polygon selection

Similar to lasso but vertex-by-vertex:
- Tap to add a vertex. Vertices are shown as dots on the overlay.
- Tap near the first vertex (within 20px) to close the polygon.
- "Cancel" button or Escape key to abort.
- Same rasterization on close.

### 4. Magic wand

On tap: read pixel color at the tapped point from the layer's rendered pixels, then flood-fill outward selecting pixels within a color tolerance.

Implementation:
1. Render the layer (without mask) to an offscreen canvas at `layer.w × layer.h` using `drawImageLayer`.
2. `getImageData()` to get pixel array.
3. BFS flood-fill from the tapped point, marking pixels within Euclidean distance `tolerance` in RGB space (default tolerance 30, configurable via a slider in the UI).
4. Output a mask canvas: selected pixels = white, unselected = black.
5. Commit as `layer.mask.src`.

### 5. Brush-paint mask (src/interactions/brushMask.js)

When the brush mask tool is active, pointer events paint directly onto the mask:
- Maintain an offscreen canvas representing the current mask (decode `layer.mask.src` on tool activation).
- On pointermove with button down: draw a white or black circle (`ctx.arc`) at the projected point; radius = brush size.
- On pointerup: encode the canvas to `layer.mask.src = canvas.toDataURL('image/png')`, call `scheduleRender()`.
- Commit to history on pointerup (not on every move tick — too noisy).
- UI controls: brush size slider, paint mode (reveal = white / hide = black toggle).

Show a preview of the brush stroke on the canvas overlay in real-time (draw a circle outline at the cursor position before the button is down).

### 6. Gradient mask

On pointerdown: record start point.
On pointerup: record end point, generate gradient mask.

Linear gradient: white at start, black at end (or vice versa), based on drag direction.
Radial gradient: white at center (start), black at radius (distance from start to end).

Generate using a 2D canvas gradient:
```js
const canvas = document.createElement('canvas');
canvas.width = layer.w; canvas.height = layer.h;
const ctx = canvas.getContext('2d');
const grad = ctx.createLinearGradient(sx, sy, ex, ey);
grad.addColorStop(0, '#ffffff');
grad.addColorStop(1, '#000000');
ctx.fillStyle = grad;
ctx.fillRect(0, 0, layer.w, layer.h);
layer.mask.src = canvas.toDataURL('image/png');
layer.mask.enabled = true;
```

Subtract `layer.x, layer.y` from the start/end points when computing them in layer-local space.

### 7. In-progress selection overlay

Extend `drawSelectionOverlay(ctx)` in `renderer.js` to draw the current selection in-progress:
- For lasso/polygon: draw the current path as a dashed stroke.
- For brush mask: draw a circle at the current cursor position.
- Only draw when `state.activeTool` is not null and a selection is in progress.

Keep this overlay in `renderer.js`'s existing `drawSelectionOverlay` — do not add a second overlay pass.

### 8. UI in imageProps.js

Add a "Masking tools" row in the Image section of `imageProps.js`:
- Buttons: Lasso, Polygon, Magic wand, Brush, Gradient.
- Each button activates the corresponding tool (sets `state.activeTool`).
- The active tool button gets an "active" class.
- The existing Mask collapsible (already in `imageProps.js`) continues to show enable/invert/feather/clear controls.

---

## Migration

No new persistent layer fields. The `layer.mask` schema already exists from Phase 0. Transient tool state (`state.activeTool`, in-progress path points) is not persisted.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Activating the lasso tool sets `state.activeTool` to 'lasso'.
- Simulating a lasso drag on an image layer results in a non-null `layer.mask.src`.
- The resulting mask is a valid PNG dataURL.
- Magic wand on a solid-color region produces a nearly-all-white mask (high coverage).
- Gradient mask produces a valid mask PNG.
- After any mask tool commits, `layer.mask.enabled` is true.
- Undo after mask tool reverts `layer.mask`.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- Mask dataURLs must be stored as strings (not Canvas or Image objects) — `history.js` uses `JSON.parse(JSON.stringify(state))` for snapshots.
- The mask PNG format must match what `drawImageLayer` expects: R=G=B=gray, A=255, white=reveal, black=hide.
- Defensive access: `layer.mask?.enabled`, `layer.mask?.src`, `layer.adjustments || []`, `layer.blendMode || 'normal'`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-c.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
