// Filter preset definitions and apply/remove logic.
// Each preset is a named look expressed as a saved array of layer.adjustments entries.
// All nine built-in looks are expressible with brightness/contrast/saturation alone
// (the three types currently supported by the WebGL shader in glAdjust.js).

export const FILTER_PRESETS = [
  {
    id: 'none',
    label: 'None',
    adjustments: [],
    overlay: null,
  },
  {
    id: 'vintage',
    label: 'Vintage',
    adjustments: [
      { type: 'brightness', value: 5 },
      { type: 'contrast', value: 10 },
      { type: 'saturation', value: -25 },
    ],
    overlay: null,
  },
  {
    id: 'noir',
    label: 'Noir',
    adjustments: [
      { type: 'brightness', value: 5 },
      { type: 'contrast', value: 40 },
      { type: 'saturation', value: -80 },
    ],
    overlay: null,
  },
  {
    id: 'drama',
    label: 'Drama',
    adjustments: [
      { type: 'brightness', value: -10 },
      { type: 'contrast', value: 30 },
      { type: 'saturation', value: 10 },
    ],
    overlay: null,
  },
  {
    id: 'grunge',
    label: 'Grunge',
    adjustments: [
      { type: 'brightness', value: -15 },
      { type: 'contrast', value: 20 },
      { type: 'saturation', value: -50 },
    ],
    overlay: null,
  },
  {
    id: 'retrolux',
    label: 'Retrolux',
    adjustments: [
      { type: 'brightness', value: 20 },
      { type: 'contrast', value: -10 },
      { type: 'saturation', value: -40 },
    ],
    overlay: null,
  },
  {
    id: 'hdrscape',
    label: 'HDR-scape',
    adjustments: [
      { type: 'brightness', value: 0 },
      { type: 'contrast', value: 50 },
      { type: 'saturation', value: 30 },
    ],
    overlay: null,
  },
  {
    id: 'bloom',
    label: 'Bloom',
    adjustments: [
      { type: 'brightness', value: 30 },
      { type: 'contrast', value: -20 },
      { type: 'saturation', value: 10 },
    ],
    overlay: null,
  },
  {
    id: 'halation',
    label: 'Halation',
    adjustments: [
      { type: 'brightness', value: 40 },
      { type: 'contrast', value: -30 },
      { type: 'saturation', value: -20 },
    ],
    overlay: null,
  },
  {
    id: 'glamourglow',
    label: 'Glamour Glow',
    adjustments: [
      { type: 'brightness', value: 25 },
      { type: 'contrast', value: -15 },
      { type: 'saturation', value: 15 },
    ],
    overlay: null,
  },
];

// Check if two adjustment arrays match (same entries in any order).
function presetsMatch(a, b) {
  if (a.length !== b.length) return false;
  // Both empty => match
  if (a.length === 0) return true;
  // Compare as sorted JSON for simplicity — order within the array doesn't matter.
  const normalize = (arr) =>
    arr.map(x => `${x.type}:${x.value}`).sort().join(',');
  return normalize(a) === normalize(b);
}

// Apply a preset to a layer — replaces layer.adjustments with the preset's entries.
// Returns the preset object for convenience.
export function applyPreset(layer, preset) {
  layer.adjustments = preset.adjustments.map(a => ({ ...a })); // deep copy
  // Overlay mechanism is reserved for future work (spec step 3).
  // For Phase 1 all nine looks are expressed with adjustments alone.
}

// Remove the current preset (reset adjustments to empty).
export function clearPreset(layer) {
  layer.adjustments = [];
}

// Return the preset id that matches the layer's current adjustments, or null.
export function getActivePresetId(layer) {
  const adjs = layer.adjustments || [];
  for (const p of FILTER_PRESETS) {
    if (presetsMatch(adjs, p.adjustments)) return p.id;
  }
  return null;
}
