# Meme Lab — remaining work plan

This is the brief for everything past the stage-1 migration. Stage 1 (this
repo as it stands) is a modular, static, client-side-only meme/image editor.
No backend, no analytics, nothing leaves the browser, ever. That constraint
applies to every feature below too: no calls to any server, no telemetry.

Read `README.md` first for the module map. The short version: `core/` is
state+history+layer data, `render/` draws to canvas, `interactions/` handles
pointer/touch, `ui/` is panels and toolbar, `persistence/` is the IndexedDB
autosave. Each props panel is split by layer type specifically so you can
touch one layer type's controls without risking the others.

There's a Playwright test suite in `tests/`. Run it before and after each
feature. It's the regression gate, not a checklist to satisfy once, every
feature below should add its own cases to it and leave all prior cases
green.

Build order, because the later features depend on infrastructure the
earlier ones don't need:

1. Exposure slider (image layers)
2. Blur/pixelate background box (text layers)
3. Lossless split infrastructure + wand tool
4. Lasso tool (reuses #3's split infrastructure)
5. AI background removal (also reuses #3)

---

## 1. Exposure slider

**Goal:** a slider on image layers that brightens/darkens the image.

**Design:** use the canvas 2D `ctx.filter` API, not manual pixel math.
`ctx.filter = 'brightness(P%)'` before the `drawImage` call in
`render/shapes.js`'s `drawImageLayer`, reset `ctx.filter = 'none'` after.

Map a `-100..100` slider to `0%..200%` brightness: `P = 100 + exposure`.
`exposure: 0` (already reserved in `core/layers.js`'s `defaultImageLayer`)
must mean "untouched," so don't apply the filter at all when
`exposure === 0` (cheap and avoids any filter-related perf cost on the
common case).

**Touch points:**
- `core/layers.js` — field already exists (`exposure: 0`), nothing to add.
- `render/shapes.js` — `drawImageLayer`, apply the filter.
- `ui/props/imageProps.js` — add a slider (copy the `rangeRow` pattern
  already used everywhere else, e.g. opacity).

**Acceptance:**
- Slider at 0 renders identically to before this feature existed.
- Live preview and exported PNG match (they already share the same
  `renderScene` call path, so this should be automatic, but verify, this
  is the easiest place for a silent forEach mismatch to creep in).
- Works with flipX/flipY and rotation simultaneously.

---

## 2. Blur / pixelate background box

**Goal:** the text layer's background box (currently solid-color only) gets
two more fill modes: blur and pixelate the pixels already drawn underneath
it, like a censor bar.

**Design:** the schema is already reserved in `core/layers.js`:
`box: { enabled, mode: 'color' | 'blur' | 'pixelate', color, amount }`.
`amount` is blur radius in px for `'blur'`, block size in px for
`'pixelate'`.

The hard part: by the time a text layer draws, the canvas already has
everything below it composited (layers draw bottom-to-top onto the same
ctx). That means you genuinely can read back "what's there" via
`getImageData` on the *main* canvas, no separate compositing step needed.
There is no cross-origin taint risk anywhere in this app (every image
source is a `FileReader` data URL, never a fetched/cross-origin image), so
`getImageData`/`toDataURL` will never throw for that reason.

Suggested flow, probably as a new `render/boxEffects.js`:
1. Compute the box's rect in **device pixel** coordinates (the ctx is
   already translated/rotated into layer-local space when `drawTextLayer`
   runs — you need the inverse of that to know what to read back in device
   space, or restructure so this read happens before the per-layer
   transform is applied).
2. `getImageData` that rect from the main canvas (or read from an explicit
   axis-aligned bounding box if the layer is rotated, see scope note below).
3. Blur: draw the captured pixels onto a small offscreen canvas, then draw
   *that* canvas back with `ctx.filter = 'blur(Npx)'` on the draw call,
   rather than hand-rolling a box blur.
4. Pixelate: draw the captured region onto a tiny canvas scaled down by
   roughly `amount`, then draw that tiny canvas back up to full size with
   `ctx.imageSmoothingEnabled = false` so it stays blocky.
5. Draw the result into the box's rect, then proceed with the text draw as
   today.

**Scope note:** handling this correctly when the text layer is *rotated* is
real extra work (the sampled region needs to be un-rotated before
processing and re-rotated on the way back). Recommend shipping the
unrotated case first since rotated censor boxes are a rare case for a meme
tool, and treating rotation support as a clearly separate follow-up rather
than blocking the feature on it.

**Touch points:**
- `render/boxEffects.js` (new) — the blur/pixelate sampling+redraw logic.
- `render/text.js` — `drawTextLayer`, branch on `box.mode`.
- `ui/props/textProps.js` — mode selector (reuse the `seg` segmented-button
  pattern already used for align/vAlign) + an amount slider shown only when
  mode isn't `'color'`.

**Acceptance:**
- `mode: 'color'` renders pixel-identical to before this feature.
- Blur/pixelate visibly affects whatever layers are *underneath* the box,
  not the box's own fill color (there's nothing to blur if box.enabled was
  just toggled on with nothing behind it but the canvas background, that's
  expected, not a bug).
- Export matches live preview.

---

## 3. Lossless split infrastructure + wand tool

This is the foundation the rest of cutout work sits on, get this right
once and wand/lasso/AI-cutout all become "produce a mask, hand it to this
function."

### 3a. Split infrastructure

**Design, decided already, don't relitigate:** cutting out part of an image
layer never deletes anything. It always produces **two** ordinary image
layers in place of the one that existed:
- a "kept" layer: the original layer's full-resolution pixels, with alpha
  multiplied by the mask
- a "rest" layer: the same full-resolution pixels, with alpha multiplied by
  the *inverted* mask

Both layers keep the original layer's `x/y/w/h/rotation/opacity` etc. The
visual result immediately after a split must look identical to before the
split, since the two halves are complementary and stacked. Nothing is
deleted; the user decides afterward whether to hide/delete/move either
half. This also means wand and lasso don't need to share one "live mask
editing" session: if wand misses a chunk, the user just selects whichever
resulting layer is wrong and runs lasso (or wand again) on *that* layer to
carve it further. Each tool stays a simple, independent, one-shot
operation.

**Suggested module:** `cutout/split.js`
```
splitLayerByMask(layer, maskCanvas) -> { keptLayer, restLayer }
```
where `maskCanvas` is a same-pixel-resolution canvas (or ImageData) whose
alpha/luminance represents "how much to keep" (0..255, can be anti-aliased
at edges, doesn't need to be strictly binary).

Steps:
1. Render `layer.src` at its **natural resolution** (not the on-canvas
   display size) onto an offscreen canvas, this is the pixel data both
   output layers are built from.
2. Multiply alpha by the mask for the kept copy, by the inverted mask for
   the rest copy. `toDataURL('image/png')` each (PNG to preserve alpha,
   don't use JPEG here).
3. Build two layer objects that copy every transform field from the
   original layer, just swapping `src`/`naturalW`/`naturalH` and assigning
   fresh ids/names. This needs a constructor distinct from
   `defaultImageLayer` in `core/layers.js` (that one always centers a new
   layer on the canvas; this needs to preserve the *existing* layer's
   position exactly). Add something like
   `layerFromSplit(originalLayer, src, naturalW, naturalH, nameSuffix)`.
4. Replace the original layer in `state.layers` with the two new ones at
   the same index (kept layer where the original was, rest layer adjacent,
   order doesn't matter much since they're visually identical to the
   original when freshly split).
5. Select the kept layer, `pushHistory()` once for the whole operation.

**Acceptance:**
- Immediately after any split, the rendered canvas is pixel-identical to
  immediately before the split.
- Both resulting layers, summed, contain 100% of the original pixel data
  (nothing clipped/lost), check this isn't just "looks right" but actually
  true at the pixel level in a test.
- A single undo reverts the entire split back to the original one layer.
- Works regardless of the original layer's rotation/flip state.

### 3b. Wand tool

**Design:** click a pixel on the selected image layer, flood-fill outward
by color similarity with a tolerance slider, producing a mask that feeds
`splitLayerByMask`.

- Must be an **iterative** flood fill (explicit queue/stack), not
  recursive, a 12MP+ image will blow the call stack otherwise.
- Run on the image's full natural-resolution pixel data, not the
  display-scaled preview, for mask quality. Map the click point from
  layer-local/display coordinates back to natural-image pixel coordinates
  (account for `w/h` vs `naturalW/naturalH` scale and `flipX/flipY`).
- For consistency with the AI cutout's size cap (see #5), downscale the
  source to the same shared cap before running the flood fill if it's
  larger, both for performance and so the two tools behave predictably
  relative to each other. Put the cap constant somewhere shared, e.g.
  `cutout/config.js`, both wand and AI-cutout import it from there.
- Color distance: plain Euclidean RGB distance is fine, no need for
  anything fancier.

**UI:** a "Magic wand" button in `ui/props/imageProps.js`'s panel, plus a
tolerance slider. Clicking the button arms the tool; the next click on the
canvas (on that layer) runs it. You'll need a small "what interaction mode
is currently active" concept so the normal pointer.js drag/select handling
gets out of the way while wand (and later lasso) mode is armed, see the
note in section 4 below, since lasso needs the same coordination and it's
worth building once.

**Touch points:**
- `cutout/split.js`, `cutout/config.js` (new)
- `cutout/wand.js` (new)
- `ui/props/imageProps.js` — button + tolerance slider
- `interactions/` — whatever mode-switch mechanism you land on (see #4)

---

## 4. Lasso tool

**Goal:** manual cutout by drawing a path: click to place a straight-line
node, drag to draw a freehand segment, drag an *existing* node to move it,
close the path to commit.

**Interaction spec (decided already):**
- Click on empty space while armed → place a new node, straight line from
  the previous node.
- Press-and-drag starting on empty space → freehand-draw a dense polyline
  segment for as long as the pointer is down, appended to the path.
- Press-and-drag starting *on* an existing node → move that node.
- Closing the path (clicking back near the first node within a small snap
  radius, or a dedicated "Done" button/Enter key, your call on which is
  more discoverable) rasterizes the path into a mask and calls
  `splitLayerByMask`, same as wand.

**Mode coordination:** this needs the same "is a cutout tool currently
armed" concept the wand tool needs. Suggest introducing it now if you
didn't already for wand:
```
interactions/mode.js
  getMode() -> 'transform' | 'wand' | 'lasso'
  setMode(mode)
```
`interactions/pointer.js`'s existing handlers should bail out early (do
nothing) when mode isn't `'transform'`, and lasso/wand own their own
pointer handling while armed. Also needs a render hook: `renderScene` in
`render/renderer.js` should draw the in-progress path (nodes, lines,
current freehand segment) as an overlay when lasso mode is active, similar
to how it already conditionally draws `drawSelectionOverlay`.

**Touch points:**
- `interactions/mode.js` (new, shared with wand)
- `cutout/lasso.js` (new)
- `render/renderer.js` — overlay hook for the in-progress path
- `ui/props/imageProps.js` — "Lasso cutout" button

**Acceptance:**
- Can produce a closed path mixing both clicked nodes and freehand
  segments in the same path.
- Dragging an existing node updates the path live.
- Closing produces a split identical in spirit to wand's (same
  `splitLayerByMask` call, same lossless guarantee).
- Pressing Escape (or your chosen cancel action) exits lasso mode without
  modifying any layer.

---

## 5. AI background removal

**Goal:** one click, no manual masking, automatic subject/background
separation, still 100% client-side.

**Library decision (already made, don't re-litigate without reason):**
use `transformers.js` (`@huggingface/transformers`) with a permissively
licensed segmentation model, **not** `@imgly/background-removal` (that
one's AGPL-licensed, unnecessary friction for something meant to be hosted
publicly with no strings attached). MODNet was a reasonable candidate as of
this writing, but verify current model availability/licensing/quality
before committing, this space moves fast and whatever's current by the
time you implement this may have moved on.

**No-bundler constraint:** this repo deliberately has no build step.
`transformers.js` ships browser-ready ESM builds that can be `import()`ed
directly from a CDN (jsdelivr/unpkg) without a bundler. Load it that way to
keep the project buildless. If you decide a bundler is actually warranted
once you're in this, that's a legitimate call to make, but flag it
explicitly as a deliberate architecture change, don't let it happen as a
silent side effect of one feature.

**Size cap (decided already):** downscale to 2048px on the long edge
before running inference, **at the moment the user clicks "process,"**
not when the image is uploaded. Share the cap constant with the wand tool
(`cutout/config.js`). Full-res phone photos (48MP+) will OOM a naive
pipeline before the model even runs if you skip this.

**Flow:**
1. Lazy-load the model (dynamic `import()`), only on first use of this
   feature, don't bloat initial page load with a 40-90MB download nobody
   asked for yet.
2. Show real download/init progress, the library supports progress
   callbacks, use them, "frozen for 10 seconds" is a bad first impression
   for something this size.
3. Downscale per the cap, run inference, get a mask back.
4. Feed the mask to the exact same `splitLayerByMask` wand/lasso use. This
   is the payoff for building #3 properly, this whole feature should be
   "get a mask, call one existing function."

**Touch points:**
- `cutout/aiSegmentation.js` (new)
- `ui/props/imageProps.js` — "Auto background removal" button, progress UI
- reuses `cutout/split.js`, `cutout/config.js`

**Acceptance:**
- Works without WebGPU (falls back to WASM, slower is fine, broken is not).
- A 48MP test image doesn't hang or crash the tab.
- Quality caveat is expected and fine: hair/motion-blur/busy-background
  edge cases are allowed to look rough, that's exactly why wand and lasso
  exist as cleanup tools on the *same* resulting layers afterward.
- Model download happens once per browser profile then is cached (standard
  HTTP cache behavior from the CDN, nothing custom needed); confirm it
  isn't re-downloading every page load.

---

## General notes for all five

- Extend `tests/test_full.py` per feature rather than writing throwaway
  one-off test scripts, keep it as one growing regression suite.
- Every new layer field needs a sane default that doesn't change rendering
  for layers created before that field existed (already the pattern used
  for `exposure` and `box.mode`/`box.amount`, both default to "do nothing
  different").
- Nothing in this app ever calls a server. If a feature seems to want one
  (it shouldn't, given the plan above), that's a sign to stop and rethink,
  not a sign to add a backend.
