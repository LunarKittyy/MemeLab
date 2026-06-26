// Loaded only by tests/index.test.html, alongside the real src/main.js.
import { state } from '../src/core/state.js';
import { selectLayer, selectLayers, setActiveTool, computeGuides } from '../src/interactions/pointer.js';
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
    const s = JSON.parse(JSON.stringify({
      width: state.width, height: state.height,
      background: state.background, layers: state.layers, selectedId: state.selectedId,
      straighten: state.straighten,
    }));
    s.selectedIds = [...state.selectedIds];
    s.showGrid = state.showGrid; s.showRulers = state.showRulers;
    s.gridSize = state.gridSize; s.snapToGuides = state.snapToGuides;
    s.compareMode = state.compareMode; s.swipeAdjustTarget = state.swipeAdjustTarget;
    s.activeGuides = state.activeGuides ? [...state.activeGuides] : [];
    return s;
  },
  getSelectedId() { return state.selectedId; },
  getSelectedIds() { return [...state.selectedIds]; },
  selectLayer, selectLayers,
  getViewport() { return { ...viewport, fitScale: getViewportFitScale() }; },
  layerScreenRect(id) {
    const l = id === null ? null : state.layers.find((x) => x.id === id);
    if (!l) return null;
    const rect = stage.getBoundingClientRect();
    const sx = rect.width / state.width, sy = rect.height / state.height;
    return { cx: rect.left + (l.x + l.w/2)*sx, cy: rect.top + (l.y + l.h/2)*sy,
             left: rect.left + l.x*sx, top: rect.top + l.y*sy, w: l.w*sx, h: l.h*sy };
  },
  getActiveTool() { return state.activeTool; },
  setActiveTool,
  async simulateLasso(layerId, points) {
    const l = state.layers.find((x) => x.id === layerId); if (!l) return;
    const pts = points.map(([dx,dy]) => ({ x: l.x+l.w/2+dx, y: l.y+l.h/2+dy }));
    lassoPointerDown(pts[0]);
    for (let i=1; i<pts.length; i++) lassoPointerMove(pts[i]);
    lassoPointerUp();
    await new Promise(r => setTimeout(r, 50));
  },
  async simulateWand(layerId, dx, dy) {
    const l = state.layers.find((x) => x.id === layerId); if (!l) return;
    await wandPointerDown({ x: l.x+(dx||0), y: l.y+(dy||0) });
    await new Promise(r => setTimeout(r, 50));
  },
  async simulateGradient(layerId, sx, sy, ex, ey) {
    const l = state.layers.find((x) => x.id === layerId); if (!l) return;
    gradientPointerDown({ x: l.x+(sx||0), y: l.y+(sy||0) });
    gradientPointerUp({ x: l.x+(ex||l.w), y: l.y+(ey||l.h) });
    await new Promise(r => setTimeout(r, 50));
  },
  computeGuides(movingLayer, allLayers) {
    return computeGuides(movingLayer, allLayers || state.layers);
  },
};
