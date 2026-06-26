import { state, getSelected, getLayerById, MIN_SIZE, drawState } from '../core/state.js';
import { clamp, deg2rad, rad2deg, rotVec } from '../core/utils.js';
import { stage, dispScaleFactor, scheduleRender, applyViewportToStage } from '../render/renderer.js';
import { viewport, resetViewport } from '../core/viewport.js';
import { pushHistory } from '../core/history.js';
import {
  lassoPointerDown, lassoPointerMove, lassoPointerUp, lassoCancel,
  polygonPointerDown, polygonCancel,
  wandPointerDown,
  gradientPointerDown, gradientPointerMove, gradientPointerUp, gradientCancel,
  updateCursor, clearCursor,
} from './selectionTools.js';
import {
  brushPointerDown, brushPointerMove, brushPointerUp,
  brushDeactivate, brushUpdateCursor, brushClearCursor,
} from './brushMask.js';
import { drawToolsPointerDown, drawToolsPointerMove, drawToolsPointerUp } from './drawTools.js';

const ZOOM_MIN = 0.1, ZOOM_MAX = 20;

export function applyZoom(factor, originX, originY) {
  const oldZoom = viewport.zoom;
  const newZoom = clamp(oldZoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === oldZoom) return;
  const rect = stage.getBoundingClientRect();
  const fracX = (originX - rect.left) / rect.width;
  const fracY = (originY - rect.top) / rect.height;
  const oldW = rect.width, oldH = rect.height;
  const newW = oldW * (newZoom / oldZoom);
  const newH = oldH * (newZoom / oldZoom);
  // Flexbox re-centers stage when size changes; adjust pan to keep cursor fixed
  viewport.zoom = newZoom;
  viewport.panX += (fracX - 0.5) * (oldW - newW);
  viewport.panY += (fracY - 0.5) * (oldH - newH);
  applyViewportToStage();
}

const selectionListeners = [];
export function onSelectionChange(fn) {
  selectionListeners.push(fn);
}

/**
 * Select a layer by id.
 * opts.multi = true: toggle this id in selectedIds (Ctrl/Cmd-click behaviour).
 * opts.addOnly = true: add to selectedIds without toggling (used for range-select).
 * Default (no opts): clear selectedIds, set selectedId to id.
 */
export function selectLayer(id, opts) {
  if (opts && opts.multi) {
    // Ctrl/Cmd-click: toggle in selectedIds
    if (id && state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
      // If we're removing the primary, promote another from the set
      if (state.selectedId === id) {
        const remaining = [...state.selectedIds];
        state.selectedId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
    } else if (id) {
      state.selectedIds.add(id);
      state.selectedId = id; // most-recently-toggled becomes primary
    }
  } else {
    // Plain click: clear multi-select, set single selection
    state.selectedId = id;
    state.selectedIds = new Set(id && id !== 'background' ? [id] : []);
  }
  selectionListeners.forEach((fn) => fn());
}

/**
 * Bulk-select a set of layer ids (for range-select).
 * Merges into existing selectedIds; sets selectedId to the last in ids.
 */
export function selectLayers(ids) {
  for (const id of ids) {
    if (id && id !== 'background') state.selectedIds.add(id);
  }
  if (ids.length > 0) state.selectedId = ids[ids.length - 1];
  selectionListeners.forEach((fn) => fn());
}

const dragTickListeners = [];
export function onDragTick(fn) {
  dragTickListeners.push(fn);
}

export function projectCoords(evt) {
  const rect = stage.getBoundingClientRect();
  const sx = state.width / rect.width, sy = state.height / rect.height;
  return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
}

function toLocal(layer, px, py) {
  const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  return rotVec(px - cx, py - cy, -deg2rad(layer.rotation));
}

export function pointInLayerBounds(layer, px, py) {
  const local = toLocal(layer, px, py);
  return Math.abs(local.x) <= layer.w / 2 && Math.abs(local.y) <= layer.h / 2;
}

function hitLayerAt(px, py) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const l = state.layers[i];
    if (!l.visible || l.locked) continue;
    if (pointInLayerBounds(l, px, py)) return l;
  }
  return null;
}

let drag = null;
const activeTouches = new Map(); // touch pointerId -> last known canvas-space {x,y}
const screenTouches = new Map(); // touch pointerId -> last known screen-space {x,y}

