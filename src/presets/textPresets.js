const STORAGE_KEY = 'memelab-text-presets';

const STYLE_FIELDS = [
  'font', 'sizeScale', 'color', 'align', 'vAlign', 'bold', 'italic',
  'lineHeight', 'letterSpacing', 'padding', 'stroke', 'box',
];

export function listTextPresets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveTextPreset(name, layer) {
  const presets = listTextPresets().filter((p) => p.name !== name);
  const preset = { name };
  for (const f of STYLE_FIELDS) {
    if (f in layer) {
      // Deep-copy objects like stroke and box
      preset[f] = typeof layer[f] === 'object' && layer[f] !== null
        ? JSON.parse(JSON.stringify(layer[f]))
        : layer[f];
    }
  }
  presets.push(preset);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('textPresets: localStorage write failed', e);
  }
  return preset;
}

export function applyTextPreset(preset, layer) {
  for (const f of STYLE_FIELDS) {
    if (f in preset) {
      layer[f] = typeof preset[f] === 'object' && preset[f] !== null
        ? JSON.parse(JSON.stringify(preset[f]))
        : preset[f];
    }
  }
}

export function deleteTextPreset(name) {
  const presets = listTextPresets().filter((p) => p.name !== name);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('textPresets: localStorage write failed', e);
  }
}
