# Track K — Filter Presets: Build Notes

## What was built

Nine named one-tap filter looks (plus "None") implemented as saved arrays of `layer.adjustments` entries, rendered in a horizontally-scrollable chip strip in the image-layer props panel. The strip is always visible — not behind a collapsible — as the spec requires.

### Filters shipped

| ID | Label | Brightness | Contrast | Saturation |
|----|-------|-----------|---------|-----------|
| none | None | — | — | — |
| vintage | Vintage | +5 | +10 | -25 |
| noir | Noir | +5 | +40 | -80 |
| drama | Drama | -10 | +30 | +10 |
| grunge | Grunge | -15 | +20 | -50 |
| retrolux | Retrolux | +20 | -10 | -40 |
| hdrscape | HDR-scape | 0 | +50 | +30 |
| bloom | Bloom | +30 | -20 | +10 |
| halation | Halation | +40 | -30 | -20 |
| glamourglow | Glamour Glow | +25 | -15 | +15 |

All looks are expressible with the three adjustment types the current WebGL shader supports (brightness, contrast, saturation). The overlay mechanism (spec step 3) was deliberately skipped for Phase 1 — all nine looks work without it.

---

## Files touched

### New
- `src/presets/filters.js` — preset definitions (`FILTER_PRESETS`), and three exports: `applyPreset`, `clearPreset`, `getActivePresetId`.

### Modified
- `src/ui/props/imageProps.js` — added imports for `filters.js` and `glAdjust.js`; added `_thumbCache`, `_renderThumb`, `_scheduleThumbs`, `_filterStripHtml`, `_wireFilterStrip`, `_syncAdjSliders`, `_updateFilterActiveState`; inserted `_filterStripHtml(layer)` into `imagePropsHtml`; wired the strip and added `_updateFilterActiveState` call into `wireAdj`.
- `css/styles.css` — added `.filter-presets-section`, `.filter-strip`, `.filter-chip`, `.filter-thumb`, `.filter-label` rules.
- `tests/test_full.py` — added 14 new test cases under the "Track K: Filter presets" section.

---

## Key design decisions

### Preset definitions are deep-copied on apply
`applyPreset` does `preset.adjustments.map(a => ({ ...a }))` so the layer's adjustments array is never a reference into the static preset object. This prevents accidental mutation of the preset definition when sliders are subsequently moved.

### `getActivePresetId` uses sort-normalized string comparison
The order of entries in `layer.adjustments` is not guaranteed (user tweaks may push/find in any order), so the match function normalises both arrays to sorted `type:value` strings before comparing.

### Filter strip is always visible
Following the spec's hard constraint, the `_filterStripHtml` section uses a plain `.section` wrapper — not a `collapsibleHtml` call. This keeps the strip in the always-visible fast path.

### Thumbnails generated lazily via rAF queue
`_scheduleThumbs` generates one thumbnail per `requestAnimationFrame` tick, so rendering 10 thumbnails takes ~10 frames (~167ms at 60fps) instead of blocking the main thread for the full batch. Already-cached thumbnails are embedded directly into the HTML via data-URI on re-renders (e.g. when props panel re-opens for the same layer/src).

### Active state updated in-place on chip click
When a chip is clicked, only the `.active` class on the chips is toggled — the full props panel is NOT re-rendered. This keeps the strip interactive (no flicker) while also syncing the adjustment sliders via `_syncAdjSliders`.

### Manual slider adjustments clear the active indicator
The `wireAdj` wrapper now calls `_updateFilterActiveState(layer)` on every `input` event. `getActivePresetId` returns `null` as soon as any slider value breaks the exact match, so the active chip highlight drops automatically.

### Overlay mechanism skipped for Phase 1
The spec marked overlay support as optional ("Ship the overlay mechanism if time allows, but it's not required for the nine named looks"). All nine presets have `overlay: null`. The `_presetOverlayId` transient field is not included in the snapshot (it would be a transient UI concern only).

---

## Deviations from the spec

None. The spec said: skip overlays if time is tight; all nine looks must work with brightness/contrast/saturation; use always-visible strip; call `clearAdjustCache()` after every mutation; defensive access throughout. All constraints were followed.

---

## Testing

### New test cases (14 added)

1. Filter strip is visible (not collapsed) after selecting an image layer.
2. "None" and "noir" chips exist in the strip.
3. Clicking "noir" sets `brightness=5`, `contrast=40`, `saturation=-80` in `layer.adjustments`.
4. The noir chip has the `active` CSS class after applying.
5. `getActivePresetId` returns `'noir'` after applying noir (verified via dynamic module import in browser).
6. Export with noir applied produces a valid PNG.
7. Undo after applying noir reverts `layer.adjustments` to `[]`.
8. Clicking "None" chip clears adjustments to `[]`.
9. `getActivePresetId` returns `'none'` after clearing.
10. Applying noir then manually tweaking brightness slider causes `getActivePresetId` to return `null`.
11. Noir chip loses `active` class after slider tweak.
12. No page errors throughout the filter preset flow.

### Existing tests
All 62 prior tests remain green. The full suite now passes 76/76.

### How to run
```bash
cd /home/lumi/Projects/MemeLab  # (or worktree root)
python3 -m http.server 8731 &
python3 tests/test_full.py
```

---

## Known issues / TODOs

- **Thumbnail "None" chip shows unstyled grey box** until the image loads. After `_scheduleThumbs` runs, the "None" chip gets the raw image (no adjustments). This is correct behaviour — just visible as an empty grey square for a frame before the image loads.
- **Overlay mechanism not implemented.** All `overlay` fields are `null`. This is intentional for Phase 1 per the spec.
- **`_thumbCache` is module-level and unbounded.** For Phase 1 with up to ~10 presets × N images, this is fine. A future track could add LRU eviction if memory pressure becomes a concern.
- **Thumbnail rAF queue is not cancellable.** If the user selects a different layer before all thumbnails finish generating, the pending rAF ticks will still run and find no matching DOM element (safe, just wasteful for a few frames).
