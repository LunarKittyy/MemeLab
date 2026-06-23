import { state, getLayerById, nextId } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender, renderLayersToCtx, updateThumbnails } from '../render/renderer.js';
import { selectLayer } from '../interactions/pointer.js';
import { ICONS } from './icons.js';
import { renderPropsPanel } from './props/panel.js';

export let lastCreatedLayerId = null;
export function setLastCreatedLayerId(id) {
  lastCreatedLayerId = id;
}

function typeBadgeIcon(type) {
  if (type === 'text') return ICONS.textT;
  if (type === 'image') return ICONS.image;
  return ICONS.shape;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---- Drag-to-reorder state ----
let dragState = null; // { layerId, startIdx, pointerStartY, dragging }

function getLayerRowIndex(li) {
  // li has data-layer-idx set during render; returns state.layers index.
  return parseInt(li.dataset.layerIdx, 10);
}

function clearDragIndicators(ul) {
  ul.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((el) => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
}

function getDragTarget(ul, clientY) {
  // Returns { li, position: 'before'|'after' } for the row under the pointer.
  const rows = [...ul.querySelectorAll('.layerrow:not(.bgrow):not(.dragging-source)')].reverse();
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) {
      const mid = r.top + r.height / 2;
      return { li: row, position: clientY < mid ? 'before' : 'after' };
    }
  }
  return null;
}

function commitDrag(ul, clientY) {
  const target = getDragTarget(ul, clientY);
  if (!target || !dragState) return;
  const fromIdx = dragState.startIdx;
  const toStateIdx = getLayerRowIndex(target.li);
  // 'before' in the list (rendered top→bottom = high→low z) means higher z-index.
  const destIdx = target.position === 'before' ? toStateIdx : toStateIdx - 1;
  if (fromIdx === destIdx || fromIdx === destIdx + 1) return;
  const [layer] = state.layers.splice(fromIdx, 1);
  const insertAt = destIdx >= fromIdx ? destIdx : destIdx + 1;
  state.layers.splice(Math.max(0, insertAt), 0, layer);
  pushHistory('Reorder layers');
  renderLayerList();
  scheduleRender();
}

export function renderLayerList() {
  const ul = document.getElementById('layerList');
  ul.innerHTML = '';
  if (state.layers.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.textContent = 'No layers yet. Add text, an image, or a shape above to get started.';
    ul.appendChild(li);
  }
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const l = state.layers[i];
    const li = document.createElement('li');
    li.className = 'layerrow' + (l.id === state.selectedId ? ' selected' : '') + (!l.visible ? ' is-hidden' : '');
    if (l.id === lastCreatedLayerId || (Array.isArray(lastCreatedLayerId) && lastCreatedLayerId.includes(l.id))) {
      li.classList.add('new-layer-pop');
    }
    li.dataset.id = l.id;
    li.dataset.layerIdx = i; // state.layers index for drag calculation
    li.innerHTML = `
      <div class="layer-preview">
        <img class="thumb-img" data-id="${l.id}" width="60" height="60" alt="" />
        <div class="mini-typebadge">${typeBadgeIcon(l.type)}</div>
      </div>
      <input class="lname" value="${escapeAttr(l.name)}" data-id="${l.id}" />
      <div class="lbtns">
        <button class="micro vis" data-id="${l.id}">${l.visible ? ICONS.eye : ICONS.eyeOff}</button>
        <button class="micro lock" data-id="${l.id}">${l.locked ? ICONS.lock : ICONS.unlock}</button>
        <button class="micro dup" data-id="${l.id}">${ICONS.copy}</button>
        <button class="micro merge" data-id="${l.id}" ${i === 0 ? 'disabled title="Nothing below to merge into"' : 'title="Merge down"'}>${ICONS.mergeDown}</button>
        <button class="micro danger del" data-id="${l.id}">${ICONS.trash}</button>
      </div>`;
    li.addEventListener('click', (e) => { if (!e.target.closest('button') && !e.target.closest('input')) selectLayer(l.id); });

    // ---- Per-row drag listeners ----
    li.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      const startY = e.clientY;
      let timer = null;
      const isTouch = e.pointerType === 'touch';

      function startDrag() {
        dragState = { layerId: l.id, startIdx: i, pointerStartY: startY, dragging: true };
        li.classList.add('dragging-source');
        ul.setPointerCapture(e.pointerId);
      }

      if (!isTouch) {
        // Desktop: start drag immediately on first move.
        function onMoveEarly(me) {
          if (Math.abs(me.clientY - startY) > 3) {
            ul.removeEventListener('pointermove', onMoveEarly);
            startDrag();
          }
        }
        ul.addEventListener('pointermove', onMoveEarly);
        li._cancelEarlyMove = () => ul.removeEventListener('pointermove', onMoveEarly);
      } else {
        // Touch: 300 ms longpress; cancel if moved more than 6 px first.
        timer = setTimeout(startDrag, 300);
        function onMoveCheck(me) {
          if (Math.abs(me.clientY - startY) > 6) {
            clearTimeout(timer);
            ul.removeEventListener('pointermove', onMoveCheck);
          }
        }
        ul.addEventListener('pointermove', onMoveCheck);
        li._cancelTimer = () => { clearTimeout(timer); ul.removeEventListener('pointermove', onMoveCheck); };
      }
    });

    ul.appendChild(li);
  }

  // ---- Global drag move / up / cancel on the ul ----
  ul.onpointermove = (e) => {
    if (!dragState || !dragState.dragging) return;
    clearDragIndicators(ul);
    const target = getDragTarget(ul, e.clientY);
    if (target) target.li.classList.add(target.position === 'before' ? 'drag-over-top' : 'drag-over-bottom');
  };
  ul.onpointerup = (e) => {
    if (!dragState) return;
    if (dragState.dragging) {
      clearDragIndicators(ul);
      commitDrag(ul, e.clientY);
      document.querySelectorAll('.dragging-source').forEach(el => el.classList.remove('dragging-source'));
    }
    dragState = null;
  };
  ul.onpointercancel = () => {
    if (dragState) {
      clearDragIndicators(ul);
      document.querySelectorAll('.dragging-source').forEach(el => el.classList.remove('dragging-source'));
      dragState = null;
    }
    renderLayerList(); // restore state
  };

  const bg = document.createElement('li');
  bg.className = 'layerrow bgrow' + (state.selectedId === 'background' ? ' selected' : '');
  bg.innerHTML = `
    <div class="layer-preview">
      <img class="thumb-img" data-id="background" width="60" height="60" alt="" />
      <div class="mini-typebadge">${ICONS.image}</div>
    </div>
    <div class="lname" style="padding:5px 0;">Background</div>`;
  bg.addEventListener('click', () => selectLayer('background'));
  ul.appendChild(bg);

  ul.querySelectorAll('.vis').forEach((b) => b.addEventListener('click', () => { const l = getLayerById(b.dataset.id); l.visible = !l.visible; pushHistory('Toggle visibility'); renderLayerList(); scheduleRender(); }));
  ul.querySelectorAll('.lock').forEach((b) => b.addEventListener('click', () => { const l = getLayerById(b.dataset.id); l.locked = !l.locked; pushHistory('Toggle lock'); renderLayerList(); scheduleRender(); }));
  ul.querySelectorAll('.del').forEach((b) => b.addEventListener('click', () => deleteLayer(b.dataset.id)));
  ul.querySelectorAll('.dup').forEach((b) => b.addEventListener('click', () => duplicateLayer(b.dataset.id)));
  ul.querySelectorAll('.merge').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) mergeLayerDown(b.dataset.id); }));
  ul.querySelectorAll('.lname').forEach((inp) => {
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('change', () => { const l = getLayerById(inp.dataset.id); l.name = inp.value || l.name; pushHistory('Rename layer'); });
  });
  lastCreatedLayerId = null;
  updateThumbnails();
}

