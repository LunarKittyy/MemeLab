# Track J — Mobile UX Polish: Build Notes

## What Was Built

Four features:

### 1. Gesture swipe-adjust (Snapseed-style)

When any adjustment slider (`aiBright`, `aiContr`, `aiSat`) is focused, moving the mouse/pointer horizontally over the canvas adjusts the slider value. The delta is scaled by `range/300` per pixel so a full-width swipe moves the slider from min to max.

**Implementation:**
- `state.swipeAdjustTarget` (transient, `null` by default) tracks the focused slider's DOM id.
- `imageProps.js` wires `focus` and `blur` events on all three adjustment sliders to set/clear `state.swipeAdjustTarget`.
- `pointer.js` `onPointerMove` checks `state.swipeAdjustTarget && !drag` and applies the delta. `lastSwipeX` is initialized in `onPointerDown` to avoid a large spurious delta on the first move event.
- A swipe hint overlay (`_showSwipeHint()`) appears briefly in the canvas area when a slider is focused, then fades after 2 seconds.

### 2. Before/after compare

Two modes, both transient (`state.compareMode`):

**Toggle mode**: When active, image layers are rendered without their adjustments or mask. Implemented by temporarily setting `layer.adjustments = []` and `layer.mask.enabled = false` during `renderScene`. This is non-destructive — originals are restored immediately after the draw.

**Split mode**: Renders the processed scene and the "original" scene (no adjustments/mask) to two offscreen canvases, then composites them side-by-side with a draggable divider handle. The split position is stored in `state.compareSplitX` (0..1, transient). The divider handle can be dragged by firing a `compareSplit` drag kind in `pointer.js`. In split mode, layer interaction is disabled.

**UI**: Compare buttons in the image props panel ("Toggle" and "Split"). Clicking the active mode button deactivates it.

### 3. Smart guides / snap to guides

When dragging a layer, alignment guides are computed against all other visible layers' left/center/right/top/center/bottom edges, plus the canvas edges and center.

**`computeGuides(movingLayer, allLayers)`** (exported from `pointer.js`): Returns an array of `{x?, y?, forRight?, forBottom?}` objects. The `forRight`/`forBottom` flags indicate that the guide should snap the moving layer's right or bottom edge (not its left/top edge).

**Snap logic** in `onPointerMove` (move case):
- Threshold is `8 / viewport.zoom` canvas pixels (constant in screen space at any zoom level).
- Checks left edge, center, and right edge of moving layer against each guide's x value.
- Checks top edge, center, and bottom edge against each guide's y value.
- Snapping is applied to `layer.x` and `layer.y` directly.
- Matched guides are pushed to `state.activeGuides`.

**Drawing**: `drawActiveGuides(ctx, W, H)` draws cyan dashed lines spanning the full canvas for each active guide. Called from `doRender()`.

**Snap toggle**: `state.snapToGuides` (default `true`, persisted to localStorage as `ml_snapToGuides`). Toolbar button "Snap" toggles it. Keyboard shortcut removed (too likely to conflict).

**`state.activeGuides`** is cleared in `onPointerUp`.

### 4. Grid and rulers

**Grid**: `drawGrid(ctx, W, H)` draws a grid when `state.showGrid` is true. Grid cells are `state.gridSize` canvas pixels, scaled by `viewport.zoom * _fitScale` to remain constant in screen space. Called from `doRender()` — NOT from `renderScene()` — so it never appears in exports. Min cell size guard of 4px prevents drawing when zoomed out too far.

**Rulers**: CSS-positioned `<canvas>` elements (`_rulerH`, `_rulerV`) are created dynamically and appended to `#canvasArea`. `updateRulers()` is called from `doRender()`. Rulers position themselves relative to the stage's bounding rect. Tick marks are drawn at auto-selected intervals (10, 25, 50, 100, 200, 500 canvas px) such that ticks are at least 20px apart in screen space.

**State** (all persisted to `localStorage`, NOT in history snapshots):
- `state.showGrid` (`ml_showGrid`, default `false`)
- `state.gridSize` (`ml_gridSize`, default `100`)
- `state.showRulers` (`ml_showRulers`, default `false`)
- `state.snapToGuides` (`ml_snapToGuides`, default `true`)

**UI**: Three toolbar buttons injected before the save-status indicator: "Grid" (`#btnToggleGrid`), "Rulers" (`#btnToggleRulers`), "Snap" (`#btnToggleSnap`). Keyboard shortcuts: `G` for grid, `R` for rulers (registered in a capture-phase keydown listener in `toolbar.js`).

---

