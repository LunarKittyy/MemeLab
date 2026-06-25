# MemeLab → General Photo Editor: Phase 0 (Foundation)

Goal: get MemeLab from "meme tool" to "competes with Snapseed / PS Mobile" territory.
This doc covers **Phase 0 only** — the foundation everything else depends on.
Build this sequentially, in one Claude Code session, in the order below. Do not
jump ahead to Phase 1 leaf features (curves UI, brush tool, AI upscale, etc.) —
those come after this lands and get scoped separately, several in parallel
worktrees.

## Why this phase exists

Four pieces of groundwork are touched by almost every feature on the full
roadmap: a non-destructive adjustment stack, layer masks, blend modes, and
canvas zoom/pan. If those get built piecemeal inside unrelated feature work,
every later feature ends up re-deciding the same schema and re-touching the
same core files (`state.js`, `renderer.js`, `history.js`). Decide it once,
here, then everything downstream just plugs in.

## Hard constraint: don't change call-site shapes

`renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer,
and `mergeLayerDown()` all currently assume "draw layer → get correct pixels
on whatever 2D ctx I handed you." Keep that contract. All new complexity
(WebGL adjustment pass, mask compositing, blend mode) must live **inside**
`drawLayer()` / a new internal module, not leak out to callers. If a caller
needs to change its signature to support this, stop and reconsider the
design — it almost always means the abstraction is leaking.

## Autonomy, testing, and migration — read before starting

**Don't pause between sections for approval.** Build section 1, get its
tests green, commit, move to section 2, and so on through section 4. Only
stop and flag a problem if a section's tests can't be made to pass after a
real debugging effort, or you hit a genuine blocking ambiguity not covered
anywhere in this doc — and even then, prefer making the most reasonable call
consistent with this codebase's existing conventions, noting what you decided
and why in `docs/build-notes/phase0.md`, over stopping. This doc is meant to
be sufficient on its own.

**Testing — use the existing harness, don't invent a new one.**
`tests/test_full.py` (Playwright) plus `tests/test-hooks.js` is the existing
regression suite; `tests/README.md` already says new features should extend
it, not get one-off scripts. For each of the 4 sections below: add or update
cases in `test_full.py` covering what you just built, add any new accessor
`test-hooks.js` needs to peek into new state (e.g. `viewport`, the
`glAdjust.js` cache), and confirm the full suite is green
(`python3 -m http.server 8731 &` then `python3 tests/test_full.py` from repo
root) before moving to the next section.

**Old saved projects must not break.** Every new field this phase adds
(`blendMode`, `mask`, `adjustments`) needs a default for layers saved before
this phase existed — they won't have the field at all, not just a falsy
value. Two layers of defense, do both: (1) in `persistence/autosave.js`
`applyLoadedSnapshot()`, give loaded layers missing these fields sane
defaults, the same way the existing `sizeScale` migration there already
works; (2) at every read site, access defensively (`layer.mask?.enabled`,
`layer.blendMode || 'normal'`) rather than assuming the field exists — don't
rely on migration alone in case a snapshot reaches a read site before
migration runs (e.g. inside `restoreSnapshot` during undo to a very old
history entry, if one survived).

**Commit after each section**, not one commit at the end — gives clean
rollback points if something in section 4 turns out to need section 2
reworked.

**Default to the cheap version when it looks the same.** Before adding new
per-frame or per-pixel work, ask whether it needs to run at full resolution
or every frame. The standard trick: apply expensive operations at display
resolution while the user is actively interacting (dragging a slider,
moving a layer), and only redo them at full resolution once they release,
settle, or export. This isn't something to fix later — build the cheap
version the first time wherever it's just as easy to write as the
expensive one.

## UI architecture: stay fast by default, pro features one tap away

Every section below, and every Phase 1 track after it, adds controls to a
UI currently built for one thing: quick meme edits in under a minute. That
has to stay true as real depth (adjustments, masks, blend modes, full
export settings, filter presets) piles on top of it — the basics shouldn't
get harder to find because something deeper now lives next to them. Decide
this now, the same reason sections 1-4 exist: a UI pattern improvised
independently by ten different tracks is much more expensive to reconcile
afterward than to standardize before any of them start.

Two existing patterns already disagree on how to do this: `rectProps.js`'s
mode toggle properly hides irrelevant rows (`display:none`) when switching
between color/blur/pixelate, while `textProps.js`'s stroke/box toggles leave
their controls visible-but-inert even when off. Pick one real pattern
instead of letting every future track invent its own: add a reusable
collapsible-section helper to `ui/props/shared.js`, alongside the existing
`field`/`rangeRow`/`actionsHtml` helpers — something like
`collapsibleHtml(title, innerHtml, { defaultOpen })` plus a matching wire-up
function — and require anything "advanced" to use it rather than a bespoke
show/hide block.

What goes where, by default:
- Content-specific basics for the selected layer (text/font/color, image
  crop/flip, shape fill) stay always visible, exactly as today.
- The generic `Adjustments` section from section 4 is naturally opt-in
  already — it starts empty, so it doesn't need its own collapse. What it
  does need: no future adjustment type (curves, HSL, vibrance, whatever
  Tracks A/B add) gets its own permanent slider area outside that one
  picker. One place pro tone/effect controls live, not one per type.
- Blend mode and mask are layer-level, not adjustment-level. Blend mode is
  universal (every layer type) — put it in a collapsible "Advanced"
  sub-section within the existing Transform block, not a permanent row next
  to opacity/rotation. Mask is image-layer-only for now (section 3) — give
  it its own collapsible "Advanced" sub-section within `imageProps.js`
  using the same helper, rather than forcing an image-only property into
  the universal Transform component.
- Filter presets (Track K) are the exception, not another "advanced"
  thing: they're meant to be fast, one-tap fun, which is exactly the
  quick-edit identity this is all trying to protect. Keep them in the
  always-visible fast path — burying them behind the same disclosure as
  curves/HSL/masks would undercut the reason they exist.
- Canvas size and export settings (Track H) split on two different axes,
  not one. Depth: basic controls stay visible, pro-only ones go behind the
  disclosure helper, same as everywhere else. Frequency is separate from
  depth and just as real: canvas size and project file export/import are
  set-once, maybe-touched-once-more actions, not things touched throughout
  a session — permanent toolbar space is the wrong tier regardless of how
  simple the control itself is. Track H folds those into one small
  "Document" entry point instead, the same split Procreate uses between
  its always-visible creative toolbar and its separate, occasional-use
  Actions menu for canvas and sharing work. Regular image export stays
  separate and prominent — it's the one project-level action that happens
  at the end of nearly every session, not a rare one.
- Order the fast path to match the actual editing workflow, not
  alphabetical or arbitrary grouping — basic/early-edit controls first,
  finishing-touch/advanced ones last, in both the toolbar's element-add
  buttons and the props panel's section order (content basics → adjustments
  → layer meta). Adobe's own Lightroom Mobile redesign cut visible options
  from 15 to 5 this way and explicitly ordered what remained to flow in
  edit-sequence order, not by frequency or alphabet.
- Never let new chrome (a tool menu, an expanding panel, a modal) cover the
  canvas right after an edit completes — that's the single most-criticized
  thing about Snapseed's most recent redesign, and it's an easy mistake to
  repeat by accident while adding panels.
- Icon-only controls (the layer row's vis/lock icons especially) need to be
  recognizable without memorization — not ambiguous twins distinguished
  only by position, which is a real, documented failure mode in other touch
  apps' brush-size/opacity sliders.
- As adjustment types accumulate across Tracks A/B/K, group the "Add
  adjustment" picker into a few labeled categories (tone, effects, looks)
  rather than one long flat list — a long list under one label creates more
  perceived overload than the same items split into well-labeled groups.

This section's own deliverable is just the shared helper and this
convention — it doesn't retrofit `textProps.js`'s existing inconsistent
toggles itself. That's exactly the kind of thing Phase 3's agent court
should check for explicitly once it runs.

---

## 1. Blend modes (do first — cheapest, validates the schema pattern)

Canvas2D's `ctx.globalCompositeOperation` natively supports the CSS
Compositing blend modes (`multiply`, `screen`, `overlay`, `darken`, `lighten`,
`color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`,
`exclusion`, `hue`, `saturation`, `color`, `luminosity`). No library needed.

- Add `layer.blendMode = 'normal'` to all three `default*Layer()` factories in
  `core/layers.js`.
- In `renderer.js`'s `drawLayer()`, set `ctx.globalCompositeOperation =
  layer.blendMode || 'normal'` right after `ctx.save()`, reset to `'source-over'`
  before `ctx.restore()`.
- UI: blend mode is layer-level, not a basic property like opacity — per
  the "UI architecture" note above, it goes in a collapsible "Advanced"
  sub-section within the existing Transform block (`transformHtml()` in
  `ui/props/shared.js`), not another permanent row next to opacity/rotation.
  This is the first thing in Phase 0 that needs the shared
  collapsible-section helper, so build that helper here — nothing earlier
  in the build order depends on it existing first.
- Watch out: blend mode interacts with the existing `mode === 'blur' |
  'pixelate'` backdrop trick in `boxEffects.js`. Those rect layers already
  skip the normal draw path during backdrop-build (`renderer.js`
  `buildBackdrop()` explicitly excludes them) — blend mode on a blur/pixelate
  layer should still apply when *compositing the result*, just confirm
  `applyBoxEffect` doesn't reset compositeOperation underneath you.

## 2. Canvas zoom & pan

Currently `resizeStageBuffer()` always fits the canvas exactly to its
container — there's no concept of zoom. Add a view-transform layer:

- New state (not in `state.layers` — this is viewport, not document):
  `viewport = { zoom: 1, panX: 0, panY: 0 }` in `core/state.js` or its own
  `core/viewport.js`.
- `dispScaleFactor()`, `projectCoords()` in `interactions/pointer.js` are the
  two functions every pointer interaction (move/resize/rotate, and every
  future tool — brush, lasso, healing) routes through. Update both to factor
  in `viewport.zoom`/`pan` so hit-testing and drag math stay correct at any
  zoom level. Get this right now — it's load-bearing for every future tool.
- UI: pinch-to-zoom (touch, you already have 2-touch pinch logic for layer
  resize in `pointer.js` — don't confuse the two; zoom pinch should only
  trigger when no layer is selected/being resized) + scroll-wheel zoom +
  a zoom-% indicator with reset-to-fit button.
- Viewport state should NOT go into history snapshots (`core/history.js`
  `snapshot()`) — zoom/pan isn't part of the document, undo shouldn't touch it.

## 3. Layer masks

Replace the current "AI bg removal splits into two flat PNG layers" hack
(`cutout/split.js`) with a real non-destructive mask, while keeping the
existing AI segmentation pipeline (`cutout/aiSegmentation.js`) as the mask
*source* rather than the layer *splitter*.

- Schema: `layer.mask = { enabled: false, src: null, invert: false, feather: 0 }`.
  `src` is a dataURL string (greyscale PNG), same pattern as image `src` —
  **critical**: `history.js` `snapshot()`/`restoreSnapshot()` use
  `JSON.parse(JSON.stringify(state))`. A live `Canvas`/`Image` object would
  break this silently (serializes to `{}`). Masks must always be stored as
  dataURL strings and rehydrated through `ensureImage()`'s cache, exactly
  like every other image reference in this codebase already does.
- Compositing: in `drawLayer()`, after drawing layer content to its local
  space but before the rotate/translate `ctx.restore()`, if `layer.mask.enabled`,
  composite the mask as alpha (`destination-in` on an offscreen buffer, or
  multiply into alpha channel manually) before drawing the result to the
  real ctx. This needs an offscreen per-layer canvas — see the caching note
  in section 4, the same cache should hold masked+adjusted layer bitmaps
  together, not two separate caches.
- UI: mask toggle + invert + feather slider in `imageProps.js`, in their
  own collapsible "Advanced" sub-section using the shared helper section 1
  already built (and generalize to text/rect layers later if it's cheap —
  not required now). A basic brush-paint-the-mask UI can be a Phase 1 leaf
  feature; Phase 0 just needs the data model and compositing to work with
  mask sources however they're produced (manually via a brush later, or via
  "Remove background" immediately).
- Once this exists, `iBgRemove`'s flow in `imageProps.js` should be migrated to
  populate `layer.mask.src` directly instead of calling `splitLayerByMask` to
  create two new layers. Keep `cutout/split.js` available but make the mask
  path the default — it's strictly more useful (re-toggle/feather/invert
  later) and is the same AI pipeline either way.

## 4. Non-destructive adjustment stack + WebGL pipeline

This is the biggest piece and unblocks the most Phase 1 work (curves, HSL,
vibrance, clarity, vignette, sharpen, split-tone, auto-enhance all ride this),
so don't leave it for last despite the size.

**Engine choice:** WebGL1 (not WebGPU) for this layer. Per-pixel adjustment
math (curves, HSL remap, vignette falloff) is well within a WebGL1 fragment
shader's job and WebGL1 has near-universal support — far broader than
WebGPU's still-patchy Android/older-Safari coverage. Reserve WebGPU
specifically for the heavy AI model inference work in Phase 1
(transformers.js / onnxruntime-web already handle the WebGPU↔WASM fallback
internally) — don't conflate the two engines. Existing `ctx.filter` CSS-filter
support (brightness/contrast/saturate/blur/hue-rotate) already covers basic
cases for free; the shader pipeline is for the things `ctx.filter` can't do
(curves, selective HSL, vibrance, vignette, clarity).

- Schema: `layer.adjustments = []`, an ordered array of
  `{ type: 'brightness'|'contrast'|'saturation'|'vibrance'|'temperature'|'curves'|'hsl'|'vignette'|...,  ...params }`.
  Migrate the existing `image.exposure` field into this array on load
  (one-time migration in `persistence/autosave.js` `applyLoadedSnapshot()`,
  same pattern already used there for the old `size`→`sizeScale` migration).
- New module `render/glAdjust.js`: owns a single shared offscreen WebGL
  context, compiles/caches one shader program per adjustment *type* (not per
  layer), and exposes something like
  `applyAdjustments(sourceCanvas, adjustments) → resultCanvas`. Chain multiple
  adjustment types as sequential passes into a small pair of ping-pong
  framebuffers rather than one mega-shader — much easier to add new
  adjustment types later without rewriting a giant shader.
- **Caching is mandatory, not optional.** `scheduleRender()` runs on every
  rAF tick during drag/resize. Do not re-run the shader pass for a layer
  whose adjustments and source content haven't changed since the last frame.
  Keep a per-layer cache: `{ version, bitmap }`, bump `version` only when
  `layer.adjustments`, `layer.mask`, or the layer's source pixels actually
  change, and reuse `bitmap` otherwise. Key the cache by `layer.id`, not
  object reference — `restoreSnapshot()` during undo/redo replaces layer
  objects wholesale via `JSON.parse(JSON.stringify(...))`, so an
  identity-keyed cache (a `WeakMap` on the object, for instance) would
  silently invalidate on every undo even when nothing relevant changed; an
  id-keyed cache survives that and still gets correctly invalidated by the
  version-bump rule above. This is the difference between smooth slider
  dragging and a janky mess on phone hardware.
- Wire into `drawLayer()`: content draw → mask composite → adjustment pass →
  draw final bitmap to the real ctx. Same caching layer serves both mask
  compositing and adjustments since they're both "produce this layer's final
  pixels" work. This doesn't conflict with section 1's
  `globalCompositeOperation` — that's set on the real ctx before any of this
  offscreen work runs, and only takes effect on the final `drawImage` of the
  processed bitmap onto that same real ctx, since the offscreen mask/adjust
  work happens on separate canvas/context objects that don't touch the real
  ctx's state at all.
- UI: a generic `Adjustments` section in the props panel that renders one
  slider per entry in `layer.adjustments`, with an "Add adjustment" picker.
  Build the picker with just `brightness`/`contrast`/`saturation` wired in
  for Phase 0 — that's enough to prove the pipeline end to end. Curves, HSL,
  vibrance, vignette, etc. get added as Phase 1 leaf features once this
  scaffold exists; they're each "add one more shader + one more slider type,"
  not foundation work. This section is always visible but starts empty —
  see the "UI architecture" note above for why nothing should ever add a
  second, separate slider area outside this one picker.

---

## Build order summary

1. Blend modes (also where the shared collapsible-section UI helper from
   "UI architecture" gets built — nothing earlier needs it to exist first)
2. Zoom & pan
3. Layer masks
4. Adjustment stack + WebGL pipeline (biggest, but unblocks the most downstream work — don't defer it)

## Explicit non-goals for Phase 0

Do not build: curves UI, HSL UI, brush tool, selection tools, AI
upscale/inpainting, format export changes, text extras, filter preset
application, layer panel button reorganization. All of that is Phase 1,
scoped per-track below, after this lands.

---

# Phase 1 — track map

Once Phase 0 is merged to `main`, these tracks are independent enough to
build in parallel. This table is the scope map, not the build prompts
themselves — see "Generating and running Phase 1" below for where the actual
per-track prompts come from.

| Track | Scope | Touches | Depends on |
|---|---|---|---|
| A — Tone adjustments | brightness/contrast/saturation (wire real UI)/vibrance/temperature/tint/highlights-shadows/curves/HSL/auto-enhance. Curves specifically needs real thought for touch, not an assumed drag-the-graph editor — Snapseed's own most recent redesign moved away from classic curve graphs to arc-based sliders for exactly this reason; decide the actual interaction before building it, don't default to the desktop-mouse pattern. | `glAdjust.js`, props panel | Phase 0 §4 |
| B — Local effects | clarity/dehaze/sharpen/noise reduction/vignette/split-tone/grain. Not all of these are uniform "one more shader" work the way section 4 assumed for the simplest cases — noise reduction and dehaze both need neighborhood/spatial sampling (multiple texture reads per output pixel, not a 1:1 color remap), a meaningfully different shader shape than brightness/curves/HSL. Budget them as their own design pass within this track, not drop-in slots in the same picker. | `glAdjust.js`, props panel | Phase 0 §4 |
| C — Selection & masking UI | lasso/polygon, magic wand, brush-paint mask, gradient mask, invert | `interactions/`, new selection module, mask schema | Phase 0 §3 |
| D — Brush & paint engine | freehand brush, eraser, ellipse/polygon/line shapes, gradient fill, bucket fill, eyedropper. Store strokes as vector data (ordered points + width/opacity/color per stroke), not raster dabs stamped onto a bitmap — same reasoning as the cheap-trick mandate in Phase 0: vector strokes stay cheap to edit, resize, and undo, while raster-only strokes lock in their resolution and bloat snapshot/undo storage the moment they're drawn. Rasterize to the layer's bitmap only at merge/export time, not as the live editing representation. | new layer/tool types, `renderer.js` | Phase 0 §1 (blend) helps but not blocking |
| E — Retouch tools | healing brush, clone stamp, dodge/burn, red-eye, liquify. Healing brush specifically is ambiguous between full AI inpainting (reusing Track G's model) and a simpler patch-based clone-from-nearby approach — the simpler approach covers the actual common case (small blemishes) without needing G's heavier model; don't reach for inpainting here unless testing shows the simple version genuinely isn't good enough. | brush engine | Track D (sequence after, or fold into D) |
| F — Geometry | canvas-wide crop (vs current per-layer crop), straighten/horizon grid, perspective warp, aspect presets. Perspective warp doesn't need Track G — crop-after-warp is a fine fallback, the same workaround Snapseed itself advises. If it should match Snapseed's smarter behavior (auto-filling the gaps a warp exposes at the edges) later, that rides on Track G's inpainting, not required now. | new crop-modal variant, `renderer.js` | Phase 0 §2 (zoom math) |
| G — AI tools | generative fill/object removal (ONNX Runtime Web + WebGPU, Moebius-style), AI upscale (Real-ESRGAN/Real-CUGAN), canvas expand/outpaint (same inpainting model, run outward instead of over a selection) | new `cutout/` modules, mirrors existing `aiSegmentation.js` pattern | Phase 0 §3 (mask) for inpaint-selection UX |
| H — File I/O, canvas & export settings | JPEG/WEBP export w/ quality, HEIC import (`heic2any`), GIF import/export w/ frames, social export presets, batch edit, a `.meme` project format. The current export UI — one scale-multiplier dropdown tied to canvas size — doesn't hold up once format, quality, and presets all need somewhere to live; don't bolt those onto it, replace it. Make size a genuine choice independent of canvas size: canvas size / scale multiplier / custom pixel dimensions / a social preset, mutually exclusive, same show/hide-by-mode pattern `rectProps.js` already uses for its color/blur/pixelate toggle (or the new shared collapsible helper from the UI architecture note, whichever fits the layout better). Quality slider only appears for lossy formats. Keep a one-click fast path for the common case (last-used or default settings) — the full settings existing shouldn't make the simple case slower. While in there: the exported filename is currently hardcoded to `meme.png` regardless of format — fix that too. `.meme` format: a zip archive (JSZip) — a `manifest.json` holding everything the autosave snapshot already holds (layers, width/height, etc.), plus the binary assets as actual files (`assets/img-<id>.png`, decoded from base64 back to raw bytes, not left as inline base64 text — base64 compresses far worse inside a zip than raw bytes do), referenced by path from the manifest. Route `.meme` import through the exact same `applyLoadedSnapshot()` migration path autosave already uses, not a second loader — an older `.meme` file needs the same field-migration safety net as an old IndexedDB autosave. Canvas size doesn't deserve its current permanent toolbar space either way: it's a set-once, maybe-touched-once-more action, not something used throughout a session. Pull canvas size out of the always-visible toolbar entirely, and fold the existing reset-canvas button and `.meme` export/import into that same single "Document" entry point — one icon, opens a small panel, not three scattered always-visible controls for things nobody touches mid-session. Inside that panel: preset + custom W/H as before, plus the resize-vs-scale choice this was already missing — changing width/height currently always keeps existing layers at their absolute position (Photoshop's "Canvas Size" behavior) with no option for the alternative, proportionally scaling the whole composition to fit (Photoshop's "Image Size" behavior); make that an explicit choice, not a silent default. Keep regular image export separate and prominent, not folded into Document — it's the one project-level action that happens at the end of nearly every session. | `ui/toolbar.js`, `render/renderer.js`, `persistence/` | none — safest first track |
| I — Text & creative extras | curved/arc text path, speech bubbles, sticker/emoji picker, saved text style presets | `render/text.js`, `ui/props/textProps.js` | none — safest first track |
| J — Mobile UX polish | gesture swipe-adjust, before/after compare, alignment/smart guides, grid/rulers | `pointer.js`, render overlay | Phase 0 §2 (zoom math) |
| K — Filter presets | one-tap named looks (vintage, noir, drama, grunge, retrolux, HDR-scape, bloom, halation, glamour glow) — each is a saved, fixed array of `layer.adjustments` entries plus an optional texture overlay asset, applied in one tap | new `presets/` module, `glAdjust.js` | Phase 0 §4 (needs the adjustment stack to exist) |
| L — Layer panel coherence | multi-select + group transform (data model + desktop interaction: shift/ctrl-click in the layer list, drag-select on canvas — lives here, not in J, since it's not actually touch-specific); the per-row icons (vis/lock/dup/merge/del) are largely redundant with the context menu (already comprehensive) and, for dup/del, with the props panel's existing Duplicate/Delete buttons (`actionsHtml()`/`wireActions()` in `ui/props/shared.js`, already act on the current selection — no new toolbar needs building). Trim the row to just visibility + lock — the only two not already covered elsewhere, and the only two with a real reason to act without disturbing the current selection. Drop the row icons for duplicate, merge-down, and delete entirely; all three are low-enough-frequency to live in the context menu only (delete also stays reachable via the props panel for free). Add a "Rename" entry to the context menu as a fallback once the always-editable inline input is replaced with click-to-select / double-click-to-rename. | `ui/layerList.js`, `ui/toolbar.js`, `ui/props/shared.js` | none — existing code, can run anytime, including parallel with Phase 0 |

## Explicit non-goals for Phase 1

AI-driven face tools (Portrait-style auto-enhancement, head pose editing) are
explicitly out of scope, not deferred — they're a different product than a
meme editor, and a different scale of effort (dedicated face-landmark/pose
models) than anything else in Track G. Don't reintroduce them in a future
Phase 1 generation pass without this being revisited on purpose.

`.meme` import/export (Track H) is a file-based save/load mechanism for the
single project currently open, not a saved-projects library or gallery
inside the app. Don't let it grow into one — that's the exact mistake
Snapseed's own 2026 redesign made, forcing a persistent library screen onto
what used to be a quick open-edit-done workflow (see the UI architecture
note above). Multi-project browsing, if it's ever wanted, is a deliberate
future decision, not something `.meme` support implies on its own.

Sky replacement is also explicitly cut, not deferred. Selecting the sky
(Track C) and grading it (Track A/B's masked adjustments) already covers
the realistic want — recoloring or mood-shifting an existing sky. The one
thing that combination can't do, swapping in different sky content
entirely, needs its own asset library and relighting logic that doesn't
reuse anything else in Track G the way outpaint and upscale do, for a need
that's narrow outside landscape/travel photography. Don't reintroduce it in
a future generation pass without this tradeoff being revisited on purpose.

Magnetic lasso and refine edge (Track C) are cut for the same kind of
reason: plain lasso + magic wand + the brush/gradient mask tools already
cover what they'd add, for less implementation cost. If hair/fur edge
quality ever genuinely needs work, that's better aimed at improving the
alpha matting the AI background-removal model already produces (Track G /
`aiSegmentation.js`) than at a separate manual edge-refinement tool.

Tracks are ordered below by merge-conflict risk, not importance: H, I, and L
touch almost nothing else touches, land those first; then K (also low
conflict — a new module plus `glAdjust.js`, same as A/B); then A/B; then
C/D; then F/J last since both touch `pointer.js`.

## Generating and running Phase 1

Before any of this: make sure PLAN.md and everything Phase 0 produced is
actually committed to the default branch. A subagent with `isolation:
worktree` gets a fresh checkout branched from the default branch's current
*committed* state — it won't see anything that's only sitting uncommitted in
the main working directory.

Once all 4 Phase 0 sections are built, tested green, and committed, spawn one
subagent to review Phase 0 cold and generate Phase 1's prompts. Run this one
directly in the main checkout — no `isolation: worktree` — since it needs to
commit its output straight to the default branch so the Round 1 subagents,
which branch from there, can actually see it. Its task prompt:

```text
First, read PLAN.md in full (repo root). It defines Phase 0's scope, the
constraints to check against, and the Phase 1 track table — you have no
other context, so this is where all of that comes from.

