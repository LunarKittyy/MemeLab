# Track G — AI Tools

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed real non-destructive layer masks (`layer.mask: { enabled, src, invert, feather }`) and the existing AI background-removal pipeline in `src/cutout/aiSegmentation.js`. Track G extends the AI toolbox with generative fill/object removal, AI upscale, and canvas expand/outpaint.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Depends on: Phase 0 section 3 (mask schema — exists). Track C (selection tools — useful for inpaint-selection UX, but not blocking).**

---

## What you are building

1. **Object removal / generative fill** — select a region (using the mask or a selection from Track C), fill it with AI-generated content (ONNX Runtime Web + WebGPU).
2. **AI upscale** — upscale the canvas or a single image layer by 2× or 4× using Real-ESRGAN or Real-CUGAN.
3. **Canvas expand / outpaint** — expand the canvas edges outward and fill the new area with AI-generated content (same inpainting model, running outward).

### Explicitly out of scope for this track (do not build)
- AI face tools (portrait auto-enhancement, head pose editing) — explicitly cut, not deferred.
- Sky replacement — explicitly cut, not deferred.
- These cuts are permanent decisions, not things to revisit later without deliberate re-approval.

---

## Files you will touch

### Primary
- New file: `src/cutout/inpaint.js` — generative fill/object removal using ONNX Runtime Web.
- New file: `src/cutout/upscale.js` — AI upscale using Real-ESRGAN/Real-CUGAN.
- New file: `src/cutout/outpaint.js` — canvas expand using the same inpainting model.
- `src/ui/props/imageProps.js` — add AI tools section for the selected image layer.
- `src/ui/toolbar.js` — add a canvas-level "Outpaint" button.

### Supporting / mirrors
- `src/cutout/aiSegmentation.js` — existing AI pipeline; use it as the pattern for model loading, WebGPU/WASM fallback, progress reporting. Mirror its patterns in the new modules.
- `src/core/state.js` — `state.width`, `state.height`, `state.layers`.
- `src/core/history.js` — `pushHistory(label)`.
- `src/core/layers.js` — `defaultImageLayer(src, w, h)`.
- `src/persistence/autosave.js` — `applyLoadedSnapshot()`.
- `src/render/renderer.js` — `renderScene()`, `scheduleRender()`.
- `src/ui/props/shared.js` — `byId()`, progress UI pattern already in `imageProps.js`.

---

## Real API shapes from Phase 0

### Existing AI pipeline pattern (src/cutout/aiSegmentation.js)
Mirror this pattern exactly in all new AI modules:
```js
// aiSegmentation.js pattern:
export async function removeBg(imageSource, progressCallback)
// imageSource: HTMLCanvasElement or HTMLImageElement
// progressCallback: (phase, pct) => void
//   phase: 'download' | 'init' | 'inference' | 'ready'
//   pct: 0..1
// Returns: HTMLCanvasElement (greyscale mask)
```

- ONNX Runtime Web is already used here (or Transformers.js) — use the same library.
- WebGPU is preferred, WASM is the fallback — the library handles this internally.
- Models are downloaded once and cached (the existing code shows how).

### Mask schema
```js
layer.mask = { enabled: boolean, src: string|null, invert: boolean, feather: number }
// src is a dataURL string — greyscale PNG, R=G=B=gray, A=255
// white = reveal, black = hide
// Always access as layer.mask?.enabled
```

