import { state, getSelected, drawState, saveUIPref, ensureImage } from '../core/state.js';
import { defaultTextLayer, defaultRectLayer, defaultImageLayer, defaultSpeechBubbleLayer, defaultDrawLayer } from '../core/layers.js';
import { toggleStickerPicker } from './stickerPicker.js';
import { clamp } from '../core/utils.js';
import { pushHistory, undo, redo, canUndo, canRedo, getHistoryEntries, jumpToHistory } from '../core/history.js';
import { scheduleRender, resizeStageBuffer } from '../render/renderer.js';
import { selectLayer } from '../interactions/pointer.js';
import { setIcon } from './icons.js';
import { wireCustomSelect } from './customSelect.js';
import { renderLayerList, deleteLayer, duplicateLayer, moveLayerUp, moveLayerDown, moveLayerToTop, moveLayerToBottom, setLastCreatedLayerId } from './layerList.js';
import { renderPropsPanel } from './props/panel.js';
import { byId, syncTransformInputs } from './props/shared.js';
import { quickExport, openExportModal } from './exportModal.js';
import { openDocumentPanel, initDocumentPanel, syncSizeInputs as docSyncSizeInputs, applyCanvasResize } from './documentPanel.js';
import { openCanvasCropModal } from './canvasCropModal.js';
import { openStraightenModal } from './straightenModal.js';
import { outpaintCanvas } from '../cutout/outpaint.js';

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

export function addSpeechBubbleAction() {
  const l = defaultSpeechBubbleLayer();
  state.layers.push(l);
  setLastCreatedLayerId(l.id);
  renderLayerList();
  selectLayer(l.id);
  scheduleRender();
  pushHistory('Add speech bubble');
}

export function addDrawLayerAction() {
  const l = defaultDrawLayer();
  state.layers.push(l);
  setLastCreatedLayerId(l.id);
  renderLayerList();
  selectLayer(l.id);
  drawState.activeTool = 'brush';
  pushHistory('Add draw layer');
  openPanelMobile('right', true);
}

function handleImageFile(file, target) {
  const isHeic = /\.(heic|heif)$/i.test(file.name) ||
    file.type === 'image/heic' || file.type === 'image/heif';

  const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);

  if (isHeic) {
    handleHeicFile(file, target);
    return;
  }
  if (isGif) {
    handleGifFile(file, target);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    addImageSrc(src, target);
  };
  reader.readAsDataURL(file);
}

function addImageSrc(src, target) {
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
}

async function handleHeicFile(file, target) {
  try {
    if (typeof heic2any === 'undefined') {
      // Fall through to normal handling — heic2any not loaded
      const reader = new FileReader();
      reader.onload = () => addImageSrc(reader.result, target);
      reader.readAsDataURL(file);
      return;
    }
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const reader = new FileReader();
    reader.onload = () => addImageSrc(reader.result, target);
    reader.readAsDataURL(blob);
  } catch (err) {
    console.error('HEIC conversion failed:', err);
    alert('Could not convert HEIC file: ' + err.message);
  }
}

async function handleGifFile(file, target) {
  try {
    // Try to use gifuct-js if available
    if (typeof parseGIF !== 'undefined' && typeof decompressFrames !== 'undefined') {
      const arrayBuffer = await file.arrayBuffer();
      const gif = parseGIF(arrayBuffer);
      const frames = decompressFrames(gif, true);

      if (frames.length <= 1) {
        // Single-frame GIF — treat as normal image
        const reader = new FileReader();
        reader.onload = () => addImageSrc(reader.result, target);
        reader.readAsDataURL(file);
        return;
      }

      // Multi-frame: create one image layer per frame
      const gW = gif.lsd.width;
      const gH = gif.lsd.height;
      let firstId = null;

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const canvas = document.createElement('canvas');
        canvas.width = gW; canvas.height = gH;
        const ctx = canvas.getContext('2d');
        const imageData = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height);
        ctx.putImageData(imageData, frame.dims.left, frame.dims.top);
        const src = canvas.toDataURL('image/png');
        ensureImage(src);
        const l = defaultImageLayer(src, gW, gH);
        l.name = `Frame ${i + 1}`;
        l.visible = i === 0; // Only first frame visible initially
        state.layers.push(l);
        if (i === 0) firstId = l.id;
      }

      setLastCreatedLayerId(firstId);
      renderLayerList();
      selectLayer(firstId);
      openPanelMobile('right', true);
      pushHistory('Import GIF frames');
      scheduleRender();
      return;
    }
    // gifuct-js not available — import as static image
    const reader = new FileReader();
    reader.onload = () => addImageSrc(reader.result, target);
    reader.readAsDataURL(file);
  } catch (err) {
    console.error('GIF import failed:', err);
    // Fallback: treat as static image
    const reader = new FileReader();
    reader.onload = () => addImageSrc(reader.result, target);
    reader.readAsDataURL(file);
  }
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

