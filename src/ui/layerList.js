import { state, getLayerById, nextId } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender } from '../render/renderer.js';
import { selectLayer } from '../interactions/pointer.js';
import { ICONS } from './icons.js';
import { renderPropsPanel } from './props/panel.js';

function typeBadgeIcon(type) {
  if (type === 'text') return ICONS.textT;
  if (type === 'image') return ICONS.image;
  return ICONS.shape;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
    li.innerHTML = `
      <div class="typebadge">${typeBadgeIcon(l.type)}</div>
      <input class="lname" value="${escapeAttr(l.name)}" data-id="${l.id}" />
      <div class="reorder">
        <button class="micro reorder-up" data-id="${l.id}">${ICONS.chevronUp}</button>
        <button class="micro reorder-down" data-id="${l.id}">${ICONS.chevronDown}</button>
      </div>
      <div class="lbtns">
        <button class="micro vis" data-id="${l.id}">${l.visible ? ICONS.eye : ICONS.eyeOff}</button>
        <button class="micro lock" data-id="${l.id}">${l.locked ? ICONS.lock : ICONS.unlock}</button>
        <button class="micro dup" data-id="${l.id}">${ICONS.copy}</button>
        <button class="micro danger del" data-id="${l.id}">${ICONS.trash}</button>
      </div>`;
    li.addEventListener('click', (e) => { if (!e.target.closest('button') && !e.target.closest('input')) selectLayer(l.id); });
    ul.appendChild(li);
  }
  const bg = document.createElement('li');
  bg.className = 'layerrow bgrow' + (state.selectedId === 'background' ? ' selected' : '');
  bg.innerHTML = `<div class="typebadge">${ICONS.image}</div><div class="lname" style="padding:5px 0;">Background</div>`;
  bg.addEventListener('click', () => selectLayer('background'));
  ul.appendChild(bg);

  ul.querySelectorAll('.vis').forEach((b) => b.addEventListener('click', () => { const l = getLayerById(b.dataset.id); l.visible = !l.visible; pushHistory(); renderLayerList(); scheduleRender(); }));
  ul.querySelectorAll('.lock').forEach((b) => b.addEventListener('click', () => { const l = getLayerById(b.dataset.id); l.locked = !l.locked; pushHistory(); renderLayerList(); scheduleRender(); }));
  ul.querySelectorAll('.del').forEach((b) => b.addEventListener('click', () => deleteLayer(b.dataset.id)));
  ul.querySelectorAll('.dup').forEach((b) => b.addEventListener('click', () => duplicateLayer(b.dataset.id)));
  ul.querySelectorAll('.reorder-up').forEach((b) => b.addEventListener('click', () => reorderLayer(b.dataset.id, 1)));
  ul.querySelectorAll('.reorder-down').forEach((b) => b.addEventListener('click', () => reorderLayer(b.dataset.id, -1)));
  ul.querySelectorAll('.lname').forEach((inp) => {
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('change', () => { const l = getLayerById(inp.dataset.id); l.name = inp.value || l.name; pushHistory(); });
  });
}

export function deleteLayer(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  state.layers.splice(idx, 1);
  if (state.selectedId === id) state.selectedId = null;
  pushHistory(); renderLayerList(); renderPropsPanel(); scheduleRender();
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
  selectLayer(copy.id);
  pushHistory(); renderLayerList(); scheduleRender();
}

export function reorderLayer(id, dir) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.layers.length) return;
  const tmp = state.layers[idx];
  state.layers[idx] = state.layers[newIdx];
  state.layers[newIdx] = tmp;
  pushHistory(); renderLayerList(); scheduleRender();
}
