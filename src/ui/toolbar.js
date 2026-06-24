import { state, getSelected } from '../core/state.js';
import { defaultTextLayer, defaultRectLayer, defaultImageLayer } from '../core/layers.js';
import { clamp } from '../core/utils.js';
import { pushHistory, undo, redo, canUndo, canRedo, getHistoryEntries, jumpToHistory } from '../core/history.js';
import { ensureImage } from '../core/state.js';
import { scheduleRender, resizeStageBuffer, exportPng as renderExportPng } from '../render/renderer.js';
import { fontsReady } from '../render/fonts.js';
import { selectLayer } from '../interactions/pointer.js';
import { setIcon } from './icons.js';
import { wireCustomSelect } from './customSelect.js';
import { renderLayerList, deleteLayer, duplicateLayer, moveLayerUp, moveLayerDown, moveLayerToTop, moveLayerToBottom, setLastCreatedLayerId } from './layerList.js';
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
  setLastCreatedLayerId(l.id);
  renderLayerList();
  selectLayer(l.id);
  pushHistory('Add text layer');
  openPanelMobile('right', true);
  requestAnimationFrame(() => { const t = byId('tText'); if (t) { t.focus(); t.select(); } });
}

export function addRectLayerAction() {
  const l = defaultRectLayer();
  state.layers.push(l);
  setLastCreatedLayerId(l.id);
  renderLayerList();
  selectLayer(l.id);
  pushHistory('Add shape layer');
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
        setLastCreatedLayerId(l.id);
        renderLayerList();
        selectLayer(l.id);
        openPanelMobile('right', true);
      }
      pushHistory('Add image layer');
      scheduleRender();
    };
    probe.src = src;
  };
  reader.readAsDataURL(file);
}

export function openPanelMobile(side, forceState) {
  if (window.innerWidth > 980) return;
  const otherSide = side === 'left' ? 'Right' : 'Left';
  document.getElementById('panel' + otherSide).classList.remove('open');
  const panel = side === 'left' ? document.getElementById('panelLeft') : document.getElementById('panelRight');
  const shouldOpen = forceState !== undefined ? forceState : !panel.classList.contains('open');
  if (shouldOpen) {
    panel.classList.add('open');
    document.getElementById('backdrop').classList.add('show');
  } else {
    panel.classList.remove('open');
    document.getElementById('backdrop').classList.remove('show');
  }
}
export function toggleHelpModal() {
  const modal = document.getElementById('helpModal');
  const backdrop = document.getElementById('backdrop');
  if (!modal) return;
  const isShown = modal.classList.contains('show');
  if (isShown) {
    modal.classList.remove('show');
    backdrop.classList.remove('show');
  } else {
    modal.classList.add('show');
    backdrop.classList.add('show');
  }
}
function closeAllPanels() {
  document.getElementById('panelLeft').classList.remove('open');
  document.getElementById('panelRight').classList.remove('open');
  document.getElementById('backdrop').classList.remove('show');
  const modal = document.getElementById('helpModal');
  if (modal) modal.classList.remove('show');
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
  const scale = +(document.getElementById('exportScale').dataset.value) || 1;
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
  pushHistory('Resize canvas');
}

export function syncSizeInputs() {
  byId('customW').value = state.width;
  byId('customH').value = state.height;
  const preset = byId('sizePreset');
  const match = `${state.width}x${state.height}`;
  const matchOpt = preset.querySelector(`.csel-opt[data-value="${match}"]`);
  if (matchOpt) {
    preset.dataset.value = match;
    preset.querySelector('.csel-label').textContent = matchOpt.textContent;
    preset.querySelectorAll('.csel-opt').forEach(o => o.classList.toggle('csel-opt-sel', o === matchOpt));
    byId('customSizeRow').style.display = 'none';
  } else {
    preset.dataset.value = 'custom';
    preset.querySelector('.csel-label').textContent = 'Custom…';
    preset.querySelectorAll('.csel-opt').forEach(o => o.classList.toggle('csel-opt-sel', o.dataset.value === 'custom'));
    byId('customSizeRow').style.display = 'grid';
  }
}



