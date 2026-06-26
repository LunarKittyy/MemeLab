export const MIN_SIZE = 12;

export const state = {
  width: 1080,
  height: 1080,
  background: { type: 'color', color: '#ffffff', src: null, fit: 'cover' },
  layers: [],
  selectedId: null,       // string | null — primary selection (drives props panel)
  selectedIds: new Set(), // Set<string> — full multi-select set (transient UI state, never persisted)
  activeTool: null,       // 'lasso'|'polygon'|'wand'|'brushMask'|'gradientMask'|null
  straighten: 0,
};

export const imageCache = new Map();

export const counters = { text: 0, image: 0, rect: 0, draw: 0 };

// Active tool state for draw tools
export const drawState = {
  activeTool: 'select', // 'select'|'brush'|'eraser'|'line'|'ellipse'|'polygon'|'gradient'|'bucket'|'eyedropper'
  brushColor: '#ff0000',
  brushSize: 20,
  brushOpacity: 1,
  brushHardness: 0.8,
  gradientType: 'linear',
  gradientColor2: '#0000ff',
};
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
