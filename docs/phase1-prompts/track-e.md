# Track E — Retouch Tools

## Context

MemeLab is a browser-based meme/photo editor. Track E builds retouch tools: healing brush, clone stamp, dodge/burn, red-eye correction, and liquify. These build on Track D's brush engine.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Sequence: Run after Track D (brush engine) has merged. Track E's retouch tools share the draw layer type, stroke format, and pointer routing from Track D.**

---

## What you are building

1. **Healing brush** — paint over blemishes; the tool blends sampled content from a nearby region with the destination, matching texture and tone. Implement as a **patch-based clone-from-nearby** approach (not full AI inpainting). The patch approach covers the common case (small blemishes) without needing a heavy AI model, and is what Snapseed's basic healing tool uses under the hood.
2. **Clone stamp** — sample from one point (alt-click/two-finger tap to set source), paint that region over another area.
3. **Dodge/burn** — lighten (dodge) or darken (burn) specific areas by painting.
4. **Red-eye correction** — detect and remove red-eye in a tapped region.
5. **Liquify** — push/warp pixels in a local region by dragging (forward warp only for Phase 1; no freeze/reconstruct needed).

---

## Files you will touch

### Primary
- `src/interactions/drawTools.js` — add retouch tool handlers here, alongside the existing brush tools from Track D.
- `src/render/drawLayer.js` — add rasterization support for retouch stroke types.
- `src/ui/props/drawProps.js` — add retouch tool buttons to the draw layer props panel.

### Supporting
- `src/core/layers.js` — `defaultDrawLayer()` already defines the draw layer type; no changes needed.
- `src/core/state.js` — `state.activeTool`, `state.brushSize`, etc. — already exist from Track D.
- `src/core/history.js` — `pushHistory(label)`.
- `src/render/renderer.js` — do NOT change exported signatures.
- `src/render/shapes.js` — `drawImageLayer(ctx, layer)` — you will read from this to bake a source bitmap for retouch.

---

## Real API shapes from Track D

### Draw layer schema (from Track D)
```js
layer.type = 'draw'
layer.strokes = []  // array of stroke objects
// always access as layer.strokes || []
```

### Stroke objects — existing types (from Track D)
```js
{ tool: 'brush', color, opacity, size, hardness, points: [[x,y,pressure], ...] }
{ tool: 'eraser', opacity, size, hardness, points: [[x,y,pressure], ...] }
{ tool: 'line', color, opacity, size, x1, y1, x2, y2 }
{ tool: 'ellipse', color, opacity, size, x1, y1, x2, y2 }
{ tool: 'polygon', color, opacity, size, vertices: [[x,y], ...] }
{ tool: 'fill', color, startX, startY, tolerance }
{ tool: 'gradient', type: 'linear'|'radial', color1, color2, x1, y1, x2, y2 }
```

