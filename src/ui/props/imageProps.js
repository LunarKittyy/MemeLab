import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions } from './shared.js';
import { renderPropsPanel } from './panel.js';
import { setPendingImageTarget, triggerFilePicker } from '../toolbar.js';

export function imagePropsHtml(layer) {
  return `
    <div class="section">
      <div class="section-title">Image</div>
      <div class="row"><button class="smallbtn full" id="iReplace">Replace image</button></div>
      <div class="row">
        <label>Flip</label>
        <div class="seg">
          <button id="iFlipH" class="${layer.flipX ? 'active' : ''}">Horizontal</button>
          <button id="iFlipV" class="${layer.flipY ? 'active' : ''}">Vertical</button>
        </div>
      </div>
      <div class="togglerow" style="margin-top:8px;"><span style="font-size:11.5px;color:var(--text-dim);">Lock aspect ratio</span>
        <label class="switch"><input type="checkbox" id="iAspect" ${layer.aspectLocked ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
      </div>
      ${rangeRow('Exposure', 'iExposure', -100, 100, 1, layer.exposure ?? 0)}
    </div>
    ${transformHtml(layer)}
    ${actionsHtml()}`;
}

export function wireImageProps(layer) {
  byId('iReplace').addEventListener('click', () => { setPendingImageTarget(layer); triggerFilePicker(); });
  byId('iFlipH').addEventListener('click', () => { layer.flipX = !layer.flipX; renderPropsPanel(); scheduleRender(); pushHistory(); });
  byId('iFlipV').addEventListener('click', () => { layer.flipY = !layer.flipY; renderPropsPanel(); scheduleRender(); pushHistory(); });
  byId('iAspect').addEventListener('change', (e) => { layer.aspectLocked = e.target.checked; pushHistory(); });
  byId('iExposure').addEventListener('input', (e) => {
    layer.exposure = Number(e.target.value);
    byId('iExposureval').textContent = layer.exposure;
    scheduleRender();
  });
  byId('iExposure').addEventListener('change', () => pushHistory());
  wireActions(layer);
}
