import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions } from './shared.js';
import { renderPropsPanel } from './panel.js';

export function rectPropsHtml(layer) {
  const mode = layer.mode || 'color';
  return `
    <div class="section">
      <div class="section-title">Shape</div>
      <div class="row">
        <label>Mode</label>
        <div class="seg" id="rModeSeg">
          <button data-v="color" class="${mode === 'color' ? 'active' : ''}">Color</button>
          <button data-v="blur" class="${mode === 'blur' ? 'active' : ''}">Blur</button>
          <button data-v="pixelate" class="${mode === 'pixelate' ? 'active' : ''}">Pixel</button>
        </div>
      </div>
      <div id="rColorRow" style="${mode !== 'color' ? 'display:none' : ''}">
        <div class="row"><label>Fill</label><input type="color" id="rColor" value="${layer.color}"></div>
      </div>
      <div id="rAmountRow" style="${mode === 'color' ? 'display:none' : ''}">
        ${rangeRow('Amount', 'rAmount', 1, 80, 1, layer.amount || 16)}
      </div>
      ${rangeRow('Corner', 'rRadius', 0, Math.round(Math.min(layer.w, layer.h) / 2), 1, layer.radius)}
      ${rangeRow('Border', 'rStrokeW', 0, 40, 1, layer.strokeWidth)}
      <div class="row"><label>Border</label><input type="color" id="rStrokeColor" value="${layer.strokeColor}"></div>
    </div>
    ${transformHtml(layer)}
    ${actionsHtml()}`;
}

export function wireRectProps(layer) {
  byId('rModeSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    layer.mode = b.dataset.v;
    const isColor = layer.mode === 'color';
    byId('rColorRow').style.display = isColor ? '' : 'none';
    byId('rAmountRow').style.display = isColor ? 'none' : '';
    byId('rModeSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    scheduleRender(); pushHistory();
  }));
  byId('rColor').addEventListener('input', (e) => { layer.color = e.target.value; scheduleRender(); });
  byId('rColor').addEventListener('change', pushHistory);
  byId('rAmount').addEventListener('input', (e) => { layer.amount = +e.target.value; byId('rAmountval').textContent = e.target.value; scheduleRender(); });
  byId('rAmount').addEventListener('change', pushHistory);
  byId('rRadius').addEventListener('input', (e) => { layer.radius = +e.target.value; byId('rRadiusval').textContent = e.target.value; scheduleRender(); });
  byId('rRadius').addEventListener('change', pushHistory);
  byId('rStrokeW').addEventListener('input', (e) => { layer.strokeWidth = +e.target.value; byId('rStrokeWval').textContent = e.target.value; scheduleRender(); });
  byId('rStrokeW').addEventListener('change', pushHistory);
  byId('rStrokeColor').addEventListener('input', (e) => { layer.strokeColor = e.target.value; scheduleRender(); });
  byId('rStrokeColor').addEventListener('change', pushHistory);
  wireActions(layer);
}
