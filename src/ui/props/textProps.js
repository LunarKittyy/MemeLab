import { FONT_OPTIONS } from '../../core/layers.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { ICONS } from '../icons.js';
import { byId, rangeRow, escapeHtmlContent, transformHtml, actionsHtml, wireActions } from './shared.js';
import { renderPropsPanel } from './panel.js';
import { customSelectHtml, wireCustomSelect } from '../customSelect.js';
import { colorSwatchHtml, wireColorSwatch } from '../colorPicker.js';

export function textPropsHtml(layer) {
  return `
    <div class="section">
      <div class="section-title">Text</div>
      <textarea class="fullinput" id="tText">${escapeHtmlContent(layer.text)}</textarea>
      <div class="row" style="margin-top:8px;">
        <label>Font</label>
        ${customSelectHtml('tFont', FONT_OPTIONS, layer.font, 'grow')}
      </div>
      ${rangeRow('Scale', 'tSize', 5, 100, 1, Math.round((layer.sizeScale ?? 0.6) * 100))}
      <div class="row">
        <label>Color</label>${colorSwatchHtml('tColor', layer.color)}
        <div class="seg" style="margin-left:8px;">
          <button id="tBold" class="${layer.bold ? 'active' : ''}" style="font-weight:800;">B</button>
          <button id="tItalic" class="${layer.italic ? 'active' : ''}" style="font-style:italic;">I</button>
        </div>
      </div>
      <div class="row">
        <label>Align</label>
        <div class="seg" id="tAlignSeg">
          <button data-v="left" class="${layer.align === 'left' ? 'active' : ''}">${ICONS.alignLeft}</button>
          <button data-v="center" class="${layer.align === 'center' ? 'active' : ''}">${ICONS.alignCenter}</button>
          <button data-v="right" class="${layer.align === 'right' ? 'active' : ''}">${ICONS.alignRight}</button>
        </div>
      </div>
      <div class="row">
        <label>Vertical</label>
        <div class="seg" id="tVAlignSeg">
          <button data-v="top" class="${layer.vAlign === 'top' ? 'active' : ''}">${ICONS.vTop}</button>
          <button data-v="middle" class="${layer.vAlign === 'middle' ? 'active' : ''}">${ICONS.vMid}</button>
          <button data-v="bottom" class="${layer.vAlign === 'bottom' ? 'active' : ''}">${ICONS.vBot}</button>
        </div>
      </div>
      ${rangeRow('Line ht', 'tLineH', 0.8, 2.2, 0.05, layer.lineHeight)}
      ${rangeRow('Spacing', 'tSpacing', -4, 30, 1, layer.letterSpacing)}
      ${rangeRow('Padding', 'tPadding', 0, 80, 1, layer.padding)}
    </div>
    <div class="section">
      <div class="togglerow"><div class="section-title" style="margin:0;">Outline</div>
        <label class="switch"><input type="checkbox" id="tStrokeOn" ${layer.stroke.enabled ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
      </div>
      <div id="tStrokeControls" style="display:${layer.stroke.enabled ? 'block' : 'none'}">
        <div class="row" style="margin-top:10px;">
          <label>Color</label>${colorSwatchHtml('tStrokeColor', layer.stroke.color)}
        </div>
        ${rangeRow('Width', 'tStrokeWidth', 0, 40, 1, layer.stroke.width)}
      </div>
    </div>
    <div class="section">
      <div class="togglerow"><div class="section-title" style="margin:0;">Background box</div>
        <label class="switch"><input type="checkbox" id="tBoxOn" ${layer.box.enabled ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
      </div>
      <div id="tBoxControls" style="display:${layer.box.enabled ? 'block' : 'none'}">
        <div class="row" style="margin-top:10px;">
          <label>Color</label>${colorSwatchHtml('tBoxColor', layer.box.color)}
        </div>
      </div>
    </div>
    ${transformHtml(layer)}
    <div class="section">
      <div class="togglerow"><span style="font-size:11.5px;color:var(--text-dim);">Lock aspect ratio</span>
        <label class="switch"><input type="checkbox" id="tAspect" ${layer.aspectLocked ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
      </div>
    </div>
    ${actionsHtml()}`;
}

