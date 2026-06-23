import { state, getSelected } from '../core/state.js';
import { defaultTextLayer, defaultRectLayer, defaultImageLayer } from '../core/layers.js';
import { clamp } from '../core/utils.js';
import { pushHistory, undo, redo } from '../core/history.js';
import { ensureImage } from '../core/state.js';
import { scheduleRender, resizeStageBuffer, exportPng as renderExportPng } from '../render/renderer.js';
import { fontsReady } from '../render/fonts.js';
import { selectLayer } from '../interactions/pointer.js';
import { setIcon } from './icons.js';
import { renderLayerList, deleteLayer, duplicateLayer } from './layerList.js';
import { renderPropsPanel } from './props/panel.js';
import { byId, syncTransformInputs } from './props/shared.js';

let fileInput = null;
let pendingImageTarget = null;

export function setPendingImageTarget(target) {
  pendingImageTarget = target;
}
export function triggerFilePicker() {
  fileInput.click();
}

export function addTextLayerAction() {
  const l = defaultTextLayer();
  state.layers.push(l);
  selectLayer(l.id);
  pushHistory();
  renderLayerList();
  openPanelMobile('right');
  requestAnimationFrame(() => { const t = byId('tText'); if (t) { t.focus(); t.select(); } });
}

export function addRectLayerAction() {
  const l = defaultRectLayer();
  state.layers.push(l);
  selectLayer(l.id);
  pushHistory();
  renderLayerList();
}

function handleImageFile(file, target) {
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    const probe = new Image();
    probe.onload = () => {
      if (target === 'background') {
        state.background.type = 'image';
        state.background.src = src;
        ensureImage(src);
        syncBgControls();
        if (state.selectedId === 'background') renderPropsPanel();
      } else if (target && target.type) {
        target.src = src;
        target.naturalW = probe.naturalWidth;
        target.naturalH = probe.naturalHeight;
        ensureImage(src);
      } else {
        const l = defaultImageLayer(src, probe.naturalWidth, probe.naturalHeight);
        ensureImage(src);
        state.layers.push(l);
        selectLayer(l.id);
        renderLayerList();
        openPanelMobile('right');
      }
      pushHistory();
      scheduleRender();
    };
    probe.src = src;
  };
  reader.readAsDataURL(file);
}

export function openPanelMobile(side) {
  if (window.innerWidth > 980) return;
  const panel = side === 'left' ? document.getElementById('panelLeft') : document.getElementById('panelRight');
  panel.classList.add('open');
  document.getElementById('backdrop').classList.add('show');
}
function closeAllPanels() {
  document.getElementById('panelLeft').classList.remove('open');
  document.getElementById('panelRight').classList.remove('open');
  document.getElementById('backdrop').classList.remove('show');
}

