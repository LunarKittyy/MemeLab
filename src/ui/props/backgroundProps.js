import { state } from '../../core/state.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { byId } from './shared.js';
import { renderPropsPanel } from './panel.js';
import { setPendingImageTarget, triggerFilePicker, syncBgControls } from '../toolbar.js';

export function backgroundPropsHtml() {
  const bg = state.background;
  const colorStyle = bg.type === 'color' ? 'margin-top:10px;' : 'display:none;margin-top:10px;';
  const imageStyle = bg.type === 'image' ? 'margin-top:10px;' : 'display:none;margin-top:10px;';
  return `
    <div class="section">
      <div class="section-title">Background</div>
      <div class="seg" id="bgPropTypeSeg">
        <button data-v="color" class="${bg.type === 'color' ? 'active' : ''}">Color</button>
        <button data-v="image" class="${bg.type === 'image' ? 'active' : ''}">Image</button>
      </div>
      <div class="row" style="${colorStyle}" id="bgPropColorRow">
        <label>Color</label><input type="color" id="bgPropColor" value="${bg.color}">
      </div>
      <div id="bgPropImageRow" style="${imageStyle}">
        <button class="smallbtn full" id="bgPropUpload">Upload image</button>
        <div class="row" style="margin-top:8px;">
          <label>Fit</label>
          <select class="fullselect grow" id="bgPropFit">
            <option value="cover" ${bg.fit === 'cover' ? 'selected' : ''}>Cover</option>
            <option value="contain" ${bg.fit === 'contain' ? 'selected' : ''}>Contain</option>
            <option value="stretch" ${bg.fit === 'stretch' ? 'selected' : ''}>Stretch</option>
          </select>
        </div>
      </div>
    </div>`;
}

export function wireBackgroundProps() {
  byId('bgPropTypeSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.background.type = b.dataset.v;
    syncBgControls();
    renderPropsPanel();
    scheduleRender(); pushHistory();
  }));
  if (byId('bgPropColor')) byId('bgPropColor').addEventListener('input', (e) => { state.background.color = e.target.value; syncBgControls(); scheduleRender(); });
  if (byId('bgPropColor')) byId('bgPropColor').addEventListener('change', pushHistory);
  if (byId('bgPropUpload')) byId('bgPropUpload').addEventListener('click', () => { setPendingImageTarget('background'); triggerFilePicker(); });
  if (byId('bgPropFit')) byId('bgPropFit').addEventListener('change', (e) => { state.background.fit = e.target.value; syncBgControls(); scheduleRender(); pushHistory(); });
}
