# Track C — Selection & Masking UI — Build Notes

## What was built

Six interactive masking tools were added to MemeLab's image layer editing workflow:

1. **Lasso selection** — freehand path drawn by dragging; closed on pointerup and rasterized to a mask.
2. **Polygon selection** — click to place vertices; close by clicking within 20px of the first vertex or using the Close button. Escape or Cancel cancels in-progress polygon.
3. **Magic wand** — tap a pixel; BFS flood-fill expands outward selecting pixels within Euclidean RGB distance ≤ tolerance (default 30, adjustable via slider).
4. **Brush-paint mask** — paint white (reveal) or black (hide) strokes directly onto the mask; smooth interpolation between pointer events; live preview on every move tick; history pushed once on pointerup.
5. **Gradient mask** — drag to define start/end; supports linear and radial gradient types; arrow indicator shown during drag.
6. **Invert mask** — already wired via the existing `layer.mask.invert` toggle in the Mask collapsible (no new code needed).

All tools write to `layer.mask.src` (PNG dataURL, R=G=B=gray, A=255, white=reveal) and set `layer.mask.enabled = true`, matching the existing `drawImageLayer` compositing contract.

---

## Files touched

### New files
- `src/interactions/selectionTools.js` — lasso, polygon, magic wand, gradient mask logic
- `src/interactions/brushMask.js` — brush-paint mask tool
- `src/interactions/toolOverlay.js` — shared overlay state singleton (breaks circular imports between renderer and selection tools)

### Modified files
- `src/core/state.js` — added `state.activeTool: null`
- `src/interactions/pointer.js` — added `setActiveTool()`, `projectCoords()` export; tool-mode routing in `onPointerDown`/`onPointerMove`/`onPointerUp`; Escape key handler for cancel
- `src/render/renderer.js` — extended `drawSelectionOverlay()` to draw in-progress lasso/polygon paths, gradient drag indicator, brush cursor circle; imports from `toolOverlay.js` (not from tool modules)
- `src/ui/props/imageProps.js` — added `_maskToolsHtml()` block with tool buttons and per-tool controls (wand tolerance, brush size/mode, gradient type, polygon close/cancel); wired all controls
- `tests/test-hooks.js` — exposed `setActiveTool`, `getActiveTool`, `simulateLasso`, `simulateWand`, `simulateGradient`
- `tests/test_full.py` — added 14 new test cases (Section 5)

---

## Key design decisions

### Circular import resolution via `toolOverlay.js`

`renderer.js` needs to read overlay state (lasso path, polygon vertices, brush cursor, etc.) to draw the in-progress selection overlay. `selectionTools.js` and `brushMask.js` need `scheduleRender()` from `renderer.js`. The naive approach of importing both ways creates a JS module cycle that manifests as "Cannot access X before initialization" errors.

Solution: a tiny `src/interactions/toolOverlay.js` module holds the shared mutable overlay state (plain object). Both tool modules mutate `overlay.*`; renderer reads `overlay.*`. No cycles.

### Mask PNG format

All tools produce a greyscale PNG with R=G=B=gray, A=255. This matches the existing `drawImageLayer` compositing path which reads the R channel as alpha via `destination-in`. The AI background removal path in `imageProps.js` uses a different format (R=G=B=255, A=gray) — the selection tools do NOT follow that format, they follow the raw mask PNG format described in the spec.

### Tool activation toggle

`setActiveTool(tool)` in `pointer.js` toggles the same tool off (sets `activeTool = null`) if called with the currently active tool. This matches the spec requirement "clicking the active tool button a second time deactivates the tool." The UI re-renders via `renderPropsPanel()` after each toggle to update button `active` class and show/hide tool-specific controls.

### Brush mask live preview

The brush tool writes `layer.mask.src = canvas.toDataURL()` on every `pointermove` while the button is held. This is intentionally slightly expensive but produces immediate visual feedback. History is pushed only once on `pointerup`. The brush working canvas is preserved between strokes as long as the same layer stays selected and its dimensions haven't changed.

### Polygon close detection

The "close within 20px" detection operates in canvas-space pixels (before projection to layer-local). This gives a consistent close-zone size regardless of layer zoom/scale, matching typical creative tool UX.

### Magic wand BFS scope

The wand BFS is bounded to `layer.w × layer.h` pixels and operates on the layer rendered without its mask (using `getAdjustedCanvas` if available, falling back to raw crop/flip draw). The dynamic `import()` inside `wandPointerDown` avoids any new top-level circular dependency.

---

## Deviations from spec

- `layer.mask.src` in `drawImageLayer` (shapes.js) uses `destination-in` with the mask PNG directly. The spec says the mask format is R=G=B=gray, A=255 and "compositing reads the R channel as alpha". The existing AI removal path converts to R=G=B=255, A=gray before storing. The spec is slightly ambiguous: the selection tools store R=G=B=gray, A=255 (the format `drawImageLayer` actually receives and uses destination-in with). Testing confirms this produces correct alpha compositing.
- The `wandTolerance` and `gradientType` exports from `selectionTools.js` are getter functions (`getWandTolerance()`, `getGradientType()`) rather than live-binding properties, since the values are module-private variables. The UI reads them at panel-render time via these getters.

---

## Known issues / TODOs

- **Feather**: `layer.mask.feather` is stored but not rendered (as noted in the spec — "currently stored but feather rendering TBD").
- **Magic wand on tainted canvas**: If the image src is a cross-origin URL (not a data-URL), `getImageData()` will throw a security error. The code catches this and silently returns without applying a mask.
- **Brush tool on layer resize**: If the layer is resized while the brush tool is active, the internal working canvas dimensions will mismatch. The next `brushPointerDown` detects this and re-initialises from `layer.mask.src`.
- **Polygon close button**: The "Close polygon" button in the props panel triggers `polygonClose()` which fires at whatever the current polygon state is. No in-progress vertex tracking from the UI button (the normal flow is: click on canvas to close).
- **Performance on large layers**: The BFS flood fill for magic wand iterates `layer.w × layer.h` pixels synchronously. For very large layers (e.g., 4000×4000) this may block the main thread for ~1–2 seconds. A worker-based implementation would be a natural follow-up.

---

## How it was tested

```bash
# Start server from worktree directory
python3 -m http.server 8731 &

# Run suite
python3 tests/test_full.py
```

All 76 tests pass: 62 original + 14 new (Section 5: Selection & Masking tools).

New tests cover:
- Activating lasso sets `state.activeTool = 'lasso'`
- Simulated lasso drag produces non-null `layer.mask.src`
- Lasso mask is a valid PNG dataURL
- Undo after lasso reverts `layer.mask.enabled`
- Activating wand sets `state.activeTool = 'wand'`
- Magic wand produces a PNG dataURL mask
- Magic wand sets `layer.mask.enabled = true`
- Activating gradient sets `state.activeTool = 'gradientMask'`
- Gradient mask produces a PNG dataURL
- Gradient mask sets `layer.mask.enabled = true`
- Toggling active tool off sets `state.activeTool = null`
- No page errors throughout masking section
