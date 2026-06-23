import { ensureImage } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender } from '../render/renderer.js';
import { renderPropsPanel } from './props/panel.js';

let _modal = null, _canvas = null, _ctx = null;
let _layer = null, _img = null;
let _imgX = 0, _imgY = 0, _imgW = 0, _imgH = 0;
let _crop = null;
let _drag = null;
const HANDLE_R = 7, MAX_W = 540, MAX_H = 400;

function buildModal() {
  const el = document.createElement('div');
  el.className = 'crop-overlay';
  el.innerHTML = `<div class="crop-modal">
    <div class="crop-header">Crop Image</div>
    <canvas class="crop-canvas"></canvas>
    <div class="crop-footer">
      <button class="smallbtn" id="cropReset">Reset</button>
      <span style="flex:1"></span>
      <button class="smallbtn" id="cropCancel">Cancel</button>
      <button class="smallbtn crop-apply-btn" id="cropApply">Apply</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  _canvas = el.querySelector('.crop-canvas');
  _ctx = _canvas.getContext('2d');
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  el.querySelector('#cropCancel').addEventListener('click', close);
  el.querySelector('#cropApply').addEventListener('click', apply);
  el.querySelector('#cropReset').addEventListener('click', reset);
  _canvas.addEventListener('pointerdown', onDown);
  _canvas.addEventListener('pointermove', onMove);
  _canvas.addEventListener('pointerup', () => { _drag = null; });
  _canvas.addEventListener('pointercancel', () => { _drag = null; });
  return el;
}

function handles() {
  const { x, y, w, h } = _crop, cx = x + w / 2, cy = y + h / 2;
  return [
    { id: 'nw', px: x, py: y }, { id: 'n', px: cx, py: y }, { id: 'ne', px: x + w, py: y },
    { id: 'e', px: x + w, py: cy }, { id: 'se', px: x + w, py: y + h },
    { id: 's', px: cx, py: y + h }, { id: 'sw', px: x, py: y + h }, { id: 'w', px: x, py: cy },
  ];
}

function hitTest(px, py) {
  for (const h of handles()) {
    if (Math.hypot(px - h.px, py - h.py) <= HANDLE_R + 4) return h.id;
  }
  const { x, y, w, h } = _crop;
  if (px >= x && px <= x + w && py >= y && py <= y + h) return 'move';
  return null;
}

function canvasXY(e) {
  const r = _canvas.getBoundingClientRect();
  return { px: (e.clientX - r.left) * (_canvas.width / r.width), py: (e.clientY - r.top) * (_canvas.height / r.height) };
}

function onDown(e) {
  const { px, py } = canvasXY(e);
  const hit = hitTest(px, py);
  if (!hit) return;
  _canvas.setPointerCapture(e.pointerId);
  _drag = { hit, startX: px, startY: py, c0: { ..._crop } };
}

function onMove(e) {
  const { px, py } = canvasXY(e);
  if (!_drag) {
    const h = hitTest(px, py);
    _canvas.style.cursor = !h ? 'default' : h === 'move' ? 'move' :
      { nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize',
        se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize' }[h] || 'default';
    return;
  }
  const dx = px - _drag.startX, dy = py - _drag.startY;
  const o = _drag.c0, MIN = 20;
  let { x, y, w, h } = o;
  const r = x + w, b = y + h;
  if (_drag.hit === 'move') {
    x = Math.max(_imgX, Math.min(_imgX + _imgW - w, x + dx));
    y = Math.max(_imgY, Math.min(_imgY + _imgH - h, y + dy));
  } else {
    let nx = x, ny = y, nr = r, nb = b;
    if (_drag.hit.includes('w')) nx = Math.max(_imgX, Math.min(nr - MIN, x + dx));
    if (_drag.hit.includes('e')) nr = Math.min(_imgX + _imgW, Math.max(nx + MIN, r + dx));
    if (_drag.hit.includes('n')) ny = Math.max(_imgY, Math.min(nb - MIN, y + dy));
    if (_drag.hit.includes('s')) nb = Math.min(_imgY + _imgH, Math.max(ny + MIN, b + dy));
    x = nx; y = ny; w = nr - nx; h = nb - ny;
  }
  _crop = { x, y, w, h };
  draw();
}

function draw() {
  const W = _canvas.width, H = _canvas.height;
  _ctx.clearRect(0, 0, W, H);
  _ctx.drawImage(_img, _imgX, _imgY, _imgW, _imgH);
  const { x, y, w, h } = _crop;
  _ctx.fillStyle = 'rgba(0,0,0,0.6)';
  _ctx.fillRect(0, 0, W, y);
  _ctx.fillRect(0, y, x, h);
  _ctx.fillRect(x + w, y, W - x - w, h);
  _ctx.fillRect(0, y + h, W, H - y - h);
  _ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  _ctx.lineWidth = 1.5;
  _ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
  _ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  _ctx.lineWidth = 1;
  _ctx.setLineDash([4, 4]);
  for (let i = 1; i <= 2; i++) {
    _ctx.beginPath(); _ctx.moveTo(x + w * i / 3, y); _ctx.lineTo(x + w * i / 3, y + h); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(x, y + h * i / 3); _ctx.lineTo(x + w, y + h * i / 3); _ctx.stroke();
  }
  _ctx.setLineDash([]);
  for (const hndl of handles()) {
    _ctx.beginPath(); _ctx.arc(hndl.px, hndl.py, HANDLE_R, 0, Math.PI * 2);
    _ctx.fillStyle = '#fff'; _ctx.fill();
    _ctx.strokeStyle = 'rgba(0,0,0,0.35)'; _ctx.lineWidth = 1; _ctx.stroke();
  }
}

function normToDisp(n) {
  return { x: _imgX + n.x * _imgW, y: _imgY + n.y * _imgH, w: n.w * _imgW, h: n.h * _imgH };
}

function dispToNorm() {
  return { x: (_crop.x - _imgX) / _imgW, y: (_crop.y - _imgY) / _imgH, w: _crop.w / _imgW, h: _crop.h / _imgH };
}

function apply() {
  const norm = dispToNorm();
  _layer.crop = norm;
  // Resize the layer to match the crop's aspect ratio, preserving width.
  const cropW = norm.w * _img.naturalWidth;
  const cropH = norm.h * _img.naturalHeight;
  _layer.h = Math.max(1, Math.round(_layer.w * (cropH / cropW)));
  pushHistory('Crop image');
  scheduleRender();
  renderPropsPanel();
  close();
}

function reset() {
  _layer.crop = { x: 0, y: 0, w: 1, h: 1 };
  _crop = normToDisp({ x: 0, y: 0, w: 1, h: 1 });
  draw();
}

function close() {
  if (_modal) _modal.style.display = 'none';
}

export function openCropModal(layer) {
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return;
  if (!_modal) _modal = buildModal();
  _modal.style.display = 'flex';
  _layer = layer; _img = img;
  const aspect = img.naturalWidth / img.naturalHeight;
  let cw = MAX_W, ch = Math.round(cw / aspect);
  if (ch > MAX_H) { ch = MAX_H; cw = Math.round(ch * aspect); }
  _canvas.width = cw; _canvas.height = ch;
  _canvas.style.width = cw + 'px'; _canvas.style.height = ch + 'px';
  _imgX = 0; _imgY = 0; _imgW = cw; _imgH = ch;
  const cur = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  _crop = normToDisp(cur);
  draw();
}
