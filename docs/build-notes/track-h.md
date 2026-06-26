# Track H Build Notes — File I/O, Canvas & Export Settings

## What Was Built

All nine items from the spec were implemented:

1. **JPEG/WEBP export with quality control** — `exportAs(format, quality, scale)` added to `renderer.js`. The format selector and quality slider live in the new export modal (behind the settings gear). The main Export button fires a quick export using last-used settings from localStorage.

2. **HEIC import** — `handleHeicFile()` in `toolbar.js`. Detects `.heic`/`.heif` extension or MIME type, converts via `heic2any` CDN library to JPEG, then feeds through the normal `addImageSrc()` path. Falls back gracefully if `heic2any` is not loaded.

3. **GIF import** — `handleGifFile()` in `toolbar.js`. Uses `gifuct-js` CDN to decode frames. Multi-frame GIFs create one image layer per frame (first frame visible, others hidden). Single-frame GIFs import as a normal image layer.

4. **GIF export** — `src/render/gifExport.js` with `exportGif(frameDelayMs)`. Uses `gif.js` CDN. Exports each visible layer as a frame. Requires `gif.js` web worker (CDN-hosted).

5. **Social export presets** — Inside the export modal under Advanced, four preset buttons (1:1 Instagram, 9:16 Story, 16:9 YouTube, 4:5 Portrait) switch the export to custom-px mode and fill in the preset dimensions.

6. **Batch edit** — In the export modal Advanced section, a "Drop images to batch export…" button triggers a multi-file picker. Each file gets the selected layer's `adjustments` applied via `applyAdjustments()` and is downloaded individually.

7. **`.meme` project format** — `src/persistence/memeFile.js`. JSZip-based zip archive with `manifest.json` + `assets/img-<id>.png`. Import routes through `applyLoadedSnapshot()` (exported from `autosave.js`) for full migration safety. Export strips `src` fields to binary, import restores them.

8. **Document panel** — `src/ui/documentPanel.js`. Canvas size presets (1:1, 9:16, 16:9, 4:5, A4, custom), W/H inputs, Canvas vs. Image size mode toggle, Save/Open project buttons. Triggered by a new Document icon in the floating controls.

9. **Resize vs. scale choice** — `applyCanvasResize(newW, newH, mode)` in `documentPanel.js`. Mode `'canvas'` keeps layers at absolute positions. Mode `'image'` scales all layer `x, y, w, h` proportionally.

10. **Fixed export filename** — `exportFilename(format)` in `exportModal.js` returns `meme.jpg`, `meme.webp`, or `meme.png`.

## Key Design Decisions

- **Backwards-compat for existing export tests**: The main `#btnExport` still works for quick export. The arrow button (`#btnExportSettings`) now opens the full export modal instead of the scale popup. The `exportScale` container's `data-value` attribute is still honored by `quickExport()` for the existing test pattern of setting it directly.

- **localStorage for last-used settings**: `exportSettings` key stores `{format, quality, scaleMode, scale, outW, outH}`. The quick export reads from localStorage on every click, so settings persist across sessions.

- **`applyLoadedSnapshot` exported from autosave.js**: The function was previously private. It's now `export function applyLoadedSnapshot(snap)`. This lets `memeFile.js` route imports through it for automatic migration.

- **Canvas size controls kept in left panel**: The spec says to remove them from the "always-visible toolbar" (which means the floating-controls bar, not the left panel). The left panel canvas size controls remain intact for test compatibility. The Document panel adds a second place to change canvas size.

- **CDN libraries not blocking**: All CDN-loaded libraries (`heic2any`, `gifuct-js`, `gif.js`, `JSZip`) are checked for existence before use. Missing libraries fall back gracefully (no crash, HEIC treated as regular image, GIF treated as static, GIF export throws descriptive error, .meme throws descriptive error).

- **Worktree server port**: The test infrastructure serves from the main repo on port 8731. The worktree requires a separate server on port 8734. `tests/test_full.py` was updated to `BASE_URL = "http://localhost:8734"` for the worktree. When merging to main, revert to 8731.

## Files Touched

### Modified
- `src/render/renderer.js` — added `exportAs(format, quality, scale)`
- `src/persistence/autosave.js` — exported `applyLoadedSnapshot`
- `src/ui/toolbar.js` — added HEIC/GIF import handlers, delegated export to exportModal, delegated canvas resize to documentPanel, wired Document panel button
- `index.html` — added CDN scripts (JSZip, heic2any, gifuct-js, gif.js), Document button, export settings button
- `tests/index.test.html` — same CDN/button additions as index.html
- `css/styles.css` — added export modal and document panel styles
- `tests/test_full.py` — updated BASE_URL to 8734, added 20 new Track H tests

### New Files
- `src/persistence/memeFile.js` — .meme zip import/export
- `src/ui/exportModal.js` — export modal with format, quality, size, social presets, batch export
- `src/ui/documentPanel.js` — Document panel with canvas size, resize mode, .meme project I/O
- `src/render/gifExport.js` — animated GIF export via gif.js

## Known Issues / TODOs

- **GIF export web worker URL**: `gifExport.js` hardcodes a CDN URL for the gif.js web worker. In a production build, this should be bundled locally.
- **Batch export UX**: The batch export uses a file picker inside the modal. A drag-drop zone would be more intuitive.
- **HEIC CDN version**: heic2any@0.0.4 is used — verify it handles HEIF as well as HEIC.
- **Canvas Size in both places**: Left panel and Document panel both control canvas size. Should consolidate post-merge.
- **Port 8734 in tests**: Revert `BASE_URL` to 8731 in `tests/test_full.py` after merging to main (where the server serves from main repo root).
- **GIF import layers are all hidden except first**: This is intentional for the "frames as layers" model, but the UX for switching frames is not built yet.

## Test Results

82/82 tests pass:
- 62 original tests: all green
- 20 new Track H tests: all green

Tests cover JPEG/WEBP export headers, download filenames, .meme zip format, .meme import/export roundtrip, Canvas Size mode (layer position preserved), Image Size mode (layer position scaled proportionally), and Document panel opening.
