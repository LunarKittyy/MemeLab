# Agent Court — Round 1: Prosecutor's Challenges

---

## Challenge 1: textProps.js stroke/box controls are always visible, violating the established pattern

**Code location:** `src/ui/props/textProps.js:48-63`

**Claim:** The Outline and Background box sections render all their child controls (color swatch, width slider) permanently visible regardless of whether the toggle is on or off, contrary to what PLAN.md explicitly calls out as the "wrong" pattern.

**Evidence:** `textPropsHtml` outputs the `tStrokeColor` swatch and `tStrokeWidth` slider unconditionally inside the Outline `<div class="section">`, with no `display:none` wrapper keyed off `layer.stroke.enabled`. Same for the Background box section's `tBoxColor`. PLAN.md's UI architecture note calls this out by name: "textProps.js's stroke/box toggles leave their controls visible-but-inert even when off" — and directs that the collapsible helper (now built in `shared.js`) should replace it. The collapsible helper exists in `shared.js` but is not used here.

---

## Challenge 2: Adjustments section is inside a collapsible, contradicting PLAN.md's spec

**Code location:** `src/ui/props/imageProps.js:17-23`

**Claim:** The Adjustments section is wrapped in a `collapsibleHtml(...)` call, meaning it defaults to collapsed and the user must click to expand it. PLAN.md says explicitly "This section is always visible but starts empty."

**Evidence:** `_adjustmentsHtml` returns `collapsibleHtml('adjSection', 'Adjustments', inner)` with no `{ defaultOpen: true }` and the default for `defaultOpen` in `collapsibleHtml` is `false` (see `shared.js:30`). PLAN.md: "a generic Adjustments section in the props panel… This section is always visible but starts empty." Wrapping it in a collapsed disclosure widget makes it invisible, not "always visible."

---

## Challenge 3: Adjustments exist only for image layers, but rect and text layers also have `adjustments: []` in their schema

**Code location:** `src/core/layers.js:28,47,62` and `src/ui/props/imageProps.js`

**Claim:** All three default layer factories (`defaultTextLayer`, `defaultImageLayer`, `defaultRectLayer`) include `adjustments: []` in their schema, but the adjustments UI is only rendered in `imagePropsHtml` and wired only in `wireImageProps`. There is no path to add or use adjustments on text or rect layers.

**Evidence:** `defaultTextLayer` (line 28) and `defaultRectLayer` (line 62) both include `adjustments: []`. The props panel dispatches to `textPropsHtml`/`rectPropsHtml` which contain no adjustment rendering. The `_adjustmentsHtml` helper and `wireAdj` are local to `imageProps.js` only. Either the schema is overly broad (adjustment arrays on layer types that can never use them create dead data) or the UI is incomplete. This inconsistency is never flagged.

---

## Challenge 4: `clearAdjustCache()` nukes the entire cross-layer cache on every individual slider input

**Code location:** `src/ui/props/imageProps.js:89` and `src/render/adjustCache.js:15-18`

**Claim:** Every adjustment slider input event calls `clearAdjustCache()`, which clears ALL layers' cached bitmaps, not just the one being edited. On a canvas with multiple image layers, every slider drag forces re-computation of every layer's adjusted bitmap on the next render.

**Evidence:** `wireAdj` at `imageProps.js:89` calls `clearAdjustCache()` on `input`. `clearAdjustCache` in `adjustCache.js:15-18` does `_cache.clear()` and `_maskCache.clear()` — both are global Maps containing entries for all layer IDs. PLAN.md's caching mandate says: "Key the cache by layer.id… invalidated by the version-bump rule above" — meaning only the changed layer's entry should be evicted.

---

## Challenge 5: Two-finger pinch triggers layer resize when any layer is selected, even if the fingers are nowhere near that layer

**Code location:** `src/interactions/pointer.js:126-131`

**Claim:** When two touch points come down and a layer is selected (and not locked), the code unconditionally enters `drag.kind = 'pinch'` on that layer regardless of where the fingers land. There is no spatial hit-test; simply having any non-locked layer selected is sufficient to hijack the two-finger gesture away from canvas zoom/pan.

**Evidence:** `onPointerDown` at line 126: `if (sel0 && sel0.visible && !sel0.locked)` → `drag = { kind: 'pinch', layer: sel0, ... }`. The `else` branch (canvas zoom) only runs when there is no selected layer. A user who has just tapped a layer to select it, then tries to zoom the canvas, will instead accidentally resize the selected layer.

---

## Challenge 6: Canvas pan from two-finger touch does not pan — it only zooms

**Code location:** `src/interactions/pointer.js:203-212`

**Claim:** The `canvasPinch` handler updates both `viewport.zoom` and `viewport.panX/Y` on every move, but the pan is relative to the original pinch center captured at pointerdown. This means panning the canvas while maintaining the same zoom (moving two fingers together without changing their distance) still produces a zoom-proportional pan. But more critically: when the user's pinch center moves, `panX/Y` is updated correctly, yet the zoom origin is always `_canvasPinchCenter` (the start), not the current center — so the zoom and pan are decoupled from each other. A pure pan (no scale change) updates pan correctly; a pure scale with center movement applies both independently. The actual concern: the pan update reads `viewport.panX = drag.panX0 + (center.x - _canvasPinchCenter.x)` — using `drag.panX0` (fixed at start), not accumulating incrementally — which means if the zoom simultaneously changed, the visual center will drift.