## Key Design Decisions

- **Grid drawn in `doRender()`, not `renderScene()`**: Keeps grid out of exports trivially (no `opts.forExport` check needed inside the grid function). Smart guides are drawn similarly. Only selection overlay (which is already gated on `!opts.forExport`) stays in `renderScene()`.

- **Compare toggle modifies layers transiently**: Instead of adding a separate "original rendering path" to `drawImageLayer`, the compare toggle modifies `layer.adjustments` and `layer.mask` in place for the duration of the render call, then restores them. This is simpler and avoids touching `shapes.js`.

- **Compare split uses two offscreen canvases**: Renders to `offA` (processed) and `offB` (original) then composites using canvas clipping. The divider handle is a filled circle at the midpoint of the screen height.

- **`computeGuides` exported from `pointer.js`**: Keeps all pointer-interaction logic in one file. `renderer.js` only draws the active guides from `state.activeGuides`.

- **Rulers are DOM `<canvas>` elements, not drawn on stage**: This avoids coordinate system complexity and keeps export clean. The ruler canvases are positioned via `style.left/top` relative to `#canvasArea` (set to `position:relative`).

- **`saveUIPref` helper in `state.js`**: Centralizes localStorage writes for UI preferences. Simple try/catch for environments where localStorage is unavailable.

---

## Files Touched

| File | Changes |
|------|---------|
| `src/core/state.js` | Added Track-J state fields and `saveUIPref()` |
| `src/interactions/pointer.js` | Added `computeGuides()`, `lastSwipeX`, swipe-adjust logic, smart guide snapping in move, `compareSplit` drag kind |
| `src/render/renderer.js` | Added `drawGrid()`, `drawActiveGuides()`, `updateRulers()` (with `_rulerH`/`_rulerV` DOM canvases), before/after compare toggle in `renderScene()`, split compare rendering in `doRender()` |
| `src/ui/props/imageProps.js` | Added compare buttons (toggle/split), swipe-adjust focus/blur wiring, `_showSwipeHint()` |
| `src/ui/toolbar.js` | Added grid/rulers/snap toggle wiring, localStorage persistence, keyboard shortcuts |
| `index.html` | Added three toolbar buttons (`btnToggleGrid`, `btnToggleRulers`, `btnToggleSnap`) |
| `tests/index.test.html` | Same three buttons added |
| `tests/test-hooks.js` | Extended `getState()` to include Track-J transient fields; added `computeGuides` export and `__test.computeGuides()` helper |
| `tests/test_full.py` | Added 24 new Track-J test cases; added `BASE_URL` env override |

---

## Deviations from Spec

- **Grid is drawn in `doRender()` instead of `drawSelectionOverlay()`**: The spec suggested extending `drawSelectionOverlay`. Since `doRender` is the only caller, and the grid must be excluded from exports (which go through `renderScene()` not `doRender()`), placing it in `doRender()` is cleaner.

- **`updateRulers()` is exported** (spec said it could be CSS overlay or drawn in `drawSelectionOverlay`): Using DOM canvases as described in spec's "CSS overlay" option.

- **Grid size UI**: A "Grid settings" popover (long-press/gear) was not implemented; `gridSize` is configurable via `state.gridSize` (default 100px) but no UI for changing it was added. This can be a follow-up.

---

## Known Issues / TODOs

- No UI for changing `gridSize` (default 100px). Could add a number input on the grid toggle button's popover.
- Rulers don't update when viewport pans (only on `scheduleRender()`). A future improvement could update rulers on pan independently.
- Compare split divider doesn't have cursor styling (e.g., `col-resize`).
- Smart guide threshold is in canvas space. At very high zoom, this becomes sub-pixel in screen space; could be clamped to a minimum screen-space threshold.
- Swipe-adjust hint overlay is appended once to `#canvasArea` and reused; if the user navigates away and back, it may show in the wrong position. Unlikely to be an issue in practice.

---

## How It Was Tested

```bash
cd /path/to/worktree
python3 -m http.server 8736 &
BASE_URL=http://localhost:8736 python3 tests/test_full.py
```

Result: **86/86 tests pass** (62 original + 24 new Track-J tests).

New test coverage:
- Grid defaults to false; toggling works; export with grid on is pixel-identical to export with grid off.
- Rulers toggle on/off.
- Snap-to-guides toggle.
- Compare toggle and split modes activate/deactivate correctly.
- `computeGuides()` returns correct alignment values (left/center/right of reference layer).
- Swipe-adjust: focusing a slider sets `swipeAdjustTarget`; horizontal pointer move updates slider value.
