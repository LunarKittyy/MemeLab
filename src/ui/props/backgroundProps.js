import { state } from '../../core/state.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { byId } from './shared.js';
import { renderPropsPanel } from './panel.js';
import { setPendingImageTarget, triggerFilePicker } from '../toolbar.js';
import { customSelectHtml, wireCustomSelect } from '../customSelect.js';
import { colorSwatchHtml, wireColorSwatch } from '../colorPicker.js';

const FIT_OPTIONS = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'stretch', label: 'Stretch' },
];

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
        <label>Color</label>${colorSwatchHtml('bgPropColor', bg.color)}
      </div>
      <div id="bgPropImageRow" style="${imageStyle}">
        <button class="smallbtn full" id="bgPropUpload">Upload image</button>
        <div class="row" style="margin-top:8px;">
          <label>Fit</label>
          ${customSelectHtml('bgPropFit', FIT_OPTIONS, bg.fit, 'grow')}
        </div>
      </div>
    </div>`;
}

export function wireBackgroundProps() {
  byId('bgPropTypeSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.background.type = b.dataset.v;
    renderPropsPanel();
    scheduleRender(); pushHistory();
  }));
  if (byId('bgPropColor')) wireColorSwatch('bgPropColor', (hex) => { state.background.color = hex; scheduleRender(); pushHistory(); });
  if (byId('bgPropUpload')) byId('bgPropUpload').addEventListener('click', () => { setPendingImageTarget('background'); triggerFilePicker(); });
  if (byId('bgPropFit')) wireCustomSelect('bgPropFit', (v) => { state.background.fit = v; scheduleRender(); pushHistory(); });
}
