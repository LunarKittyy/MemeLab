# Track L — Layer Panel Coherence

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed blend modes, zoom/pan, layer masks, and a WebGL adjustment stack. This track is about cleaning up the layer panel's UI coherence — it touches existing code only, no new features, and has almost no merge-conflict risk with other tracks. Land it alongside H and I in the first round.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

---

## What you are building

1. **Multi-select + group transform** — shift/ctrl-click in the layer list to select multiple layers; drag-move them as a group on the canvas.
2. **Trim per-row icons** — remove dup/merge/delete row icons; keep only visibility (👁) and lock (🔒), which are the only two not covered elsewhere and the only two with a reason to act without disturbing the current selection.
3. **Context menu: add Rename entry** — add a "Rename" item to the existing right-click/long-press context menu. The layer name input should be click-to-select / double-click-to-rename (not always in edit mode).
4. **Layer panel order reflects edit flow** — layers listed top = front, bottom = back, matching the visual canvas stacking order (confirm this is currently the case or fix it).

---

## Files you will touch

### Primary
- `src/ui/layerList.js` — the layer panel HTML, event wiring, drag-reorder, context menu, per-row icons. This is the main file.
- `src/ui/toolbar.js` — may need small changes if layer-panel-adjacent toolbar buttons change.
- `src/ui/props/shared.js` — `actionsHtml()` / `wireActions()` already provide Duplicate and Delete in the props panel; reference these to confirm they cover what the row icons were doing.

