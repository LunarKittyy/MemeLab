// Loaded only by tests/index.test.html, alongside the real src/main.js.
// ES modules are singletons per URL, so importing the same module paths
// here gives access to the exact same live state main.js is driving, no
// special test-mode branching needed anywhere in the app code itself.

import { state } from '../src/core/state.js';
import { selectLayer, selectLayers } from '../src/interactions/pointer.js';
import { stage, getViewportFitScale } from '../src/render/renderer.js';
import { viewport } from '../src/core/viewport.js';

window.__test = {
  getState() {
    // selectedIds is a Set — JSON.stringify drops it, so serialize manually
    const s = JSON.parse(JSON.stringify(state));
    s.selectedIds = [...state.selectedIds];
    return s;
  },
  getSelectedId() {
    return state.selectedId;
  },
  getSelectedIds() {
    return [...state.selectedIds];
  },
  selectLayer,
  selectLayers,
  getViewport() {
    return { ...viewport, fitScale: getViewportFitScale() };
  },
  layerScreenRect(id) {
    const l = id === null ? null : state.layers.find((x) => x.id === id);
    if (!l) return null;
    const rect = stage.getBoundingClientRect();
    const sx = rect.width / state.width, sy = rect.height / state.height;
    return {
      cx: rect.left + (l.x + l.w / 2) * sx,
      cy: rect.top + (l.y + l.h / 2) * sy,
      left: rect.left + l.x * sx, top: rect.top + l.y * sy,
      w: l.w * sx, h: l.h * sy,
    };
  },
};
