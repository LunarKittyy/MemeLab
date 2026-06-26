# Phase 2 efficiency findings

## Fixes applied (committed)

### 1. Thumbnail dirty-tracking — `src/render/renderer.js`

`updateThumbnails()` previously re-rendered every `<img class="thumb-img">` on
every `scheduleRender()` tick regardless of whether anything had changed.

Fix: `thumbSerial(id)` hashes all state fields that affect each thumbnail
(position, size, rotation, opacity, visibility, content fields, adjustments,
mask, blend mode, and image-loaded status). `updateThumbnails()` compares the
current serial against a per-id cache (`_thumbCache: Map`); it only calls
`renderThumbToDataURL` when the serial changes. During a drag where no layer
content changes, every thumbnail is skipped — zero canvas work.

Image-load status (`img.complete && img.naturalWidth`) is included in the
serial so that a thumbnail cached while an image was still loading will be
invalidated and re-rendered once the image arrives.

`invalidateThumbCache(id?)` is exported for callers that need to force a flush.

### 2. Checkerboard pre-render — `src/render/renderer.js`

`renderThumbToDataURL()` previously ran a nested loop drawing individual
checkerboard squares on every call. Replaced with `_thumbBg`, a 60×60
offscreen canvas built once at module init; thumbnails now start with a single
`drawImage(_thumbBg, 0, 0)`.

### 3. GL texture reuse — `src/render/glAdjust.js`

`applyAdjustments()` created and deleted a WebGL texture on every call
(`gl.createTexture()` / `gl.deleteTexture(tex)`). The texture is now allocated
once during `initGL()` and reused across all calls. Texture parameters
(CLAMP_TO_EDGE / LINEAR) are set once at creation; only `texImage2D` runs per
call to upload new pixel data.

Note: `adjustCache.js` already caches the result canvas keyed by content
serial, so `applyAdjustments` only fires on actual content changes — the
texture reuse still saves meaningful allocation churn when adjustments are
being dragged.

### 4. Masked layer composite caching — `src/render/adjustCache.js`, `src/render/shapes.js`

`drawImageLayer()` previously allocated a new offscreen canvas (and sometimes a
second invert canvas) on every draw call for any layer with `mask.enabled`.
These canvas allocations happen at full layer display size on every rAF tick
during any drag.

Fix: `getMaskedCanvas(layer, drawFn)` in `adjustCache.js` caches the composited
result in `_maskCache: Map` keyed by a serial that includes `layer.src`,
`layer.crop`, `layer.flipX/flipY`, `layer.adjustments`, `mask.src`,
`mask.invert`, `mask.feather`, and `layer.w/h` (since the composite is at
display resolution). `clearAdjustCache()` now also clears `_maskCache`, so
undo/redo still invalidates correctly.

---

## Deferred findings

### A. `buildBackdrop()` redraws the full scene every frame

**File:** `src/render/renderer.js` — `buildBackdrop()`, called from `renderScene()`

**Cost:** When any blur or pixelate rect layer exists, `buildBackdrop()` runs on
every `scheduleRender()` tick at full canvas resolution (default 1080×1080).
It redraws the background and every non-blur/pixelate layer onto a full-size
offscreen canvas, then `renderScene()` redraws the same layers again on top of
it. This doubles the draw cost and runs at pixel resolution (not display
resolution) on every rAF frame during drags, resizes, or rotations — even
when the blur layer itself isn't moving.

**Fix shape:** Cache the backdrop with a serial covering the background and all
non-blur/pixelate layers' content and geometry. Invalidate only when one of
those actually changes. This is similar to the adjust/mask cache pattern but
applies to the whole scene rather than a single layer, so it needs care around
the invalidation trigger (a move of any non-blur layer invalidates it). A
simpler partial win: only rebuild the backdrop when `blur/pixelate` layers
exist *and* something below them in the stacking order has moved or changed,
using a flag set in `onPointerMove` when the dragged layer is not itself
the blur/pixelate rect.

**Scope:** Medium. Touches `renderScene()` and needs a scene-level dirty flag or
serial. Worth its own focused pass.

### B. Text word-wrap is remeasured every frame — `src/render/text.js`

**File:** `src/render/text.js` — `getWrappedLines()` / `wrapParagraph()`

**Cost:** On every draw of a text layer, `getWrappedLines()` calls
`ctx.measureText(test)` in a word-by-word loop. For long paragraphs and small
word counts this is fast, but it runs on every rAF tick during any drag (even
moving a different layer while a text layer is visible). Since `drawTextLayer`
is called for every visible text layer on every frame, N text layers = N
full wrap passes per frame.

**Fix shape:** Cache the wrapped-lines result keyed by
`(text, font-string, layer.w, layer.padding, letterSpacing)`. Invalidate when
any of those change. The cache can live in a module-level `Map` in `text.js`,
cleared on the same events that already clear the adjust cache (or lazily via
serial comparison). The font string is already computed by `buildFontString()`
so it's cheap to use as part of the key.

**Scope:** Small-medium. Self-contained in `text.js`. Straightforward to add.

### C. `extractSourceCanvas` in `adjustCache.js` allocates a new canvas even when adjustments don't run the GL pass

**File:** `src/render/adjustCache.js` — `extractSourceCanvas()`

**Cost:** `getAdjustedCanvas()` calls `extractSourceCanvas()` to blit the cropped
image into a new canvas before feeding it to the GL pipeline. When
`applyAdjustments` returns `null` (all adjustments are zero), the fallback is
`result = src` — meaning the canvas allocated in `extractSourceCanvas` becomes
the cached result. This allocation happens once per change (the result is
cached), but if multiple rapid changes arrive (slider dragging) it allocates a
new cropped canvas on every slider move event.

**Fix shape:** The source canvas extraction could itself be cached by
`(src.slice(-32), crop, flipX, flipY)` independently of the adjustment values,
so slider dragging only re-runs the GL pass, not the blit step. Low priority
given the existing cache structure already avoids the worst case.
