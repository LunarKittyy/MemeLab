# Phase 0 build notes

Judgment calls and non-obvious decisions made while building the four sections.

---

## Section 1 — Blend modes

**`globalCompositeOperation` reset:** Set to `'source-over'` (not `'normal'`) before
`ctx.restore()` in `drawLayer()`. Canvas2D requires `'source-over'` as the reset value;
`'normal'` is not a valid composite operation and silently no-ops in some engines.

**Blend mode on blur/pixelate rects:** `boxEffects.js` draws to the real ctx via a
backdrop read; `applyBoxEffect` does not internally set `globalCompositeOperation`, so
`drawLayer()`'s pre-draw assignment applies correctly to the composited result.
No conflict found — the PLAN.md concern was worth checking but did not require a fix.

**Collapsible UI pattern chosen:** `collapsibleHtml(id, title, innerHtml, {defaultOpen})`
plus `wireCollapsible(id)` in `ui/props/shared.js`. The `id` is used as the element ID
for the outer wrapper and as `${id}-hdr` / `${id}-body` for the header and body, so wiring
never needs to walk the DOM. Blend mode select is inside a collapsible "Advanced" section
in the Transform block; mask and adjustments also use the same helper.

---

## Section 2 — Canvas zoom & pan

**Viewport state location:** `src/core/viewport.js` — a standalone module rather than
a field on `state` in `state.js`. This makes it structurally impossible to accidentally
serialize viewport into a history snapshot (since `history.js` `snapshot()` only reads
from `state`).

**CSS zoom instead of ctx.scale:** Stage element dimensions are set to
`fitScale × zoom × document.width/height` pixels; pan is applied as a CSS `translate()`
on the same element. `getBoundingClientRect()` sees the fully-transformed rect, so
`dispScaleFactor()` and `projectCoords()` in `pointer.js` needed no changes — they already
work from the rect's reported size, which includes zoom.

**`applyZoom` pan formula:** `viewport.panX += (fracX - 0.5) * (oldW - newW)` where
`fracX` is the cursor's fractional position within the stage's reported width before zoom.
This keeps the point under the cursor fixed while flexbox re-centers the element during
the width change. The `- 0.5` offsets for the flexbox centering behavior.

**Two-finger canvas pinch vs layer pinch:** Canvas pinch (zoom the viewport) fires when
no layer is selected or being resized. Layer pinch (resize the selected layer) fires when
a layer is active. The distinguishing condition is `activeDrag === null` — if a
`pointerdown` on the stage background starts the gesture, it's a canvas pinch; if it
started on a layer handle, it's a layer resize.

**`screenTouches` Map:** Touch coordinates for canvas pinch are stored in screen space
(`clientX/Y`) rather than document/layer space, because the pinch midpoint and spread
need to be stable across zoom changes that happen mid-gesture.

---

## Section 3 — Layer masks

**Mask format — alpha-keyed PNG:** The AI segmentation output has R=G=B=gray and A=255.
`destination-in` compositing uses the *alpha* channel of the mask as the cutout, not the
RGB values. So `runBgRemoval` converts: `A = R` (gray value becomes alpha), `R=G=B=255`.
This runs in a small pixel loop in imageProps.js at mask-apply time, not on every render.

**dataURL storage:** Masks (and all images) are stored as dataURL strings in
`layer.mask.src`. `history.js` `snapshot()` uses `JSON.parse(JSON.stringify(state))`;
live Canvas/Image objects serialise to `{}` and would silently break undo. The
`ensureImage()` cache rehydrates from the dataURL string on first render after restore.

**Offscreen compositing per draw:** `drawImageLayer` creates a small offscreen canvas
at `layer.w × layer.h` each time a mask is active. This is not cached separately —
the adjustment cache (Section 4) covers the adjusted+masked result when both are active.
A masked-only layer without adjustments does the offscreen blit on every render frame
at display resolution (cheap: screen-size canvas op, not a GL pass).

**Invert path:** A separate `inv` canvas filled white then `destination-out`'d with the
mask image, then used as the mask in `destination-in`. This avoids mutating the cached
mask image or needing a CPU pixel loop on render.

**`cutout/split.js` kept:** PLAN.md says keep it available. `runBgRemoval` now populates
`layer.mask.src` directly instead of calling `splitLayerByMask`. `split.js` is unchanged
and still importable for any callers that want the two-flat-layer path.

---

## Section 4 — Adjustment stack + WebGL pipeline

**Single-pass shader for Phase 0:** PLAN.md describes ping-pong framebuffers for
multi-type chaining ("add one more shader + one more slider type"). Phase 0 builds just
brightness/contrast/saturation — all three fit in one fragment shader with three uniforms,
so there is no ping-pong yet. The `applyAdjustments` API accepts an arbitrary
`adjustments` array and the function signature is designed for later expansion: add a
second compile+ping-pong path when a second shader type (curves, HSL) lands in Phase 1.
This is noted in glAdjust.js.

**Cache serial excludes `w`/`h`:** The adjusted canvas lives at cropped *natural*
resolution (`crop.w × naturalWidth`, `crop.h × naturalHeight`), not at `layer.w/h`.
Resizing the layer during a drag just changes how the cached canvas gets scaled in
`_drawImageContent`, not the cache key — slider drags and layer moves don't re-trigger
the GL pass against each other.

**`clearAdjustCache()` on every `input` event:** Each slider `input` fires
`clearAdjustCache()` before `scheduleRender()`. Because `getAdjustedCanvas` immediately
recomputes for the new serial, the new frame picks up the updated values. The alternative
(version-bumping the cache entry) would require passing a mutable version counter through
the layer object; clearing the whole Map is simpler and fine given only one layer's
adjustments change per interaction.

**`restoreSnapshot()` clears the cache:** After an undo/redo, the layer objects are
replaced wholesale via `JSON.parse(JSON.stringify(snap))`. An id-keyed cache would still
serve the old entry until the serial diverged — clearing on restore is the correct
approach and matches the "bump version on change" rule from PLAN.md.

**Pillow deprecation in tests:** `Image.getdata()` is deprecated in Pillow 14. The test
uses it only to compute average pixel brightness for the visual-diff assertion. Left
as-is for now; Phase 2 efficiency pass can update to `get_flattened_data` once Pillow 14
is the minimum required version.
