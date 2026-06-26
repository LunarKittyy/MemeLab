export const MIN_SIZE = 12;

// Load UI preferences from localStorage (not in history snapshots).
function _loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; }
}

export const state = {
  width: 1080,
  height: 1080,
  background: { type: 'color', color: '#ffffff', src: null, fit: 'cover' },
  layers: [],
  selectedId: null,

  // ---- Track-J: UI preferences (persisted to localStorage, NOT in history) ----
  showGrid: _loadPref('ml_showGrid', false),
  gridSize: _loadPref('ml_gridSize', 100),   // canvas px per cell
  showRulers: _loadPref('ml_showRulers', false),
  snapToGuides: _loadPref('ml_snapToGuides', true),

  // ---- Track-J: transient (never persisted) ----
  compareMode: null,         // null | 'toggle' | 'split'
  swipeAdjustTarget: null,   // element id of focused range slider, or null
  activeGuides: [],          // guide lines visible during current drag
  compareSplitX: null,       // fractional 0..1 split position (null = 0.5)
};

export function saveUIPref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const imageCache = new Map();

export const counters = { text: 0, image: 0, rect: 0 };
let idSeq = 1;

export function nextId() {
  return 'L' + idSeq++;
}

export function reseedIdSequenceFrom(n) {
  idSeq = Math.max(idSeq, n);
}

export function getSelected() {
  if (!state.selectedId || state.selectedId === 'background') return null;
  return state.layers.find((l) => l.id === state.selectedId) || null;
}

export function getLayerById(id) {
  return state.layers.find((l) => l.id === id);
}

export function pruneImageCache() {
  const used = new Set();
  if (state.background.src) used.add(state.background.src);
  for (const l of state.layers) if (l.src) used.add(l.src);
  for (const key of imageCache.keys()) if (!used.has(key)) imageCache.delete(key);
}

export function ensureImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  const img = new Image();
  imageCache.set(src, img);
  img.onload = () => {
    import('../render/renderer.js').then((m) => m.scheduleRender());
  };
  img.src = src;
  return img;
}