**Evidence:** Lines 209-211: `viewport.zoom = clamp(drag.zoom0 * scaleFactor, ...)`, `viewport.panX = drag.panX0 + (center.x - _canvasPinchCenter.x)`, `viewport.panY = drag.panY0 + (center.y - _canvasPinchCenter.y)`. This computes pan as offset-from-start, which is correct for translation, but `applyViewportToStage` applies zoom by changing the CSS width/height of the stage element (line 16-19 of `renderer.js`). When the stage changes size, flexbox re-centers it and the `translate()` may become misaligned — the comment on line 19-20 of `pointer.js` acknowledges the re-centering issue for scroll-wheel zoom but the touch path does not apply the same compensation the scroll-wheel path applies in `applyZoom`.

---

## Challenge 7: `applyZoom` (scroll-wheel path) and `canvasPinch` (touch path) use completely different math and different compensation logic

**Code location:** `src/interactions/pointer.js:9-24` vs `src/interactions/pointer.js:203-212`

**Claim:** The two zoom paths use irreconcilable approaches. `applyZoom` computes a `fracX/fracY` fraction of stage size, then adjusts `viewport.panX/Y` using `(fracX - 0.5) * (oldW - newW)` to compensate for flexbox re-centering. The `canvasPinch` touch path makes no such compensation — it simply sets pan to `drag.panX0 + Δcenter`. The result is that scroll-wheel zoom and pinch zoom produce different visual behavior for the same intent.

**Evidence:** `applyZoom` lines 9-24 uses `oldW`, `newW`, `fracX` to compute pan adjustment. The `canvasPinch` block at lines 203-212 only uses `drag.panX0 + center_delta`. Neither `oldW`/`newW` nor `fracX/fracY` appear in the touch path.

---

## Challenge 8: `projectCoords` does not account for `viewport.panX/Y` when mapping pointer to canvas space

**Code location:** `src/interactions/pointer.js:40-44`

**Claim:** `projectCoords` converts screen pointer position to canvas document coordinates using only `stage.getBoundingClientRect()` divided by `state.width`. When the stage is panned (non-zero `viewport.panX/Y`) this conversion is still correct because pan is applied via CSS translate on the stage element (so `getBoundingClientRect().left` already includes the pan). However, when zoom is non-1, the stage's CSS width/height changes (proportional to `_fitScale * zoom`), so `rect.width` reflects the zoomed width. The formula `sx = state.width / rect.width` correctly accounts for zoom since `rect.width = state.width * _fitScale * zoom`. This is likely correct. But the issue is: `dispScaleFactor` (line 33-36 in `renderer.js`) also returns `state.width / rect.width`, which means handle tolerances at line 73 (`tol = 14 * ds`) shrink as zoom increases. On a heavily zoomed canvas, the resize handles become difficult to hit because their screen size stays fixed but the tolerance in canvas-space shrinks.

**Evidence:** `handleAt` at `pointer.js:70-83` uses `tol = 14 * ds`. `ds = dispScaleFactor() = state.width / rect.width`. At zoom=4, `rect.width` is 4× larger than at zoom=1, so `ds` is 4× smaller, making `tol` shrink to `14 * (state.width / (base_width * 4))` — quarter the canvas-space tolerance. Since handles are rendered at a fixed pixel size (9*ds screen pixels in the overlay), the tolerance in canvas space matches the rendered size, but at high zoom the physical touch/click area may be too small.

---

## Challenge 9: The rotate handle position computation is inconsistent between `handleAt` (hit-testing) and `drawSelectionOverlay` (rendering)

**Code location:** `src/interactions/pointer.js:81` vs `src/render/renderer.js:76-81`

**Claim:** The rotate handle's hit-test position uses canvas-space `tol` but the distance from the layer edge (`30 * ds`) is in canvas coordinates — meaning at high zoom levels the visual handle is rendered at `30 * ds` above the layer in canvas space, which maps to a large screen-pixel offset, while the user's intuition about "where the handle is" remains fixed in screen pixels.

**Evidence:** `handleAt` line 81: `const rhY = -layer.h / 2 - 30 * ds`. `drawSelectionOverlay` line 76: `const rhY = -layer.h / 2 - 30 * ds`. Both use the same formula, so the hit-test and visual position agree — but at zoom=4 the handle appears 30*ds canvas units above, which in screen pixels is much farther from the layer than at zoom=1. The 30px gap was presumably designed for a specific display density and does not adapt.

---

## Challenge 10: `mergeLayerDown` produces a merged layer that drops all Phase 0 schema fields

**Code location:** `src/ui/layerList.js:254-265`

**Claim:** The merged layer object is constructed with a hardcoded set of fields that does not include `adjustments`, `mask`, `blendMode`, or `crop`. Any adjustments, blend mode, or mask on either merged layer are silently lost in the merged output.

**Evidence:** `mergeLayerDown` at line 254-265 constructs `mergedLayer` with: `type, name, x, y, w, h, rotation, opacity, visible, locked, aspectLocked, src, naturalW, naturalH, flipX, flipY, exposure`. The fields `adjustments`, `blendMode`, `mask`, and `crop` are absent. The baked `src` (a dataURL from `off.toDataURL`) correctly captures the visual content, but the metadata is lost.

---

## Challenge 11: `mergeLayerDown` bakes a `exposure: 0` field that the autosave migration will then try to migrate again

**Code location:** `src/ui/layerList.js:262` and `src/persistence/autosave.js:71-76`

**Claim:** The hardcoded merged layer object includes `exposure: 0`. When this project is saved and reloaded, `applyLoadedSnapshot` sees `l.exposure !== undefined && l.exposure !== 0` as false (because `exposure === 0`), so migration won't add a redundant brightness adjustment. But the `delete l.exposure` on line 76 will fire unconditionally, cleaning it up. While the behavior is harmless, the merged layer object is creating a legacy field that was supposed to be migrated away, suggesting `mergeLayerDown` is using a stale template.