function showHint(msg) {
  const t = document.getElementById('hintToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showHint._t);
  showHint._t = setTimeout(() => t.classList.remove('show'), 1800);
}

async function exportPngAndDownload() {
  await fontsReady();
  const scale = +document.getElementById('exportScale').value || 1;
  const blob = await renderExportPng(scale);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meme.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function applySizePreset(value) {
  if (value === 'custom') {
    document.getElementById('customSizeRow').style.display = 'grid';
    return;
  }
  document.getElementById('customSizeRow').style.display = 'none';
  const [w, h] = value.split('x').map(Number);
  state.width = w; state.height = h;
  document.getElementById('customW').value = w;
  document.getElementById('customH').value = h;
  resizeStageBuffer();
  pushHistory();
}

export function syncSizeInputs() {
  byId('customW').value = state.width;
  byId('customH').value = state.height;
  const preset = byId('sizePreset');
  const match = `${state.width}x${state.height}`;
  let found = false;
  for (const opt of preset.options) { if (opt.value === match) { preset.value = match; found = true; break; } }
  if (!found) { preset.value = 'custom'; document.getElementById('customSizeRow').style.display = 'grid'; }
}

export function syncBgControls() {
  const bg = state.background;
  document.getElementById('bgColorRow').style.display = bg.type === 'color' ? 'flex' : 'none';
  document.getElementById('bgImageRow').style.display = bg.type === 'image' ? 'block' : 'none';
  document.getElementById('bgTypeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === bg.type));
  document.getElementById('bgColor').value = bg.color;
  document.getElementById('bgFit').value = bg.fit;
}

export function initIcons() {
  setIcon('btnUndo', 'undo');
  setIcon('btnRedo', 'redo');
  setIcon('closeLeft', 'close');
  setIcon('closeRight', 'close');
  setIcon('iconAddText', 'textT');
  setIcon('iconAddImage', 'image');
  setIcon('iconAddRect', 'shape');
}

export function updateHistoryButtons(canUndo, canRedo) {
  byId('btnUndo').disabled = !canUndo;
  byId('btnRedo').disabled = !canRedo;
}

export function updateSaveStatusUI(kind, detail) {
  const dot = document.getElementById('saveDot');
  const wrap = document.getElementById('saveStatus');
  if (!dot || !wrap) return;
  dot.className = 'savedot ' + kind;
  wrap.title = detail || '';
}

export function wireGlobalUI() {
  fileInput = document.getElementById('fileInput');
  document.getElementById('btnAddText').addEventListener('click', addTextLayerAction);
  document.getElementById('btnAddRect').addEventListener('click', addRectLayerAction);
  document.getElementById('btnAddImage').addEventListener('click', () => { pendingImageTarget = null; fileInput.click(); });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) handleImageFile(fileInput.files[0], pendingImageTarget);
    fileInput.value = '';
    pendingImageTarget = null;
  });
  document.getElementById('btnBgImage').addEventListener('click', () => { pendingImageTarget = 'background'; fileInput.click(); });
  document.getElementById('btnBgRemove').addEventListener('click', () => {
    state.background.type = 'color'; state.background.src = null;
    syncBgControls(); scheduleRender(); pushHistory();
    if (state.selectedId === 'background') renderPropsPanel();
  });
  document.getElementById('bgTypeSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.background.type = b.dataset.v; syncBgControls(); scheduleRender(); pushHistory();
    if (state.selectedId === 'background') renderPropsPanel();
  }));
  document.getElementById('bgColor').addEventListener('input', (e) => { state.background.color = e.target.value; scheduleRender(); });
  document.getElementById('bgColor').addEventListener('change', () => { pushHistory(); if (state.selectedId === 'background') renderPropsPanel(); });
  document.getElementById('bgFit').addEventListener('change', (e) => { state.background.fit = e.target.value; scheduleRender(); pushHistory(); if (state.selectedId === 'background') renderPropsPanel(); });

  document.getElementById('sizePreset').addEventListener('change', (e) => applySizePreset(e.target.value));
  document.getElementById('customW').addEventListener('change', (e) => { state.width = clamp(+e.target.value || 1080, 50, 4000); resizeStageBuffer(); pushHistory(); });
  document.getElementById('customH').addEventListener('change', (e) => { state.height = clamp(+e.target.value || 1080, 50, 4000); resizeStageBuffer(); pushHistory(); });

  document.getElementById('btnReset').addEventListener('click', () => {
    if (!confirm('Clear the canvas? This removes all layers and resets the background.')) return;
    state.layers = [];
    state.background = { type: 'color', color: '#ffffff', src: null, fit: 'cover' };
    state.selectedId = null;
    pushHistory(); renderLayerList(); renderPropsPanel(); scheduleRender();
  });

  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  document.getElementById('btnExport').addEventListener('click', () => { exportPngAndDownload(); showHint('PNG saved to your downloads'); });

  document.getElementById('btnOpenLeft').addEventListener('click', () => openPanelMobile('left'));
  document.getElementById('btnOpenRight').addEventListener('click', () => openPanelMobile('right'));
  document.getElementById('closeLeft').addEventListener('click', closeAllPanels);
  document.getElementById('closeRight').addEventListener('click', closeAllPanels);
  document.getElementById('backdrop').addEventListener('click', closeAllPanels);

  document.getElementById('canvasArea').addEventListener('dragover', (e) => { e.preventDefault(); });
  document.getElementById('canvasArea').addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleImageFile(file, null);
  });

  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (typing) return;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (meta && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); return; }
    const sel = getSelected();
    if (!sel) return;
    if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLayer(sel.id); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteLayer(sel.id); return; }
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { sel.x -= step; scheduleRender(); syncTransformInputs(); }
    else if (e.key === 'ArrowRight') { sel.x += step; scheduleRender(); syncTransformInputs(); }
    else if (e.key === 'ArrowUp') { sel.y -= step; scheduleRender(); syncTransformInputs(); }
    else if (e.key === 'ArrowDown') { sel.y += step; scheduleRender(); syncTransformInputs(); }
    else return;
  });
  window.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && getSelected()) pushHistory();
  });

  window.addEventListener('resize', resizeStageBuffer);
}
