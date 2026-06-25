# Track J — Mobile UX Polish

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed canvas zoom/pan (`src/core/viewport.js`, `src/interactions/pointer.js`). Track J adds gesture swipe-to-adjust, before/after compare, alignment/smart guides, and grid/rulers.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Depends on: Phase 0 section 2 (zoom math must exist — it does). Run after or in parallel with Track F (both touch pointer.js — coordinate to avoid merge conflicts).**

---

## What you are building

1. **Gesture swipe-adjust** — when an adjustment is active (e.g. a brightness slider is focused), swiping left/right on the canvas adjusts its value. Snapseed-style.
2. **Before/after compare** — split-screen or toggle view to compare the original image to the current edits.
3. **Alignment / smart guides** — when dragging a layer, show guide lines when it aligns with other layers' edges or centers, and optionally snap to those guides.
4. **Grid / rulers** — toggleable overlay: a grid (configurable cell size) and/or rulers along the top and left edges.

---

## Files you will touch

### Primary
- `src/interactions/pointer.js` — the main pointer event handler; you will extend it for swipe-adjust and smart guide snapping.
- `src/render/renderer.js` — the `drawSelectionOverlay` function draws on top of the scene; you will extend it to draw guide lines, grid, and rulers.
- `src/ui/props/imageProps.js` — add before/after toggle button; swipe-adjust activates from the adjustment sliders here.

### Supporting
- `src/core/state.js` — add `state.showGrid`, `state.gridSize`, `state.showRulers`, `state.snapToGuides`.
- `src/core/viewport.js` — `viewport.zoom`, `viewport.panX`, `viewport.panY`.
- `src/core/history.js` — `pushHistory(label)`.
- `src/render/shapes.js` — `drawImageLayer(ctx, layer)` — before/after may need to read the original image.
- `src/ui/props/shared.js` — `collapsibleHtml()`, `wireCollapsible()`, `byId()`, `rangeRow()`.
- `src/ui/toolbar.js` — toggles for grid/rulers/before-after may live here.

---

## Real API shapes from Phase 0

### viewport.js
```js
export const viewport = { zoom: 1, panX: 0, panY: 0 }
export function resetViewport()
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

The internal `onPointerMove` handler uses `drag.kind` to dispatch movement types. Smart guide snapping will hook into the `move` case.

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function resizeStageBuffer()
export function applyViewportToStage()
export function scheduleRender()
export function dispScaleFactor()
export function getViewportFitScale()
export let stage
```

The internal `drawSelectionOverlay(ctx)` in `renderer.js` is where you will draw guides, grid, and rulers. This function is called from `doRender()` via `renderScene`, which passes `opts.forExport`. Grid and rulers must NOT appear in exports — check `opts.forExport` before drawing them.

### Layer schema
```js
layer.x, layer.y, layer.w, layer.h, layer.rotation
layer.visible, layer.locked
layer.blendMode   // access as layer.blendMode || 'normal'
layer.adjustments // access as layer.adjustments || []
layer.mask        // access as layer.mask?.enabled
// Image layers:
layer.src         // dataURL string
```

### state
```js
state.layers       // array
state.selectedId   // string|null
state.width, state.height
```

---

## Implementation steps

### 1. Gesture swipe-adjust

When an adjustment slider (`<input type="range">`) in the props panel is focused or active, a horizontal swipe on the canvas adjusts that slider's value. This is the Snapseed swipe-to-adjust interaction.

**Tracking the focused slider**:
```js
// In imageProps.js, when wiring adjustment sliders:
byId('aiBright').addEventListener('focus', () => { state.swipeAdjustTarget = 'aiBright'; });
byId('aiBright').addEventListener('blur',  () => { if (state.swipeAdjustTarget === 'aiBright') state.swipeAdjustTarget = null; });
```

Add `state.swipeAdjustTarget = null` (transient, not persisted) to `state.js`.

**In pointer.js**, in `onPointerMove`, when `state.swipeAdjustTarget` is set and no layer drag is in progress:
```js
if (state.swipeAdjustTarget && !drag) {
  const deltaX = evt.clientX - lastSwipeX;
  lastSwipeX = evt.clientX;
  const slider = document.getElementById(state.swipeAdjustTarget);
  if (slider) {
    const range = slider.max - slider.min;
    slider.value = clamp(+slider.value + deltaX * (range / 300), slider.min, slider.max);
    slider.dispatchEvent(new Event('input'));
  }
}
```

Show a horizontal swipe hint (a small visual overlay on the canvas) when a slider is focused. Dismiss it after 2 seconds.

### 2. Before/after compare

Two modes:
- **Toggle**: tap to flip between "original" and "current". A button in the toolbar or the image props panel.
- **Split**: show original on the left half, current on the right, with a draggable divider.

**State**: `state.compareMode = null | 'toggle' | 'split'` (transient, not persisted).

