# Track F — Geometry

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed canvas zoom/pan (`src/core/viewport.js`, zoom math in `src/interactions/pointer.js`). Track F adds canvas-wide crop, straighten/horizon grid, perspective warp, and aspect ratio presets.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Depends on: Phase 0 section 2 (zoom math must exist — it does). Run after or in parallel with Track J (both touch pointer.js — coordinate to avoid merge conflicts).**

---

## What you are building

1. **Canvas-wide crop** — crop the entire canvas (not per-layer crop). Removes the edges of the canvas, adjusting `state.width`, `state.height`, and offsetting all layers.
2. **Straighten/horizon grid** — rotate the entire canvas composition by a small angle (−45° to +45°), plus a grid overlay to help align to the horizon.
3. **Perspective warp** — four-corner warp of an image layer (not canvas-wide). The user drags four corners to distort the layer into a trapezoid.
4. **Aspect ratio presets** — presets for canvas crop: 1:1, 4:3, 16:9, 3:2, 9:16, etc.

---

## Files you will touch

### Primary
- New file: `src/ui/cropModal.js` — the canvas-wide crop UI (a modal or full-screen overlay). Note: there is already a `src/ui/cropModal.js` for per-layer image crop — you will either extend it or add a canvas-wide mode flag. Check the existing file first.
- `src/core/state.js` — canvas crop modifies `state.width`, `state.height`, and all layer positions.
- `src/interactions/pointer.js` — perspective warp and straighten interact with pointer events.
- `src/render/renderer.js` — straighten needs a rotation transform applied at the composition level; perspective warp needs per-layer warping in `drawLayer()`.

### Supporting
- `src/core/history.js` — `pushHistory(label)` after crop/straighten/warp.
- `src/core/viewport.js` — `viewport.zoom`, `viewport.panX`, `viewport.panY`, `resetViewport()`.
- `src/render/shapes.js` — perspective warp in `drawImageLayer(ctx, layer)`.
- `src/persistence/autosave.js` — new fields need migration.
- `src/ui/props/imageProps.js` — add "Perspective warp" button to image layer props.
- `src/ui/toolbar.js` — add "Crop canvas" and "Straighten" buttons or menu entries.
- `src/ui/props/shared.js` — `collapsibleHtml()`, `wireCollapsible()`, `byId()`.

---

## Real API shapes from Phase 0

