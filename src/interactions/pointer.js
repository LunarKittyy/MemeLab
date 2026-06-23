import { state, getSelected, MIN_SIZE } from '../core/state.js';
import { clamp, deg2rad, rad2deg, rotVec } from '../core/utils.js';
import { stage, dispScaleFactor, scheduleRender } from '../render/renderer.js';
import { pushHistory } from '../core/history.js';

// Anything that needs to react to selection changing (layer list highlight,
// props panel content, the canvas redraw) registers here.
const selectionListeners = [];
export function onSelectionChange(fn) {
  selectionListeners.push(fn);
}
export function selectLayer(id) {
  state.selectedId = id;
  selectionListeners.forEach((fn) => fn());
}

// Anything that wants a cheap, no-history-commit UI sync during an active
// drag (the X/Y/W/H/rotation number fields in the props panel).
const dragTickListeners = [];
export function onDragTick(fn) {
  dragTickListeners.push(fn);
}

function projectCoords(evt) {
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

export function stageEventsInit() {
  stage.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function onPointerDown(evt) {
  evt.preventDefault();
  const p = projectCoords(evt);
  const ds = dispScaleFactor();

  if (evt.pointerType === 'touch') {
    activeTouches.set(evt.pointerId, p);
    if (activeTouches.size === 2) {
      const sel0 = getSelected();
      if (sel0 && sel0.visible && !sel0.locked) {
        const pts = [...activeTouches.values()];
        const dist0 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        drag = { kind: 'pinch', layer: sel0, dist0, w0: sel0.w, h0: sel0.h, cx0: sel0.x + sel0.w / 2, cy0: sel0.y + sel0.h / 2 };
      } else {
        drag = null;
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
      drag = { kind: 'move', layer: sel, startX: p.x, startY: p.y, origX: sel.x, origY: sel.y, hasMoved: false, potentialSelectId };
      return;
    }
  }

  const hit = hitLayerAt(p.x, p.y);
  if (hit) {
    selectLayer(hit.id);
    stage.setPointerCapture(evt.pointerId);
    drag = { kind: 'move', layer: hit, startX: p.x, startY: p.y, origX: hit.x, origY: hit.y, hasMoved: false };
  } else {
    selectLayer(null);
  }
}

function onPointerMove(evt) {
  if (evt.pointerType === 'touch' && activeTouches.has(evt.pointerId)) {
    activeTouches.set(evt.pointerId, projectCoords(evt));
  }
  if (!drag) return;
  evt.preventDefault();
  const p = projectCoords(evt);
  const layer = drag.layer;

  if (drag.kind === 'move') {
    layer.x = drag.origX + (p.x - drag.startX);
    layer.y = drag.origY + (p.y - drag.startY);
    if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 3) {
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
  if (evt.pointerType === 'touch') activeTouches.delete(evt.pointerId);
  if (!drag) return;
  if (drag.kind === 'pinch' && activeTouches.size >= 2) return;
  
  const d = drag;
  drag = null;

  if (d.kind === 'move' && !d.hasMoved) {
    d.layer.x = d.origX;
    d.layer.y = d.origY;
    scheduleRender();
    if (d.potentialSelectId) {
      selectLayer(d.potentialSelectId);
    }
  } else {
    pushHistory();
  }
}