### Layer schema
```js
layer.id, layer.type, layer.name
layer.x, layer.y, layer.w, layer.h
layer.src          // dataURL string for image layers
layer.blendMode    // access as layer.blendMode || 'normal'
layer.adjustments  // access as layer.adjustments || []
layer.mask         // access as layer.mask?.enabled
```

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function scheduleRender()
export function resizeStageBuffer()
```

### history.js
```js
export function pushHistory(label)
```

### imageProps.js — existing progress UI pattern
```js
// Already in imageProps.js — reuse this pattern for new AI tools:
setProgress(label, pct)   // shows progress bar with label
hideProgress()            // hides it
showAiError(msg)          // shows error with auto-dismiss
```

---

## Implementation steps

### 1. Generative fill / object removal (src/cutout/inpaint.js)

**Input**: a source canvas (the image content) + a mask canvas (white = area to fill, black = preserve).

**Model choice**: Use a lightweight inpainting model from ONNX Hub or Transformers.js. Options:
- `Xenova/stable-diffusion-2-inpainting` (heavy, may be too slow on mobile — assess).
- A smaller MAT or LaMa-based inpainting model (faster, sufficient for removing objects).
- Start with LaMa or a similar fast model. Complexity budget: the model should run in under 10 seconds on a modern phone.

```js
export async function inpaintRegion(srcCanvas, maskCanvas, progressCallback)
// srcCanvas: HTMLCanvasElement — the image to inpaint
// maskCanvas: HTMLCanvasElement — white = fill this region, black = preserve
// progressCallback: same signature as aiSegmentation.js
// Returns: HTMLCanvasElement — the inpainted result at the same dimensions as srcCanvas
```

**UX flow in imageProps.js**:
1. User selects a region using the mask (via Track C's selection tools, or the existing "Remove background" mask).
2. User taps "Generative fill" / "Remove object".
3. Progress is shown using the existing `setProgress` / `hideProgress` pattern.
4. On completion, the result replaces `layer.src` (the underlying image) and `layer.mask` is cleared (since the fill is now baked in).
5. `pushHistory('Generative fill')`.

Note: After inpainting, the result is baked into the layer's `src`. This is intentionally destructive — the inpainted content is the new image. The user can undo via history.

### 2. AI upscale (src/cutout/upscale.js)

**Model**: Real-ESRGAN (general purpose, x2 and x4 variants) or Real-CUGAN (anime/illustration focused). Both have ONNX versions. Choose one to ship; note the choice in your build notes.

```js
export async function upscaleImage(srcCanvas, factor, progressCallback)
// srcCanvas: HTMLCanvasElement
// factor: 2 | 4
// progressCallback: same signature as aiSegmentation.js
// Returns: HTMLCanvasElement — upscaled result at srcCanvas.width*factor × srcCanvas.height*factor
```

**UX flow**:
- For a single image layer: the upscaled result replaces `layer.src`, `layer.naturalW` and `layer.naturalH` are updated, and the layer's display size (`layer.w`, `layer.h`) is NOT changed (the image is just higher resolution now).
- For the whole canvas: render the full scene to an offscreen canvas, upscale it, then present it as a download (or as a new layer). This is a destructive export-time operation, not a layer edit.

Add an "Upscale" option in the existing AI Tools section of `imageProps.js`, and in the export modal (Track H, if landed).

### 3. Canvas expand / outpaint (src/cutout/outpaint.js)

Canvas expand: the user specifies how many pixels to add to each edge (top, bottom, left, right). The canvas grows, existing layers keep their positions, and the new border area is filled by inpainting.

```js
export async function outpaintCanvas(expandTop, expandRight, expandBottom, expandLeft, progressCallback)
// Expands state.width/height, offsets all layers, fills the new border via inpainting
// Returns: void (modifies state directly)
```

Implementation:
1. Compute new canvas dimensions.
2. Create a new source canvas: render the current scene at the new dimensions, with existing content placed at the correct offset and the new border areas left black/white (the inpaint mask).
3. Create an inpaint mask: white = new border regions, black = existing content area.
4. Run `inpaintRegion(srcCanvas, maskCanvas, progress)`.
5. Update `state.width`, `state.height`.
6. Offset all layer positions: `layer.x += expandLeft`, `layer.y += expandTop`.
7. Add the inpainted result as a new background image layer (or update the background).
8. Call `resizeStageBuffer()`, `scheduleRender()`, `pushHistory('Canvas expand')`.

**UI**: A "Expand canvas" panel (toolbar button or in the Document panel from Track H if landed). Four number inputs for top/right/bottom/left expansion in px, plus a preview.

---

## WebGPU / WASM fallback

All ONNX Runtime Web calls automatically fall back to WASM if WebGPU is unavailable. The existing `aiSegmentation.js` shows this pattern — mirror it:
```js
// Transformers.js / ONNX Runtime Web handles this internally when you specify:
env.backends.onnx.wasm.numThreads = 1;
// or via the Transformers.js pipeline which auto-selects the best backend
```

Do NOT explicitly manage WebGPU device creation in your code — let the ONNX Runtime / Transformers.js handle it.

---

## Migration

No new persistent layer fields beyond `layer.src` (already exists). Inpainting results are stored as `layer.src` dataURLs — the existing persistence handles this.

If outpaint adds new layers, those are standard `defaultImageLayer()` objects — no migration needed.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. AI model inference is too slow for headless CI, so AI tests should be skipped or mocked in the test suite:
- Add test cases that **mock** the model inference (inject a fake `inpaintRegion` that returns a blank canvas) and test the UX flow: progress shown, result applied to layer, mask cleared, history pushed.
- Add test cases that confirm model loading begins without JS errors (but don't wait for full inference).
- Add one real inference test marked as `@slow` or gated behind an environment variable.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- Do NOT build AI face tools or sky replacement — these are explicitly and permanently cut.
- All AI results baked into layers must be stored as dataURL strings in `layer.src` — not as live Canvas or Image objects.
- Mirror the `aiSegmentation.js` progress-reporting pattern exactly for all new AI operations.
- Defensive access: `layer.mask?.enabled`, `layer.adjustments || []`, `layer.blendMode || 'normal'`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-g.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