**For toggle mode**:
- When active, `renderScene` draws the original image (before adjustments/mask) instead of the processed result.
- "Original" = the layer's `src` with no adjustments, no mask, no blend mode effect.
- Simplest implementation: when compare toggle is active, temporarily clear `layer.adjustments` and `layer.mask.enabled` during the render pass. Do this non-destructively: clone the adjustments, render, restore.
- Better: in `drawImageLayer` in `shapes.js`, check `state.compareMode === 'toggle'` and skip `getAdjustedCanvas()` and mask compositing.

**For split mode**:
- Render the full processed scene to an offscreen canvas A.
- Render the "original" scene (no adjustments/masks) to an offscreen canvas B.
- On the stage, clip to the left half (`ctx.rect(0, 0, W/2, H)`) and draw A; clip to the right half and draw B.
- Draw a divider line at the midpoint.
- A draggable handle on the divider lets the user slide the split point.
- Add this as a second render pass in `doRender()`, gated on `state.compareMode === 'split'`.

**UI**: A "Compare" toggle button in the toolbar or image props. When active, show the button as highlighted.

### 3. Smart guides

When dragging a layer, compute potential alignment lines with other visible layers' edges and centers. If the dragging layer's edge or center comes within a threshold (e.g. 8px in canvas space), snap to it and show a colored guide line.

**Computation** (in `onPointerMove`, `drag.kind === 'move'`):
```js
const guides = computeGuides(drag.layer, state.layers);
// guides: { x?: number, y?: number }[] — each is a snap line
for (const guide of guides) {
  const threshold = 8 / viewport.zoom;  // threshold in canvas px
  if (guide.x !== undefined && Math.abs(drag.layer.x - guide.x) < threshold) {
    drag.layer.x = guide.x;  // snap
    state.activeGuides.push(guide);
  }
  // similar for .y
}
```

`computeGuides(movingLayer, allLayers)`: for each other visible layer, compute:
- Left edge, right edge, horizontal center.
- Top edge, bottom edge, vertical center.
Also include canvas edges (x=0, x=state.width, y=0, y=state.height).

**Drawing guides**: in `drawSelectionOverlay(ctx)`, draw active guide lines as colored lines spanning the full canvas height/width. Clear `state.activeGuides` on pointerup.

**Snap toggle**: add a "Snap to guides" toggle in the toolbar or a settings panel. Wire to `state.snapToGuides` (default: true).

**State**:
```js
state.snapToGuides = true;   // persisted? — yes, user preference
state.activeGuides = [];     // transient — current drag's visible guide lines
```

### 4. Grid and rulers

**Grid overlay**: when `state.showGrid` is true, draw a grid in `drawSelectionOverlay(ctx)` (or a separate `drawOverlay` function called from `doRender`):
```js
function drawGrid(ctx, W, H) {
  const cellPx = state.gridSize * viewport.zoom * getViewportFitScale();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= W; x += cellPx) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += cellPx) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}
```

Adjust for the current zoom level so grid cells appear the same size in screen space regardless of zoom.

**Rulers**: draw a 20px ruler along the top and left edges of the canvas area (outside the stage canvas, as a CSS element overlay, or drawn on the stage canvas with a clipped region). CSS overlay is simpler — position a fixed-size `<div>` with ruler tick marks drawn via Canvas or SVG.

**State**:
```js
state.showGrid = false;     // toggleable
state.gridSize = 100;       // canvas px per cell
state.showRulers = false;   // toggleable
```

Add to `snapshot()` / `restoreSnapshot()` in `history.js`? Grid visibility is a UI preference, not document state — probably not in history. Store in `localStorage` instead.

**UI**: Toolbar toggle buttons for grid and rulers. A "Grid settings" popover (cell size, color) accessible from the grid toggle button long-press or a gear icon.

---

## Migration

`state.showGrid`, `state.showRulers`, `state.gridSize`, `state.snapToGuides`: store in `localStorage` (not in autosave snapshots) since they're UI preferences, not document state. No migration needed.

Transient fields (`state.compareMode`, `state.swipeAdjustTarget`, `state.activeGuides`): never persisted.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Setting `state.showGrid = true` and rendering produces a valid export (grid must not appear in the export — check `opts.forExport`).
- Before/after toggle: compare mode renders the original (no adjustments) layer src.
- Smart guide computation: given two layers, `computeGuides` returns the expected alignment values.
- Grid and rulers are not drawn when `opts.forExport` is true.
- Swipe-adjust: simulating horizontal swipe with a focused slider updates the slider value.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- Grid and rulers must NOT appear in exports — gate on `opts.forExport`.
- `state.compareMode`, `state.swipeAdjustTarget`, `state.activeGuides` must NOT appear in history snapshots.
- Defensive access: `layer.blendMode || 'normal'`, `layer.mask?.enabled`, `layer.adjustments || []`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-j.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