export function initIcons() {
  setIcon('btnUndo', 'undo');
  setIcon('btnRedo', 'redo');
  setIcon('iconAddText', 'textT');
  setIcon('iconAddImage', 'image');
  setIcon('iconAddRect', 'shape');
  setIcon('btnOpenLeft', 'layers');
  setIcon('btnOpenRight', 'brush');
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


  wireCustomSelect('sizePreset', (v) => applySizePreset(v));
  const exportSplit = document.getElementById('exportScale');
  const exportArrow = exportSplit.querySelector('.export-arrow');
  const exportPopup = exportSplit.querySelector('.export-scale-popup');
  let exportOpen = false;
  function closeExportPopup() { exportOpen = false; exportPopup.style.display = 'none'; }
  exportArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    exportOpen = !exportOpen;
    exportPopup.style.display = exportOpen ? 'block' : 'none';
  });
  exportPopup.addEventListener('click', (e) => {
    e.stopPropagation();
    const opt = e.target.closest('.csel-opt');
    if (!opt) return;
    exportSplit.dataset.value = opt.dataset.value;
    exportSplit.querySelector('.export-scale-label').textContent = opt.dataset.value + 'x';
    exportPopup.querySelectorAll('.csel-opt').forEach(o => o.classList.toggle('csel-opt-sel', o === opt));
    closeExportPopup();
  });
  document.addEventListener('click', closeExportPopup);
  document.getElementById('customW').addEventListener('change', (e) => { state.width = clamp(+e.target.value || 1080, 50, 4000); resizeStageBuffer(); pushHistory('Resize canvas'); });
  document.getElementById('customH').addEventListener('change', (e) => { state.height = clamp(+e.target.value || 1080, 50, 4000); resizeStageBuffer(); pushHistory('Resize canvas'); });

  let _resetPending = false, _resetTimer = null;
  document.getElementById('btnReset').addEventListener('click', () => {
    if (!_resetPending) {
      _resetPending = true;
      const btn = document.getElementById('btnReset');
      btn.textContent = 'Are you sure?';
      btn.classList.add('danger');
      _resetTimer = setTimeout(() => {
        _resetPending = false;
        btn.textContent = 'Reset canvas';
        btn.classList.remove('danger');
      }, 3000);
      return;
    }
    clearTimeout(_resetTimer);
    _resetPending = false;
    const btn = document.getElementById('btnReset');
    btn.textContent = 'Reset canvas';
    btn.classList.remove('danger');
    state.layers = [];
    state.background = { type: 'color', color: '#ffffff', src: null, fit: 'cover' };
    state.selectedId = null;
    pushHistory('Reset canvas'); renderLayerList(); renderPropsPanel(); scheduleRender();
  });

  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);

  // Right-click context menu on undo/redo: shows scrollable history jump list.
  function showHistoryMenu(anchorBtn, filter) {
    if (anchorBtn.disabled) return;
    const existing = document.getElementById('historyMenu');
    if (existing) existing.remove();

    const entries = getHistoryEntries().filter(filter);
    if (!entries.length) return;

    const menu = document.createElement('ul');
    menu.id = 'historyMenu';
    menu.className = 'history-menu';
    entries.forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = entry.label;
      li.className = 'history-menu-item' + (entry.isCurrent ? ' current' : '');
      li.tabIndex = 0;
      li.addEventListener('click', () => { jumpToHistory(entry.index); menu.remove(); });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToHistory(entry.index); menu.remove(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); const next = li.nextElementSibling; if (next) next.focus(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); const prev = li.previousElementSibling; if (prev) prev.focus(); }
        if (e.key === 'Escape')    { menu.remove(); anchorBtn.focus(); }
      });
      menu.appendChild(li);
    });

    const rect = anchorBtn.getBoundingClientRect();
    if (rect.bottom > window.innerHeight / 2) {
      menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      menu.style.top = 'auto';
    } else {
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.bottom = 'auto';
    }
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);
    menu.firstElementChild && menu.firstElementChild.focus();

    function dismiss(e) {
      if (!menu.contains(e.target) && e.target !== anchorBtn) {
        menu.remove();
        document.removeEventListener('pointerdown', dismiss, true);
        document.removeEventListener('keydown', dismissKey, true);
      }
    }
    function dismissKey(e) {
      if (e.key === 'Escape') { menu.remove(); document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissKey, true); }
    }
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismissKey, true);
  }

  document.getElementById('btnUndo').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const currentIdx = getHistoryEntries().findIndex((x) => x.isCurrent);
    // Show states from current back to oldest (excludes states after current).
    showHistoryMenu(e.currentTarget, (entry) => entry.index <= currentIdx);
  });
  document.getElementById('btnRedo').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const currentIdx = getHistoryEntries().findIndex((x) => x.isCurrent);
    // Show states from current onward (so user can see where they're jumping to).
    showHistoryMenu(e.currentTarget, (entry) => entry.index >= currentIdx);
  });
  document.getElementById('btnExport').addEventListener('click', () => { exportPngAndDownload(); showHint('PNG saved to your downloads'); });
  document.getElementById('helpClose').addEventListener('click', toggleHelpModal);

  document.getElementById('btnOpenLeft').addEventListener('click', () => openPanelMobile('left'));
  document.getElementById('btnOpenRight').addEventListener('click', () => openPanelMobile('right'));
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
    
    // Toggle Shortcuts Help modal: Ctrl + / or Ctrl + ?
    if (meta && (e.key === '/' || e.key === '?')) {
      e.preventDefault();
      toggleHelpModal();
      return;
    }
    
    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (meta && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); return; }
    
    // Deselect layer: Photoshop Ctrl + D
    if (meta && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      selectLayer(null);
      return;
    }

    // Photoshop tool shortcuts (single key)
    if (!meta) {
      if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        addTextLayerAction();
        return;
      }
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        addRectLayerAction();
        return;
      }
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        fileInput.click();
        return;
      }
    }

    const sel = getSelected();
    if (!sel) return;
    
    // Photoshop duplicate layer: Ctrl + J
    if (meta && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      duplicateLayer(sel.id);
      return;
    }

    // Photoshop reorder layers depth: Ctrl + [ / ] (Cmd + [ / ] on Mac)
    if (meta && e.key === '[') {
      e.preventDefault();
      if (e.shiftKey) {
        moveLayerToBottom(sel.id);
      } else {
        moveLayerDown(sel.id);
      }
      return;
    }
    if (meta && e.key === ']') {
      e.preventDefault();
      if (e.shiftKey) {
        moveLayerToTop(sel.id);
      } else {
        moveLayerUp(sel.id);
      }
      return;
    }

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
