import { getLayerById, ensureImage } from '../../core/state.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { clearAdjustCache } from '../../render/adjustCache.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions, collapsibleHtml, wireCollapsible } from './shared.js';
import { renderPropsPanel } from './panel.js';
import { setPendingImageTarget, triggerFilePicker } from '../toolbar.js';
import { removeBg } from '../../cutout/aiSegmentation.js';
import { ICONS } from '../icons.js';
import { openCropModal } from '../cropModal.js';
import { FILTER_PRESETS, applyPreset, clearPreset, getActivePresetId } from '../../presets/filters.js';
import { applyAdjustments } from '../../render/glAdjust.js';

// ---- Filter preset thumbnails ----
// Map of layerId+presetId -> { canvas, srcKey }
// srcKey is the layer.src tail used to detect stale entries.
const _thumbCache = new Map();

function _srcKey(layer) {
  return layer.src ? layer.src.slice(-32) : '__none__';
}

function _getCacheKey(layer, presetId) {
  return layer.id + '|' + presetId;
}

// Draw a 60x60 thumbnail of the layer's image with a preset's adjustments.
// Returns a canvas, or null if the image is not loaded yet.
function _renderThumb(layer, preset) {
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return null;

  const THUMB = 60;
  // Draw source image into a square thumbnail canvas.
  const src = document.createElement('canvas');
  src.width = THUMB; src.height = THUMB;
  const ctx = src.getContext('2d');
  // Fit image to square with object-fit:cover logic.
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const scale = Math.max(THUMB / nw, THUMB / nh);
  const dw = nw * scale, dh = nh * scale;
  ctx.drawImage(img, (THUMB - dw) / 2, (THUMB - dh) / 2, dw, dh);

  if (preset.adjustments.length === 0) return src;
  return applyAdjustments(src, preset.adjustments) || src;
}

// Populate thumbnail <img> elements lazily, one per animation frame.
function _scheduleThumbs(layer) {
  const srcKey = _srcKey(layer);
  let i = 0;

  function tick() {
    if (i >= FILTER_PRESETS.length) return;
    const preset = FILTER_PRESETS[i++];
    const cacheKey = _getCacheKey(layer, preset.id);

    // Invalidate if layer.src changed.
    const cached = _thumbCache.get(cacheKey);
    if (!cached || cached.srcKey !== srcKey) {
      const canvas = _renderThumb(layer, preset);
      if (canvas) {
        _thumbCache.set(cacheKey, { canvas, srcKey });
        // Push into the <img> in the DOM (if the strip is still rendered).
        const imgEl = document.querySelector(`.filter-thumb[data-preset="${preset.id}"]`);
        if (imgEl) imgEl.src = canvas.toDataURL('image/jpeg', 0.7);
      }
    } else {
      // Already cached — push anyway in case the DOM just rerendered.
      const imgEl = document.querySelector(`.filter-thumb[data-preset="${preset.id}"]`);
      if (imgEl && !imgEl.src) imgEl.src = cached.canvas.toDataURL('image/jpeg', 0.7);
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function _filterStripHtml(layer) {
  const activeId = getActivePresetId(layer);
  const chips = FILTER_PRESETS.map(p => {
    const isActive = p.id === activeId;
    // Check for a cached thumb — if available, embed it directly.
    const cacheKey = _getCacheKey(layer, p.id);
    const cached = _thumbCache.get(cacheKey);
    const srcAttr = (cached && cached.srcKey === _srcKey(layer))
      ? `src="${cached.canvas.toDataURL('image/jpeg', 0.7)}"`
      : '';
    return `<div class="filter-chip${isActive ? ' active' : ''}" data-preset-id="${p.id}">
      <img class="filter-thumb" data-preset="${p.id}" width="60" height="60" ${srcAttr}>
      <span class="filter-label">${p.label}</span>
    </div>`;
  }).join('');

  return `<div class="section filter-presets-section">
    <div class="section-title">Filters</div>
    <div class="filter-strip" id="filterStrip">${chips}</div>
  </div>`;
}

function _wireFilterStrip(layer) {
  const strip = byId('filterStrip');
  if (!strip) return;

  strip.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const presetId = chip.dataset.presetId;
      const preset = FILTER_PRESETS.find(p => p.id === presetId);
      if (!preset) return;

      if (presetId === 'none') {
        clearPreset(layer);
        pushHistory('Clear filter');
      } else {
        applyPreset(layer, preset);
        pushHistory('Apply filter: ' + preset.label);
      }
      clearAdjustCache();
      scheduleRender();

      // Update active highlight without full re-render of props panel.
      strip.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.presetId === presetId);
      });
      // Sync adjustment sliders to match the newly applied preset values.
      _syncAdjSliders(layer);
    });
  });

  // Kick off lazy thumbnail generation.
  _scheduleThumbs(layer);
}

