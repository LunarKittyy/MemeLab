import { state, ensureImage } from './state.js';

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

// Anything that should happen whenever a new history checkpoint is committed
// (autosave, undo/redo button state) is registered here rather than imported
// statically, so this module doesn't need to know who's listening.
const commitListeners = [];
export function onHistoryCommit(fn) {
  commitListeners.push(fn);
}

export function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  historyIndex++;
  if (history.length > 80) { history.shift(); historyIndex--; }
  commitListeners.forEach((fn) => fn());
}

export function restoreSnapshot(snap) {
  const clone = JSON.parse(JSON.stringify(snap));
  state.width = clone.width;
  state.height = clone.height;
  state.background = clone.background;
  state.layers = clone.layers;
  state.selectedId = clone.selectedId;
  if (state.background.src) ensureImage(state.background.src);
  state.layers.forEach((l) => { if (l.type === 'image') ensureImage(l.src); });
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