export function deleteLayer(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  state.layers.splice(idx, 1);
  if (state.selectedId === id) state.selectedId = null;
  pushHistory('Delete layer'); renderLayerList(); renderPropsPanel(); scheduleRender();
}

export function duplicateLayer(id) {
  const l = getLayerById(id);
  if (!l) return;
  const copy = JSON.parse(JSON.stringify(l));
  copy.id = nextId();
  copy.name = l.name + ' copy';
  copy.x += 18; copy.y += 18;
  const idx = state.layers.findIndex((x) => x.id === id);
  state.layers.splice(idx + 1, 0, copy);
  lastCreatedLayerId = copy.id;
  selectLayer(copy.id);
  pushHistory('Duplicate layer');
}


// ---- Merge layer down ----
export function mergeLayerDown(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx <= 0) return; // nothing below
  const topLayer    = state.layers[idx];
  const bottomLayer = state.layers[idx - 1];

  // Composite both layers onto a full-canvas offscreen at logical size.
  const W = state.width, H = state.height;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ctx = off.getContext('2d');
  renderLayersToCtx(ctx, [bottomLayer, topLayer]);

  const src = off.toDataURL('image/png');
  const mergedLayer = {
    id: nextId(),
    type: 'image',
    name: bottomLayer.name + ' + ' + topLayer.name,
    x: 0, y: 0, w: W, h: H,
    rotation: 0, opacity: 1, visible: true, locked: false, aspectLocked: false,
    src, naturalW: W, naturalH: H,
    flipX: false, flipY: false, exposure: 0,
  };

  state.layers.splice(idx - 1, 2, mergedLayer);
  lastCreatedLayerId = mergedLayer.id;
  selectLayer(mergedLayer.id);
  pushHistory('Merge layer down');
}

// ---- Layer depth / sorting helpers ----
export function moveLayerUp(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx === -1 || idx === state.layers.length - 1) return;
  const [layer] = state.layers.splice(idx, 1);
  state.layers.splice(idx + 1, 0, layer);
  pushHistory('Bring layer forward'); renderLayerList(); scheduleRender();
}

export function moveLayerDown(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx === -1 || idx === 0) return;
  const [layer] = state.layers.splice(idx, 1);
  state.layers.splice(idx - 1, 0, layer);
  pushHistory('Send layer backward'); renderLayerList(); scheduleRender();
}

export function moveLayerToTop(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx === -1 || idx === state.layers.length - 1) return;
  const [layer] = state.layers.splice(idx, 1);
  state.layers.push(layer);
  pushHistory('Bring layer to front'); renderLayerList(); scheduleRender();
}

export function moveLayerToBottom(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx === -1 || idx === 0) return;
  const [layer] = state.layers.splice(idx, 1);
  state.layers.unshift(layer);
  pushHistory('Send layer to back'); renderLayerList(); scheduleRender();
}