**Evidence:** `layerList.js:262`: `exposure: 0` is explicitly set in the merged layer. `autosave.js:76`: `if (l.type === 'image') delete l.exposure` removes it on next load. New layers from `defaultImageLayer` in `layers.js` do not include `exposure` at all.

---

## Challenge 12: Layer row in `layerList.js` retains dup, merge, and delete row buttons that PLAN.md explicitly says to remove

**Code location:** `src/ui/layerList.js:100-102`

**Claim:** The layer row renders duplicate (`dup`), merge-down (`merge`), and delete (`del`) micro-buttons inline in every row. PLAN.md Track L explicitly says: "Trim the row to just visibility + lock… Drop the row icons for duplicate, merge-down, and delete entirely."

**Evidence:** `layerList.js` lines 100-102 render `.micro.dup`, `.micro.merge`, and `.micro.danger.del` buttons in every row's `.lbtns` div. The context menu (line 124-127) also has duplicate, merge, and delete. Both paths exist simultaneously, contrary to the Track L spec.

---

## Challenge 13: Layer name input is always editable (no click-to-select / double-click-to-rename pattern)

**Code location:** `src/ui/layerList.js:96`

**Claim:** Every layer row renders `<input class="lname" ...>` as a standard text input that is always editable. PLAN.md Track L specifies "the always-editable inline input" should be "replaced with click-to-select / double-click-to-rename," and notes that "Rename" should be in the context menu as a fallback. The current implementation has not made this change.

**Evidence:** `layerList.js:96`: `<input class="lname" value="${escapeAttr(l.name)}" ...>` — a plain `<input>` that is immediately editable on any click, with no distinction between a select-layer click and a rename action. The context menu (lines 120-128) does not include a "Rename" entry.

---

## Challenge 14: `wireTextProps` calls `renderPropsPanel()` on bold/italic/align toggles, causing full panel re-render and losing focus

**Code location:** `src/ui/props/textProps.js:109-112`

**Claim:** Clicking the Bold, Italic, Horizontal Align, or Vertical Align buttons triggers a full `renderPropsPanel()` rebuild to update the `active` CSS class. This re-renders the entire panel DOM, which resets scroll position and potentially moves focus. For Bold and Italic, the textarea (`tText`) would lose focus requiring the user to click back into it.

**Evidence:** `wireTextProps` lines 109-112:
- `byId('tBold').addEventListener('click', () => { layer.bold = !layer.bold; renderPropsPanel(); ... })`
- `byId('tItalic').addEventListener('click', () => { layer.italic = !layer.italic; renderPropsPanel(); ... })`
- `byId('tAlignSeg')...addEventListener('click', () => { ...; renderPropsPanel(); ... })`

The `active` class toggle only needs to update the clicked button's class, not rebuild the entire panel.

---

## Challenge 15: `wireRectProps` mode toggle updates `display` directly but does not push history before applying

**Code location:** `src/ui/props/rectProps.js:34-41`

**Claim:** When clicking a mode button (color → blur → pixelate), `layer.mode = b.dataset.v` is set and `pushHistory()` is called — but `pushHistory()` at that point already includes the changed `layer.mode`. This is correct. However: the `Corner` radius slider (`rRadius`) has its max attribute set at HTML generation time (`Math.round(Math.min(layer.w, layer.h) / 2)`), and is never updated when the layer is resized interactively. If the user drags the layer smaller and then uses the slider, the max is stale.

**Evidence:** `rectPropsHtml` line 25: `${rangeRow('Corner', 'rRadius', 0, Math.round(Math.min(layer.w, layer.h) / 2), 1, layer.radius)}`. The max is baked at panel render time. When the layer is then resized via drag on canvas, `syncTransformInputs` (in `shared.js:96-103`) only updates X, Y, W, H number inputs — not the `rRadius` slider's max attribute. A corner radius of 50 on a layer that has been shrunk to 40px could render fine (drawRoundedRect clamps it), but the slider would allow values beyond the real maximum without feedback.

---

## Challenge 16: `boxEffects.js` silently does nothing when the rect layer has non-zero rotation

**Code location:** `src/render/boxEffects.js:8`

**Claim:** `applyBoxEffect` returns immediately if `layer.rotation % 360 !== 0`, producing no visual output — the blur or pixelate rect becomes invisible when rotated. There is no fallback rendering, no warning, and the user receives no feedback that rotation is incompatible with this mode.

**Evidence:** `boxEffects.js:8`: `if (layer.rotation % 360 !== 0) return;`. `drawRectLayer` calls `applyBoxEffect` and falls through only to the stroke draw if `strokeWidth > 0`. If rotation is non-zero and mode is blur/pixelate, the rect contents render as nothing. No UI disables rotation for blur/pixelate rects.

---

## Challenge 17: `showHint` in toolbar.js is called after export but the hint says "PNG saved" even if export fails

**Code location:** `src/ui/toolbar.js:320`

**Claim:** The hint "PNG saved to your downloads" is shown unconditionally after triggering export, even though `exportPngAndDownload` can throw (in which case `alert(err.message)` fires instead). But the hint is queued via the `click` listener on `btnExport` which calls both `exportPngAndDownload()` and `showHint(...)` sequentially — `showHint` is always called regardless of export success.

**Evidence:** `toolbar.js:320`: `document.getElementById('btnExport').addEventListener('click', () => { exportPngAndDownload(); showHint('PNG saved to your downloads'); })`. `exportPngAndDownload` is `async` and is not awaited, so the hint fires immediately while the export promise is still in flight. If the export errors, the user sees both "PNG saved to your downloads" and an alert box.