### New stroke types you will add
```js
{ tool: 'heal', points: [[x,y], ...], size, sourceCanvas: null }
// sourceCanvas is null in the stored stroke — baked at rasterize time from image context

{ tool: 'clone', points: [[x,y], ...], size, opacity, sourceX, sourceY }
// sourceX/sourceY: the sample origin point in canvas space

{ tool: 'dodge', points: [[x,y], ...], size, exposure: 0..1 }
{ tool: 'burn',  points: [[x,y], ...], size, exposure: 0..1 }

{ tool: 'redeye', cx, cy, radius }
// center and radius of the detected red circle to correct

{ tool: 'liquify', points: [[x,y], ...], size, strength: 0..1 }
// forward warp: pixels under the brush are pushed in the drag direction
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

### Layer schema (for read sites)
```js
layer.blendMode   // always access as layer.blendMode || 'normal'
layer.adjustments // always access as layer.adjustments || []
layer.mask        // always access as layer.mask?.enabled
```

---

## Implementation steps

### 1. Healing brush

The healing brush needs a source image to sample from. The draw layer sits on top of an image layer — when the heal tool is activated, bake the current rendered canvas beneath the draw layer into a "source bitmap" that the healing brush reads from.

**Activation**: when the heal tool is selected, capture the content of the layers beneath the current draw layer:
```js
// Render all layers below the current draw layer to a temp canvas
const srcCanvas = document.createElement('canvas');
srcCanvas.width = state.width; srcCanvas.height = state.height;
const srcCtx = srcCanvas.getContext('2d');
for (const l of state.layers) {
  if (l.id === currentDrawLayer.id) break;
  drawLayer(srcCtx, l, null);  // internal renderer function
}
state._healSourceCanvas = srcCanvas;  // transient, not persisted
```

**During painting**: for each brush dab center `(x, y)`:
1. Sample a patch from `_healSourceCanvas` at a nearby region (offset by `(dx, dy)` — default: find the most similar patch in a search radius, or simply use the center of the surrounding clean area).
2. Blend the sampled patch into the draw layer's raster using a feathered mask (Gaussian-weighted composite).

**Storage**: a heal stroke stores `{ tool: 'heal', points, size }` — the source canvas is NOT stored in the stroke (it would bloat the snapshot). At rasterize time in `drawLayer.js`, re-derive it from the underlying layers. For the initial implementation, use a simpler heuristic: sample from an area offset from the stroke center (e.g., the patch directly above or to the left of the stroke), not a full content-aware search.

### 2. Clone stamp

Two-step gesture:
1. **Set source**: alt-click (desktop) or two-finger single tap (touch) at the source point to set `state.cloneStampSource = { x, y }`.
2. **Paint**: drag to stamp the region from around the source point onto the destination.

During painting, each dab at `(dx, dy)` from the stroke start reads from `_healSourceCanvas` at `(cloneStampSource.x + dx, cloneStampSource.y + dy)` and paints it on the draw layer.

Show a crosshair cursor at the clone source while the clone stamp tool is active.

### 3. Dodge/burn

Dodge (lighten) and burn (darken) are pixel-level brightness adjustments applied locally. Implement as a stroke that is rasterized by modifying the pixels under the brush:

At rasterize time in `drawLayer.js`, a dodge/burn stroke:
1. Read pixels from the current draw layer bitmap (or from `_healSourceCanvas`) in the brush region.
2. For dodge: `pixel.rgb = pixel.rgb + exposure * (1 - pixel.rgb)` (lighten toward white).
3. For burn: `pixel.rgb = pixel.rgb * (1 - exposure)` (darken toward black).
4. Stamp the modified pixels back.

Use `getImageData`/`putImageData` on the offscreen rasterize canvas.

### 4. Red-eye correction

When the red-eye tool is active:
- The user taps on a red eye in an image layer.
- Sample a small region around the tap (e.g. 60×60px) from the source layers.
- Detect red pixels (R > threshold, R > G * 2, R > B * 2 — standard red-eye detection heuristic).
- Replace red pixels by setting R = (G + B) / 2, preserving saturation.
- Commit as a `redeye` stroke: `{ tool: 'redeye', cx, cy, radius }`.

At rasterize time: re-run the detection and correction algorithm in the stroke's region.

### 5. Liquify

Forward warp: pixels in the brush region are displaced in the drag direction.

At rasterize time, a liquify stroke:
1. Sample the source pixels in the brush region.
2. For each output pixel `(x, y)` in the region: look up its value from a displaced input position `(x - dx * strength, y - dy * strength)` where `(dx, dy)` is the cumulative drag direction for this stroke.
3. Use bilinear interpolation when sampling displaced pixels.

Store cumulative displacement per point in the stroke: `points: [[x, y, dx, dy], ...]`.

Liquify reads from the same `_healSourceCanvas` snapshot taken at tool activation.

### 6. UI additions in drawProps.js

Add a "Retouch" section (use `collapsibleHtml` from `shared.js`) containing:
- Heal button.
- Clone stamp button (with "Set source" indicator showing current source point if set).
- Dodge button + Burn button (share a combined tool with a mode toggle).
- Exposure slider for dodge/burn (0.1–1.0).
- Red-eye correction button.
- Liquify button + Strength slider (0.1–1.0).

---

## Migration

New stroke types are additional entries in `layer.strokes`. Old draw layers without these stroke types work correctly (the rasterizer skips unknown tool types or treats them as no-ops).

Transient fields (`state._healSourceCanvas`, `state.cloneStampSource`) are never persisted — they're captured fresh at tool activation.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- A heal stroke stored in `layer.strokes` rasterizes without errors.
- Clone stamp: setting source point stores it in state; painting creates a clone stroke.
- Dodge/burn stroke rasterizes and visibly lightens/darkens the affected region.
- Red-eye correction stroke rasterizes and modifies the red channel.
- Liquify stroke rasterizes without errors.
- Undo after each retouch stroke removes the last entry from `layer.strokes`.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- Healing brush must use patch-based clone-from-nearby — do NOT attempt full AI inpainting here (that belongs in Track G if needed).
- Transient tool state (`_healSourceCanvas`, `cloneStampSource`) must NOT appear in history snapshots.
- Defensive access: `layer.strokes || []`, `layer.blendMode || 'normal'`, `layer.adjustments || []`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-e.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
