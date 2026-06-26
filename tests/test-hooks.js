// Loaded only by tests/index.test.html, alongside the real src/main.js.
// ES modules are singletons per URL, so importing the same module paths
// here gives access to the exact same live state main.js is driving, no
// special test-mode branching needed anywhere in the app code itself.

import { state } from '../src/core/state.js';
import { selectLayer, computeGuides } from '../src/interactions/pointer.js';
import { stage, getViewportFitScale } from '../src/render/renderer.js';
import { viewport } from '../src/core/viewport.js';

window.__test = {
  getState() {
    // Include Track-J transient fields too
    return {
      ...JSON.parse(JSON.stringify({
        width: state.width,
        height: state.height,
        background: state.background,
        layers: state.layers,
        selectedId: state.selectedId,
      })),
      showGrid: state.showGrid,
      showRulers: state.showRulers,
      gridSize: state.gridSize,
      snapToGuides: state.snapToGuides,
      compareMode: state.compareMode,
      swipeAdjustTarget: state.swipeAdjustTarget,
      activeGuides: state.activeGuides ? [...state.activeGuides] : [],
    };
  },
  getSelectedId() {
    return state.selectedId;
  },
  selectLayer,
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
  // Track-J: test helper to run computeGuides
  computeGuides(movingLayer, allLayers) {
    return computeGuides(movingLayer, allLayers || state.layers);
  },
};
