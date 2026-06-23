export const MIN_SIZE = 12;

export const state = {
  width: 1080,
  height: 1080,
  background: { type: 'color', color: '#ffffff', src: null, fit: 'cover' },
  layers: [],
  selectedId: null,
};

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

// Dynamic import avoids a static circular dependency with renderer.js.
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
