import { state, ensureImage } from './state.js';
import { clearAdjustCache } from '../render/adjustCache.js';
import { invalidateAllDrawCaches } from '../render/drawLayer.js';

let history = [];
let historyIndex = -1;

export function snapshot() {
  return {
    width: state.width,
    height: state.height,
    background: JSON.parse(JSON.stringify(state.background)),
    layers: JSON.parse(JSON.stringify(state.layers)),
    selectedId: state.selectedId,
  };
}

const commitListeners = [];
export function onHistoryCommit(fn) {
  commitListeners.push(fn);
}

export function pushHistory(label) {
  history = history.slice(0, historyIndex + 1);
  const snap = snapshot();
  snap._label = label || 'Edit';
  history.push(snap);
  historyIndex++;
  if (history.length > 80) { history.shift(); historyIndex--; }
  commitListeners.forEach((fn) => fn());
}

export function getHistoryEntries() {
  return history.map((snap, i) => ({
    index: i,
    label: snap._label || 'Edit',
    isCurrent: i === historyIndex,
  }));
}

export function jumpToHistory(index) {
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  restoreSnapshot(history[historyIndex]);
  restoreListeners.forEach((fn) => fn());
}

export function restoreSnapshot(snap) {
  const clone = JSON.parse(JSON.stringify(snap));
  state.width = clone.width;
  state.height = clone.height;
  state.background = clone.background;
  state.layers = clone.layers;
  state.selectedId = clone.selectedId;
  // Multi-select is transient UI state — always reset on history restore
  state.selectedIds = new Set(state.selectedId && state.selectedId !== 'background' ? [state.selectedId] : []);
  clearAdjustCache();
  invalidateAllDrawCaches();
  if (state.background.src) ensureImage(state.background.src);
  state.layers.forEach((l) => {
    if (l.type === 'image') {
      if (l.src) ensureImage(l.src);
      if (l.mask?.src) ensureImage(l.mask.src);
    }
  });
}

const restoreListeners = [];
export function onRestore(fn) {
  restoreListeners.push(fn);
}

export function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    restoreSnapshot(history[historyIndex]);
    restoreListeners.forEach((fn) => fn());
  }
}

export function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    restoreSnapshot(history[historyIndex]);
    restoreListeners.forEach((fn) => fn());
  }
}

export function canUndo() {
  return historyIndex > 0;
}

export function canRedo() {
  return historyIndex < history.length - 1;
}