function handleAt(layer, px, py, ds) {
  const local = toLocal(layer, px, py);
  const tol = 14 * ds;
  const corners = {
    tl: [-layer.w / 2, -layer.h / 2], tr: [layer.w / 2, -layer.h / 2],
    bl: [-layer.w / 2, layer.h / 2], br: [layer.w / 2, layer.h / 2],
  };
  for (const key in corners) {
    const [hx, hy] = corners[key];
    if (Math.abs(local.x - hx) <= tol && Math.abs(local.y - hy) <= tol) return { kind: 'resize', corner: key };
  }
  const rhY = -layer.h / 2 - 30 * ds;
  if (Math.abs(local.x - 0) <= tol && Math.abs(local.y - rhY) <= tol * 1.3) return { kind: 'rotate' };
  return null;
}

let _canvasPinchDist = 0;
let _canvasPinchCenter = { x: 0, y: 0 };

/** Activate or deactivate a selection tool. Pass null to deactivate. */
export function setActiveTool(toolName) {
  const prev = state.activeTool;
  // Deactivate old tool cleanup
  if (prev === 'lasso') lassoCancel();
  else if (prev === 'polygon') polygonCancel();
  else if (prev === 'gradientMask') gradientCancel();
  else if (prev === 'brushMask') brushDeactivate();

  // Toggle off if same tool
  if (prev === toolName) {
    state.activeTool = null;
  } else {
    state.activeTool = toolName;
  }

  // Update cursor CSS on stage
  if (stage) {
    const cursors = {
      lasso: 'crosshair',
      polygon: 'crosshair',
      wand: 'cell',
      brushMask: 'none',
      gradientMask: 'crosshair',
    };
    stage.style.cursor = state.activeTool ? (cursors[state.activeTool] || 'crosshair') : '';
  }
  scheduleRender();
}

export function stageEventsInit() {
  stage.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  const area = document.getElementById('canvasArea');
  area.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    applyZoom(factor, e.clientX, e.clientY);
  }, { passive: false });

  area.addEventListener('dblclick', (e) => {
    if (e.target === area || e.target.id === 'canvasWrap') {
      resetViewport();
      applyViewportToStage();
    }
  });

  const zoomResetBtn = document.getElementById('zoomReset');
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
      resetViewport();
      applyViewportToStage();
    });
  }

  // Escape cancels active tool
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeTool) {
      if (state.activeTool === 'lasso') lassoCancel();
      else if (state.activeTool === 'polygon') polygonCancel();
      else if (state.activeTool === 'gradientMask') gradientCancel();
      else if (state.activeTool === 'brushMask') brushClearCursor();
      scheduleRender();
    }
  });
}

function onPointerDown(evt) {
  evt.preventDefault();

  // Route to draw tools if a draw tool is active (and the selected layer is a draw layer)
  const selLayer = getSelected();
  if (drawState.activeTool && drawState.activeTool !== 'select' && selLayer && selLayer.type === 'draw') {
    stage.setPointerCapture(evt.pointerId);
    drawToolsPointerDown(evt);
    return;
  }

  const p = projectCoords(evt);
  const ds = dispScaleFactor();

  // ---- Tool mode: route to active selection tool ----
  if (state.activeTool) {
    stage.setPointerCapture(evt.pointerId);
    const tool = state.activeTool;
    if (tool === 'lasso') {
      lassoPointerDown(p);
    } else if (tool === 'polygon') {
      polygonPointerDown(p);
    } else if (tool === 'wand') {
      wandPointerDown(p);
    } else if (tool === 'brushMask') {
      brushPointerDown(p);
    } else if (tool === 'gradientMask') {
      gradientPointerDown(p);
    }
    return;
  }

  if (evt.pointerType === 'touch') {
    activeTouches.set(evt.pointerId, p);
    screenTouches.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    if (activeTouches.size === 2) {
      const sel0 = getSelected();
      const pts = [...activeTouches.values()];
      if (sel0 && sel0.visible && !sel0.locked) {
        const dist0 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        drag = { kind: 'pinch', layer: sel0, dist0, w0: sel0.w, h0: sel0.h, cx0: sel0.x + sel0.w / 2, cy0: sel0.y + sel0.h / 2 };
      } else {
        // No selected layer: two-finger gesture zooms/pans the canvas
        const scrPts = [...screenTouches.values()];
        _canvasPinchDist = Math.hypot(scrPts[1].x - scrPts[0].x, scrPts[1].y - scrPts[0].y);
        _canvasPinchCenter = { x: (scrPts[0].x + scrPts[1].x) / 2, y: (scrPts[0].y + scrPts[1].y) / 2 };
        drag = { kind: 'canvasPinch', zoom0: viewport.zoom, panX0: viewport.panX, panY0: viewport.panY };
      }
      return;
    }
    if (activeTouches.size > 2) return;
  }

  const sel = getSelected();

  if (sel) {
    const h = handleAt(sel, p.x, p.y, ds);
    if (h) {
      stage.setPointerCapture(evt.pointerId);
      if (h.kind === 'rotate') {
        const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
        const startAngle = Math.atan2(p.y - cy, p.x - cx);
        drag = { kind: 'rotate', layer: sel, cx, cy, startAngle, startRotation: sel.rotation };
      } else {
        drag = { kind: 'resize', layer: sel, corner: h.corner, x0: sel.x, y0: sel.y, w0: sel.w, h0: sel.h, rotation0: sel.rotation };
      }
      return;
    }
    if (!sel.locked && sel.visible && pointInLayerBounds(sel, p.x, p.y)) {
      stage.setPointerCapture(evt.pointerId);
      const hit = hitLayerAt(p.x, p.y);
      const potentialSelectId = (hit && hit.id !== sel.id) ? hit.id : null;
      // Capture original positions for all selected layers (group move)
      const origPositions = {};
      for (const id of state.selectedIds) {
        const l = getLayerById(id);
        if (l) origPositions[id] = { x: l.x, y: l.y };
      }
      drag = { kind: 'move', layer: sel, startX: p.x, startY: p.y, origX: sel.x, origY: sel.y, hasMoved: false, potentialSelectId, origPositions };
      return;
    }
  }

  const hit = hitLayerAt(p.x, p.y);
  if (hit) {
    selectLayer(hit.id);
    stage.setPointerCapture(evt.pointerId);
    const origPositions = { [hit.id]: { x: hit.x, y: hit.y } };
    drag = { kind: 'move', layer: hit, startX: p.x, startY: p.y, origX: hit.x, origY: hit.y, hasMoved: false, origPositions };
  } else {
    selectLayer(null);
  }
}

