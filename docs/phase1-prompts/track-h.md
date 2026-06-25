# Track H — File I/O, Canvas & Export Settings

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed blend modes, zoom/pan, layer masks, and a WebGL adjustment stack. This track is independent of all other Phase 1 tracks and touches almost no code that other tracks touch — land it first.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

---

## What you are building

1. **JPEG/WEBP export with quality control** — the current `exportPng()` always produces a PNG. Add format + quality options.
2. **HEIC import** — import HEIC/HEIF files via the `heic2any` library.
3. **GIF import/export with frames** — import animated GIFs (show frames as separate layers), export a layer stack as animated GIF.
4. **Social export presets** — one-tap size presets (1:1 for Instagram, 9:16 for Stories/Reels, 16:9 for YouTube, 4:5 for portrait feed).
5. **Batch edit** — apply the current layer's adjustments to multiple images dropped at once, export each.
6. **`.meme` project format** — a zip archive (JSZip) containing `manifest.json` plus binary assets; import/export.
7. **Canvas size as Document panel** — pull canvas size out of the always-visible toolbar, fold it + `.meme` import/export into a single "Document" icon/panel. Keep regular image export separate and prominent.
8. **Fixed export filename** — current code hardcodes `meme.png`; fix to reflect format (`meme.jpg`, `meme.webp`, etc.).
9. **Resize vs. scale choice** — when changing canvas size, let the user choose: "Canvas Size" (keep layers at absolute positions) vs. "Image Size" (proportionally scale the whole composition). Currently always silently does Canvas Size.

---

## Files you will touch

### Primary
- `src/ui/toolbar.js` — currently hosts the canvas-size reset button and the export button. You will remove canvas-size controls from here and add a Document icon.
- `src/render/renderer.js` — `exportPng(scale)` is here; you will extend it or add siblings for JPEG/WEBP/GIF export.
- `src/persistence/autosave.js` — `applyLoadedSnapshot()` is here; `.meme` import must route through this exact function.

### Supporting
- `src/core/state.js` — `state.width`, `state/height`, `state.layers`, `state.background`; canvas-size changes go through here.
- `src/core/history.js` — `pushHistory()`, `restoreSnapshot()` — push history after canvas resize.
- `src/ui/props/shared.js` — `collapsibleHtml(id, title, innerHtml, { defaultOpen })` and `wireCollapsible(id)` for any pro-only UI sections; `byId()`, `field()`, `rangeRow()`.

### New files to create
- `src/persistence/memeFile.js` — JSZip-based `.meme` export and import.
- `src/ui/exportModal.js` — the export settings modal/panel.
- `src/ui/documentPanel.js` — Document panel (canvas size, resize/scale choice, `.meme` import/export).

---

## Real API shapes from Phase 0

### renderer.js exports (do NOT change their signatures — all callers depend on them)
```js
export function renderScene(ctx, opts)           // opts: { forExport: boolean }
export function renderLayersToCtx(ctx, layers)  // used by thumbnail and merge
export async function exportPng(scale)          // returns Promise<Blob>
export function resizeStageBuffer()
export function applyViewportToStage()
export let stage
export function dispScaleFactor()
```

**Hard constraint:** Do not change these call-site shapes. Add new export functions alongside `exportPng`, do not change its signature. All new complexity stays inside new functions or internal helpers, not leaking to callers.

### Layer schema (as it actually exists in the codebase)
```js
// All layer types share:
layer.id          // string, e.g. "L3"
layer.type        // 'image' | 'text' | 'rect'
layer.blendMode   // string, default 'normal' — always access as layer.blendMode || 'normal'
layer.adjustments // array of { type: string, value: number } — always access as layer.adjustments || []
layer.visible     // boolean
layer.locked      // boolean
layer.opacity     // 0–1
layer.x, layer.y, layer.w, layer.h, layer.rotation

// Image layers only:
layer.src         // dataURL string
layer.naturalW, layer.naturalH
layer.flipX, layer.flipY
layer.crop        // { x, y, w, h } — fractions of natural size
layer.mask        // { enabled: boolean, src: string|null, invert: boolean, feather: number }
                  // always access as layer.mask?.enabled
```

