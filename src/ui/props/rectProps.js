import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions } from './shared.js';

export function rectPropsHtml(layer) {
  return `
    <div class="section">
      <div class="section-title">Shape</div>
      <div class="row"><label>Fill</label><input type="color" id="rColor" value="${layer.color}"></div>
      ${rangeRow('Corner', 'rRadius', 0, Math.round(Math.min(layer.w, layer.h) / 2), 1, layer.radius)}
      ${rangeRow('Border', 'rStrokeW', 0, 40, 1, layer.strokeWidth)}
      <div class="row"><label>Border</label><input type="color" id="rStrokeColor" value="${layer.strokeColor}"></div>
    </div>
    ${transformHtml(layer)}
    ${actionsHtml()}`;
}

export function wireRectProps(layer) {
  byId('rColor').addEventListener('input', (e) => { layer.color = e.target.value; scheduleRender(); });
  byId('rColor').addEventListener('change', pushHistory);
  byId('rRadius').addEventListener('input', (e) => { layer.radius = +e.target.value; byId('rRadiusval').textContent = e.target.value; scheduleRender(); });
  byId('rRadius').addEventListener('change', pushHistory);
  byId('rStrokeW').addEventListener('input', (e) => { layer.strokeWidth = +e.target.value; byId('rStrokeWval').textContent = e.target.value; scheduleRender(); });
  byId('rStrokeW').addEventListener('change', pushHistory);
  byId('rStrokeColor').addEventListener('input', (e) => { layer.strokeColor = e.target.value; scheduleRender(); });
  byId('rStrokeColor').addEventListener('change', pushHistory);
  wireActions(layer);
}
