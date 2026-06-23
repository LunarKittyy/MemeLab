import { MIN_SIZE, getSelected } from '../../core/state.js';
import { clamp } from '../../core/utils.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { onDragTick } from '../../interactions/pointer.js';
import { deleteLayer, duplicateLayer } from '../layerList.js';

export function byId(id) {
  return document.getElementById(id);
}

export function escapeHtmlContent(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function field(labelText, innerHtml) {
  return `<div class="row"><label>${labelText}</label>${innerHtml}</div>`;
}

export function rangeRow(labelText, id, min, max, step, value) {
  return `<div class="row"><label>${labelText}</label><input class="grow" type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><span class="rangeval" id="${id}val">${value}</span></div>`;
}

export function transformHtml(layer) {
  return `
    <div class="section">
      <div class="section-title">Transform</div>
      <div class="sizegrid">
        <div class="numfield"><span>X</span><input class="fullinput" type="number" id="pX" value="${Math.round(layer.x)}"></div>
        <div class="numfield"><span>Y</span><input class="fullinput" type="number" id="pY" value="${Math.round(layer.y)}"></div>
        <div class="numfield"><span>W</span><input class="fullinput" type="number" id="pW" value="${Math.round(layer.w)}"></div>
        <div class="numfield"><span>H</span><input class="fullinput" type="number" id="pH" value="${Math.round(layer.h)}"></div>
      </div>
      ${rangeRow('Rotate', 'pRot', 0, 359, 1, Math.round(layer.rotation))}
      ${rangeRow('Opacity', 'pOpac', 0, 1, 0.01, layer.opacity)}
    </div>`;
}

export function wireCommonTransformProps(layer) {
  byId('pX').addEventListener('input', (e) => { layer.x = +e.target.value || 0; scheduleRender(); });
  byId('pY').addEventListener('input', (e) => { layer.y = +e.target.value || 0; scheduleRender(); });
  byId('pW').addEventListener('input', (e) => { layer.w = clamp(+e.target.value || MIN_SIZE, MIN_SIZE, 8000); scheduleRender(); });
  byId('pH').addEventListener('input', (e) => { layer.h = clamp(+e.target.value || MIN_SIZE, MIN_SIZE, 8000); scheduleRender(); });
  ['pX', 'pY', 'pW', 'pH'].forEach((id) => byId(id).addEventListener('change', pushHistory));
  byId('pRot').addEventListener('input', (e) => { layer.rotation = +e.target.value; byId('pRotval').textContent = e.target.value; scheduleRender(); });
  byId('pRot').addEventListener('change', pushHistory);
  byId('pOpac').addEventListener('input', (e) => { layer.opacity = +e.target.value; byId('pOpacval').textContent = e.target.value; scheduleRender(); });
  byId('pOpac').addEventListener('change', pushHistory);
}

export function actionsHtml() {
  return `<div class="section"><div class="row"><button class="smallbtn full" id="pDup">Duplicate</button><button class="smallbtn full danger" id="pDel" style="color:var(--danger);border-color:var(--danger);">Delete</button></div></div>`;
}

export function wireActions(layer) {
  byId('pDup').addEventListener('click', () => duplicateLayer(layer.id));
  byId('pDel').addEventListener('click', () => deleteLayer(layer.id));
}

// Cheap, no-history-commit refresh of the transform number fields, called on
// every pointermove tick during a drag/resize/rotate.
export function syncTransformInputs() {
  const layer = getSelected();
  if (!layer) return;
  if (byId('pX')) byId('pX').value = Math.round(layer.x);
  if (byId('pY')) byId('pY').value = Math.round(layer.y);
  if (byId('pW')) byId('pW').value = Math.round(layer.w);
  if (byId('pH')) byId('pH').value = Math.round(layer.h);
  if (byId('pRot')) { byId('pRot').value = Math.round(layer.rotation); byId('pRotval').textContent = Math.round(layer.rotation); }
}
onDragTick(syncTransformInputs);