// Quick export is handled by exportModal.js quickExport()

export function applySizePreset(value) {
  if (value === 'custom') {
    const row = document.getElementById('customSizeRow');
    if (row) row.style.display = 'grid';
    return;
  }
  const row = document.getElementById('customSizeRow');
  if (row) row.style.display = 'none';
  const [w, h] = value.split('x').map(Number);
  const wEl = document.getElementById('customW');
  const hEl = document.getElementById('customH');
  if (wEl) wEl.value = w;
  if (hEl) hEl.value = h;
  applyCanvasResize(w, h, 'canvas');
}

// Delegate syncSizeInputs to the document panel module
export function syncSizeInputs() {
  docSyncSizeInputs();
}



export function initIcons() {
  setIcon('btnUndo', 'undo');
  setIcon('btnRedo', 'redo');
  setIcon('iconAddText', 'textT');
  setIcon('iconAddImage', 'image');
  setIcon('iconAddRect', 'shape');
  setIcon('btnOpenLeft', 'layers');
  setIcon('btnOpenRight', 'shape');
  const docIcon = document.getElementById('iconBtnDocument');
  if (docIcon) setIcon('iconBtnDocument', 'shape');
  const bubbleIconEl = document.getElementById('iconAddBubble');
  if (bubbleIconEl) bubbleIconEl.textContent = '💬';
  const stickerIconEl = document.getElementById('iconAddSticker');
  if (stickerIconEl) stickerIconEl.textContent = '😊';
  const drawIconEl = document.getElementById('iconAddDraw');
  if (drawIconEl) setIcon('iconAddDraw', 'brush');
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
  initDocumentPanel();
  fileInput = document.getElementById('fileInput');
  document.getElementById('btnAddText').addEventListener('click', addTextLayerAction);
  document.getElementById('btnAddRect').addEventListener('click', addRectLayerAction);
  document.getElementById('btnAddDraw') && document.getElementById('btnAddDraw').addEventListener('click', addDrawLayerAction);
  document.getElementById('btnAddImage').addEventListener('click', () => { pendingImageTarget = null; fileInput.click(); });
  const btnBubble = document.getElementById('btnAddBubble');
  if (btnBubble) btnBubble.addEventListener('click', addSpeechBubbleAction);
  const btnSticker = document.getElementById('btnAddSticker');
  if (btnSticker) btnSticker.addEventListener('click', () => toggleStickerPicker(btnSticker));
  const btnAddDraw = document.getElementById('btnAddDraw');
  if (btnAddDraw) btnAddDraw.addEventListener('click', addDrawLayerAction);
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) handleImageFile(fileInput.files[0], pendingImageTarget);
    fileInput.value = '';
    pendingImageTarget = null;
  });
  // Accept HEIC in file picker
  fileInput.setAttribute('accept', 'image/*,.heic,.heif');


  const btnCropCanvas = document.getElementById('btnCropCanvas');
  if (btnCropCanvas) btnCropCanvas.addEventListener('click', openCanvasCropModal);

  const btnStraighten = document.getElementById('btnStraighten');
  if (btnStraighten) btnStraighten.addEventListener('click', openStraightenModal);

  wireCustomSelect('sizePreset', (v) => applySizePreset(v));
  const cwEl = document.getElementById('customW');
  const chEl = document.getElementById('customH');
  if (cwEl) cwEl.addEventListener('change', (e) => { state.width = clamp(+e.target.value || 1080, 50, 8000); resizeStageBuffer(); pushHistory('Resize canvas'); });
  if (chEl) chEl.addEventListener('change', (e) => { state.height = clamp(+e.target.value || 1080, 50, 8000); resizeStageBuffer(); pushHistory('Resize canvas'); });

  let _resetPending = false, _resetTimer = null;
  // ---- Outpaint / expand canvas ----
  (function wireOutpaint() {
    const btnToggle  = document.getElementById('btnOutpaint');
    const panel      = document.getElementById('outpaintPanel');
    const btnRun     = document.getElementById('btnOutpaintRun');
    if (!btnToggle || !panel || !btnRun) return;

    btnToggle.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
    });

    btnRun.addEventListener('click', async () => {
      if (btnRun.disabled) return;
      const top    = Math.max(0, parseInt(document.getElementById('outpaintTop').value,    10) || 0);
      const bottom = Math.max(0, parseInt(document.getElementById('outpaintBottom').value, 10) || 0);
      const left   = Math.max(0, parseInt(document.getElementById('outpaintLeft').value,   10) || 0);
      const right  = Math.max(0, parseInt(document.getElementById('outpaintRight').value,  10) || 0);

      if (!top && !bottom && !left && !right) {
        const err = document.getElementById('outpaintError');
        if (err) { err.textContent = 'Enter at least one non-zero expansion value.'; err.style.display = 'block'; setTimeout(() => { err.style.display = 'none'; }, 4000); }
        return;
      }

      btnRun.disabled = true;
      btnToggle.disabled = true;
      const prog = document.getElementById('outpaintProgress');
      const label = document.getElementById('outpaintProgressLabel');
      const bar   = document.getElementById('outpaintProgressBar');
      const errEl = document.getElementById('outpaintError');
      if (errEl) errEl.style.display = 'none';
      if (prog) prog.style.display = 'block';

      function setOutpaintProgress(lbl, pct) {
        if (label) label.textContent = lbl;
        if (bar)   bar.style.width = Math.round(pct * 100) + '%';
      }

      try {
        await outpaintCanvas(top, right, bottom, left, (phase, pct) => {
          if (phase === 'download') {
            setOutpaintProgress(`Downloading model… ${Math.round(pct * 100)}%`, pct * 0.7);
          } else if (phase === 'init') {
            setOutpaintProgress('Initialising model…', 0.7 + pct * 0.15);
          } else if (phase === 'inference') {
            setOutpaintProgress(pct < 1 ? 'Running AI expand…' : 'Finalising…', 0.85 + pct * 0.15);
          } else if (phase === 'ready') {
            setOutpaintProgress('Ready', 1);
          }
        });
        renderLayerList();
        syncSizeInputs();
      } catch (err) {
        console.error('Outpaint failed:', err);
        if (errEl) { errEl.textContent = 'Failed: ' + (err.message || 'Unknown error'); errEl.style.display = 'block'; setTimeout(() => { errEl.style.display = 'none'; }, 5000); }
      } finally {
        if (prog) prog.style.display = 'none';
        btnRun.disabled = false;
        btnToggle.disabled = false;
      }
    });
  })();

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
  document.getElementById('btnExport').addEventListener('click', () => { quickExport(); showHint('Exporting…'); });
  const exportSettingsBtn = document.getElementById('btnExportSettings');
  if (exportSettingsBtn) exportSettingsBtn.addEventListener('click', openExportModal);
  const docBtn = document.getElementById('btnDocument');
  if (docBtn) docBtn.addEventListener('click', openDocumentPanel);
  document.getElementById('helpClose').addEventListener('click', toggleHelpModal);

  document.getElementById('btnOpenLeft').addEventListener('click', () => openPanelMobile('left'));
  document.getElementById('btnOpenRight').addEventListener('click', () => openPanelMobile('right'));
  document.getElementById('backdrop').addEventListener('click', closeAllPanels);

  document.getElementById('canvasArea').addEventListener('dragover', (e) => { e.preventDefault(); });
  document.getElementById('canvasArea').addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const isHeic = /\.(heic|heif)$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif';
    if (file.type.startsWith('image/') || isHeic) handleImageFile(file, null);
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

  // ---- Track-J: grid / rulers / snap toggles ----
  function _updateGridBtn() {
    const btn = byId('btnToggleGrid');
    if (btn) btn.classList.toggle('active', !!state.showGrid);
  }
  function _updateRulersBtn() {
    const btn = byId('btnToggleRulers');
    if (btn) btn.classList.toggle('active', !!state.showRulers);
  }
  function _updateSnapBtn() {
    const btn = byId('btnToggleSnap');
    if (btn) btn.classList.toggle('active', !!state.snapToGuides);
  }
  _updateGridBtn(); _updateRulersBtn(); _updateSnapBtn();

  const btnGrid = byId('btnToggleGrid');
  if (btnGrid) btnGrid.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    saveUIPref('ml_showGrid', state.showGrid);
    _updateGridBtn();
    scheduleRender();
  });
  const btnRulers = byId('btnToggleRulers');
  if (btnRulers) btnRulers.addEventListener('click', () => {
    state.showRulers = !state.showRulers;
    saveUIPref('ml_showRulers', state.showRulers);
    _updateRulersBtn();
    scheduleRender();
  });
  const btnSnap = byId('btnToggleSnap');
  if (btnSnap) btnSnap.addEventListener('click', () => {
    state.snapToGuides = !state.snapToGuides;
    saveUIPref('ml_snapToGuides', state.snapToGuides);
    _updateSnapBtn();
  });

  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!e.ctrlKey && !e.metaKey) {
      if (e.key.toLowerCase() === 'g') { e.preventDefault(); if (btnGrid) btnGrid.click(); }
      if (e.key.toLowerCase() === 'r' && !e.shiftKey) { e.preventDefault(); if (btnRulers) btnRulers.click(); }
    }
  }, true); // capture phase to fire before the main keydown handler

  window.addEventListener('resize', resizeStageBuffer);
}
