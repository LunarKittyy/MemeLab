import { state, getLayerById, nextId, pruneImageCache } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender, renderLayersToCtx, updateThumbnails } from '../render/renderer.js';
import { selectLayer } from '../interactions/pointer.js';
import { ICONS } from './icons.js';
import { renderPropsPanel } from './props/panel.js';
import { showContextMenu } from './contextMenu.js';

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

let dragState = null;
let _suppressNextClick = false;

function getLayerRowIndex(li) {
  return parseInt(li.dataset.layerIdx, 10);
}

function clearDragIndicators(ul) {
  ul.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((el) => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
}

function getDragTarget(ul, clientY) {
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
  const destIdx = target.position === 'before' ? toStateIdx : toStateIdx - 1;
  if (fromIdx === destIdx || fromIdx === destIdx + 1) return;
  const [layer] = state.layers.splice(fromIdx, 1);
  const insertAt = destIdx >= fromIdx ? destIdx : destIdx + 1;
  state.layers.splice(Math.max(0, insertAt), 0, layer);
  pushHistory('Reorder layers');
  renderLayerList();
  scheduleRender();
}

export function updateLayerListSelection() {
  const ul = document.getElementById('layerList');
  ul.querySelectorAll('.layerrow[data-id]').forEach(li => {
    li.classList.toggle('selected', li.dataset.id === state.selectedId);
  });
  const bg = ul.querySelector('.bgrow');
  if (bg) bg.classList.toggle('selected', state.selectedId === 'background');
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
    li.dataset.layerIdx = i;
    li.innerHTML = `
      <div class="layer-preview">
        <img class="thumb-img" data-id="${l.id}" width="60" height="60" alt="" draggable="false" />
        <div class="mini-typebadge">${typeBadgeIcon(l.type)}</div>
      </div>
      <input class="lname" value="${escapeAttr(l.name)}" data-id="${l.id}" />
      <div class="lbtns">
        <button class="micro vis" data-id="${l.id}">${l.visible ? ICONS.eye : ICONS.eyeOff}</button>
        <button class="micro lock" data-id="${l.id}">${l.locked ? ICONS.lock : ICONS.unlock}</button>
      </div>
      <div class="layer-drag-handle" title="Drag to reorder">
        <svg viewBox="0 0 8 14" fill="currentColor" width="10" height="14">
          <circle cx="2" cy="2" r="1.4"/><circle cx="6" cy="2" r="1.4"/>
          <circle cx="2" cy="7" r="1.4"/><circle cx="6" cy="7" r="1.4"/>
          <circle cx="2" cy="12" r="1.4"/><circle cx="6" cy="12" r="1.4"/>
        </svg>
      </div>`;
    li.addEventListener('click', (e) => {
      if (_suppressNextClick) return;
      if (!e.target.closest('button') && !e.target.closest('.layer-drag-handle')) selectLayer(l.id);
    });

    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = state.layers.findIndex(x => x.id === l.id);
      showContextMenu(e.clientX, e.clientY, [
        { action: 'vis',   label: l.visible ? 'Hide layer' : 'Show layer', onClick: () => { l.visible = !l.visible; pushHistory('Toggle visibility'); renderLayerList(); scheduleRender(); } },
        { action: 'lock',  label: l.locked ? 'Unlock layer' : 'Lock layer', onClick: () => { l.locked = !l.locked; pushHistory('Toggle lock'); renderLayerList(); scheduleRender(); } },
        'sep',
        { action: 'dup',   label: 'Duplicate', onClick: () => duplicateLayer(l.id) },
        ...(idx > 0 ? [{ action: 'merge', label: 'Merge down', onClick: () => mergeLayerDown(l.id) }] : []),
        'sep',
        { action: 'del',   label: 'Delete', danger: true, onClick: () => deleteLayer(l.id) },
      ]);
    });

    li.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button') || e.target.closest('input')) return;
      const startX = e.clientX, startY = e.clientY;
      const fromHandle = !!e.target.closest('.layer-drag-handle');

      function startDrag() {
        cancel();
        dragState = { layerId: l.id, startIdx: i, pointerStartY: startY, dragging: true };
        li.classList.add('dragging-source');
        ul.setPointerCapture(e.pointerId);
      }

      const threshold = fromHandle ? 4 : (e.pointerType === 'touch' ? 10 : 3);

      function onMoveEarly(me) {
        if (Math.hypot(me.clientX - startX, me.clientY - startY) > threshold) startDrag();
      }

      function cancel() {
        ul.removeEventListener('pointermove', onMoveEarly);
        ul.removeEventListener('pointerup', cancelOnUp);
        ul.removeEventListener('pointercancel', cancelOnUp);
      }

      function cancelOnUp() { cancel(); if (fromHandle) selectLayer(l.id); }

      ul.addEventListener('pointermove', onMoveEarly);
      ul.addEventListener('pointerup', cancelOnUp);
      ul.addEventListener('pointercancel', cancelOnUp);
    });

    ul.appendChild(li);
  }

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
      _suppressNextClick = true;
      setTimeout(() => { _suppressNextClick = false; }, 0);
    }
    dragState = null;
  };
  function cancelDragState() {
    if (dragState) {
      clearDragIndicators(ul);
      document.querySelectorAll('.dragging-source').forEach(el => el.classList.remove('dragging-source'));
      dragState = null;
    }
    renderLayerList();
  }
  ul.onpointercancel = cancelDragState;
  ul.oncontextmenu = (e) => { if (dragState) { e.preventDefault(); cancelDragState(); } };

  const bg = document.createElement('li');
  bg.className = 'layerrow bgrow' + (state.selectedId === 'background' ? ' selected' : '');
  bg.innerHTML = `
    <div class="layer-preview">
      <img class="thumb-img" data-id="background" width="60" height="60" alt="" draggable="false" />
      <div class="mini-typebadge">${ICONS.image}</div>
    </div>
    <div class="lname" style="padding:5px 0;flex:1;">Background</div>`;
  bg.addEventListener('click', () => selectLayer('background'));
  ul.appendChild(bg);

  ul.querySelectorAll('.vis').forEach((b) => b.addEventListener('click', () => { const l = getLayerById(b.dataset.id); l.visible = !l.visible; pushHistory('Toggle visibility'); renderLayerList(); scheduleRender(); }));
  ul.querySelectorAll('.lock').forEach((b) => b.addEventListener('click', () => { const l = getLayerById(b.dataset.id); l.locked = !l.locked; pushHistory('Toggle lock'); renderLayerList(); scheduleRender(); }));
  ul.querySelectorAll('input.lname').forEach((inp) => {
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
  pruneImageCache();
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
  renderLayerList();
  selectLayer(copy.id);
  pushHistory('Duplicate layer');
}


export function mergeLayerDown(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx <= 0) return;
  const topLayer    = state.layers[idx];
  const bottomLayer = state.layers[idx - 1];
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
    flipX: false, flipY: false,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    mask: { enabled: false, src: null, invert: false, feather: 0 },
    adjustments: [], blendMode: 'normal',
  };

  state.layers.splice(idx - 1, 2, mergedLayer);
  lastCreatedLayerId = mergedLayer.id;
  renderLayerList();
  selectLayer(mergedLayer.id);
  pushHistory('Merge layer down');
}

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