// Sync adjustment slider positions to layer.adjustments without triggering events.
function _syncAdjSliders(layer) {
  const types = ['brightness', 'contrast', 'saturation'];
  const idMap = { brightness: 'aiBright', contrast: 'aiContr', saturation: 'aiSat' };
  for (const type of types) {
    const a = (layer.adjustments || []).find(x => x.type === type);
    const v = a ? a.value : 0;
    const el = byId(idMap[type]);
    if (el) {
      el.value = v;
      const valEl = byId(idMap[type] + 'val');
      if (valEl) valEl.textContent = v;
    }
  }
}

// Recompute which chip is highlighted after the user manually tweaks a slider.
function _updateFilterActiveState(layer) {
  const activeId = getActivePresetId(layer);
  const strip = byId('filterStrip');
  if (!strip) return;
  strip.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.presetId === activeId);
  });
}

function _adjVal(layer, type) {
  const a = (layer.adjustments || []).find(x => x.type === type);
  return a ? a.value : 0;
}

function _adjustmentsHtml(layer) {
  return `<div class="section">
    <div class="section-title">Adjustments</div>
    ${rangeRow('Brightness', 'aiBright', -100, 100, 1, _adjVal(layer, 'brightness'))}
    ${rangeRow('Contrast',   'aiContr',  -100, 100, 1, _adjVal(layer, 'contrast'))}
    ${rangeRow('Saturation', 'aiSat',    -100, 100, 1, _adjVal(layer, 'saturation'))}
  </div>`;
}

export function imagePropsHtml(layer) {
  const mask = layer.mask || { enabled: false, src: null, invert: false, feather: 0 };
  const maskInner = `
    <div class="togglerow"><span style="font-size:11.5px;color:var(--text-dim);">Enable mask</span>
      <label class="switch"><input type="checkbox" id="iMaskEnabled" ${mask.enabled ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
    </div>
    <div id="iMaskControls" style="display:${mask.enabled ? 'block' : 'none'}">
      <div class="togglerow" style="margin-top:6px;"><span style="font-size:11.5px;color:var(--text-dim);">Invert mask</span>
        <label class="switch"><input type="checkbox" id="iMaskInvert" ${mask.invert ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
      </div>
      ${rangeRow('Feather', 'iMaskFeather', 0, 50, 1, mask.feather ?? 0)}
      <div class="row" style="margin-top:6px;"><button class="smallbtn full danger" id="iMaskClear">Clear mask</button></div>
    </div>`;
  return `
    <div class="section">
      <div class="section-title">Image</div>
      <div class="row"><button class="smallbtn full" id="iReplace">Replace image</button></div>
      <div class="row"><button class="smallbtn full" id="iCrop">Crop</button></div>
      <div class="row">
        <label>Flip</label>
        <div class="seg">
          <button id="iFlipH" class="${layer.flipX ? 'active' : ''}">Horizontal</button>
          <button id="iFlipV" class="${layer.flipY ? 'active' : ''}">Vertical</button>
        </div>
      </div>
      <div class="togglerow" style="margin-top:8px;"><span style="font-size:11.5px;color:var(--text-dim);">Lock aspect ratio</span>
        <label class="switch"><input type="checkbox" id="iAspect" ${layer.aspectLocked ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
      </div>
      ${collapsibleHtml('iMaskSection', 'Mask', maskInner, { defaultOpen: mask.enabled })}
    </div>
    <div class="section" id="aiSection">
      <div class="section-title">AI Tools</div>
      <div class="row">
        <button class="smallbtn full" id="iBgRemove" style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <span class="icon" style="width:13px;height:13px;display:flex;align-items:center;">${ICONS.sparkles}</span>
          Remove background
        </button>
      </div>
      <div id="aiProgress" style="display:none;">
        <div class="ai-progress-label" id="aiProgressLabel">Loading model…</div>
        <div class="ai-progress-track"><div class="ai-progress-bar" id="aiProgressBar"></div></div>
      </div>
      <div id="aiError" class="ai-error" style="display:none;"></div>
    </div>
    ${_filterStripHtml(layer)}
    ${_adjustmentsHtml(layer)}
    ${transformHtml(layer)}
    ${actionsHtml()}`;
}