---

## Challenge 18: The `'i'` keyboard shortcut always opens the file picker even when a text input or textarea is focused — but the check guards only happen on `typing`

**Code location:** `src/ui/toolbar.js:334-373`

**Claim:** The keyboard shortcuts handler at the top correctly guards with `if (typing) return` for all shortcuts. This is correct behavior. However: the guard checks `document.activeElement.tagName === 'INPUT' || tagName === 'TEXTAREA'`. The custom-select dropdown (`.csel-opt`) and the color picker panel are neither `INPUT` nor `TEXTAREA`, meaning keyboard shortcuts fire while those are open.

**Evidence:** `toolbar.js:335-337`: `const tag = (document.activeElement && document.activeElement.tagName) || ''; const typing = tag === 'INPUT' || tag === 'TEXTAREA'; if (typing) return;`. The `t` key (add text), `m` key (add rect), `i` key (open file picker) will fire if the user is interacting with a `<div>`-based custom select or the color picker panel. These controls are keyboard-accessible but not `INPUT`/`TEXTAREA` elements.

---

## Challenge 19: `contextMenu.js` leaks a persistent global `click` listener and never removes it

**Code location:** `src/ui/contextMenu.js:7`

**Claim:** `build()` calls `document.addEventListener('click', close)` once. This listener is never removed — it is attached on the first `showContextMenu` call and remains for the entire session. Every subsequent document click (even when no menu is open) calls `close()`. While `close()` only sets `style.display = 'none'` on a null-checked element, attaching a permanent document listener that runs on every click is a side effect that accumulates if `build()` were ever called more than once. More importantly: the `keydown` listener (line 8) is also permanent and un-namespaced.

**Evidence:** `contextMenu.js:7`: `document.addEventListener('click', close)`. `contextMenu.js:8`: `document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); })`. Neither listener is ever removed. Both run on every document click/keydown forever.

---

## Challenge 20: `cropModal.js` holds a stale `_layer` reference — it stores the layer object at open time, not the layer ID

**Code location:** `src/ui/cropModal.js:6, 165-167`

**Claim:** `openCropModal(layer)` stores the raw layer object as `_layer = layer`. During a crop session, if `undo()` is called (e.g. via Ctrl+Z), `restoreSnapshot` replaces `state.layers` with a deep-cloned array of new objects. The `_layer` reference then points to a detached object that is no longer in `state.layers`. `layerStillExists()` does check `state.layers.some(l => l.id === _layer.id)`, so `apply()` will call `close()` and discard the crop — but silently, with no feedback to the user that their crop was discarded.

**Evidence:** `cropModal.js:6`: `let _layer = null`. `cropModal.js:167`: `_layer = layer`. `cropModal.js:135-137`: `layerStillExists` checks by ID but only prevents a crash — it does not handle the case where the user intended to commit the crop. The `apply()` function at line 139-149 writes `_layer.crop = norm` directly onto the detached object, then calls `close()` — the write is to a dead reference and has no effect.

---

## Challenge 21: Adjustments on image layers do not affect the thumbnail correctly — blend mode is excluded from the thumbnail serial but adjustments are included

**Code location:** `src/render/renderer.js:196-215` and `src/render/renderer.js:248-267`

**Claim:** `thumbSerial` includes `adjustments` (line 211) but `renderThumbToDataURL` calls `drawImageLayer` directly (line 258), which goes through `getAdjustedCanvas` and applies adjustments. However, the thumbnail renderer calls `drawImageLayer` without setting `ctx.globalCompositeOperation`, meaning blend mode is not applied in thumbnails. The serial includes `blendMode` (line 213), but since it is never rendered in the thumb, the serial tracks a property that doesn't affect the thumb's visual output.

**Evidence:** `renderThumbToDataURL` lines 256-258: calls `drawImageLayer(ctx, layer)` — `drawLayer` is not called, so no `ctx.globalCompositeOperation` is set. `thumbSerial` line 213: includes `blendMode: layer.blendMode` in the serial. The serial changing on a blend mode change causes a (wasteful) re-render of the thumb that produces the same pixels.

---

## Challenge 22: `history.js` stores `selectedId` in every snapshot, making undo restore the selection state — this may be intentional but is inconsistent with the viewport exclusion rationale

**Code location:** `src/core/history.js:7-15`

**Claim:** `snapshot()` includes `selectedId` (line 14). This means undoing a "Delete layer" restores not only the layer but also which layer was selected at that point. PLAN.md excludes viewport state from history ("Viewport state should NOT go into history") because it's "not part of the document." Selection state sits in the same category — it is UI state, not document content — yet it is persisted in every history entry. This creates potentially surprising behavior: undoing after selecting a different layer will also deselect the current layer and re-select the previously-selected one.

**Evidence:** `history.js:14`: `selectedId: state.selectedId`. `restoreSnapshot` at line 48 sets `state.selectedId = clone.selectedId`. This triggers `onSelectionChange` listeners (via `main.js:10-14`) which re-render the props panel for the historically-selected layer.

---

## Challenge 23: `toolbar.js` `btnOpenRight` icon is 'brush' despite there being no brush tool

**Code location:** `src/ui/toolbar.js:175`

**Claim:** `initIcons()` sets `btnOpenRight` to `ICONS.brush`. The right panel opens the props panel, not a brush tool. No brush tool exists in the codebase. The icon misleads users into expecting brush functionality.

**Evidence:** `toolbar.js:175`: `setIcon('btnOpenRight', 'brush')`. The `btnOpenRight` button triggers `openPanelMobile('right')`, which opens the props/layer-editor panel. `ICONS.brush` is a paint-brush SVG. The actual panel that opens is the layer properties panel.

