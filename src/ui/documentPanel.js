/**
 * Document panel — canvas size, resize vs scale choice, .meme import/export.
 *
 * Canvas size controls are pulled OUT of the always-visible toolbar and live here.
 * Opening the panel is triggered by a "Document" icon in the floating controls.
 */

import { state } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { resizeStageBuffer } from '../render/renderer.js';
import { renderLayerList } from './layerList.js';
import { renderPropsPanel } from './props/panel.js';
import { byId } from './props/shared.js';
import { wireCustomSelect } from './customSelect.js';
import { exportMemeFile, importMemeFile } from '../persistence/memeFile.js';
import { clamp } from '../core/utils.js';

const CANVAS_PRESETS = [
  { value: '1080x1080', label: 'Square 1080 (1:1)' },
  { value: '1080x1920', label: 'Story 1080×1920 (9:16)' },
  { value: '1920x1080', label: 'YouTube 1920×1080 (16:9)' },
  { value: '1080x1350', label: 'Portrait 1080×1350 (4:5)' },
  { value: '1200x900',  label: 'Classic 1200×900 (4:3)' },
  { value: '2480x3508', label: 'A4 Portrait (300dpi)' },
  { value: 'custom',    label: 'Custom…' },
];

let _panelEl = null;
let _resizeMode = 'canvas'; // 'canvas' | 'image'

function buildPanelHtml() {
  const presetOpts = CANVAS_PRESETS.map(p =>
    `<div class="csel-opt${p.value === `${state.width}x${state.height}` ? ' csel-opt-sel' : ''}" data-value="${p.value}">${p.label}</div>`
  ).join('');

  const matchPreset = CANVAS_PRESETS.find(p => p.value === `${state.width}x${state.height}`);
  const presetLabel = matchPreset ? matchPreset.label : 'Custom…';

  return `
    <div class="doc-panel-inner">
      <div class="export-modal-header">
        <span class="export-modal-title">Document</span>
        <button class="help-close" id="docPanelClose">&times;</button>
      </div>

      <div class="section" style="padding-top:12px;">
        <div class="section-title">Canvas Size</div>

        <div class="row">
          <label>Preset</label>
          <div class="csel grow" id="docSizePreset" data-value="${matchPreset ? matchPreset.value : 'custom'}" tabindex="0" role="combobox">
            <span class="csel-label">${presetLabel}</span>
            <svg class="csel-chevron" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div class="csel-popup" role="listbox">${presetOpts}</div>
          </div>
        </div>

        <div class="sizegrid" id="docCustomSizeRow" style="margin-bottom:8px;">
          <div class="numfield"><span>W</span><input class="fullinput" type="number" id="docCustomW" min="50" max="8000" value="${state.width}"></div>
          <div class="numfield"><span>H</span><input class="fullinput" type="number" id="docCustomH" min="50" max="8000" value="${state.height}"></div>
        </div>

        <div class="row">
          <label style="width:auto;margin-right:8px;">Mode</label>
          <div class="seg grow" id="docResizeModeSeg">
            <button data-v="canvas"${_resizeMode === 'canvas' ? ' class="active"' : ''} title="Change canvas size, keep layers at absolute positions">Canvas</button>
            <button data-v="image"${_resizeMode === 'image' ? ' class="active"' : ''} title="Scale entire composition proportionally">Image</button>
          </div>
        </div>
        <div style="font-size:10px;color:var(--text-faint);margin-bottom:8px;" id="docResizeModeHint">
          ${_resizeMode === 'canvas' ? 'Canvas size: layers stay at absolute positions.' : 'Image size: layers scale proportionally.'}
        </div>

        <button class="smallbtn full" id="docApplySize">Apply Size</button>
      </div>

      <div class="section" style="border-top:1px solid var(--border);padding-top:12px;">
        <div class="section-title">Project File</div>
        <div class="row">
          <button class="smallbtn full" id="docSaveProject">Save .meme project</button>
        </div>
        <div class="row">
          <button class="smallbtn full" id="docOpenProject">Open .meme project…</button>
          <input type="file" id="docProjectInput" accept=".meme" style="display:none">
        </div>
      </div>
    </div>
  `;
}

function getOrCreatePanel() {
  if (_panelEl) return _panelEl;
  _panelEl = document.createElement('div');
  _panelEl.className = 'export-modal'; // reuse same overlay style
  _panelEl.id = 'documentPanel';
  document.body.appendChild(_panelEl);
  return _panelEl;
}

