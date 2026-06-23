// The single source of truth for the project being edited, plus the image
// cache that backs every image/background layer. Kept dependency-light on
// purpose: render.js and history.js both need this module, so this module
// must not statically depend on either of them.

export const MIN_SIZE = 12;

export const state = {
  width: 1080,
  height: 1080,
  background: { type: 'color', color: '#ffffff', src: null, fit: 'cover' },
  layers: [],
  selectedId: null,
};

// src (dataURL) -> HTMLImageElement. One entry per distinct image, shared
// between however many layers happen to reference the same src.
export const imageCache = new Map();

export const counters = { text: 0, image: 0, rect: 0 };
let idSeq = 1;

export function nextId() {
  return 'L' + idSeq++;
}

// Used after restoring a project from storage, so newly-created layers don't
// collide with ids/default-names that came back from the save.
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

// Lazily loads (or returns the cached) Image for a given src. Render code
// calls this on every draw; it's cheap once the image is cached.
// On first load of a given src, we ask for a redraw once it's ready. Using a
// dynamic import here (instead of a static one) deliberately avoids a static
// circular dependency between state.js and render/renderer.js.
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