export function wireTextProps(layer) {
  byId('tText').addEventListener('input', (e) => { layer.text = e.target.value; scheduleRender(); });
  byId('tText').addEventListener('change', pushHistory);
  wireCustomSelect('tFont', (v) => {
    if (v === '__custom__') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.ttf,.otf,.woff,.woff2';
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const familyName = 'CustomFont_' + Date.now();
        const url = URL.createObjectURL(file);
        const face = new FontFace(familyName, `url(${url})`);
        try {
          await face.load();
        } catch {
          URL.revokeObjectURL(url);
          alert('Could not load font file. Make sure it\'s a valid TTF, OTF, or WOFF.');
          return;
        }
        document.fonts.add(face);
        layer.font = familyName;
        const label = file.name.replace(/\.[^.]+$/, '');
        const sel = byId('tFont');
        if (sel) { sel.dataset.value = familyName; sel.querySelector('.csel-label').textContent = label; }
        scheduleRender(); pushHistory();
      });
      input.click();
      return;
    }
    layer.font = v; scheduleRender(); pushHistory();
  });
  byId('tSize').addEventListener('input', (e) => { layer.sizeScale = +e.target.value / 100; byId('tSizeval').textContent = e.target.value + '%'; scheduleRender(); });
  byId('tSize').addEventListener('change', pushHistory);
  byId('tSizeval').textContent = Math.round((layer.sizeScale ?? 0.6) * 100) + '%';
  wireColorSwatch('tColor', (hex) => { layer.color = hex; scheduleRender(); pushHistory(); });
  byId('tBold').addEventListener('click', () => { layer.bold = !layer.bold; renderPropsPanel(); scheduleRender(); pushHistory(); });
  byId('tItalic').addEventListener('click', () => { layer.italic = !layer.italic; renderPropsPanel(); scheduleRender(); pushHistory(); });
  byId('tAlignSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { layer.align = b.dataset.v; renderPropsPanel(); scheduleRender(); pushHistory(); }));
  byId('tVAlignSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { layer.vAlign = b.dataset.v; renderPropsPanel(); scheduleRender(); pushHistory(); }));
  byId('tLineH').addEventListener('input', (e) => { layer.lineHeight = +e.target.value; byId('tLineHval').textContent = e.target.value; scheduleRender(); });
  byId('tLineH').addEventListener('change', pushHistory);
  byId('tSpacing').addEventListener('input', (e) => { layer.letterSpacing = +e.target.value; byId('tSpacingval').textContent = e.target.value; scheduleRender(); });
  byId('tSpacing').addEventListener('change', pushHistory);
  byId('tPadding').addEventListener('input', (e) => { layer.padding = +e.target.value; byId('tPaddingval').textContent = e.target.value; scheduleRender(); });
  byId('tPadding').addEventListener('change', pushHistory);
  byId('tStrokeOn').addEventListener('change', (e) => {
    layer.stroke.enabled = e.target.checked;
    byId('tStrokeControls').style.display = e.target.checked ? 'block' : 'none';
    scheduleRender(); pushHistory();
  });
  wireColorSwatch('tStrokeColor', (hex) => { layer.stroke.color = hex; scheduleRender(); pushHistory(); });
  byId('tStrokeWidth').addEventListener('input', (e) => { layer.stroke.width = +e.target.value; byId('tStrokeWidthval').textContent = e.target.value; scheduleRender(); });
  byId('tStrokeWidth').addEventListener('change', pushHistory);
  byId('tBoxOn').addEventListener('change', (e) => {
    layer.box.enabled = e.target.checked;
    byId('tBoxControls').style.display = e.target.checked ? 'block' : 'none';
    scheduleRender(); pushHistory();
  });
  wireColorSwatch('tBoxColor', (hex) => { layer.box.color = hex; scheduleRender(); pushHistory(); });
  byId('tAspect').addEventListener('change', (e) => { layer.aspectLocked = e.target.checked; pushHistory(); });
  wireActions(layer);
}