function onPointerMove(evt) {
  // ---- Tool mode ----
  if (state.activeTool) {
    const p = projectCoords(evt);
    const tool = state.activeTool;
    if (tool === 'lasso') {
      if (evt.buttons & 1) lassoPointerMove(p);
      updateCursor(p);
    } else if (tool === 'polygon') {
      updateCursor(p);
      scheduleRender();
    } else if (tool === 'brushMask') {
      brushPointerMove(p);
    } else if (tool === 'gradientMask') {
      gradientPointerMove(p);
      updateCursor(p);
    } else {
      updateCursor(p);
    }
    return;
  }

  if (evt.pointerType === 'touch' && activeTouches.has(evt.pointerId)) {
    activeTouches.set(evt.pointerId, projectCoords(evt));
    screenTouches.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
  }
  // Route to draw tools if active
  const selLayerMove = getSelected();
  if (drawState.activeTool && drawState.activeTool !== 'select' && selLayerMove && selLayerMove.type === 'draw') {
    drawToolsPointerMove(evt);
    return;
  }
  if (!drag) return;
  evt.preventDefault();
  const p = projectCoords(evt);
  const layer = drag.layer;

  if (drag.kind === 'move') {
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    if (state.selectedIds.size > 1 && drag.origPositions) {
      // Group move: translate all selected layers by the same delta
      for (const id of state.selectedIds) {
        const l = getLayerById(id);
        if (l && drag.origPositions[id]) {
          l.x = drag.origPositions[id].x + dx;
          l.y = drag.origPositions[id].y + dy;
        }
      }
    } else {
      layer.x = drag.origX + dx;
      layer.y = drag.origY + dy;
    }
    if (Math.hypot(dx, dy) > 3) {
      drag.hasMoved = true;
    }
  } else if (drag.kind === 'pinch') {
    const pts = [...activeTouches.values()];
    if (pts.length < 2 || drag.dist0 < 1e-3) return;
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const scale = clamp(dist / drag.dist0, 0.05, 50);
    const newW = clamp(drag.w0 * scale, MIN_SIZE, 8000);
    const newH = clamp(drag.h0 * scale, MIN_SIZE, 8000);
    layer.w = newW; layer.h = newH;
    layer.x = drag.cx0 - newW / 2;
    layer.y = drag.cy0 - newH / 2;
  } else if (drag.kind === 'canvasPinch') {
    const scrPts = [...screenTouches.values()];
    if (scrPts.length < 2 || _canvasPinchDist < 1e-3) return;
    const dist = Math.hypot(scrPts[1].x - scrPts[0].x, scrPts[1].y - scrPts[0].y);
    const center = { x: (scrPts[0].x + scrPts[1].x) / 2, y: (scrPts[0].y + scrPts[1].y) / 2 };
    const scaleFactor = dist / _canvasPinchDist;
    viewport.zoom = clamp(drag.zoom0 * scaleFactor, ZOOM_MIN, ZOOM_MAX);
    viewport.panX = drag.panX0 + (center.x - _canvasPinchCenter.x);
    viewport.panY = drag.panY0 + (center.y - _canvasPinchCenter.y);
    applyViewportToStage();
    return;
  } else if (drag.kind === 'rotate') {
    const angle = Math.atan2(p.y - drag.cy, p.x - drag.cx);
    let deg = drag.startRotation + rad2deg(angle - drag.startAngle);
    deg = ((deg % 360) + 360) % 360;
    const snapped = Math.round(deg / 15) * 15;
    if (Math.abs(deg - snapped) < 2.5) deg = snapped % 360;
    layer.rotation = deg;
  } else if (drag.kind === 'resize') {
    const signX = drag.corner.includes('r') ? 1 : -1;
    const signY = drag.corner.includes('b') ? 1 : -1;
    const rad0 = deg2rad(drag.rotation0);
    const cx0 = drag.x0 + drag.w0 / 2, cy0 = drag.y0 + drag.h0 / 2;
    const anchorLocal = { x: -signX * drag.w0 / 2, y: -signY * drag.h0 / 2 };
    const anchorWorld = { x: cx0 + rotVec(anchorLocal.x, anchorLocal.y, rad0).x, y: cy0 + rotVec(anchorLocal.x, anchorLocal.y, rad0).y };
    const vecWorld = { x: p.x - anchorWorld.x, y: p.y - anchorWorld.y };
    const vecLocal = rotVec(vecWorld.x, vecWorld.y, -rad0);
    let newW = clamp(signX * vecLocal.x, MIN_SIZE, 8000);
    let newH = clamp(signY * vecLocal.y, MIN_SIZE, 8000);
    if (layer.aspectLocked && drag.w0 && drag.h0) {
      const ratio = drag.w0 / drag.h0;
      newH = newW / ratio;
    }
    const centerOffsetLocal = { x: signX * newW / 2, y: signY * newH / 2 };
    const rotated = rotVec(centerOffsetLocal.x, centerOffsetLocal.y, rad0);
    const newCenter = { x: anchorWorld.x + rotated.x, y: anchorWorld.y + rotated.y };
    layer.w = newW; layer.h = newH;
    layer.x = newCenter.x - newW / 2; layer.y = newCenter.y - newH / 2;
  }
  dragTickListeners.forEach((fn) => fn());
  scheduleRender();
}