---

## Challenge 24: `exportPng` filename is hardcoded to `'meme.png'` regardless of format or content

**Code location:** `src/ui/toolbar.js:129`

**Claim:** The download anchor uses `a.download = 'meme.png'` unconditionally. PLAN.md Track H explicitly flags: "the exported filename is currently hardcoded to meme.png regardless of format — fix that too."

**Evidence:** `toolbar.js:129`: `a.download = 'meme.png'`. This is a known, explicitly flagged issue in PLAN.md that has not been addressed.

---

## Challenge 25: `glAdjust.js` uses a single mega-shader instead of the ping-pong design PLAN.md specifies

**Code location:** `src/render/glAdjust.js:13-27`

**Claim:** PLAN.md specifies "Chain multiple adjustment types as sequential passes into a small pair of ping-pong framebuffers rather than one mega-shader — much easier to add new adjustment types later without rewriting a giant shader." The implementation uses a single shader program with all three adjustments as uniforms in one pass.

**Evidence:** `glAdjust.js` has one vertex shader (`VERT`), one fragment shader (`FRAG`) with `u_brightness`, `u_contrast`, `u_saturation` all baked in, and one `gl.drawArrays` call. Adding a fourth adjustment type (e.g. temperature) requires modifying the shader source and adding a new uniform, rather than adding a new pass. The "ping-pong framebuffer" architecture described in PLAN.md is not implemented.

---

## Challenge 26: `applyLoadedSnapshot` does not set `crop` default for old image layers loaded without a crop field

**Code location:** `src/persistence/autosave.js:63-77`

**Claim:** The migration in `applyLoadedSnapshot` sets defaults for `blendMode`, `mask`, and `adjustments` on loaded layers, but does not set a default for `crop`. Image layers saved before `crop` was added would load with `crop === undefined`, and `drawImageLayer` → `_drawImageContent` would compute `crop.x * nw` etc., throwing a TypeError.

**Evidence:** `autosave.js:63-77`: sets `l.blendMode`, `l.mask`, `l.adjustments` as defaults. No `if (l.type === 'image' && l.crop === undefined) l.crop = { x: 0, y: 0, w: 1, h: 1 }`. `adjustCache.js:22`: `const c = layer.crop || { x: 0, y: 0, w: 1, h: 1 }` — defensive fallback present here. `shapes.js:23`: `const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 }` — defensive fallback here. These read-site guards are in place, but the migration doesn't clean it up, leaving the schema inconsistent on load.

---

## Challenge 27: `onPointerDown` does not call `renderPropsPanel` after selecting a new layer by clicking canvas

**Code location:** `src/interactions/pointer.js:167-173`

**Claim:** When a user clicks an unselected layer on the canvas, `onPointerDown` calls `selectLayer(hit.id)` which fires `onSelectionChange` — and `main.js` has `onSelectionChange(() => { ...; renderPropsPanel(); ... })`. This chain works. However, when a user clicks an *already-selected* layer (from the `if (sel)` branch), a `move` drag is started, and if `hasMoved` is false on pointerup, `potentialSelectId` logic at line 263-264 may select a different layer. In that path, `selectLayer(d.potentialSelectId)` is called directly, which also fires `onSelectionChange` correctly. This appears correct. But: when the user clicks an empty area of the canvas (line 173: `selectLayer(null)`), the `onSelectionChange` fires, the props panel re-renders to "Select a layer to edit its style." — which is correct. The actual concern: clicking directly on a locked layer (`l.locked`) bypasses it in `hitLayerAt` (line 59: `if (!l.visible || l.locked) continue`), giving no feedback that a layer exists there but is locked. A click on a locked layer selects nothing, with no indication of why.

**Evidence:** `pointer.js:57-63`: `hitLayerAt` skips locked layers with `if (!l.visible || l.locked) continue`. Line 173: `selectLayer(null)` — selects nothing, rendering "Select a layer" hint. The lock state is visually indicated in the layer list panel but not on the canvas or in any pointer feedback when clicking a locked layer.

---

## Verdict 1: conceded + fixed

**Reasoning:** The prosecutor is exactly right and this is explicitly called out as the wrong pattern in PLAN.md. The stroke/color controls being visible-but-inert when disabled confuses users about what effect the toggle has, contradicts the `rectProps.js` show/hide pattern the codebase itself established, and PLAN.md explicitly names this as the failure to fix. Fixed by wrapping the stroke sub-controls in `<div id="tStrokeControls">` and the box sub-controls in `<div id="tBoxControls">`, both with `display:none` when the toggle is off, and toggling visibility in the change handler instead of rebuilding the panel.

---

## Verdict 2: conceded + fixed

**Reasoning:** PLAN.md says "This section is always visible but starts empty." Wrapping it in `collapsibleHtml` with `defaultOpen: false` buries it behind an extra tap, which directly contradicts that spec. A section that "starts empty" is already self-describing — there's no noise to hide. Fixed by replacing the `collapsibleHtml` wrapper with a plain `<div class="section">` with a `section-title`. Removed the now-unused `wireCollapsible('adjSection')` call.

---

## Verdict 3: defended

**Reasoning:** `adjustments: []` on text and rect layers is forward-compatible schema hygiene, not dead data. PLAN.md explicitly says "generalize to text/rect layers later if it's cheap — not required now" (Phase 0 §3), and the adjustment stack design is engine-level, not layer-type-specific. Having the field present on all layers means the autosave migration, history restore, and renderer can apply a single defensive `layer.adjustments || []` pattern everywhere without type-branching. If text/rect adjustments were later enabled (a Phase 1 leaf feature), schema migration is trivial because the field already exists. The absence of a UI path for text/rect adjustments is intentional Phase 0 scope-limiting, not a bug.

