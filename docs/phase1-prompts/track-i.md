# Track I — Text & Creative Extras

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed blend modes, zoom/pan, layer masks, and a WebGL adjustment stack. This track is independent of all other Phase 1 tracks and touches almost no code that other tracks touch — land it alongside H and L in the first round.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

---

## What you are building

1. **Curved/arc text path** — text layers can follow an arc (curve up or curve down by a configurable amount).
2. **Speech bubbles** — a rect-layer variant that renders a rounded rect with a tail/pointer (direction + position configurable).
3. **Sticker/emoji picker** — a panel or popover for inserting emoji as text layers, plus a small built-in sticker library (PNG assets).
4. **Saved text style presets** — save the current text layer's style (font, color, stroke, size, alignment) as a named preset; apply with one tap.

---

## Files you will touch

### Primary
- `src/render/text.js` — `drawTextLayer(ctx, layer)` lives here; you will extend it to support the arc path.
- `src/ui/props/textProps.js` — text layer props panel; add arc controls, speech bubble controls, style preset UI.

### Supporting
- `src/core/layers.js` — `defaultTextLayer()` and `defaultRectLayer()` factories; you will add new fields and a new `defaultSpeechBubbleLayer()` factory (or add a `subtype` to rect).
- `src/ui/toolbar.js` — where the "Add text" / "Add shape" buttons live; add "Add speech bubble" and "Add sticker/emoji" buttons.
- `src/ui/props/shared.js` — `collapsibleHtml(id, title, innerHtml, { defaultOpen })`, `wireCollapsible(id)`, `byId()`, `field()`, `rangeRow()`.
- `src/render/renderer.js` — `drawLayer()` dispatches to type-specific draw functions; you may need to handle a new `speechbubble` type here.
- `src/persistence/autosave.js` — `applyLoadedSnapshot()` must add defaults for any new fields on load.

### New files to create
- `src/presets/textPresets.js` — load/save/list named text style presets (use `localStorage`).
- `src/ui/stickerPicker.js` — sticker/emoji picker UI.

---

## Real API shapes from Phase 0

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function resizeStageBuffer()
```

The internal `drawLayer(ctx, layer, backdrop)` function in `renderer.js` dispatches by `layer.type`. If you add a new layer type (e.g. `'speechbubble'`), add a branch there. This is an internal function, not exported — edit it directly.

### Layer schema (as it exists in the codebase)
```js
// Text layer fields (from defaultTextLayer() in src/core/layers.js):
layer.id, layer.type ('text'), layer.name
layer.x, layer.y, layer.w, layer.h, layer.rotation
layer.opacity, layer.visible, layer.locked, layer.aspectLocked
layer.text          // string
layer.font          // CSS font-family string
layer.sizeScale     // fraction of layer.h (0.05–1.0)
layer.color         // hex string
layer.align         // 'left' | 'center' | 'right'
layer.vAlign        // 'top' | 'middle' | 'bottom'
layer.bold, layer.italic
layer.lineHeight    // multiplier, e.g. 1.15
layer.letterSpacing // px
layer.padding       // px
layer.stroke        // { enabled: boolean, color: string, width: number }
layer.box           // { enabled: boolean, mode: 'color'|'blur', color: string, amount: number }
layer.adjustments   // [] (always access as layer.adjustments || [])
layer.blendMode     // 'normal' (always access as layer.blendMode || 'normal')
```

### collapsible UI helpers (src/ui/props/shared.js)
```js
export function collapsibleHtml(id, title, innerHtml, { defaultOpen = false } = {})
// Returns an HTML string

