import { bindStage, resizeStageBuffer, scheduleRender } from './render/renderer.js';
import { fontsReady } from './render/fonts.js';
import { pushHistory, onHistoryCommit, onRestore, canUndo, canRedo } from './core/history.js';
import { stageEventsInit, onSelectionChange } from './interactions/pointer.js';
import { renderLayerList } from './ui/layerList.js';
import { renderPropsPanel } from './ui/props/panel.js';
import { initIcons, wireGlobalUI, syncSizeInputs, syncBgControls, updateHistoryButtons, updateSaveStatusUI } from './ui/toolbar.js';
import { scheduleAutosave, tryLoadAutosave, onSaveStatusChange } from './persistence/autosave.js';

// --- cross-module wiring ---
// Selecting a different layer (or the background, or nothing) needs the
// layer list, the style panel, and the canvas overlay to all refresh.
onSelectionChange(() => {
  renderLayerList();
  renderPropsPanel();
  scheduleRender();
});

// Undo/redo restores a whole snapshot, so everything needs a full refresh,
// including the undo/redo buttons themselves (the history position moved
// without a new commit happening).
onRestore(() => {
  syncSizeInputs();
  renderLayerList();
  renderPropsPanel();
  scheduleRender();
  updateHistoryButtons(canUndo(), canRedo());
});

// Every committed history checkpoint updates the undo/redo buttons and
// kicks off a debounced autosave.
onHistoryCommit(() => {
  updateHistoryButtons(canUndo(), canRedo());
  scheduleAutosave();
});

onSaveStatusChange(updateSaveStatusUI);

async function init() {
  bindStage(document.getElementById('stage'));
  initIcons();
  wireGlobalUI();
  stageEventsInit();
  await tryLoadAutosave();
  syncSizeInputs();
  syncBgControls();
  renderLayerList();
  renderPropsPanel();
  resizeStageBuffer();
  pushHistory();
  fontsReady().then(scheduleRender);
}

window.addEventListener('DOMContentLoaded', init);