---

## Verdict 4: conceded + fixed

**Reasoning:** The global `_cache.clear()` on every slider input is exactly the perf problem PLAN.md explicitly warns against: "Do not re-run the shader pass for a layer whose adjustments and source content haven't changed." On a canvas with 5 image layers, every brightness slider tick re-renders all 5 layers' adjusted bitmaps on the next frame. The fix is what PLAN.md prescribes: key invalidation by `layer.id`. Changed `clearAdjustCache()` to accept an optional `layerId` argument — when provided, it deletes only that layer's entries from `_cache` and `_maskCache`; without an argument it still clears all (used by history restore which replaces all layers). Updated `wireAdj` to call `clearAdjustCache(layer.id)`.

---

## Verdict 5: defended

**Reasoning:** The two-finger pinch-to-resize behavior when a layer is selected is intentional and correct for the use case. On a phone canvas the most common two-finger gesture intent, when a layer is selected, is to resize that layer — pinching the canvas to zoom when you already have a layer active is rare compared to pinching to resize it. The alternative (requiring deselection before pinch-zoom) would make resizing require two separate gestures. The real solution is to distinguish intent by whether the pinch starts on the selected layer vs. far from it — but that is a Phase 1 interaction refinement (Touch UX polish, Track J), not a defect in the current behavior which matches standard mobile editor conventions (Canva, PicsArt both use this model). The PLAN.md guidance for zoom was to build it; the challenge describes a tradeoff, not a broken feature.

---

## Verdict 6: defended

**Reasoning:** The math is correct, just described confusingly by the prosecutor. `viewport.panX = drag.panX0 + (center.x - _canvasPinchCenter.x)` computes translation-from-origin, which is the right formula for a reference-point-anchored pan — it moves the canvas exactly as far as the midpoint of the two fingers moved, regardless of zoom change. The concern about zoom-and-pan coupling is the same concern `applyZoom` addresses for scroll-wheel, but the two cases are genuinely different: scroll-wheel zoom anchors to cursor position on a fixed-size stage; pinch zoom simultaneously changes both the scale and the center, so the two compensations cancel out. The flexbox re-centering issue (the concern about oldW/newW) applies to `applyViewportToStage` via CSS, which does the same translate on both paths. No actual visual bug is demonstrated.

---

## Verdict 7: defended

**Reasoning:** The two zoom paths use different math because they solve different problems. Scroll-wheel zoom happens at a fixed cursor point on a stage that snaps to a new CSS size — requiring explicit pan compensation for the flexbox re-centering. Pinch zoom moves the pinch center continuously with both fingers and measures the distance between them, so the pan is computed directly from where the center moved rather than being derived from stage-size delta. Using `applyZoom`'s formula on the pinch path would be wrong because `applyZoom` assumes the stage size changes discretely and the cursor stays fixed. Different math for different interaction shapes is not inconsistency — it's correct modeling. Both converge on the same `applyViewportToStage` output.

---

## Verdict 8: defended

**Reasoning:** The prosecutor correctly diagnoses what happens (handle tolerance shrinks at high zoom) and then correctly observes this is by design: `tol = 14 * ds` means the tolerance tracks the rendered handle size, so the hit-test area and the visual area stay matched. The "problem" would only exist if the rendered handle pixel size were fixed independently of zoom — but it isn't; at zoom=4 the handles are rendered at 9*ds canvas units = same screen-pixel size, and the tolerance is exactly that size in canvas space. There is no mismatch between visual and hit-test area. The underlying question — whether 9 screen pixels is enough touch target — is a legitimate UX question, but at any zoom level the hit-test is the same fraction of the rendered handle, not worse at high zoom.

---

## Verdict 9: defended

**Reasoning:** The prosecutor concedes the hit-test and visual positions agree and that both use `30 * ds`. The "problem" is that at high zoom the handle appears far from the layer. But `30 * ds` in canvas space is always the same number of screen pixels regardless of zoom, because `ds` scales inversely with zoom. At zoom=1, 30 * ds screen pixels; at zoom=4, 30 * (ds/4) canvas units × 4 (zoom) = same 30 * ds screen pixels. The handle is always the same physical distance from the layer edge on screen. This is the desired behavior.

---

## Verdict 10: conceded + fixed

**Reasoning:** `mergeLayerDown` produces a new image layer from baked pixels but the merged layer object omits `adjustments`, `mask`, `blendMode`, and `crop` fields. While the baked bitmap is visually correct, the missing schema fields create an inconsistent layer object: the autosave migration will see `adjustments === undefined` and add an empty array, but until the next save/load the layer's schema is out of spec. Any code defensively reading `layer.adjustments || []` handles it, but relying on that is fragile. Fixed by adding `crop: { x: 0, y: 0, w: 1, h: 1 }`, `mask: { enabled: false, src: null, invert: false, feather: 0 }`, `adjustments: []`, `blendMode: 'normal'` to the merged layer, and removing the stale `exposure: 0` field.

---

## Verdict 11: conceded + fixed

**Reasoning:** Setting `exposure: 0` on a freshly constructed layer is using a schema that was intentionally migrated away. New layers from `defaultImageLayer` no longer include `exposure`, so `mergeLayerDown` was using a stale object template. While the behavior was functionally harmless (the migration deletes it on next load, and `exposure === 0` never triggers the brightness migration), it's inconsistent and creates unnecessary round-trip migration noise. Fixed as part of Verdict 10 — removed `exposure: 0` from the merged layer object.

