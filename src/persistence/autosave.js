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
    // IndexedDB stores structured data directly and has a quota in the
    // hundreds-of-MB-to-GB range (vs. the old 5MB ceiling this project used
    // to be built around), so there's no need to downscale/recompress
    // images before saving here the way the original Claude-artifact
    // version had to.
    const ok = await idbSet(SAVE_KEY, snap);
    setSaveStatus(ok ? 'saved' : 'error');
  } catch (e) {
    console.error('Autosave failed:', e);
    // Most likely cause if this throws is the storage quota actually being
    // exceeded (very large projects with many full-resolution photos).
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
  const maxNum = { text: 0, image: 0, rect: 0 };
  const re = /^(?:Text|Image|Shape) (\d+)$/;
  state.layers.forEach((l) => {
    const m = re.exec(l.name || '');
    if (m && maxNum[l.type] !== undefined) maxNum[l.type] = Math.max(maxNum[l.type], +m[1]);
  });
  counters.text = maxNum.text; counters.image = maxNum.image; counters.rect = maxNum.rect;
}

function applyLoadedSnapshot(snap) {
  state.width = snap.width || 1080;
  state.height = snap.height || 1080;
  state.background = snap.background || { type: 'color', color: '#ffffff', src: null, fit: 'cover' };
  state.layers = Array.isArray(snap.layers) ? snap.layers : [];
  // Migrate text layers that pre-date sizeScale: derive scale from absolute size + box height.
  state.layers.forEach((l) => {
    if (l.type === 'text' && l.sizeScale === undefined && l.size && l.h) {
      l.sizeScale = Math.min(1, Math.max(0.05, l.size / l.h));
    }
  });
  state.selectedId = null;
  reconcileIdsAndCounters();
  if (state.background.src) ensureImage(state.background.src);
  state.layers.forEach((l) => { if (l.type === 'image' && l.src) ensureImage(l.src); });
}

export async function tryLoadAutosave() {
  try {
    const snap = await idbGet(SAVE_KEY);
    if (!snap || !Array.isArray(snap.layers)) return false;
    applyLoadedSnapshot(snap);
    return true;
  } catch (e) {
    return false; // no saved project yet, or it couldn't be read — start fresh
  }
}
