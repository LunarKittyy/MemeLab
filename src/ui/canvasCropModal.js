// Canvas-wide crop modal.
// Renders the current scene onto an overlay canvas, lets the user drag a
// crop rectangle, optionally constrained to an aspect ratio, and on confirm:
//   - state.width / state.height are updated
//   - every layer's x/y is offset
//   - resizeStageBuffer() is called
//   - pushHistory('Crop canvas') is called

import { state } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { resizeStageBuffer, renderScene, scheduleRender } from '../render/renderer.js';
import { syncSizeInputs } from './toolbar.js';
import { renderLayerList } from './layerList.js';
import { renderPropsPanel } from './props/panel.js';

let _modal = null, _canvas = null, _ctx = null;
let _crop = null, _drag = null;
let _sceneW = 0, _sceneH = 0; // canvas coordinate space (display pixels on the overlay canvas)
let _sceneX = 0, _sceneY = 0; // offset of scene within the overlay canvas
let _aspect = null; // null = free, number = locked ratio (w/h)

const HANDLE_R = 7;
const MIN_CROP = 20;
const MAX_OVERLAY_W = 680;
const MAX_OVERLAY_H = 500;

// Aspect ratio presets: label → w/h ratio (null = free)
const PRESETS = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

function buildModal() {
  const el = document.createElement('div');
  el.className = 'crop-overlay canvas-crop-overlay';
  el.innerHTML = `
    <div class="canvas-crop-modal">
      <div class="crop-header">Crop Canvas</div>
      <div class="canvas-crop-presets" id="ccPresets">
        ${PRESETS.map((p, i) => `<button class="smallbtn canvas-crop-preset-btn${i === 0 ? ' active' : ''}" data-index="${i}">${p.label}</button>`).join('')}
      </div>
      <canvas class="crop-canvas canvas-crop-canvas" id="ccCanvas"></canvas>
      <div class="canvas-crop-info" id="ccInfo"></div>
      <div class="crop-footer">
        <button class="smallbtn" id="ccReset">Reset</button>
        <span style="flex:1"></span>
        <button class="smallbtn" id="ccCancel">Cancel</button>
        <button class="smallbtn crop-apply-btn" id="ccApply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  _canvas = el.querySelector('#ccCanvas');
  _ctx = _canvas.getContext('2d');

  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  el.querySelector('#ccCancel').addEventListener('click', close);
  el.querySelector('#ccApply').addEventListener('click', apply);
  el.querySelector('#ccReset').addEventListener('click', reset);

  el.querySelector('#ccPresets').addEventListener('click', (e) => {
    const btn = e.target.closest('.canvas-crop-preset-btn');
    if (!btn) return;
    el.querySelectorAll('.canvas-crop-preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const idx = parseInt(btn.dataset.index, 10);
    _aspect = PRESETS[idx].ratio;
    // Re-constrain current crop to new aspect ratio.
    if (_aspect !== null) constrainToAspect();
    draw();
  });

  _canvas.addEventListener('pointerdown', onDown);
  _canvas.addEventListener('pointermove', onMove);
  _canvas.addEventListener('pointerup', () => { _drag = null; });
  _canvas.addEventListener('pointercancel', () => { _drag = null; });

  return el;
}

function constrainToAspect() {
  if (_aspect === null) return;
  // Keep the top-left fixed, adjust width/height to match.
  const maxW = _sceneW, maxH = _sceneH;
  let { x, y, w, h } = _crop;
  // Fit within the scene bounds while keeping aspect ratio.
  const fitW = Math.min(w, maxW - x);
  const fitH = fitW / _aspect;
  if (y + fitH > _sceneY + _sceneH) {
    const fitH2 = Math.min(h, _sceneH - (y - _sceneY));
    const fitW2 = fitH2 * _aspect;
    _crop = { x, y, w: Math.min(fitW2, maxW - x), h: fitH2 };
  } else {
    _crop = { x, y, w: fitW, h: fitH };
  }
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
  return {
    px: (e.clientX - r.left) * (_canvas.width / r.width),
    py: (e.clientY - r.top) * (_canvas.height / r.height),
  };
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
  const o = _drag.c0;
  let { x, y, w, h } = o;
  const r2 = x + w, b = y + h;
  const sx = _sceneX, sy = _sceneY;

  if (_drag.hit === 'move') {
    x = Math.max(sx, Math.min(sx + _sceneW - w, x + dx));
    y = Math.max(sy, Math.min(sy + _sceneH - h, y + dy));
  } else {
    let nx = x, ny = y, nr = r2, nb = b;
    if (_drag.hit.includes('w')) nx = Math.max(sx, Math.min(nr - MIN_CROP, x + dx));
    if (_drag.hit.includes('e')) nr = Math.min(sx + _sceneW, Math.max(nx + MIN_CROP, r2 + dx));
    if (_drag.hit.includes('n')) ny = Math.max(sy, Math.min(nb - MIN_CROP, y + dy));
    if (_drag.hit.includes('s')) nb = Math.min(sy + _sceneH, Math.max(ny + MIN_CROP, b + dy));
    x = nx; y = ny; w = nr - nx; h = nb - ny;
    // If aspect locked, constrain based on which edge moved.
    if (_aspect !== null) {
      if (_drag.hit.includes('w') || _drag.hit.includes('e')) {
        h = w / _aspect;
        // Clamp height
        if (nb > sy + _sceneH) { h = sy + _sceneH - y; w = h * _aspect; }
      } else {
        w = h * _aspect;
        if (nr > sx + _sceneW) { w = sx + _sceneW - x; h = w / _aspect; }
      }
    }
  }
  _crop = { x, y, w, h };
  updateInfo();
  draw();
}

function updateInfo() {
  const infoEl = document.getElementById('ccInfo');
  if (!infoEl) return;
  const cw = Math.round(_crop.w / _sceneW * state.width);
  const ch = Math.round(_crop.h / _sceneH * state.height);
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const g = gcd(cw, ch);
  infoEl.textContent = `${cw} × ${ch} px  (${cw/g}:${ch/g})`;
}

function draw() {
  const W = _canvas.width, H = _canvas.height;
  _ctx.clearRect(0, 0, W, H);
  _ctx.fillStyle = '#1a1525';
  _ctx.fillRect(0, 0, W, H);
  // Draw the scene.
  _ctx.save();
  _ctx.translate(_sceneX, _sceneY);
  _ctx.scale(_sceneW / state.width, _sceneH / state.height);
  renderScene(_ctx, { forExport: true });
  _ctx.restore();

  // Darken outside crop rect.
  const { x, y, w, h } = _crop;
  _ctx.fillStyle = 'rgba(0,0,0,0.6)';
  _ctx.fillRect(0, 0, W, y);
  _ctx.fillRect(0, y, x, h);
  _ctx.fillRect(x + w, y, W - x - w, h);
  _ctx.fillRect(0, y + h, W, H - y - h);

  // Crop border
  _ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  _ctx.lineWidth = 1.5;
  _ctx.setLineDash([]);
  _ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);

  // Rule-of-thirds grid
  _ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  _ctx.lineWidth = 1;
  _ctx.setLineDash([4, 4]);
  for (let i = 1; i <= 2; i++) {
    _ctx.beginPath(); _ctx.moveTo(x + w * i / 3, y); _ctx.lineTo(x + w * i / 3, y + h); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(x, y + h * i / 3); _ctx.lineTo(x + w, y + h * i / 3); _ctx.stroke();
  }
  _ctx.setLineDash([]);

  // Handles
  for (const hndl of handles()) {
    _ctx.beginPath(); _ctx.arc(hndl.px, hndl.py, HANDLE_R, 0, Math.PI * 2);
    _ctx.fillStyle = '#fff'; _ctx.fill();
    _ctx.strokeStyle = 'rgba(0,0,0,0.35)'; _ctx.lineWidth = 1; _ctx.stroke();
  }
}

function apply() {
  // Convert crop rect from overlay-canvas space → canvas coordinate space.
  const scaleX = state.width / _sceneW;
  const scaleY = state.height / _sceneH;
  const cropX = Math.round((_crop.x - _sceneX) * scaleX);
  const cropY = Math.round((_crop.y - _sceneY) * scaleY);
  const cropW = Math.round(_crop.w * scaleX);
  const cropH = Math.round(_crop.h * scaleY);

  // Clamp to canvas bounds.
  const x = Math.max(0, cropX);
  const y = Math.max(0, cropY);
  const w = Math.min(state.width - x, cropW);
  const h = Math.min(state.height - y, cropH);
  if (w < 1 || h < 1) { close(); return; }

  // Update canvas dimensions.
  state.width = w;
  state.height = h;

  // Offset all layer positions.
  for (const layer of state.layers) {
    layer.x -= x;
    layer.y -= y;
  }

  resizeStageBuffer();
  pushHistory('Crop canvas');
  syncSizeInputs();
  renderLayerList();
  renderPropsPanel();
  scheduleRender();
  close();
}

function reset() {
  _aspect = null;
  document.querySelectorAll('.canvas-crop-preset-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  initCropRect();
  draw();
}

function initCropRect() {
  // Default crop = full canvas (with 10% inset to make handles visible).
  const pad = 0;
  _crop = { x: _sceneX + pad, y: _sceneY + pad, w: _sceneW - pad * 2, h: _sceneH - pad * 2 };
}

function close() {
  if (_modal) _modal.style.display = 'none';
}

export function openCanvasCropModal() {
  if (!_modal) _modal = buildModal();
  _modal.style.display = 'flex';

  // Size the overlay canvas.
  const aspect = state.width / state.height;
  let ow = MAX_OVERLAY_W, oh = Math.round(ow / aspect);
  if (oh > MAX_OVERLAY_H) { oh = MAX_OVERLAY_H; ow = Math.round(oh * aspect); }

  const PADDING = 24;
  _canvas.width = ow + PADDING * 2;
  _canvas.height = oh + PADDING * 2;
  _canvas.style.width = '';
  _canvas.style.height = '';

  _sceneX = PADDING;
  _sceneY = PADDING;
  _sceneW = ow;
  _sceneH = oh;

  _aspect = null;
  document.querySelectorAll('.canvas-crop-preset-btn').forEach((b, i) => b.classList.toggle('active', i === 0));

  initCropRect();
  updateInfo();
  draw();
}
