/**
 * Export modal — format, quality, size, social presets, batch export.
 *
 * Fast path: the main Export button fires immediately with last-used settings
 * (stored in localStorage). The settings gear opens the full modal.
 */

import { state, getSelected } from '../core/state.js';
import { exportAs } from '../render/renderer.js';
import { fontsReady } from '../render/fonts.js';
import { applyAdjustments } from '../render/glAdjust.js';
import { collapsibleHtml, wireCollapsible, byId } from './props/shared.js';

const LS_KEY = 'exportSettings';

const SOCIAL_PRESETS = [
  { label: '1:1 Instagram', w: 1080, h: 1080 },
  { label: '9:16 Story', w: 1080, h: 1920 },
  { label: '16:9 YouTube', w: 1920, h: 1080 },
  { label: '4:5 Portrait', w: 1080, h: 1350 },
];

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { format: 'png', quality: 92, scaleMode: 'multiplier', scale: 2, outW: 1080, outH: 1080 };
}

function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

/** Derive export filename from format. */
export function exportFilename(format) {
  if (format === 'jpeg') return 'meme.jpg';
  if (format === 'webp') return 'meme.webp';
  return 'meme.png';
}

/** Trigger a download with the given blob and filename. */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Run the export with the given settings object.
 * { format, quality, scaleMode, scale, outW, outH }
 */
export async function runExport(settings) {
  await fontsReady();
  const { format, quality, scaleMode, scale, outW, outH } = settings;

  let exportScale;
  if (scaleMode === 'multiplier') {
    exportScale = scale;
  } else {
    // custom pixel dimensions — compute scale from output size vs canvas size
    exportScale = Math.min(outW / state.width, outH / state.height);
  }

  const q = quality / 100;
  let blob;
  try {
    blob = await exportAs(format, q, exportScale);
  } catch (err) {
    alert('Export failed: ' + err.message);
    return;
  }

  triggerDownload(blob, exportFilename(format));
  saveSettings(settings);
}

/** Quick export using last-used settings — called from main Export button. */
export async function quickExport() {
  const settings = loadSettings();
  // Fall back to current scale selector value if present (backwards compat)
  const scaleEl = document.getElementById('exportScale');
  if (scaleEl && settings.scaleMode === 'multiplier') {
    settings.scale = +(scaleEl.dataset.value) || settings.scale;
  }
  await runExport(settings);
}

// ---- Modal ----

function buildModalHtml(s) {
  const fmtOpts = ['png', 'jpeg', 'webp'].map(f =>
    `<option value="${f}"${s.format === f ? ' selected' : ''}>${f.toUpperCase()}</option>`
  ).join('');

  const qualityDisplay = s.format !== 'png' ? 'block' : 'none';
  const customDisplay = s.scaleMode === 'custom' ? 'block' : 'none';

  const socialBtns = SOCIAL_PRESETS.map(p =>
    `<button class="smallbtn" data-social-w="${p.w}" data-social-h="${p.h}" style="flex:1;font-size:10px;">${p.label}</button>`
  ).join('');

  const advancedInner = `
    <div class="row" id="exportQualityRow" style="display:${qualityDisplay}">
      <label>Quality</label>
      <input class="grow" type="range" id="exportQualitySlider" min="1" max="100" step="1" value="${s.quality}">
      <span class="rangeval" id="exportQualityVal">${s.quality}</span>
    </div>
    <div class="row">
      <label>Size</label>
      <div class="seg grow" id="exportScaleModeSeg">
        <button data-v="multiplier"${s.scaleMode === 'multiplier' ? ' class="active"' : ''}>Multiplier</button>
        <button data-v="custom"${s.scaleMode === 'custom' ? ' class="active"' : ''}>Custom px</button>
      </div>
    </div>
    <div class="row" id="exportMultiplierRow" style="display:${s.scaleMode === 'multiplier' ? 'flex' : 'none'}">
      <label>Scale</label>
      <div class="seg grow" id="exportScaleSeg">
        <button data-v="1"${s.scale === 1 ? ' class="active"' : ''}>1x</button>
        <button data-v="2"${s.scale === 2 ? ' class="active"' : ''}>2x</button>
        <button data-v="4"${s.scale === 4 ? ' class="active"' : ''}>4x</button>
      </div>
    </div>
    <div class="sizegrid" id="exportCustomPxRow" style="display:${customDisplay}">
      <div class="numfield"><span>W</span><input class="fullinput" type="number" id="exportCustomW" value="${s.outW}" min="50" max="8000"></div>
      <div class="numfield"><span>H</span><input class="fullinput" type="number" id="exportCustomH" value="${s.outH}" min="50" max="8000"></div>
    </div>
    <div class="section-title" style="margin-top:8px;font-size:11px;">Social presets (sets output size)</div>
    <div class="row" style="flex-wrap:wrap;gap:4px;">${socialBtns}</div>
    <div class="section-title" style="margin-top:8px;font-size:11px;">Batch export</div>
    <div class="row">
      <button class="smallbtn full" id="exportBatchBtn">Drop images to batch export…</button>
    </div>
    <input type="file" id="exportBatchInput" multiple accept="image/*" style="display:none">
  `;

  return `
    <div class="export-modal-inner">
      <div class="export-modal-header">
        <span class="export-modal-title">Export Settings</span>
        <button class="help-close" id="exportModalClose">&times;</button>
      </div>
      <div class="section" style="padding-top:12px;">
        <div class="row">
          <label>Format</label>
          <select class="grow fullselect" id="exportFormatSelect">${fmtOpts}</select>
        </div>
        ${collapsibleHtml('exportAdvanced', 'Size & Quality', advancedInner, { defaultOpen: true })}
      </div>
      <div class="section" style="border-top:1px solid var(--border);padding-top:12px;">
        <button class="primarybtn full" id="exportModalDoExport" style="width:100%;justify-content:center;">Export as ${exportFilename(s.format)}</button>
      </div>
    </div>
  `;
}