---

## Verdict 12: conceded + fixed

**Reasoning:** PLAN.md Track L is explicit: "Drop the row icons for duplicate, merge-down, and delete entirely; all three are low-enough-frequency to live in the context menu only." The row already has a comprehensive context menu with all three actions plus visibility and lock. Having both the row buttons and the context menu is directly redundant, creates visual noise on every layer row, and contradicts the stated design direction. Fixed by removing the `.micro.dup`, `.micro.merge`, and `.micro.danger.del` buttons from the row HTML, and removing their click-handler wiring. Visibility and lock remain as the only row buttons since they need to act without disturbing the current selection (exactly what PLAN.md says).

---

## Verdict 13: defended

**Reasoning:** The click-to-select / double-click-to-rename pattern is a real UX improvement but it's a Track L scope item, and the PLAN.md language is "replace with" rather than "was already replaced." The current always-editable name input is not broken — it works, it doesn't cause bugs, and the click handler correctly suppresses the select-layer action when clicking an input (`e.target.closest('input')`). The context menu "Rename" entry is also a Track L item specified as a "fallback once the always-editable inline input is replaced." Since Track L hasn't been fully applied yet, and this change would require restructuring click-delegation logic, it's legitimate Phase 1 remaining work rather than a bug. The prosecutor's challenge quotes PLAN.md accurately but that plan item isn't a concession-worthy defect — it's acknowledged future work.

---

## Verdict 14: defended

**Reasoning:** For Bold and Italic specifically, the `renderPropsPanel()` call is used to toggle the `active` class on the button, and the prosecutor is right that this is heavier than needed — a direct `classList.toggle` would be cheaper. However, the actual cost is not a real problem: `renderPropsPanel()` only re-renders the props panel (not the canvas), and the panel rebuild is fast enough that it's imperceptible. More importantly, the panel rebuild also re-syncs any derived state (font preview, size values) that could have changed. For Align and VAlign, the same pattern is used and is similarly benign. This is a minor efficiency concern, not a correctness bug or UX problem. A targeted class toggle would be cleaner but the current pattern is deliberately simple and has no observed failure mode. Defending: the cost is trivial and the approach is consistent across all toggle buttons in the panel.

---

## Verdict 15: defended

**Reasoning:** The `rRadius` slider max being stale after an interactive resize is a real edge case, but it has no visible failure mode: `drawRoundedRect` in `text.js` already clamps radius to `min(w/2, h/2)`, so a slider value above the layer's real half-dimension renders correctly (it just clips). The user can set a "too high" radius but the visual result is the same as the maximum valid radius — the corner is fully rounded. Adding live `max` updates to `syncTransformInputs` would require accessing the layer W and H on every drag tick just to update a slider max that never produces a visible artifact. The cost of the fix is real; the benefit is cosmetic at most. Defending on this specific tradeoff.

---

## Verdict 16: defended

**Reasoning:** `boxEffects.js` silently returning on rotation is a real limitation with a real reason: blur/pixelate rect effects require reading the backdrop pixels at the rect's axis-aligned position, then applying CSS `filter:blur()`. CSS filter applies to the drawing context's transformed coordinate system, not to the screen-space region. A rotated rect's backdrop region isn't axis-aligned, so the blur/pixelate can't correctly sample from the backdrop without significantly more complex offscreen compositing (rotate backdrop, clip, blur, rotate back). The current approach — skip the effect entirely for rotated rects — is the honest behavior: it doesn't produce a wrong-looking blur on the wrong pixels. What's missing is a UI hint that rotation is incompatible. That's a UX polish item (disable the rotation control or show a tooltip) but not a correctness defect in the renderer itself.

---

## Verdict 17: conceded + fixed

**Reasoning:** `exportPngAndDownload` is `async` but was called without `await`, so `showHint` fired unconditionally and immediately regardless of export outcome. On export failure the user would see both an error alert and "PNG saved to your downloads," which is actively misleading. Fixed by making the export click handler `async` and awaiting `exportPngAndDownload()` before showing the hint. Since `exportPngAndDownload` already catches errors internally (alerts then returns without throwing), the `await` correctly gates the hint on successful completion.

---

## Verdict 18: defended

**Reasoning:** The `typing` guard `tag === 'INPUT' || tag === 'TEXTAREA'` is sufficient for this app's keyboard shortcut surface. The custom-select dropdown (`.csel-opt`) and color picker are `<div>`-based elements that don't hold keyboard focus in the sense that typing into them produces text — they respond to click/pointer events, not keyboard input that would conflict with `t`/`m`/`i` shortcuts. If a user is interacting with the color picker or custom-select by clicking options, `activeElement` would be whichever `<div>` was last focused, and a subsequent keypress triggering a shortcut is unexpected but not harmful (adds text or triggers a picker). The real keyboard-accessibility scenario the prosecutor describes — where Tab-navigating into a custom select and then pressing a key would misfire a shortcut — is a real but edge-case UX issue that belongs in a broader keyboard-accessibility pass, not a targeted single-character check. The current guard covers the significant failure mode (typing in a name/textarea and having letters trigger shortcuts).

---

## Verdict 19: defended

**Reasoning:** The `document.addEventListener('click', close)` and the Escape keydown listener are intentionally permanent singleton handlers, not accumulating leaks. `build()` is called at most once (guarded by `if (!_menu) _menu = build()`), so there is exactly one `click` listener and one `keydown` listener ever attached. `close()` is a 3-line no-op when no menu is visible (`_menu.style.display = 'none'` on an already-hidden element). This is the standard singleton-menu pattern: attach once, run always but cheaply when idle. The alternative — attaching and removing on every open/close — is more code with identical runtime behavior. The concern about future multiple `build()` calls is moot since the guard prevents it.

