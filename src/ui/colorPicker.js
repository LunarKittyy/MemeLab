function hexToRgb(hex) {
  hex = (hex || '#000000').replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = ((h * 60) + 360) % 360;
  }
  return { h, s: max > 0 ? d / max : 0, v: max };
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function hsvToHex(h, s, v) { const { r, g, b } = hsvToRgb(h, s, v); return rgbToHex(r, g, b); }

let _picker = null, _svCanvas, _svCtx, _hueCanvas, _hueCtx, _hexInput, _preview;
let _h = 0, _s = 1, _v = 1;
let _onChange = null, _anchorEl = null;
const SV_W = 200, SV_H = 150, HUE_H = 14;

function buildPicker() {
  const el = document.createElement('div');
  el.className = 'cpicker';
  el.innerHTML = `
    <canvas class="cp-sv" width="${SV_W}" height="${SV_H}" draggable="false"></canvas>
    <div class="cp-hue-wrap">
      <canvas class="cp-hue" width="${SV_W}" height="${HUE_H}" draggable="false"></canvas>
      <div class="cp-hue-thumb"></div>
    </div>
    <div class="cp-bottom">
      <div class="cp-preview"></div>
      <span class="cp-hash">#</span>
      <input class="cp-hex" maxlength="6" spellcheck="false">
    </div>`;
  document.body.appendChild(el);
  _svCanvas = el.querySelector('.cp-sv');
  _svCtx = _svCanvas.getContext('2d');
  _hueCanvas = el.querySelector('.cp-hue');
  _hueCtx = _hueCanvas.getContext('2d');
  _hexInput = el.querySelector('.cp-hex');
  _preview = el.querySelector('.cp-preview');

  const hg = _hueCtx.createLinearGradient(0, 0, SV_W, 0);
  for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
  _hueCtx.fillStyle = hg;
  _hueCtx.fillRect(0, 0, SV_W, HUE_H);

  let svDrag = false, hueDrag = false;
  _svCanvas.addEventListener('pointerdown', (e) => { e.preventDefault(); svDrag = true; _svCanvas.setPointerCapture(e.pointerId); updateSV(e); });
  _svCanvas.addEventListener('pointermove', (e) => { if (svDrag) updateSV(e); });
  _svCanvas.addEventListener('pointerup', () => { svDrag = false; });
  _hueCanvas.addEventListener('pointerdown', (e) => { e.preventDefault(); hueDrag = true; _hueCanvas.setPointerCapture(e.pointerId); updateHue(e); });
  _hueCanvas.addEventListener('pointermove', (e) => { if (hueDrag) updateHue(e); });
  _hueCanvas.addEventListener('pointerup', () => { hueDrag = false; });

  _hexInput.addEventListener('input', () => {
    const hex = _hexInput.value.replace(/[^0-9a-fA-F]/g, '');
    if (hex.length === 6) {
      const { r, g, b } = hexToRgb('#' + hex);
      const hsv = rgbToHsv(r, g, b);
      _h = hsv.h; _s = hsv.s; _v = hsv.v;
      drawSV(); updateHueThumb(); emit('#' + hex, true);
    }
  });
  el.addEventListener('click', (e) => e.stopPropagation());
  return el;
}

function updateSV(e) {
  const r = _svCanvas.getBoundingClientRect();
  _s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  _v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
  drawSV(); emit(hsvToHex(_h, _s, _v), false);
}
function updateHue(e) {
  const r = _hueCanvas.getBoundingClientRect();
  _h = Math.max(0, Math.min(359.99, ((e.clientX - r.left) / r.width) * 360));
  drawSV(); updateHueThumb(); emit(hsvToHex(_h, _s, _v), false);
}
function drawSV() {
  const ctx = _svCtx;
  const sg = ctx.createLinearGradient(0, 0, SV_W, 0);
  sg.addColorStop(0, '#fff'); sg.addColorStop(1, `hsl(${_h},100%,50%)`);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, SV_W, SV_H);
  const vg = ctx.createLinearGradient(0, 0, 0, SV_H);
  vg.addColorStop(0, 'transparent'); vg.addColorStop(1, '#000');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, SV_W, SV_H);
  const cx = _s * SV_W, cy = (1 - _v) * SV_H;
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
}
function updateHueThumb() {
  const thumb = _picker && _picker.querySelector('.cp-hue-thumb');
  if (thumb) thumb.style.left = `${(_h / 360) * 100}%`;
}
function emit(hex, fromHexInput) {
  if (_preview) _preview.style.background = hex;
  if (_hexInput && !fromHexInput) _hexInput.value = hex.replace('#', '');
  if (_anchorEl && _anchorEl.isConnected) { _anchorEl.style.background = hex; _anchorEl.dataset.value = hex; }
  if (_onChange) _onChange(hex);
}

export function colorSwatchHtml(id, value) {
  return `<div class="cswatch" id="${id}" data-value="${value || '#000000'}" style="background:${value || '#000000'}" tabindex="0" role="button"></div>`;
}

export function wireColorSwatch(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!_picker) _picker = buildPicker();
    _onChange = onChange; _anchorEl = el;
    const { r, g, b } = hexToRgb(el.dataset.value);
    const hsv = rgbToHsv(r, g, b);
    _h = hsv.h; _s = hsv.s; _v = hsv.v;
    drawSV(); updateHueThumb();
    if (_hexInput) _hexInput.value = (el.dataset.value || '#000000').replace('#', '');
    if (_preview) _preview.style.background = el.dataset.value || '#000000';
    const rect = el.getBoundingClientRect();
    const PW = SV_W + 20, PH = SV_H + HUE_H + 60;
    let left = rect.right + 8, top = rect.top;
    if (left + PW > window.innerWidth) left = rect.left - PW - 8;
    if (left < 8) left = 8;
    if (top + PH > window.innerHeight) top = window.innerHeight - PH - 8;
    if (top < 8) top = 8;
    _picker.style.left = left + 'px'; _picker.style.top = top + 'px';
    _picker.style.display = 'block';
  });
}

document.addEventListener('click', () => { if (_picker) _picker.style.display = 'none'; });