export function wireImageProps(layer) {
  byId('iReplace').addEventListener('click', () => { setPendingImageTarget(layer); triggerFilePicker(); });
  byId('iCrop').addEventListener('click', () => openCropModal(layer));
  byId('iFlipH').addEventListener('click', () => { layer.flipX = !layer.flipX; renderPropsPanel(); scheduleRender(); pushHistory('Flip horizontal'); });
  byId('iFlipV').addEventListener('click', () => { layer.flipY = !layer.flipY; renderPropsPanel(); scheduleRender(); pushHistory('Flip vertical'); });
  byId('iAspect').addEventListener('change', (e) => { layer.aspectLocked = e.target.checked; pushHistory(); });

  // ---- Filter preset strip ----
  _wireFilterStrip(layer);

  // ---- Adjustments ----
  if (!layer.adjustments) layer.adjustments = [];
  function wireAdj(id, type) {
    byId(id).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      byId(id + 'val').textContent = v;
      let adj = layer.adjustments.find(a => a.type === type);
      if (adj) { adj.value = v; } else { layer.adjustments.push({ type, value: v }); }
      clearAdjustCache(layer.id);
      scheduleRender();
      // After a manual tweak, re-evaluate which preset (if any) is still active.
      _updateFilterActiveState(layer);
    });
    byId(id).addEventListener('change', () => pushHistory());
  }
  wireAdj('aiBright', 'brightness');
  wireAdj('aiContr',  'contrast');
  wireAdj('aiSat',    'saturation');

  // ---- Mask controls ----
  if (!layer.mask) layer.mask = { enabled: false, src: null, invert: false, feather: 0 };
  wireCollapsible('iMaskSection');
  byId('iMaskEnabled').addEventListener('change', (e) => {
    layer.mask.enabled = e.target.checked;
    byId('iMaskControls').style.display = e.target.checked ? 'block' : 'none';
    scheduleRender(); pushHistory();
  });
  byId('iMaskInvert').addEventListener('change', (e) => {
    layer.mask.invert = e.target.checked; scheduleRender(); pushHistory();
  });
  byId('iMaskFeather').addEventListener('input', (e) => {
    layer.mask.feather = Number(e.target.value);
    byId('iMaskFeatherval').textContent = e.target.value;
    scheduleRender();
  });
  byId('iMaskFeather').addEventListener('change', () => pushHistory());
  byId('iMaskClear').addEventListener('click', () => {
    layer.mask = { enabled: false, src: null, invert: false, feather: 0 };
    renderPropsPanel(); scheduleRender(); pushHistory('Clear mask');
  });

  // ---- AI background removal ----
  byId('iBgRemove').addEventListener('click', () => runBgRemoval(layer));

  wireActions(layer);
}

function setProgress(label, pct) {
  const prog = byId('aiProgress');
  if (!prog) return;
  prog.style.display = 'block';
  byId('aiProgressLabel').textContent = label;
  byId('aiProgressBar').style.width = Math.round(pct * 100) + '%';
}

function hideProgress() {
  const prog = byId('aiProgress');
  if (prog) prog.style.display = 'none';
}

function showAiError(msg) {
  const el = byId('aiError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { if (el) el.style.display = 'none'; }, 5000);
}

async function runBgRemoval(layer) {
  const btn = byId('iBgRemove');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  byId('aiError') && (byId('aiError').style.display = 'none');

  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) {
    showAiError('Image not loaded yet — try again in a moment.');
    btn.disabled = false;
    return;
  }

  // If the layer has a crop, bake it into a canvas so the AI only sees the cropped region.
  let aiInput = img;
  const crop = layer.crop;
  if (crop && (crop.x !== 0 || crop.y !== 0 || crop.w !== 1 || crop.h !== 1)) {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const sx = crop.x * nw, sy = crop.y * nh;
    const sw = crop.w * nw, sh = crop.h * nh;
    const baked = document.createElement('canvas');
    baked.width = Math.round(sw);
    baked.height = Math.round(sh);
    baked.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, baked.width, baked.height);
    aiInput = baked;
  }

  setProgress('Starting AI cutout...', 0.05);
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    const maskCanvas = await removeBg(aiInput, (phase, pct) => {
      if (phase === 'download') {
        setProgress(`Downloading model… ${Math.round(pct * 100)}%`, pct * 0.7);
      } else if (phase === 'init') {
        setProgress('Initialising model…', 0.7 + pct * 0.15);
      } else if (phase === 'inference') {
        setProgress(pct < 1 ? 'Running AI…' : 'Processing mask…', 0.85 + pct * 0.15);
      } else if (phase === 'ready') {
        setProgress('Ready', 1);
      }
    });

    // Check the layer still exists (user might have deleted it while waiting).
    const currentLayer = getLayerById(layer.id);
    if (!currentLayer) {
      hideProgress();
      btn.disabled = false;
      return;
    }

    setProgress('Applying mask…', 1);

    // Convert mask (R=G=B=gray, A=255) → alpha-keyed mask (R=G=B=255, A=gray)
    // so destination-in compositing in the renderer produces correct transparency.
    const mw = maskCanvas.width, mh = maskCanvas.height;
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = mw; alphaCanvas.height = mh;
    const alphaCtx = alphaCanvas.getContext('2d');
    alphaCtx.drawImage(maskCanvas, 0, 0);
    const imgData = alphaCtx.getImageData(0, 0, mw, mh);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 3] = d[i]; // A = gray value (R channel)
      d[i] = d[i + 1] = d[i + 2] = 255;
    }
    alphaCtx.putImageData(imgData, 0, 0);

    if (!currentLayer.mask) currentLayer.mask = { enabled: false, src: null, invert: false, feather: 0 };
    currentLayer.mask.src = alphaCanvas.toDataURL('image/png');
    currentLayer.mask.enabled = true;

    renderPropsPanel();
    scheduleRender();
    pushHistory('Remove background (AI)');
    hideProgress();
  } catch (err) {
    console.error('AI background removal failed:', err);
    showAiError('Failed: ' + (err.message || 'Unknown error'));
    hideProgress();
  } finally {
    if (byId('iBgRemove')) byId('iBgRemove').disabled = false;
  }
}