### Supporting
- `src/core/state.js` — `state.selectedId` is currently a single string. For multi-select you will change this to a `Set<string>` (or add `state.selectedIds: Set<string>`) — read the existing usage carefully before deciding.
- `src/core/history.js` — `pushHistory()`, `restoreSnapshot()` — multi-select state should likely NOT go into history snapshots (same reasoning as viewport: it's UI state, not document state).
- `src/interactions/pointer.js` — `selectLayer(id)` and `getSelected()` are used here; you will need to extend or replace `selectLayer` for multi-select.
- `src/render/renderer.js` — `drawLayer()` and `drawSelectionOverlay()` — extend the selection overlay to show outlines on all selected layers, not just one.

---

## Real API shapes from Phase 0

### State
```js
// src/core/state.js:
state.selectedId   // currently: string | null (single selection)
state.layers       // array of layer objects, ordered bottom→front (state.layers[last] = topmost)
```

For multi-select, you have two options:
- **Option A**: Add `state.selectedIds = new Set()` alongside `state.selectedId` (keep `state.selectedId` as the "primary" for props panel rendering, `selectedIds` as the full set). This is safer — less churn on existing callers.
- **Option B**: Replace `state.selectedId` with a `Set`. More invasive.

Choose Option A — it's lower risk. `state.selectedId` continues to drive the props panel. `state.selectedIds` is the multi-select set; when it has exactly one item, `selectedId` equals that item.

### pointer.js exports
```js
export function selectLayer(id)         // currently sets state.selectedId
export function onSelectionChange(fn)   // listeners called when selection changes
export function pointInLayerBounds(layer, px, py)
export function applyZoom(factor, originX, originY)
export function stageEventsInit()
```

Extend `selectLayer` to accept an optional `{ multi: boolean }` option: if `multi` is true and the layer is already in `selectedIds`, deselect it; otherwise add it while keeping others. Add a new `selectLayers(ids: string[])` export for bulk selection.

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function resizeStageBuffer()
```

The internal `drawSelectionOverlay(ctx)` is not exported — edit it directly in `renderer.js` to draw outlines on all layers in `state.selectedIds` (not just `state.selectedId`).

### shared.js actions (confirm row icons are redundant with these)
```js
export function actionsHtml()
// Renders: <button id="pDup">Duplicate</button> <button id="pDel">Delete</button>

export function wireActions(layer)
// Wires pDup and pDel to duplicateLayer/deleteLayer from layerList.js
```

The props panel already exposes Duplicate and Delete for the selected layer. The row icons for dup/del are therefore redundant — remove them from the layer row.

---

## Implementation steps

### 1. Trim per-row icons

In `layerList.js`, each layer row currently has per-row icon buttons (visibility toggle, lock toggle, duplicate, merge-down, delete — or similar). Keep **only** visibility and lock. Remove dup, merge-down, and delete from the row entirely.

- Duplicate stays in the props panel (`actionsHtml()` / `wireActions()`).
- Delete stays in the props panel AND in the context menu.
- Merge-down stays in the context menu only.

Make sure visibility and lock icons are visually distinguishable without relying on position alone (e.g. eye icon vs. padlock icon, not two near-identical toggle icons side by side).

### 2. Rename via context menu + double-click

Current behavior: the layer name input may always be in edit mode. Change to:
- **Single click on a layer row**: selects the layer (no edit).
- **Double-click on the layer name text**: activates an inline text input for rename.
- **Context menu "Rename" item**: same as double-click — focuses the inline rename input.

On rename confirm (Enter or blur), update `layer.name` and call `pushHistory('Rename layer')`.

Add "Rename" to the existing context menu in `layerList.js`. The context menu likely already has Delete, Duplicate, Merge Down — add Rename above those.

### 3. Multi-select: data model

Add to `src/core/state.js`:
```js
export const state = {
  // ... existing fields ...
  selectedId: null,     // string | null — primary selection (drives props panel)
  selectedIds: new Set(), // Set<string> — full multi-select set
};
```

Update `restoreSnapshot()` in `history.js` — it currently restores `state.selectedId`. Multi-select state should NOT be in snapshots (it's transient UI state). After restore, clear `state.selectedIds` and set `state.selectedId` from the snapshot.

Update `snapshot()` in `history.js` — do NOT include `selectedIds` in the snapshot object (same reasoning as viewport).

### 4. Multi-select: layer list interaction

In `layerList.js`:
- **Shift-click** on a layer row: range-select from the current `selectedId` to the clicked layer.
- **Ctrl/Cmd-click** on a layer row: toggle the clicked layer in `selectedIds` without deselecting others.
- **Plain click**: clear `selectedIds`, select only the clicked layer.

Highlight all rows in `selectedIds` with a secondary selection style (e.g. a lighter tint vs. the primary selection's full highlight).

### 5. Multi-select: canvas interaction

In `pointer.js`:
- When dragging a layer that is part of a multi-select (`state.selectedIds.size > 1`), move ALL layers in `selectedIds` by the same delta.
- Resize and rotate remain single-layer operations (apply only to the primary `selectedId`).
- Clicking an empty area deselects all (clear `selectedIds`, set `selectedId = null`).

### 6. Multi-select: selection overlay

In `renderer.js`, `drawSelectionOverlay(ctx)`:
- Draw the full selection handles (corners, rotation handle) only for `state.selectedId` (the primary).
- Draw a simpler outline (just the border rect, no handles) for all other layers in `state.selectedIds`.

### 7. Group transform: move

When dragging the primary selected layer and `state.selectedIds.size > 1`:
```js
// In onPointerMove, drag.kind === 'move':
const dx = p.x - drag.startX, dy = p.y - drag.startY;
for (const id of state.selectedIds) {
  const l = getLayerById(id);
  if (l) { l.x = drag.origPositions[id].x + dx; l.y = drag.origPositions[id].y + dy; }
}
```

Store `drag.origPositions` (a map of `id → { x, y }`) when the drag starts.

---

## Migration

Multi-select state (`selectedIds`) is NOT persisted — it's always cleared on load. No migration work needed.

For any new fields on layers (none in this track), the pattern would be: add defaults in `applyLoadedSnapshot()` in `autosave.js` AND defensive access at every read site.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Clicking two layer rows with Ctrl held results in both being in `selectedIds`.
- Moving one of the multi-selected layers moves all of them by the same delta.
- Single-click clears multi-select.
- Layer row no longer shows dup/delete icons (check DOM).
- Double-click on layer name activates inline rename.
- Context menu "Rename" item exists.
- Undo after rename reverts the name.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- `state.selectedIds` must NOT appear in history snapshots — multi-select is transient UI state.
- Defensive access everywhere: `layer.blendMode || 'normal'`, `layer.mask?.enabled`, `layer.adjustments || []`.
- The props panel continues to work for single-selection via `state.selectedId`; when multiple layers are selected, the props panel shows the primary selection only.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-l.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
