import { state, counters, nextId } from './state.js';

export const FONT_OPTIONS = [
  { value: 'FuturaCondXBold', label: 'Futura Condensed ExtraBold' },
  { value: 'MemeImpact', label: 'Impact' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: '"Comic Sans MS", cursive', label: 'Comic Sans' },
  { value: '"Courier New", monospace', label: 'Courier' },
];

export function defaultTextLayer() {
  counters.text++;
  const size = Math.round(state.width * 0.09);
  const w = Math.round(state.width * 0.74);
  const h = Math.round(size * 1.7);
  return {
    id: nextId(), type: 'text', name: 'Text ' + counters.text,
    x: Math.round((state.width - w) / 2), y: Math.round((state.height - h) / 2),
    w, h, rotation: 0, opacity: 1, visible: true, locked: false, aspectLocked: false,
    text: 'Your text here',
    font: 'MemeImpact', size, color: '#ffffff', align: 'center', vAlign: 'middle',
    bold: false, italic: false, lineHeight: 1.15, letterSpacing: 0, padding: 14,
    stroke: { enabled: true, color: '#000000', width: Math.max(2, Math.round(size * 0.07)) },
    // mode: 'color' | 'blur' | 'pixelate' (blur/pixelate land in a later pass)
    box: { enabled: false, mode: 'color', color: '#ffffff', amount: 16 },
  };
}

export function defaultImageLayer(src, naturalW, naturalH) {
  counters.image++;
  const maxDim = Math.min(state.width, state.height) * 0.7;
  let w = naturalW, h = naturalH;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale); h = Math.round(h * scale);
  }
  return {
    id: nextId(), type: 'image', name: 'Image ' + counters.image,
    x: Math.round((state.width - w) / 2), y: Math.round((state.height - h) / 2),
    w, h, rotation: 0, opacity: 1, visible: true, locked: false, aspectLocked: true,
    src, naturalW, naturalH, flipX: false, flipY: false,
    // exposure lands in a later pass; field reserved here so layer shape is stable
    exposure: 0,
  };
}

export function defaultRectLayer() {
  counters.rect++;
  const size = Math.round(Math.min(state.width, state.height) * 0.32);
  return {
    id: nextId(), type: 'rect', name: 'Shape ' + counters.rect,
    x: Math.round((state.width - size) / 2), y: Math.round((state.height - size) / 2),
    w: size, h: size, rotation: 0, opacity: 1, visible: true, locked: false, aspectLocked: false,
    // mode: 'color' | 'blur' | 'pixelate'  — blur/pixelate make the shape a censor bar.
    // amount: blur radius (px) for 'blur', block size (px) for 'pixelate'.
    // Default 'color' is identical to the old behaviour so existing saves are unaffected.
    mode: 'color', amount: 16,
    color: '#FF3D8A', radius: 0, strokeWidth: 0, strokeColor: '#000000',
  };
}