let _modalEl = null;
let _currentSettings = null;

function getOrCreateModal() {
  if (_modalEl) return _modalEl;
  _modalEl = document.createElement('div');
  _modalEl.className = 'export-modal';
  _modalEl.id = 'exportModal2';
  document.body.appendChild(_modalEl);
  return _modalEl;
}

export function openExportModal() {
  _currentSettings = loadSettings();
  const modal = getOrCreateModal();
  modal.innerHTML = buildModalHtml(_currentSettings);
  modal.classList.add('show');
  wireCollapsible('exportAdvanced');
  wireModalEvents(modal, _currentSettings);
}

function closeExportModal() {
  if (_modalEl) _modalEl.classList.remove('show');
}

function wireModalEvents(modal, s) {
  const formatSel = document.getElementById('exportFormatSelect');
  const qualityRow = document.getElementById('exportQualityRow');
  const qualitySlider = document.getElementById('exportQualitySlider');
  const qualityVal = document.getElementById('exportQualityVal');
  const scaleModeSeg = document.getElementById('exportScaleModeSeg');
  const scaleSeg = document.getElementById('exportScaleSeg');
  const multiplierRow = document.getElementById('exportMultiplierRow');
  const customPxRow = document.getElementById('exportCustomPxRow');
  const customW = document.getElementById('exportCustomW');
  const customH = document.getElementById('exportCustomH');
  const doExportBtn = document.getElementById('exportModalDoExport');

  function refreshExportLabel() {
    if (doExportBtn) doExportBtn.textContent = 'Export as ' + exportFilename(s.format);
  }

  formatSel.addEventListener('change', () => {
    s.format = formatSel.value;
    qualityRow.style.display = s.format !== 'png' ? 'flex' : 'none';
    refreshExportLabel();
  });

  if (qualitySlider) {
    qualitySlider.addEventListener('input', () => {
      s.quality = +qualitySlider.value;
      if (qualityVal) qualityVal.textContent = s.quality;
    });
  }

  scaleModeSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      s.scaleMode = btn.dataset.v;
      scaleModeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      multiplierRow.style.display = s.scaleMode === 'multiplier' ? 'flex' : 'none';
      customPxRow.style.display = s.scaleMode === 'custom' ? 'block' : 'none';
    });
  });

  scaleSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      s.scale = +btn.dataset.v;
      scaleSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  customW.addEventListener('change', () => { s.outW = +customW.value || 1080; });
  customH.addEventListener('change', () => { s.outH = +customH.value || 1080; });

  // Social presets
  modal.querySelectorAll('[data-social-w]').forEach(btn => {
    btn.addEventListener('click', () => {
      s.scaleMode = 'custom';
      s.outW = +btn.dataset.socialW;
      s.outH = +btn.dataset.socialH;
      customW.value = s.outW;
      customH.value = s.outH;
      scaleModeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === 'custom'));
      multiplierRow.style.display = 'none';
      customPxRow.style.display = 'block';
    });
  });

  doExportBtn.addEventListener('click', async () => {
    closeExportModal();
    await runExport(s);
  });

  document.getElementById('exportModalClose').addEventListener('click', closeExportModal);

  // Batch export
  const batchBtn = document.getElementById('exportBatchBtn');
  const batchInput = document.getElementById('exportBatchInput');

  batchBtn.addEventListener('click', () => batchInput.click());
  batchInput.addEventListener('change', async () => {
    const files = Array.from(batchInput.files || []);
    if (!files.length) return;
    const sel = getSelected();
    const adjustments = sel ? (sel.adjustments || []) : [];

    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      const img = await loadImage(dataUrl);

      // Draw image onto a canvas, apply adjustments, download
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(img, 0, 0);

      let outputCanvas = applyAdjustments(canvas, adjustments) || canvas;
      const fmt = s.format;
      const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
      const q = s.quality / 100;
      const blob = await new Promise((res) => outputCanvas.toBlob(res, mime, q));
      if (!blob) continue;
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      const name = file.name.replace(/\.[^.]+$/, '') + '_exported.' + ext;
      triggerDownload(blob, name);
    }
    batchInput.value = '';
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeExportModal();
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