### autosave.js — migration function (route .meme import through this)
```js
// Internal to autosave.js — but you will import and reuse its logic or call tryLoadAutosave()
export async function tryLoadAutosave()   // returns boolean
// applyLoadedSnapshot(snap) is not exported — you will need to extract it or
// restructure so .meme import can call it. The easiest approach: export it.
```

`applyLoadedSnapshot` already handles all migration (adds defaults for `blendMode`, `mask`, `adjustments` if missing, migrates old `exposure` field). Any `.meme` file — even one saved by an older version — must go through this same path so it gets migrated automatically.

### collapsible UI helpers (src/ui/props/shared.js)
```js
export function collapsibleHtml(id, title, innerHtml, { defaultOpen = false } = {})
// Returns an HTML string; inject into panel innerHTML

export function wireCollapsible(id)
// Call after the HTML is in the DOM; wires the toggle button
```

Use these for any "advanced" or infrequently-used sub-sections in the Document panel or export modal. The quality slider and advanced export options should live behind a collapsible, not always visible.

---

## Implementation steps

### 1. Export modal (`src/ui/exportModal.js`)

Replace the current single "Export" button + hardcoded `meme.png` flow with a modal or slide-up panel:

- **Format selector** — PNG, JPEG, WEBP (segmented button or `<select>`).
- **Quality slider** — only visible when JPEG or WEBP is selected (use `display:none` when PNG is selected, same pattern as `rectProps.js` hides/shows rows by mode). Range 0–100, default 92.
- **Size** — scale multiplier (1×, 2×, 4×) OR custom pixel dimensions (W × H). These are mutually exclusive — show/hide by mode using the same pattern.
- **Social presets** — 1:1 (1080×1080), 9:16 (1080×1920), 16:9 (1920×1080), 4:5 (1080×1350). Tapping a preset sets the output dimensions, not the canvas size.
- **One-click fast path** — remember the last-used settings (`localStorage`); the export button fires immediately with those, and a small "settings" gear icon opens the full modal.
- **Filename** — derive from format: `meme.png`, `meme.jpg`, `meme.webp`.

Add export functions alongside `exportPng` in `renderer.js`:
```js
export async function exportAs(format, quality, scale)
// format: 'png' | 'jpeg' | 'webp'
// quality: 0–1 (ignored for png)
// scale: number (multiplier on state.width/height)
// Returns Promise<Blob>
```

Use `'image/jpeg'` and `'image/webp'` as the MIME type in `canvas.toBlob()`. For PNG, delegate to the existing `exportPng(scale)`.

### 2. HEIC import

Add `heic2any` via CDN or npm. In the file-picker handler (wherever images are currently dropped/opened), detect `.heic`/`.heif` extensions or `image/heic`/`image/heif` MIME types and run through `heic2any({ blob, toType: 'image/jpeg' })` before creating the dataURL. The rest of the import path is unchanged.

### 3. GIF import

Use `gifuct-js` (or similar pure-JS GIF decoder) to decode an imported GIF into frames. Create one image layer per frame. If the GIF has only one frame, create a single image layer as normal.

### 4. GIF export

Add `gif.js` (web worker-based GIF encoder) to encode the layer stack as an animated GIF. Expose this as `exportGif(frameDelayMs)` in `renderer.js` or a new `render/gifExport.js`. Render each layer individually using `renderLayersToCtx` for frame composition, or render the full scene per frame if frame-per-layer is not what the user wants — decide based on what makes sense for the "frames as layers" model you built for import.

### 5. Batch edit

A "Batch export" option in the export modal: user drops multiple images, the current layer's `adjustments` array is applied to each via `applyAdjustments` (from `src/render/glAdjust.js`), and each result is downloaded as a separate file. This is a fire-and-forget flow, not a new persistent state — don't add it to history.

`applyAdjustments` signature (from `src/render/glAdjust.js`):
```js
export function applyAdjustments(srcCanvas, adjustments)
// srcCanvas: HTMLCanvasElement
// adjustments: array of { type: string, value: number }
// Returns: HTMLCanvasElement | null
// Returns null if all adjustments are zero (no-op)
```

### 6. `.meme` project format (`src/persistence/memeFile.js`)

