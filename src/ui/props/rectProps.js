import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions } from './shared.js';
import { colorSwatchHtml, wireColorSwatch } from '../colorPicker.js';

function speechBubblePropsHtml(layer) {
  const tailDir = layer.tailDir || 'bottom';
  const tailPos = layer.tailPos !== undefined ? layer.tailPos : 0.5;
  const tailLen = layer.tailLen !== undefined ? layer.tailLen : 30;
  return `
    <div class="section">
      <div class="section-title">Speech Bubble</div>
      <div class="row"><label>Fill</label>${colorSwatchHtml('rColor', layer.color)}</div>
      ${rangeRow('Corner', 'rRadius', 0, Math.round(Math.min(layer.w, layer.h) / 2), 1, layer.radius || 16)}
      ${rangeRow('Border', 'rStrokeW', 0, 40, 1, layer.strokeWidth || 0)}
      <div class="row"><label>Border</label>${colorSwatchHtml('rStrokeColor', layer.strokeColor || '#000000')}</div>
      <div class="row">
        <label>Tail</label>
        <div class="seg" id="rTailDirSeg">
          <button data-v="top" class="${tailDir === 'top' ? 'active' : ''}">Top</button>
          <button data-v="bottom" class="${tailDir === 'bottom' ? 'active' : ''}">Bottom</button>
          <button data-v="left" class="${tailDir === 'left' ? 'active' : ''}">Left</button>
          <button data-v="right" class="${tailDir === 'right' ? 'active' : ''}">Right</button>
        </div>
      </div>
      ${rangeRow('Tail pos', 'rTailPos', 0, 1, 0.01, tailPos)}
      ${rangeRow('Tail len', 'rTailLen', 5, 120, 1, tailLen)}
    </div>
    ${transformHtml(layer)}
    ${actionsHtml()}`;
}

function wireSpeechBubbleProps(layer) {
  wireColorSwatch('rColor', (hex) => { layer.color = hex; scheduleRender(); pushHistory(); });
  byId('rRadius').addEventListener('input', (e) => { layer.radius = +e.target.value; byId('rRadiusval').textContent = e.target.value; scheduleRender(); });
  byId('rRadius').addEventListener('change', pushHistory);
  byId('rStrokeW').addEventListener('input', (e) => { layer.strokeWidth = +e.target.value; byId('rStrokeWval').textContent = e.target.value; scheduleRender(); });
  byId('rStrokeW').addEventListener('change', pushHistory);
  wireColorSwatch('rStrokeColor', (hex) => { layer.strokeColor = hex; scheduleRender(); pushHistory(); });
  byId('rTailDirSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    layer.tailDir = b.dataset.v;
    byId('rTailDirSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    scheduleRender(); pushHistory();
  }));
  byId('rTailPos').addEventListener('input', (e) => { layer.tailPos = +e.target.value; byId('rTailPosval').textContent = (+e.target.value).toFixed(2); scheduleRender(); });
  byId('rTailPos').addEventListener('change', pushHistory);
  byId('rTailLen').addEventListener('input', (e) => { layer.tailLen = +e.target.value; byId('rTailLenval').textContent = e.target.value; scheduleRender(); });
  byId('rTailLen').addEventListener('change', pushHistory);
  wireActions(layer);
}

export function rectPropsHtml(layer) {
  if (layer.subtype === 'speechbubble') return speechBubblePropsHtml(layer);
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
        <div class="row"><label>Fill</label>${colorSwatchHtml('rColor', layer.color)}</div>
      </div>
      <div id="rAmountRow" style="${mode === 'color' ? 'display:none' : ''}">
        ${rangeRow('Amount', 'rAmount', 1, 80, 1, layer.amount || 16)}
      </div>
      ${rangeRow('Corner', 'rRadius', 0, Math.round(Math.min(layer.w, layer.h) / 2), 1, layer.radius)}
      ${rangeRow('Border', 'rStrokeW', 0, 40, 1, layer.strokeWidth)}
      <div class="row"><label>Border</label>${colorSwatchHtml('rStrokeColor', layer.strokeColor)}</div>
    </div>
    ${transformHtml(layer)}
    ${actionsHtml()}`;
}

export function wireRectProps(layer) {
  if (layer.subtype === 'speechbubble') { wireSpeechBubbleProps(layer); return; }
  byId('rModeSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    layer.mode = b.dataset.v;
    const isColor = layer.mode === 'color';
    byId('rColorRow').style.display = isColor ? '' : 'none';
    byId('rAmountRow').style.display = isColor ? 'none' : '';
    byId('rModeSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    scheduleRender(); pushHistory();
  }));
  wireColorSwatch('rColor', (hex) => { layer.color = hex; scheduleRender(); pushHistory(); });
  byId('rAmount').addEventListener('input', (e) => { layer.amount = +e.target.value; byId('rAmountval').textContent = e.target.value; scheduleRender(); });
  byId('rAmount').addEventListener('change', pushHistory);
  byId('rRadius').addEventListener('input', (e) => { layer.radius = +e.target.value; byId('rRadiusval').textContent = e.target.value; scheduleRender(); });
  byId('rRadius').addEventListener('change', pushHistory);
  byId('rStrokeW').addEventListener('input', (e) => { layer.strokeWidth = +e.target.value; byId('rStrokeWval').textContent = e.target.value; scheduleRender(); });
  byId('rStrokeW').addEventListener('change', pushHistory);
  wireColorSwatch('rStrokeColor', (hex) => { layer.strokeColor = hex; scheduleRender(); pushHistory(); });
  wireActions(layer);
}
