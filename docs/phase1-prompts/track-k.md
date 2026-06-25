# Track K — Filter Presets

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed a non-destructive adjustment stack (`layer.adjustments`) and WebGL pipeline (`src/render/glAdjust.js`, `src/render/adjustCache.js`). Track K builds on that stack: filter presets are one-tap named looks, each implemented as a saved array of `layer.adjustments` entries plus an optional overlay asset.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Depends on: Phase 0 section 4 (adjustment stack must exist — it does).**

---

## What you are building

One-tap named filter looks: vintage, noir, drama, grunge, retrolux, HDR-scape, bloom, halation, glamour glow. Each is:
- A fixed, curated array of `layer.adjustments` entries (e.g. `[{ type: 'brightness', value: 15 }, { type: 'contrast', value: 20 }, { type: 'saturation', value: -30 }]`).
- An optional texture overlay asset (a PNG blended over the image at reduced opacity using a specific blend mode).

Filter presets are in the **always-visible fast path** — do not put them behind a collapsible. They're meant to be fast, one-tap fun, which is the quick-edit identity this app is built around. Burying them behind a disclosure would undercut the reason they exist.

---

## Files you will touch

### Primary
- `src/presets/filters.js` — **new file** — the preset definitions and apply/remove logic.
- `src/ui/props/imageProps.js` — add the filter preset strip to the image layer props panel.

### Supporting
- `src/render/glAdjust.js` — the WebGL pipeline; you will NOT change this file, only call it via `adjustCache.js`.
- `src/render/adjustCache.js` — cache API; you will NOT change it, but understand that `clearAdjustCache()` must be called when adjustments change.
- `src/core/layers.js` — `defaultImageLayer()` already includes `adjustments: []`; no changes needed.
- `src/persistence/autosave.js` — `applyLoadedSnapshot()` already migrates `adjustments`; no changes needed for the preset mechanism itself.
- `src/ui/props/shared.js` — `byId()`, `rangeRow()`, `collapsibleHtml()`, `wireCollapsible()` — available if needed.

---

## Real API shapes from Phase 0

### Layer schema (as it exists in the codebase)
```js
layer.adjustments  // array of { type: string, value: number }
                   // always access as layer.adjustments || []
// Supported types in the current WebGL shader (src/render/glAdjust.js):
// 'brightness'  — value: -100 to +100 (mapped to -1..+1 in shader as value/100)
// 'contrast'    — value: -100 to +100
// 'saturation'  — value: -100 to +100
```

