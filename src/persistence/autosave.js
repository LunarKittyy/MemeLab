import { state, ensureImage, counters, reseedIdSequenceFrom } from '../core/state.js';
import { snapshot } from '../core/history.js';
import { idbGet, idbSet } from './idb.js';

const SAVE_KEY = 'project';
let saveTimer = null;

const statusListeners = [];
export function onSaveStatusChange(fn) {
  statusListeners.push(fn);
}

const LABELS = {
  idle: 'Nothing to save yet',
  saving: 'Saving…',
  saved: 'All changes saved on this device',
  error: 'Autosave failed, your work is only safe until you reload',
  toobig: 'Project too large to autosave, your work is only safe until you reload',
};

function setSaveStatus(kind, detail) {
  statusListeners.forEach((fn) => fn(kind, detail || LABELS[kind] || ''));
}

export function scheduleAutosave() {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveStatus('saving');
  saveTimer = setTimeout(doAutosave, 700);
}

async function doAutosave() {
  try {
    const snap = snapshot();
    const ok = await idbSet(SAVE_KEY, snap);
    setSaveStatus(ok ? 'saved' : 'error');
  } catch (e) {
    console.error('Autosave failed:', e);
    setSaveStatus('toobig');
  }
}

function reconcileIdsAndCounters() {
  let maxId = 0;
  state.layers.forEach((l) => {
    const m = /^L(\d+)$/.exec(l.id || '');
    if (m) maxId = Math.max(maxId, +m[1]);
  });
  reseedIdSequenceFrom(maxId + 1);
  const maxNum = { text: 0, image: 0, rect: 0, draw: 0 };
  const re = /^(?:Text|Image|Shape|Drawing) (\d+)$/;
  state.layers.forEach((l) => {
    const m = re.exec(l.name || '');
    if (m) {
      if (l.type === 'text') maxNum.text = Math.max(maxNum.text, +m[1]);
      else if (l.type === 'image') maxNum.image = Math.max(maxNum.image, +m[1]);
      else if (l.type === 'rect') maxNum.rect = Math.max(maxNum.rect, +m[1]);
      else if (l.type === 'draw') maxNum.draw = Math.max(maxNum.draw, +m[1]);
    }
  });
  counters.text = maxNum.text; counters.image = maxNum.image; counters.rect = maxNum.rect; counters.draw = maxNum.draw;
}

export function applyLoadedSnapshot(snap) {
  state.width = snap.width || 1080;
  state.height = snap.height || 1080;
  state.background = snap.background || { type: 'color', color: '#ffffff', src: null, fit: 'cover' };
  state.layers = Array.isArray(snap.layers) ? snap.layers : [];
  state.layers.forEach((l) => {
    if (l.type === 'text' && l.sizeScale === undefined && l.size && l.h) {
      l.sizeScale = Math.min(1, Math.max(0.05, l.size / l.h));
    }
    if (l.blendMode === undefined) l.blendMode = 'normal';
    if (l.type === 'image' && l.mask === undefined) l.mask = { enabled: false, src: null, invert: false, feather: 0 };
    if (l.type === 'image' && l.crop === undefined) l.crop = { x: 0, y: 0, w: 1, h: 1 };
    if (l.adjustments === undefined) l.adjustments = [];
    // Migrate legacy exposure field → brightness adjustment
    if (l.type === 'image' && l.exposure !== undefined && l.exposure !== 0) {
      if (!l.adjustments.some(a => a.type === 'brightness')) {
        l.adjustments.push({ type: 'brightness', value: l.exposure });
      }
    }
    if (l.type === 'image') delete l.exposure;
    // Track I migrations
    if (l.type === 'text' && l.arc === undefined) l.arc = 0;
    if (l.type === 'rect' && l.subtype === 'speechbubble') {
      if (l.tailDir === undefined) l.tailDir = 'bottom';
      if (l.tailPos === undefined) l.tailPos = 0.5;
      if (l.tailLen === undefined) l.tailLen = 30;
    }
    // Draw layer migration
    if (l.type === 'draw') {
      if (!Array.isArray(l.strokes)) l.strokes = [];
      if (l.blendMode === undefined) l.blendMode = 'normal';
      if (l.adjustments === undefined) l.adjustments = [];
    }
  });
  state.selectedId = null;
  reconcileIdsAndCounters();
  if (state.background.src) ensureImage(state.background.src);
  state.layers.forEach((l) => {
    if (l.type === 'image') {
      if (l.src) ensureImage(l.src);
      if (l.mask?.src) ensureImage(l.mask.src);
    }
  });
}

export async function tryLoadAutosave() {
  try {
    const snap = await idbGet(SAVE_KEY);
    if (!snap || !Array.isArray(snap.layers)) return false;
    applyLoadedSnapshot(snap);
    return true;
  } catch (e) {
    return false;
  }
}