A `.meme` file is a zip archive (use JSZip):
- `manifest.json` — the full autosave snapshot structure: `{ width, height, background, layers, ... }` but with `src` fields replaced by asset paths (e.g. `"assets/img-L3.png"`).
- `assets/img-<id>.png` — the binary PNG data for each image layer's `src` (decode from base64, store as raw bytes — base64 compresses worse inside zip).
- Same for `background.src` and any `layer.mask.src`.

**Export** (`exportMemeFile()`):
1. Walk `state.layers`, collect all dataURL `src` values.
2. Convert each dataURL to binary (strip `data:image/png;base64,`, atob, Uint8Array).
3. Build `manifest.json` with `src` replaced by `"assets/img-<id>.png"`.
4. Add all files to JSZip, generate blob, trigger download as `project.meme`.

**Import** (`importMemeFile(file)`):
1. Load zip via JSZip.
2. Parse `manifest.json`.
3. For each asset path in the manifest, read the binary file from zip, convert back to dataURL (`btoa` + prefix).
4. Reconstruct the snapshot object with dataURLs restored.
5. Call `applyLoadedSnapshot(snap)` — this is the critical step. The manifest is just a snapshot, so it must go through the same migration path as autosave. To make this work, **export `applyLoadedSnapshot` from `autosave.js`** so `memeFile.js` can import it.
6. After loading, call `scheduleRender()` and `pushHistory('Load .meme file')`.

### 7. Document panel (`src/ui/documentPanel.js`)

Remove canvas-size controls from the always-visible toolbar. Add a single "Document" icon button to the toolbar that opens a small panel (slide-in or modal):

- **Canvas size** — preset sizes (Instagram 1:1, Story 9:16, YouTube 16:9, A4 portrait, custom) + custom W/H inputs.
- **Resize vs. scale choice** — explicit radio or toggle:
  - "Canvas Size" (Photoshop behavior): change `state.width`/`state.height`, keep all layers at their current absolute positions. Existing behavior.
  - "Image Size": change `state.width`/`state.height`, then scale all layer positions/sizes proportionally (`layer.x *= newW/oldW`, `layer.y *= newH/oldH`, `layer.w *= newW/oldW`, `layer.h *= newH/oldH`).
- **`.meme` export** — "Save project" button, calls `exportMemeFile()`.
- **`.meme` import** — "Open project" file picker, calls `importMemeFile(file)`.

Use `collapsibleHtml`/`wireCollapsible` from `src/ui/props/shared.js` if you need to hide any advanced options within the Document panel.

After any canvas size change:
1. Update `state.width`, `state.height`.
2. If "Image Size" mode, scale all layer geometry.
3. Call `resizeStageBuffer()` (from `renderer.js`) to update the canvas element.
4. Call `pushHistory('Canvas size')`.

---

## Migration

The `.meme` format routes through `applyLoadedSnapshot()`, so older `.meme` files get the same automatic field migration as old autosave data. No additional migration work needed.

For new state fields added by this track (e.g. any stored export preferences in `state`), add defaults in `applyLoadedSnapshot()` and use defensive access (`state.exportFormat || 'png'`).

---

## UI architecture rules (do not violate)

- Basic controls stay visible; advanced/rare ones go behind `collapsibleHtml`.
- Canvas size and `.meme` import/export live in the Document panel, not the main toolbar row.
- Regular image export stays separate and prominent — it's the most frequent end-of-session action.
- Never let a new panel cover the canvas right after an edit completes.
- The quality slider and advanced export options are behind the collapsible, not always-visible.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases to `tests/test_full.py` covering:
- Export as JPEG and WEBP produce valid blobs (check MIME type or file header).
- Exported filename reflects format.
- `.meme` export produces a downloadable blob.
- `.meme` import restores the canvas state (layer count, width/height).
- Canvas Size mode change keeps a layer at its absolute position.
- Image Size mode change scales layer position proportionally.
- HEIC file import produces an image layer (mock or skip if HEIC decode takes too long in headless).

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`. Add new functions alongside them — never change their signatures.
- All new complexity lives inside new modules or new helper functions, not in existing callers.
- `.meme` import must route through `applyLoadedSnapshot()` for migration safety.
- Defensive access everywhere: `layer.blendMode || 'normal'`, `layer.mask?.enabled`, `layer.adjustments || []`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-h.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