---

## Verdict 20: defended

**Reasoning:** The stale-reference scenario the prosecutor describes is real but benign: `layerStillExists()` detects the detachment and calls `close()`, discarding the crop. The "silent discard" concern is fair but the alternative — re-finding the layer by ID and writing to the current reference — would be a two-line fix but adds complexity to what is already a documented edge case (undo during a crop modal session). The crop modal is a short-duration, modal operation that blocks other actions while open. Users who press Ctrl+Z during a crop are actively working in two modes simultaneously. The existing behavior (close the modal, discard the in-progress crop) is consistent with how modal dialogs generally respond to state changes underneath them. The missing user feedback is legitimate UX debt but not a correctness bug — the crop is never applied to a dead reference.

---

## Verdict 21: conceded + fixed

**Reasoning:** Including `blendMode` in `thumbSerial` but never rendering blend mode in thumbnails is waste: a blend-mode-only change triggers a thumbnail re-render that produces identical pixels to the previous thumbnail. Blend mode only makes visual sense when composited against other layers, which the isolated layer thumbnail deliberately doesn't show (the thumb renders the layer in isolation on a checkerboard). Removed `blendMode` from the serial — this means a blend-mode change no longer triggers a thumb re-render, which is the correct behavior since the thumb output is unchanged.

---

## Verdict 22: defended

**Reasoning:** `selectedId` in history snapshots is correct behavior with a specific UX rationale: undo/redo should restore the selection to where it was at that history state because the props panel shows properties for the selected layer, and showing the properties for a layer that was just restored by undo is substantially more useful than showing "nothing selected." When a user undoes "Delete layer," restoring the deleted layer's selection is the expected outcome — the user undid the delete so they can continue editing that layer. The viewport exclusion rationale in PLAN.md is about spatial navigation state (zoom/pan) that is explicitly not part of the document; selection state is different — it directly determines what the props panel shows and what keyboard operations (delete, arrow keys) act on. The "surprising" scenario the prosecutor describes (undoing after selecting a different layer also changes selection) is intentional and matches Photoshop's behavior.

---

## Verdict 23: conceded + fixed

**Reasoning:** `ICONS.brush` on `btnOpenRight` sets the wrong user expectation — a paintbrush icon signals a brush/drawing tool, not a properties panel. No brush tool exists in the codebase. Users who tap the button expecting a brush tool will instead see layer properties, which is disorienting. Fixed by changing to `ICONS.shape` (a square), which is generic and doesn't imply a non-existent tool. A proper "sliders" or "panel" icon would be ideal but isn't in the icon set; `shape` is less misleading than a brush.

---

## Verdict 24: conceded + fixed

**Reasoning:** PLAN.md Track H explicitly flags this: "the exported filename is currently hardcoded to meme.png regardless of format — fix that too." The Track H work to add format choice and quality control hasn't landed yet, but the filename can be improved now without waiting for it. Fixed by using `meme-${state.width}x${state.height}.png` as the filename, which includes the canvas dimensions. This disambiguates multiple exports from the same session and is consistent with what other tools do. When Track H adds format selection, the extension can be updated then.

---

## Verdict 25: defended

**Reasoning:** The single-shader vs. ping-pong design is a real architectural difference from PLAN.md, but it's a defensible judgment call given Phase 0's actual scope: exactly three adjustments (brightness, contrast, saturation), all operating on the same per-pixel color transform with no inter-pass dependency. The ping-pong design is valuable when passes need to read the output of a previous pass (e.g., a blur pass that samples neighbors), or when the set of passes is large and variable. With three fixed uniform parameters, a single pass is strictly more efficient (one draw call, no framebuffer swap, no ping-pong canvas allocation), and adding a fourth adjustment like temperature is one new `uniform float` and two lines of shader — not "rewriting a giant shader." The ping-pong design becomes worth the overhead once neighborhood-sampling adjustments (dehaze, clarity, sharpening — Track B items) land and need their own passes. Defending: the current design is optimal for Phase 0's fixed three-adjustment scope; the PLAN.md ping-pong guidance is more applicable to Phase 1 Track B than Phase 0's bootstrap implementation.

---

## Verdict 26: conceded + fixed

**Reasoning:** The defensive fallbacks in `adjustCache.js` and `shapes.js` (`layer.crop || { x: 0, y: 0, w: 1, h: 1 }`) protect against a runtime crash, but the migration in `applyLoadedSnapshot` should be the authoritative default-setting point so the schema is clean at load time rather than relying on every read site to be defensive. A field that's missing after migration is a latent bug waiting for a read site that forgets the guard. Fixed by adding `if (l.type === 'image' && l.crop === undefined) l.crop = { x: 0, y: 0, w: 1, h: 1 }` to the migration block, consistent with how `mask` and `blendMode` are handled.

---

## Verdict 27: defended

**Reasoning:** The actual title of this challenge misrepresents what the prosecutor found: the `renderPropsPanel` chain via `onSelectionChange` works correctly in all described paths. The real concern buried in the challenge is that clicking a locked layer on canvas gives no visual feedback about why nothing was selected. This is a legitimate UX gap but it is not what the challenge title claims (that `renderPropsPanel` isn't called) — it is called, it just renders "Select a layer" which is technically accurate. The locked-layer feedback problem (showing a tooltip or briefly highlighting the locked layer) belongs in a canvas interaction polish pass, likely Track J. It's not a correctness bug in the pointer handling — skipping locked layers in hit-testing is deliberate (you can't accidentally move or select a locked layer, which is the point of locking).

