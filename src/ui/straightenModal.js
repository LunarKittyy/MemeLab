// Straighten / horizon grid modal.
// Non-destructive: sets state.straighten (degrees, stored in history/snapshot).
// The rotation is applied in renderScene() around the canvas center.

import { state } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender, renderScene } from '../render/renderer.js';

let _modal = null, _canvas = null, _ctx = null;
let _currentAngle = 0;

const MAX_W = 640, MAX_H = 480;

function buildModal() {
  const el = document.createElement('div');
  el.className = 'crop-overlay';
  el.innerHTML = `
    <div class="crop-modal straighten-modal">
      <div class="crop-header">Straighten</div>
      <canvas class="crop-canvas straighten-canvas" id="stCanvas"></canvas>
      <div class="straighten-controls">
        <div class="row" style="gap:10px;align-items:center;">
          <label style="font-size:12px;color:var(--text-dim);min-width:50px;">Angle</label>
          <input type="range" id="stSlider" min="-45" max="45" step="0.1" value="0" style="flex:1;">
          <span id="stAngleVal" style="font-size:12px;color:var(--text-dim);min-width:40px;text-align:right;">0°</span>
        </div>
      </div>
      <div class="crop-footer">
        <button class="smallbtn" id="stReset">Reset</button>
        <span style="flex:1"></span>
        <button class="smallbtn" id="stCancel">Cancel</button>
        <button class="smallbtn crop-apply-btn" id="stApply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  _canvas = el.querySelector('#stCanvas');
  _ctx = _canvas.getContext('2d');

  el.addEventListener('click', (e) => { if (e.target === el) cancel(); });
  el.querySelector('#stCancel').addEventListener('click', cancel);
  el.querySelector('#stApply').addEventListener('click', apply);
  el.querySelector('#stReset').addEventListener('click', () => {
    _currentAngle = 0;
    el.querySelector('#stSlider').value = 0;
    el.querySelector('#stAngleVal').textContent = '0°';
    drawPreview();
  });

  el.querySelector('#stSlider').addEventListener('input', (e) => {
    _currentAngle = parseFloat(e.target.value);
    el.querySelector('#stAngleVal').textContent = _currentAngle.toFixed(1) + '°';
    drawPreview();
  });

  return el;
}

function drawPreview() {
  const W = _canvas.width, H = _canvas.height;
  _ctx.clearRect(0, 0, W, H);

  // Draw scene rotated around center.
  _ctx.save();
  _ctx.fillStyle = '#1a1525';
  _ctx.fillRect(0, 0, W, H);

  const prevStraighten = state.straighten;
  state.straighten = _currentAngle;
  // Scale to fit the canvas.
  const scaleX = W / state.width, scaleY = H / state.height;
  const scale = Math.min(scaleX, scaleY) * 0.88; // 12% inset to show rotation
  const offX = (W - state.width * scale) / 2;
  const offY = (H - state.height * scale) / 2;

  _ctx.save();
  _ctx.translate(offX, offY);
  _ctx.scale(scale, scale);
  renderScene(_ctx, { forExport: true });
  _ctx.restore();
  state.straighten = prevStraighten;

  // Draw grid overlay (rule of thirds over the full preview area).
  _ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  _ctx.lineWidth = 1;
  _ctx.setLineDash([4, 4]);
  for (let i = 1; i <= 2; i++) {
    _ctx.beginPath(); _ctx.moveTo(W * i / 3, 0); _ctx.lineTo(W * i / 3, H); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(0, H * i / 3); _ctx.lineTo(W, H * i / 3); _ctx.stroke();
  }
  // Center cross
  _ctx.strokeStyle = 'rgba(255,100,100,0.5)';
  _ctx.lineWidth = 1;
  _ctx.setLineDash([2, 4]);
  _ctx.beginPath(); _ctx.moveTo(W / 2, 0); _ctx.lineTo(W / 2, H); _ctx.stroke();
  _ctx.beginPath(); _ctx.moveTo(0, H / 2); _ctx.lineTo(W, H / 2); _ctx.stroke();
  _ctx.setLineDash([]);

  _ctx.restore();
}

function apply() {
  state.straighten = _currentAngle;
  pushHistory('Straighten');
  scheduleRender();
  close();
}

function cancel() {
  // Don't modify state.straighten — just close.
  close();
}

function close() {
  if (_modal) _modal.style.display = 'none';
}

export function openStraightenModal() {
  if (!_modal) _modal = buildModal();
  _modal.style.display = 'flex';

  // Size the preview canvas.
  const aspect = state.width / state.height;
  let cw = MAX_W, ch = Math.round(cw / aspect);
  if (ch > MAX_H) { ch = MAX_H; cw = Math.round(ch * aspect); }
  _canvas.width = cw;
  _canvas.height = ch;
  _canvas.style.width = '';
  _canvas.style.height = '';

  // Start with current straighten value.
  _currentAngle = state.straighten || 0;
  const slider = _modal.querySelector('#stSlider');
  const val = _modal.querySelector('#stAngleVal');
  if (slider) { slider.value = _currentAngle; }
  if (val) { val.textContent = _currentAngle.toFixed(1) + '°'; }

  drawPreview();
}
