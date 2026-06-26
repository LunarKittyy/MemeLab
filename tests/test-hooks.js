// Loaded only by tests/index.test.html, alongside the real src/main.js.
// ES modules are singletons per URL, so importing the same module paths
// here gives access to the exact same live state main.js is driving, no
// special test-mode branching needed anywhere in the app code itself.

import { state } from '../src/core/state.js';
import { selectLayer, setActiveTool } from '../src/interactions/pointer.js';
import { stage, getViewportFitScale } from '../src/render/renderer.js';
import { viewport } from '../src/core/viewport.js';
import {
  lassoPointerDown, lassoPointerMove, lassoPointerUp,
  wandPointerDown,
  gradientPointerDown, gradientPointerUp,
} from '../src/interactions/selectionTools.js';
import { overlay } from '../src/interactions/toolOverlay.js';

window.__test = {
  getState() {
    return JSON.parse(JSON.stringify(state));
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
  // ---- Selection / masking tool helpers ----
  getActiveTool() {
    return state.activeTool;
  },
  setActiveTool,
  // Direct lasso programmatic fire (in canvas coords)
  async simulateLasso(layerId, points) {
    const l = state.layers.find((x) => x.id === layerId);
    if (!l) return;
    // Convert layer-center-relative screen points to canvas coords
    const rect = stage.getBoundingClientRect();
    const sx = state.width / rect.width, sy = state.height / rect.height;
    const cx = rect.left + (l.x + l.w / 2) / sx;
    const cy = rect.top + (l.y + l.h / 2) / sy;
    // points are offsets from center in canvas pixels
    const canvasPts = points.map(([dx, dy]) => ({ x: l.x + l.w / 2 + dx, y: l.y + l.h / 2 + dy }));
    lassoPointerDown(canvasPts[0]);
    for (let i = 1; i < canvasPts.length; i++) lassoPointerMove(canvasPts[i]);
    lassoPointerUp();
    // Give toDataURL time to run
    await new Promise(r => setTimeout(r, 50));
  },
  async simulateWand(layerId, dx, dy) {
    const l = state.layers.find((x) => x.id === layerId);
    if (!l) return;
    // dx/dy are offsets from layer top-left in canvas-space pixels
    await wandPointerDown({ x: l.x + (dx || 0), y: l.y + (dy || 0) });
    await new Promise(r => setTimeout(r, 50));
  },
  async simulateGradient(layerId, sx, sy, ex, ey) {
    const l = state.layers.find((x) => x.id === layerId);
    if (!l) return;
    const startPt = { x: l.x + (sx || 0), y: l.y + (sy || 0) };
    const endPt   = { x: l.x + (ex || l.w), y: l.y + (ey || l.h) };
    gradientPointerDown(startPt);
    gradientPointerUp(endPt);
    await new Promise(r => setTimeout(r, 50));
  },
};