Then read the actual Phase 0 code that just landed: the real
layer.adjustments entry shape, the real mask schema, glAdjust.js's real
API (not PLAN.md's predictions of them). Sanity-check it against PLAN.md's
constraints: call-site shapes unchanged, old saved projects still load
without errors, the test suite is actually green, caching actually avoids
re-running shaders on unchanged layers. If something looks like a real
problem rather than a reasonable judgment call, write it to
docs/build-notes/phase0-review.md, flag status: blocked, and stop.

Otherwise, write one prompt per track into
docs/phase1-prompts/track-<letter>.md. Each file must be fully
self-contained: whoever builds a track will have read nothing but that one
file, not PLAN.md. Use the real API names, not PLAN.md's predictions of
them, and append the report-back convention below to the end of every
generated file. Commit all the generated files directly to the default
branch — they need to exist there before any track's worktree is created.

Report back to me with just: status (clean/blocked) and the list of files
you generated. Nothing else.
```

Build each track as its own subagent with `isolation: worktree`. Give it
exactly this as its task prompt, nothing more:

```text
Read docs/phase1-prompts/track-<letter>.md in full — that is your complete
task specification, with everything you need. Build it.
```

Don't use fork agents for track work — forks inherit the entire session
history, which is unnecessary cost for a task that's fully specified in one
file anyway.

Round 1:
```text
Spawn three subagents in parallel, each with isolation: worktree:
- one with the prompt "Read docs/phase1-prompts/track-h.md in full — that
  is your complete task specification, with everything you need. Build it."
- the same pattern for track-i.md
- the same pattern for track-l.md
```
Subsequent rounds follow the same pattern: K → A/B → C/D → F/J.

### Report-back convention

A subagent's tool calls and intermediate work already stay out of the
orchestrator's context — only its final report lands there. Include this in
every track's prompt so that report stays small too:

```text
When you're done, do not return the full diff or a detailed walkthrough.
Instead:
1. Write a complete write-up to docs/build-notes/track-<letter>.md in your
   worktree: what you built, key design decisions, any deviations from
   the prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of
   `git diff --stat` (not the full diff body), and a one-line pointer to
   the notes file. Nothing else.
```

The notes files land in the repo with the merged code, so they exist as
documentation without sitting in any session's context until actually needed.

---

# Phase 2 — efficiency pass

Per-track efficiency (the cheap-trick mandate above) catches a lot, but not
everything — some waste only shows up once enough of the real system exists
to profile as a whole, not track by track. Once Round 1 (H, I, L), Round 2
(K), and Round 3 (A, B) have landed, spawn one fresh subagent (not a fork,
no `isolation: worktree` — this runs once against the whole repo, not in
parallel, so it should commit straight to the default branch like the
Phase 0→1 generator does) to audit the actual running app for unnecessary
cost, not just correctness:

```text
Read PLAN.md in full first (repo root) for context on what exists and why.

Then profile the actual running app — use the existing
tests/test_full.py Playwright setup to drive it, or simple console.time
instrumentation — looking for work being done more expensively than it
needs to be. One concrete starting point, already present: renderer.js's
updateThumbnails() currently re-renders every layer's 60x60 thumbnail on
every scheduleRender() tick, including layers that didn't change. Look for
more like it: anything per-pixel or per-frame that could run at lower
resolution while the user is actively interacting and full resolution only
once they settle; anything recomputed that could be cached and isn't; any
resource (AI model, WebGL context, framebuffer) reloaded or recreated when
it could be reused.

For each finding: if the fix is small and self-contained, make it, test
it, and commit. If it's substantial enough to need its own focused build,
write it to docs/build-notes/phase2-findings.md as a track-shaped item
instead of trying to do it inline.

Report back to me with just: status (done/blocked), the list of fixes
made, and the list of findings deferred to
docs/build-notes/phase2-findings.md.
```

# Phase 3 — coherence pass ("agent court")

UI and interaction patterns accumulate across tracks built by different
subagents with no memory of each other's choices — worth a deliberate check
once the interaction-heaviest tracks exist, not just the new code but the
old code too. Once Tracks C and D (selection tools, brush engine) have
landed — the biggest remaining addition to interaction surface, on top of
whatever Track L already cleaned up — run a two-subagent adversarial review.
Neither is a fork, and neither uses `isolation: worktree` — both operate
sequentially against the whole repo rather than in parallel against a
scoped piece of it, so both run in the main checkout, same reasoning as the
Phase 0→1 generator. In this order:

**Prosecutor** — read-only, no Write/Edit (`tools: Read, Grep, Glob, Bash`):
```text
Read PLAN.md in full first for context, then read the actual UI and
interaction code: ui/toolbar.js, ui/layerList.js, ui/props/, and whatever
Tracks C and D added for selection and brushwork — not just the new code,
all of it. For every design decision you can identify, write a specific,
falsifiable challenge to docs/build-notes/agent-court-round1.md: not a
vague complaint, a concrete "here's why X seems off, here's the actual
code/UI element." Do not propose fixes — that's not your job here.
```

**Defender** — full tool access (it implements anything it concedes):
```text
Read PLAN.md in full first for context, then read
docs/build-notes/agent-court-round1.md. For every challenge in it, do
exactly one of:
1. Write a genuine defense grounded in a real, specific user-facing or
   technical tradeoff. "It already works," "no one's complained," and
   "that's just where it ended up" are not defenses — if you can't give a
   reason specific enough that it wouldn't also excuse an obviously bad
   design, you don't have one.
2. Concede, and implement the fix.

Append your verdict and reasoning for each challenge to the same file,
then commit. Report back to me with just: how many challenges were
defended vs conceded, and a one-line pointer to the file.
```

This forces every existing decision — including ones nobody thought to
question — to either earn a real reason or change.
