# Track F — Geometry: Build Notes

## Status: Done

## What was built

### 1. Canvas-wide crop (`src/ui/canvasCropModal.js` — new file)
A full-screen overlay modal that:
- Renders the current scene onto an overlay canvas at a scaled preview resolution.
- Shows a drag-adjustable crop rectangle with 8 handles (corners + edge midpoints) and a rule-of-thirds grid.
- Offers 6 aspect ratio presets (Free, 1:1, 4:3, 3:2, 16:9, 9:16) that constrain the crop rect as the user drags.
- On confirm: updates `state.width`/`state.height`, offsets every layer's `x`/`y` by the crop origin, calls `resizeStageBuffer()`, and calls `pushHistory('Crop canvas')`.
- Buttons: "Crop canvas" and "Straighten" added to the Canvas section of the left panel (in both `index.html` and `tests/index.test.html`).

### 2. Straighten / horizon grid (`src/ui/straightenModal.js` — new file)
A modal with:
- A preview canvas that renders the scene at a reduced scale with the current angle applied (preview-only, uses `state.straighten` temporarily then restores).
- A rotation slider (−45° to +45°, step 0.1°) with live angle display.
- A rule-of-thirds grid overlay plus a center crosshair drawn over the preview.
- On confirm: sets `state.straighten = angle` and calls `pushHistory('Straighten')`.
- Storage: Option A (non-destructive) — `state.straighten` is a new field that persists through snapshot/restore and undo/redo.

### 3. Perspective warp (image layers only)
- **Data model**: `layer.perspectiveWarp = null | { enabled, tl, tr, bl, br }` where each corner is `{ dx, dy }` — plain serializable offsets from the layer's bounding box corners in layer-local space.
- **Rendering** (`src/render/renderer.js` — `drawLayer`): When `layer.perspectiveWarp?.enabled` is true, renders the un-warped layer to an off-screen canvas, then calls `perspectiveWarpCanvas()` which uses triangle subdivision (Approach B) to map the quad onto the main context.
- **Triangle subdivision** (`src/render/glAdjust.js` — `perspectiveWarpCanvas`): Subdivides the source into a 16×16 grid of cells, each rendered as two triangles using an affine `ctx.transform` per triangle. Works without additional WebGL setup. Quality is good for typical warp magnitudes.
- **Warp handles** (`src/render/renderer.js` — `drawSelectionOverlay`): When warp is active, draws 4 circular handles at the warped corner positions (orange, distinct from the normal pink resize handles). Draws the quad outline to show the warped shape.
- **Corner dragging** (`src/interactions/pointer.js`): `handleAt()` detects warp corner handles first when `perspectiveWarp.enabled`. A new `drag.kind = 'warp'` case in `onPointerMove` updates the corresponding corner's `dx`/`dy`. Delta is converted from canvas space to layer-local space (undoing layer rotation) so the warp offset is rotation-independent.
- **UI**: "Perspective warp" button in `imageProps.js` that toggles warp on/off. Button label changes to "Exit warp" when active.
- **Adjust cache**: `makeSerial` in `adjustCache.js` now includes `perspectiveWarp` so the cache invalidates correctly when warp changes.

### 4. Aspect ratio presets
Built into the canvas crop modal — 6 buttons (Free, 1:1, 4:3, 3:2, 16:9, 9:16) that constrain the crop rectangle during drag.

## Key design decisions

- **Straighten storage (Option A)**: Non-destructive. `state.straighten` is applied as a `ctx.rotate()` around the canvas center in `renderScene` and `buildBackdrop`. No layer data is modified. Full undo/redo via history snapshots.
- **Perspective warp rendering (Approach B)**: Triangle subdivision rather than WebGL homography. The existing GL context is already dedicated to the adjustment pipeline; adding a second program would complicate state management. At 16×16 grid resolution, warp quality is visually smooth for typical use.
- **Corner offsets in layer-local space**: Warp offsets (`dx`/`dy` per corner) are relative to the layer's un-rotated bounding box. Rotation is applied when computing actual canvas positions. This keeps the offsets meaningful and stable when the layer is rotated after warping.
- **Blocking move/select in warp mode**: When `perspectiveWarp.enabled`, pointer-down inside the layer body is absorbed (no move, no deselect) so accidental taps don't exit warp accidentally.

