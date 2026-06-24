import { bindStage, resizeStageBuffer, scheduleRender } from './render/renderer.js';
import { fontsReady } from './render/fonts.js';
import { pushHistory, onHistoryCommit, onRestore, canUndo, canRedo } from './core/history.js';
import { stageEventsInit, onSelectionChange } from './interactions/pointer.js';
import { renderLayerList, updateLayerListSelection } from './ui/layerList.js';
import { renderPropsPanel } from './ui/props/panel.js';
import { initIcons, wireGlobalUI, syncSizeInputs, updateHistoryButtons, updateSaveStatusUI } from './ui/toolbar.js';
import { scheduleAutosave, tryLoadAutosave, onSaveStatusChange } from './persistence/autosave.js';

onSelectionChange(() => {
  updateLayerListSelection();
  renderPropsPanel();
  scheduleRender();
});

onRestore(() => {
  syncSizeInputs();
  renderLayerList();
  renderPropsPanel();
  scheduleRender();
  updateHistoryButtons(canUndo(), canRedo());
});

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
  renderLayerList();
  renderPropsPanel();
  resizeStageBuffer();
  pushHistory();
  fontsReady().then(scheduleRender);
}

window.addEventListener('DOMContentLoaded', init);