export function wireCollapsible(id)
// Call after the HTML is in the DOM
```

Use these for "arc path", "style presets", and any other secondary text controls that don't need to be visible by default.

---

## Implementation steps

### 1. Arc text path

Add an `arc` field to the text layer schema:
```js
layer.arc = 0  // degrees of bend: 0 = flat, positive = curve up, negative = curve down
```

In `drawTextLayer(ctx, layer)` in `src/render/text.js`:
- When `layer.arc === 0` (or falsy), use the existing flat text rendering path unchanged.
- When `layer.arc !== 0`, use `ctx.textOnPath` or a manual arc path:
  - Compute the arc radius from `layer.w` and `layer.arc` (bend amount).
  - Use `ctx.save()` / `ctx.restore()` and rotate+translate per character, or use a `Path2D` arc.
  - The simplest correct approach: for each character, compute its angular position on the arc, rotate the context, draw the character. This avoids needing `textOnPath` which isn't universally supported.
  - Respect `layer.align` for placement along the arc.

Add arc controls in `textProps.js` inside a `collapsibleHtml('tArcSection', 'Arc', ...)` section:
- A range slider for arc bend (-180 to +180 degrees, step 1, default 0).
- A "flat" reset button.

Add the `arc` field to `defaultTextLayer()` in `src/core/layers.js`:
```js
arc: 0,
```

Add migration in `applyLoadedSnapshot()` in `src/persistence/autosave.js`:
```js
if (l.type === 'text' && l.arc === undefined) l.arc = 0;
```

### 2. Speech bubbles

Add a speech bubble as a new rect subtype. The cleanest approach that avoids changing `drawLayer()`'s dispatch too much: add `layer.subtype = 'speechbubble'` to rect layers, and in `drawRectLayer()` in `src/render/shapes.js`, check for this subtype.

New factory in `src/core/layers.js`:
```js
export function defaultSpeechBubbleLayer() {
  // Similar to defaultRectLayer() but with subtype and tail fields:
  return {
    ...defaultRectLayer(),   // reuse base rect fields
    name: 'Speech Bubble ' + counters.rect,
    subtype: 'speechbubble',
    tailDir: 'bottom',       // 'top' | 'bottom' | 'left' | 'right'
    tailPos: 0.5,            // 0–1 fraction along the edge
    tailLen: 30,             // px length of the tail
  };
}
```

In `drawRectLayer()` in `src/render/shapes.js`, add a branch:
```js
if (layer.subtype === 'speechbubble') {
  drawSpeechBubble(ctx, layer);
  return;
}
```

`drawSpeechBubble(ctx, layer)` — draw a rounded rect with a triangular tail using `ctx.beginPath()` / `ctx.lineTo()` / `ctx.arc()`. No library needed.

Add speech bubble controls in `src/ui/props/rectProps.js` (or a new `speechBubbleProps.js`) when `layer.subtype === 'speechbubble'`:
- Tail direction (segmented button: top/bottom/left/right).
- Tail position slider (0–1).
- Tail length slider.
- Fill color, corner radius (reuse existing rect controls).

Add migration in `applyLoadedSnapshot()`:
```js
if (l.type === 'rect' && l.subtype === 'speechbubble') {
  if (l.tailDir === undefined) l.tailDir = 'bottom';
  if (l.tailPos === undefined) l.tailPos = 0.5;
  if (l.tailLen === undefined) l.tailLen = 30;
}
```

### 3. Sticker/emoji picker (`src/ui/stickerPicker.js`)

A popover or bottom sheet triggered by an "Add sticker" toolbar button:
- **Emoji tab** — a scrollable grid of emoji characters (use a curated list of ~100 common emoji). Tapping an emoji creates a text layer with that character, large `sizeScale`, centered.
- **Sticker tab** — a grid of PNG sticker assets (ship a small set of 10–20 built-in stickers as files in `assets/stickers/`). Tapping a sticker creates an image layer with that sticker's dataURL as `src`.

For the emoji path, create a text layer via `defaultTextLayer()` with `text` set to the chosen emoji and `font` set to a system emoji font stack (`'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`).

For the sticker path, fetch the sticker PNG (a `fetch()` to the asset URL + `.blob()` + `FileReader` to get a dataURL), then create an image layer via `defaultImageLayer(src, naturalW, naturalH)`.

### 4. Saved text style presets (`src/presets/textPresets.js`)

A preset captures the style fields of a text layer (not its content or geometry):
```js
// Preset shape:
{ name: string, font, sizeScale, color, align, vAlign, bold, italic,
  lineHeight, letterSpacing, padding, stroke, box }
```

Store in `localStorage` as JSON under key `'memelab-text-presets'`. API:
```js
export function listTextPresets()              // returns array of preset objects
export function saveTextPreset(name, layer)    // saves current layer style as named preset
export function applyTextPreset(preset, layer) // applies preset fields onto layer
export function deleteTextPreset(name)         // removes preset by name
```

In `textProps.js`, add a `collapsibleHtml('tPresetsSection', 'Style presets', ...)` section:
- A horizontal scroll of preset name chips; tap to apply.
- A "Save current style" button that prompts for a name (`window.prompt`) and saves.
- A small delete (×) button on each chip.

---

## Migration

For every new field added to existing layer types, add a migration guard in `applyLoadedSnapshot()` in `src/persistence/autosave.js`:

```js
// text arc
if (l.type === 'text' && l.arc === undefined) l.arc = 0;

// speech bubble fields
if (l.type === 'rect' && l.subtype === 'speechbubble') {
  if (l.tailDir === undefined) l.tailDir = 'bottom';
  if (l.tailPos === undefined) l.tailPos = 0.5;
  if (l.tailLen === undefined) l.tailLen = 30;
}
```

Also access defensively at every read site: `layer.arc || 0`, `layer.tailDir || 'bottom'`, etc. — don't rely on migration alone, because `restoreSnapshot()` during undo to a very old history entry may bypass `applyLoadedSnapshot`.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- A text layer with `arc = 45` renders without errors and produces a valid export.
- A text layer with `arc = 0` renders identically to the old behavior (regression).
- A speech bubble layer renders without errors.
- Saving and loading a text preset via localStorage round-trips correctly.
- Emoji sticker insertion creates a text layer with the correct character.
- Migration: a saved snapshot with a text layer missing `arc` loads and gets `arc = 0`.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`. All new complexity lives inside `drawTextLayer()`, `drawRectLayer()`, or new internal modules.
- Defensive access everywhere: `layer.blendMode || 'normal'`, `layer.mask?.enabled`, `layer.adjustments || []`, `layer.arc || 0`.
- New schema fields need defaults in `applyLoadedSnapshot()` AND defensive access at every read site.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-i.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