## Files touched

| File | Change |
|------|--------|
| `src/core/state.js` | Added `straighten: 0` to initial state |
| `src/core/history.js` | Added `straighten` to `snapshot()` and `restoreSnapshot()` |
| `src/core/layers.js` | Added `perspectiveWarp: null` to `defaultImageLayer()` |
| `src/persistence/autosave.js` | Migration for `straighten` and `perspectiveWarp` in `applyLoadedSnapshot()` |
| `src/render/renderer.js` | Straighten rotation in `renderScene` and `buildBackdrop`; warp rendering in `drawLayer`; warp handles in `drawSelectionOverlay`; added import of `perspectiveWarpCanvas` |
| `src/render/glAdjust.js` | Added `perspectiveWarpCanvas()` and `drawTriangle()` |
| `src/render/adjustCache.js` | Added `perspectiveWarp` to `makeSerial()` |
| `src/interactions/pointer.js` | Warp corner `handleAt()`, `warp` drag case in `onPointerMove`, warp mode body-click absorption |
| `src/ui/canvasCropModal.js` | New: canvas-wide crop modal with aspect ratio presets |
| `src/ui/straightenModal.js` | New: straighten modal with slider and grid preview |
| `src/ui/props/imageProps.js` | Added "Perspective warp" button to image props HTML and wiring |
| `src/ui/toolbar.js` | Wired `btnCropCanvas` and `btnStraighten` in `wireGlobalUI()` |
| `index.html` | Added Crop canvas + Straighten buttons in Canvas section |
| `tests/index.test.html` | Same button additions |
| `css/styles.css` | Styles for canvas crop modal, straighten modal |
| `tests/test_full.py` | 22 new Track F test cases |

## Deviations from spec

- The spec suggested adding "Perspective warp" to `imageProps.js` — done. The spec also listed `src/ui/props/shared.js` as a supporting file but no changes were needed there.
- The spec mentioned the possibility of using the existing glAdjust.js WebGL context for a homography shader (Approach A). We used Approach B (triangle subdivision) instead because the adjustment GL context is a singleton program that would need significant restructuring to also run a perspective warp pass. Approach B produces identical visual quality for the warp magnitudes typical of horizon correction.
- `canvasCropModal.js` was a new file (the spec noted the existing `cropModal.js` was for per-layer crop and to either extend or add a canvas-wide mode flag — we chose a separate file to keep concerns cleanly separated).

## Known issues / TODOs

- **Perspective warp gap fill**: As noted in the spec's non-goals, gaps exposed at the canvas edges when warping are not filled. Crop-after-warp is the workaround.
- **Triangle subdivision performance**: At 16×16 = 512 triangles per render, warp is redrawn on every frame tick during drag. On very large layers (> 2000px) this may stutter on slow devices. Could be improved by caching the warped bitmap.
- **Straighten + export clipping**: When `state.straighten` is non-zero, corners of the canvas stick outside the frame — intentional (the spec says straighten is applied to the whole composition; content outside the canvas bounds is clipped by the canvas itself).

## Testing

All 62 existing tests remain green. 22 new Track F tests added:
- Canvas crop: dimensions and layer offsets verified, export size verified.
- Undo/redo for crop and straighten.
- Straighten: state field persisted, export succeeds without errors.
- Perspective warp: enabled flag in state, serializable as plain object, export succeeds.
- DOM: Crop canvas and Straighten buttons present.
- New image layers initialize with `perspectiveWarp: null`.

Final result: **84/84 tests pass**.
