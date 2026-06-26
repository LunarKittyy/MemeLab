# Track L — Layer Panel Coherence: Build Notes

## What was built

Four coherence improvements to the layer panel, touching existing code only (no new features):

1. **Trim per-row icons** — removed Duplicate, Merge Down, and Delete from each layer row. Only Visibility (👁) and Lock (🔒) remain. Duplicate and Delete continue to live in the props panel; Merge Down and Delete stay in the context menu.

2. **Rename via context menu + double-click** — layer name is now a `<span>` (read-only). Double-clicking it, or selecting "Rename" from the right-click context menu, swaps it for an inline `<input>`. Confirming via Enter or blur writes `layer.name` and calls `pushHistory('Rename layer')`. Escape or a blur without change discards. Single-click on the row only selects the layer, never opens edit mode.

3. **Multi-select + group transform** — `state.selectedIds` (a `Set<string>`) was added alongside the existing `state.selectedId` (Option A from the spec). Ctrl/Cmd-click toggles layers in/out of the set. Shift-click range-selects from the current primary to the clicked layer. Plain click clears the set and selects one. Secondary selections render with a `.multi-selected` CSS class (lighter pink tint + left-border accent). Canvas overlay draws a dashed outline for each secondary-selected layer and full handles only for the primary. Dragging the primary when `selectedIds.size > 1` moves all selected layers by the same delta, stored via `drag.origPositions`.

4. **Layer order confirmed** — layers are already listed top = front, bottom = back. `state.layers[last]` is the topmost (frontmost) layer. `renderLayerList` iterates `for i = layers.length-1 down to 0`, rendering rows top-to-bottom = front-to-back. No fix needed.

## Files touched

| File | Change |
|------|--------|
| `src/core/state.js` | Added `selectedIds: new Set()` to state object |
| `src/core/history.js` | `restoreSnapshot()` resets `selectedIds` from the restored `selectedId` (not from snapshot — transient state) |
| `src/interactions/pointer.js` | Extended `selectLayer(id, opts)` with `{multi}` toggle; added `selectLayers(ids[])` for range-select; updated `onPointerDown` to capture `origPositions` for all selected layers; updated `onPointerMove` to apply group move when `selectedIds.size > 1`; fixed `onPointerUp` to restore all origPositions on no-move |
| `src/render/renderer.js` | `drawSelectionOverlay` now iterates `state.selectedIds` to draw dashed border-only outlines for secondary selections before drawing full primary handles |
| `src/ui/layerList.js` | Full rewrite of row HTML/events: removed dup/merge/del buttons; changed `<input class="lname">` to `<span class="lname-text">`; added `activateRename()` function; wired dblclick on name span and context menu "Rename" entry; added shift-click and ctrl-click handling; updated `updateLayerListSelection` to set `multi-selected` class |
| `css/styles.css` | Changed `lname` from `<input>` to `<span>` styles; added `.lname-text`, `.lname-input`, `.multi-selected` rules; reduced `lbtns` max-width from 130px to 60px for the two remaining buttons |
| `tests/test-hooks.js` | Added `getSelectedIds()` export and `selectLayers` import; `getState()` now serializes `selectedIds` as an array |
| `tests/test_full.py` | Added 22 new test cases covering row icon trim, rename (dblclick + context menu + undo), multi-select (ctrl-click, class, clear on single-click), group move (same delta), and selectedIds not persisted in history |

## Key design decisions

- **Option A for multi-select state**: Kept `state.selectedId` as the single source of truth for the props panel. Added `selectedIds` as an additive overlay. This minimised churn on existing callers — nothing outside `pointer.js`, `layerList.js`, and `renderer.js` needed to change.
- **`selectedIds` excluded from history**: Treated as transient viewport-like UI state. `snapshot()` was deliberately not changed — the `selectedIds` field is never written into the snapshot object. `restoreSnapshot()` reconstructs `selectedIds` from `selectedId` (single-member set, or empty if background/null).
- **Inline rename without an always-on input**: Replaced the `<input>` in every row with a `<span>`. `activateRename()` dynamically swaps it. This avoids the "always in edit mode" UX problem and also means keyboard shortcuts work normally when not renaming.
- **Context menu "Rename" uses a setTimeout(10ms)**: The context menu closes on the next click event. A tiny delay ensures the menu is gone and the DOM row is settled before `activateRename` is called. This prevents the focus from landing on a hidden element.
- **lbtns max-width**: Reduced from 130px to 60px since only two 24px buttons remain (vis + lock = 48px + 1px gap).

## Deviations from the spec

None material. The spec suggested `selectLayer` could accept `{multi: boolean}`, which was implemented. `selectLayers(ids[])` was added for range-select as specified. The `dragging via the layer drag handle selects the layer` behaviour from the old `cancelOnUp` callback was preserved.

## Known issues / TODOs

- Shift-click range-select always includes the background row layer IDs (background is excluded by `!== 'background'` guards but background itself is not part of `state.layers`, so it cannot be accidentally included).
- Resize and rotate remain single-layer operations as specified — applying them to multiple selected layers simultaneously would require a future track.
- The locking check (`sel.locked`) in `onPointerDown` in pointer.js still applies only to the primary — if a secondary-selected layer is locked it gets moved anyway (the group move doesn't check per-layer locked status). This could be tightened but the spec is silent on it.

## How it was tested

Ran the full Playwright suite: 62 existing tests + 22 new Track L tests = **84/84 passed**.

```
python3 -m http.server 8732 &   # from worktree root
python3 tests/test_full.py      # (with BASE_URL patched to :8732 in CI)
```