export function openDocumentPanel() {
  const panel = getOrCreatePanel();
  panel.innerHTML = buildPanelHtml();
  panel.classList.add('show');
  wirePanelEvents(panel);
  // Wire custom select for size preset
  wireCustomSelect('docSizePreset', (value) => {
    if (value === 'custom') {
      // Just show dimensions
      return;
    }
    const [w, h] = value.split('x').map(Number);
    byId('docCustomW').value = w;
    byId('docCustomH').value = h;
  });
}

function closeDocumentPanel() {
  if (_panelEl) _panelEl.classList.remove('show');
}

function wirePanelEvents(panel) {
  byId('docPanelClose').addEventListener('click', closeDocumentPanel);

  const resizeModeSeg = byId('docResizeModeSeg');
  const hint = byId('docResizeModeHint');

  resizeModeSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      _resizeMode = btn.dataset.v;
      resizeModeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      if (hint) hint.textContent = _resizeMode === 'canvas'
        ? 'Canvas size: layers stay at absolute positions.'
        : 'Image size: layers scale proportionally.';
    });
  });

  byId('docApplySize').addEventListener('click', () => {
    const newW = clamp(+byId('docCustomW').value || 1080, 50, 8000);
    const newH = clamp(+byId('docCustomH').value || 1080, 50, 8000);
    applyCanvasResize(newW, newH, _resizeMode);
    closeDocumentPanel();
  });

  byId('docSaveProject').addEventListener('click', async () => {
    try { await exportMemeFile(); } catch (e) { alert('Save failed: ' + e.message); }
  });

  byId('docOpenProject').addEventListener('click', () => byId('docProjectInput').click());
  byId('docProjectInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      await importMemeFile(file);
      renderLayerList();
      renderPropsPanel();
      resizeStageBuffer();
    } catch (err) {
      alert('Failed to open project: ' + err.message);
    }
    e.target.value = '';
    closeDocumentPanel();
  });

  // Close on backdrop click
  panel.addEventListener('click', (e) => {
    if (e.target === panel) closeDocumentPanel();
  });
}

/**
 * Apply canvas resize with mode choice.
 * @param {number} newW
 * @param {number} newH
 * @param {'canvas'|'image'} mode
 */
export function applyCanvasResize(newW, newH, mode) {
  const oldW = state.width;
  const oldH = state.height;
  state.width = newW;
  state.height = newH;

  if (mode === 'image' && (oldW !== newW || oldH !== newH)) {
    const sx = newW / oldW;
    const sy = newH / oldH;
    for (const layer of state.layers) {
      layer.x *= sx;
      layer.y *= sy;
      layer.w *= sx;
      layer.h *= sy;
    }
  }

  resizeStageBuffer();
  pushHistory('Canvas size');
}

/**
 * Sync the document panel inputs (if open) with current state.
 * Also keep legacy toolbar size inputs in sync if they still exist in DOM.
 */
export function syncSizeInputs() {
  // Document panel inputs (if panel is open)
  const wEl = byId('docCustomW');
  const hEl = byId('docCustomH');
  if (wEl) wEl.value = state.width;
  if (hEl) hEl.value = state.height;

  // Legacy toolbar inputs — keep in sync for backwards compatibility
  const oldW = byId('customW');
  const oldH = byId('customH');
  if (oldW) oldW.value = state.width;
  if (oldH) oldH.value = state.height;

  // Sync legacy toolbar size preset dropdown
  const oldPreset = byId('sizePreset');
  if (oldPreset) {
    const match = `${state.width}x${state.height}`;
    const matchOpt = oldPreset.querySelector(`.csel-opt[data-value="${match}"]`);
    if (matchOpt) {
      oldPreset.dataset.value = match;
      const labelEl = oldPreset.querySelector('.csel-label');
      if (labelEl) labelEl.textContent = matchOpt.textContent;
      oldPreset.querySelectorAll('.csel-opt').forEach(o => o.classList.toggle('csel-opt-sel', o === matchOpt));
      const customRow = byId('customSizeRow');
      if (customRow) customRow.style.display = 'none';
    } else {
      oldPreset.dataset.value = 'custom';
      const labelEl = oldPreset.querySelector('.csel-label');
      if (labelEl) labelEl.textContent = 'Custom…';
      oldPreset.querySelectorAll('.csel-opt').forEach(o => o.classList.toggle('csel-opt-sel', o.dataset.value === 'custom'));
      const customRow = byId('customSizeRow');
      if (customRow) customRow.style.display = 'grid';
    }
  }
}