### viewport.js (do NOT change exports)
```js
export const viewport = { zoom: 1, panX: 0, panY: 0 }
export function resetViewport()
```

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function resizeStageBuffer()
export function applyViewportToStage()
export function scheduleRender()
export function dispScaleFactor()
export let stage
export function getViewportFitScale()
```

### pointer.js exports
```js
export function applyZoom(factor, originX, originY)
export function selectLayer(id)
export function onSelectionChange(fn)
export function onDragTick(fn)
export function pointInLayerBounds(layer, px, py)
export function stageEventsInit()
```

The existing `projectCoords(evt)` in `pointer.js` (internal, not exported) accounts for the stage's bounding rect at any zoom level. Perspective warp corner handles must use the same projection.

### Layer schema
```js
layer.x, layer.y, layer.w, layer.h, layer.rotation
layer.blendMode   // access as layer.blendMode || 'normal'
layer.adjustments // access as layer.adjustments || []
layer.mask        // access as layer.mask?.enabled
// Image layers also have:
layer.src, layer.naturalW, layer.naturalH, layer.crop, layer.flipX, layer.flipY
```

### New layer field for perspective warp (you will add)
```js
layer.perspectiveWarp = null
// or:
layer.perspectiveWarp = {
  enabled: true,
  // Four corner offsets from the layer's bounding box corners, in canvas px:
  tl: { dx: 0, dy: 0 },   // top-left offset
  tr: { dx: 0, dy: 0 },   // top-right
  bl: { dx: 0, dy: 0 },   // bottom-left
  br: { dx: 0, dy: 0 },   // bottom-right
}
```

### state (canvas-wide crop modifies this)
```js
state.width    // number, canvas width in px
state.height   // number, canvas height in px
state.layers   // array — all layer positions affected by crop offset
```

---

## Implementation steps

### 1. Canvas-wide crop

The canvas-wide crop lets the user draw a crop rectangle over the full canvas (similar to Lightroom's crop tool). On confirm:
1. Determine the crop rectangle: `{ x, y, w, h }` in canvas space.
2. Update `state.width = Math.round(w)`, `state.height = Math.round(h)`.
3. Offset all layer positions: `layer.x -= x`, `layer.y -= y` for every layer.
4. Call `resizeStageBuffer()` to update the canvas element.
5. Call `pushHistory('Crop canvas')`.

**UI**: A full-screen overlay modal that shows the canvas with a drag-adjustable crop rectangle. On edges of the crop rect, show drag handles. Show the crop dimensions and aspect ratio. "Confirm" and "Cancel" buttons.

**Aspect ratio presets**: A row of preset buttons (Free, 1:1, 4:3, 3:2, 16:9, 9:16). When a preset is selected, the crop rectangle is constrained to that ratio as the user drags.

**Implementation of the crop overlay**: Use an absolutely-positioned `<div>` overlay on the `canvasArea`. Inside, show a `<canvas>` rendering the current scene, with a darkened border outside the crop rect and a resizable inner rectangle. The crop handles are `<div>` elements you position with CSS.

Alternatively: draw the crop handles directly onto the stage canvas via an overlay render pass (similar to `drawSelectionOverlay`). This is simpler but requires adding an extra render pass that fires only when the crop modal is active.

### 2. Straighten / horizon grid

Add a "Straighten" mode to the canvas crop modal (or as a separate tool):
- A rotation slider (−45° to +45°, step 0.1°).
- A grid overlay (3×3 or rule-of-thirds grid drawn on the canvas overlay).
- Preview: apply the rotation visually during drag (CSS `transform: rotate()` on the stage, not a permanent canvas rotation — just a preview).
- On confirm: add a straighten adjustment. Two options for how to store it:
  - **Option A** (non-destructive): add a `state.straighten = 0` (degrees) field. In `renderScene`, apply `ctx.rotate(deg2rad(state.straighten))` around the center before drawing layers. This keeps it reversible.
  - **Option B** (destructive): rotate each layer's `rotation` field by the straighten amount, and rotate each layer's `(x,y)` around the canvas center. Simpler to implement, harder to undo perfectly.
  - **Recommend Option A** — consistent with the non-destructive philosophy.

If using Option A, add `state.straighten = 0` to `src/core/state.js` and include it in `snapshot()` / `restoreSnapshot()` in `history.js`.

Add migration in `applyLoadedSnapshot()`:
```js
if (snap.straighten === undefined) state.straighten = 0;
else state.straighten = snap.straighten;
```

In `renderScene`:
```js
if (state.straighten !== 0) {
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.rotate(deg2rad(state.straighten));
  ctx.translate(-W/2, -H/2);
  // draw layers...
  ctx.restore();
} else {
  // draw layers normally
}
```

### 3. Perspective warp (image layers only)

Perspective warp lets the user drag the four corners of an image layer independently, producing a quadrilateral projection.

**Data model**: Add `layer.perspectiveWarp` to image layers (null by default, populated when the user activates warp mode for that layer).

**Migration** in `applyLoadedSnapshot()`:
```js
if (l.type === 'image' && l.perspectiveWarp === undefined) l.perspectiveWarp = null;
```

**Rendering**: When `layer.perspectiveWarp?.enabled` is true, use a CSS 3D transform or Canvas 2D homography to warp the image. Canvas 2D doesn't support arbitrary quadrilateral warps natively. Two approaches:
- **Approach A (WebGL)**: Render the warped image via a WebGL homography shader (4 corner UV coordinates → output quad). This is the high-quality approach and is already in glAdjust.js's WebGL context.
- **Approach B (triangle subdivision)**: Split the quad into many small triangles and use `ctx.transform` with `ctx.drawImage` per triangle (the "fake perspective" hack). Works without WebGL but is slow for large layers.
- **Recommend Approach A** if the glAdjust.js WebGL context is accessible. Add a `perspectiveWarp(srcCanvas, corners)` function to `glAdjust.js` that renders the image with a homography.

The rendered warped canvas is then drawn at the layer's position. Use the adjustment cache (`adjustCache.js`) to cache the warped bitmap — invalidate when `layer.perspectiveWarp` changes (add it to `makeSerial` in `adjustCache.js`).

**Corner drag handles**: When warp mode is active for a layer, show 4 drag handles at the layer's corners (offset by `perspectiveWarp.tl/tr/bl/br`). Dragging a handle updates the corresponding offset. Use the same pointer-routing approach as Track C/D for tool-mode awareness.

**UI**: Add a "Perspective warp" button in `imageProps.js`. When tapped, activates warp mode for that layer. Show "Confirm" / "Reset" / "Cancel" overlay buttons.

---

## Non-goals for this track

- Do NOT implement content-aware gap fill after warp (the gaps exposed at edges when warping). Crop-after-warp is the acceptable fallback for Phase 1. Track G's inpainting can fill gaps later if needed.
- Do NOT implement magnetic lasso or refine edge (those are explicitly cut).

---

## Migration

```js
// In applyLoadedSnapshot():
if (snap.straighten === undefined) state.straighten = 0;
else state.straighten = snap.straighten;

state.layers.forEach(l => {
  if (l.type === 'image' && l.perspectiveWarp === undefined) l.perspectiveWarp = null;
});
```

Access defensively: `layer.perspectiveWarp?.enabled`, `state.straighten || 0`.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Canvas crop: after cropping to a 500×500 region of a 1080×1080 canvas, `state.width` and `state.height` are 500.
- Canvas crop: all layer positions are offset correctly.
- Straighten: setting `state.straighten = 5` produces a valid export without errors.
- Undo after crop restores original dimensions and layer positions.
- Perspective warp: setting `layer.perspectiveWarp` and rendering produces a valid export.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- Perspective warp corner offsets in `layer.perspectiveWarp` must be stored as plain serializable objects (not Canvas/Image/WebGL objects) — `history.js` uses `JSON.parse(JSON.stringify(state))`.
- Defensive access: `layer.perspectiveWarp?.enabled`, `state.straighten || 0`, `layer.blendMode || 'normal'`, `layer.mask?.enabled`, `layer.adjustments || []`.
- New persistent fields need defaults in `applyLoadedSnapshot()` AND defensive access at every read site.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-f.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