The current shader handles only brightness/contrast/saturation. Track A (Tone adjustments) will add more types. For this track, all preset definitions must be expressible with the three types the shader currently supports. You can reserve additional types in the preset definition objects for later activation (they'll be no-ops until Track A adds their shader support), but the nine built-in looks must work with brightness/contrast/saturation alone.

```js
layer.blendMode    // string, always access as layer.blendMode || 'normal'
layer.mask         // { enabled, src, invert, feather }, always access as layer.mask?.enabled
```

### glAdjust.js API (do NOT modify this file)
```js
export function applyAdjustments(srcCanvas, adjustments)
// srcCanvas: HTMLCanvasElement
// adjustments: array of { type: string, value: number }
// Returns: HTMLCanvasElement | null
// Returns null if all adjustments are zero (no-op)
```

### adjustCache.js API (do NOT modify this file)
```js
export function getAdjustedCanvas(layer)
// Returns: HTMLCanvasElement | null
// Returns null if no active adjustments or image not loaded yet

export function clearAdjustCache()
// Call this after mutating layer.adjustments so the cache invalidates
```

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function scheduleRender()
```

### history.js
```js
export function pushHistory(label)   // call after applying a preset
```

### shared.js
```js
export function collapsibleHtml(id, title, innerHtml, { defaultOpen = false } = {})
export function wireCollapsible(id)
export function byId(id)
```

---

## Implementation steps

### 1. Preset definitions (`src/presets/filters.js`)

Define each preset as an object:
```js
export const FILTER_PRESETS = [
  {
    id: 'none',
    label: 'None',
    adjustments: [],
    overlay: null,
  },
  {
    id: 'vintage',
    label: 'Vintage',
    adjustments: [
      { type: 'brightness', value: 5 },
      { type: 'contrast', value: 10 },
      { type: 'saturation', value: -25 },
    ],
    overlay: null,   // or: { src: 'assets/overlays/vintage.png', opacity: 0.2, blendMode: 'multiply' }
  },
  // ... noir, drama, grunge, retrolux, hdr-scape, bloom, halation, glamour-glow
];
```

Design the nine looks yourself — you are the implementer. Each should be visually distinct and recognizable. Suggested starting points:
- **noir**: high contrast (+40), desaturated (-80), slight brightness boost (+5).
- **drama**: high contrast (+30), slight saturation boost (+10), brightness down (-10).
- **grunge**: contrast up (+20), saturation way down (-50), brightness down (-15).
- **retrolux**: brightness up (+20), contrast down (-10), saturation way down (-40).
- **HDR-scape**: contrast up (+50), saturation up (+30).
- **bloom**: brightness up (+30), contrast down (-20), saturation up (+10).
- **halation**: brightness up (+40), contrast down (-30), saturation down (-20).
- **glamour glow**: brightness up (+25), contrast down (-15), saturation up (+15).

Also export:
```js
// Apply a preset to a layer — replaces layer.adjustments with the preset's entries.
// Preserves any adjustments NOT in the preset (e.g. user's manual brightness tweak).
// Actually: for simplicity, just replace adjustments wholesale with the preset entries.
// The user can still tweak sliders afterward.
export function applyPreset(layer, preset) {
  layer.adjustments = preset.adjustments.map(a => ({ ...a })); // deep copy
  // If the preset has an overlay, handle it separately (see step 3).
}

// Remove the current preset (reset adjustments to empty).
export function clearPreset(layer) {
  layer.adjustments = [];
}

// Return the preset id that matches the layer's current adjustments, or null.
export function getActivePresetId(layer) {
  const adjs = layer.adjustments || [];
  for (const p of FILTER_PRESETS) {
    if (presetsMatch(adjs, p.adjustments)) return p.id;
  }
  return null;
}
```

### 2. Preset strip UI in image props

In `imageProps.js`, add a horizontal scrollable strip of filter thumbnails above the Adjustments section. This strip is always visible (not behind a collapsible) — presets are a fast-path feature.

Each preset chip:
- Small thumbnail preview (see step 4 for how to generate these).
- Label below the thumbnail.
- Active state (border/highlight) when the layer's current adjustments match the preset.

Wire tapping a chip to:
```js
applyPreset(layer, preset);
clearAdjustCache();     // from src/render/adjustCache.js
scheduleRender();       // from src/render/renderer.js
pushHistory('Apply filter: ' + preset.label);
```

The "None" chip clears the preset:
```js
clearPreset(layer);
clearAdjustCache();
scheduleRender();
pushHistory('Clear filter');
```

### 3. Texture overlay support (optional for some presets)

If a preset has `overlay: { src, opacity, blendMode }`, applying the preset should also add an overlay layer above the current image layer. This overlay is a separate image layer in `state.layers`, not part of `layer.adjustments`. When clearing the preset, remove the overlay layer.

Track the overlay layer by storing `layer._presetOverlayId` (a transient field, not persisted) so you can find and remove it when the preset changes.

Alternatively, for Phase 1, skip the overlay mechanism and make all nine presets expressible with adjustments alone. Ship the overlay mechanism if time allows, but it's not required for the nine named looks.

### 4. Preset thumbnails

Generate preset thumbnails at render time, not at build time:
- When the preset strip is shown for a layer, render a 60×60 version of the layer's image with each preset's adjustments applied.
- Use `applyAdjustments(srcCanvas, preset.adjustments)` directly (not through `getAdjustedCanvas` — that's the cache layer for the main render path).
- Cache these thumbnail canvases in a `Map<presetId, canvas>` keyed by `layer.id + presetId`; invalidate when the layer's `src` changes.
- Generate them lazily (when the strip is first opened) and progressively (one per rAF tick or in a microtask queue) to avoid blocking the main thread.

### 5. Active preset indicator

After the user manually tweaks an adjustment slider (via the existing Adjustments sliders in `imageProps.js`), the active preset highlight should clear — the layer's adjustments no longer match any preset. `getActivePresetId(layer)` already handles this: if the sliders no longer match a preset, it returns `null`, so just re-call `getActivePresetId` and update the UI highlight on every slider change.

---

## Non-goals for this track

- Do NOT add new adjustment types to `glAdjust.js` (curves, HSL, vibrance, etc.) — that's Track A.
- Do NOT build a full preset editor or preset library (save/load custom presets) — ship the nine built-in presets only.
- Overlay texture support is optional; the nine looks must work without it using brightness/contrast/saturation alone.

---

## Migration

No new persistent layer fields are added by this track. The `adjustments` array is already migrated by `applyLoadedSnapshot()` in `autosave.js`. Transient fields (`_presetOverlayId`) must NOT be included in `snapshot()` — they're UI state only.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Applying the "noir" preset sets `layer.adjustments` to the expected values.
- Applying "None" clears `layer.adjustments` to `[]`.
- `getActivePresetId` returns the correct id when adjustments match a preset.
- `getActivePresetId` returns null after a slider tweak breaks the match.
- Applying a preset triggers a valid re-export (no render errors).
- Undo after applying a preset reverts `layer.adjustments`.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- Filter presets are in the always-visible fast path — do NOT put them behind a collapsible.
- Call `clearAdjustCache()` after every mutation of `layer.adjustments`.
- Defensive access: `layer.adjustments || []`, `layer.blendMode || 'normal'`, `layer.mask?.enabled`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-k.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