function onPointerUp(evt) {
  // ---- Tool mode ----
  if (state.activeTool) {
    const p = projectCoords(evt);
    const tool = state.activeTool;
    if (tool === 'lasso') {
      lassoPointerUp();
    } else if (tool === 'brushMask') {
      brushPointerUp();
    } else if (tool === 'gradientMask') {
      gradientPointerUp(p);
    }
    // polygon: closes on tap, handled in pointerdown
    // wand: fires on tap (pointerdown), nothing on up
    return;
  }

  if (evt.pointerType === 'touch') {
    activeTouches.delete(evt.pointerId);
    screenTouches.delete(evt.pointerId);
  }
  // Route to draw tools if active
  const selLayerUp = getSelected();
  if (drawState.activeTool && drawState.activeTool !== 'select' && selLayerUp && selLayerUp.type === 'draw') {
    drawToolsPointerUp(evt);
    return;
  }
  if (!drag) return;
  if ((drag.kind === 'pinch' || drag.kind === 'canvasPinch') && activeTouches.size >= 2) return;

  const d = drag;
  drag = null;

  if (d.kind === 'canvasPinch') return;

  if (d.kind === 'move' && !d.hasMoved) {
    // Restore original positions (relevant when multi-select was active)
    if (d.origPositions) {
      for (const id of Object.keys(d.origPositions)) {
        const l = getLayerById(id);
        if (l) { l.x = d.origPositions[id].x; l.y = d.origPositions[id].y; }
      }
    } else {
      d.layer.x = d.origX;
      d.layer.y = d.origY;
    }
    scheduleRender();
    if (d.potentialSelectId) {
      selectLayer(d.potentialSelectId);
    }
  } else {
    pushHistory();
  }
}
