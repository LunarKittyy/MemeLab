import { getLayerById, ensureImage } from '../../core/state.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { clearAdjustCache } from '../../render/adjustCache.js';
import { computeAutoEnhance } from '../../render/glAdjust.js';
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

// ─── Helpers ──────────────────────────────────────────────────────────────
function _adjVal(layer, type) {
  const a = (layer.adjustments || []).find(x => x.type === type);
  return a ? (a.value || 0) : 0;
}

function _getCurves(layer, channel) {
  const a = (layer.adjustments || []).find(x => x.type === 'curves' && x.channel === channel);
  return a ? a.points : null;
}

function _getHsl(layer, range) {
  const a = (layer.adjustments || []).find(x => x.type === 'hsl' && x.range === range);
  return a ? { hue: a.hue || 0, saturation: a.saturation || 0, luminance: a.luminance || 0 } : { hue: 0, saturation: 0, luminance: 0 };
}

// Curve control-point extraction: we use 3-point simplified curve
// Control points are at x=0 (blacks), x=0.5 (mids), x=1 (highlights)
function _curvePointY(points, x) {
  if (!points) return x; // identity
  const pt = points.find(p => Math.abs(p[0] - x) < 0.01);
  return pt ? pt[1] : x;
}

function _pointsToSliders(points) {
  return {
    blacks: Math.round(_curvePointY(points, 0)    * 100),
    mids:   Math.round(_curvePointY(points, 0.5)  * 100),
    highs:  Math.round(_curvePointY(points, 1.0)  * 100),
  };
}

function _slidersToPoints(blacks, mids, highs) {
  return [
    [0,   blacks / 100],
    [0.5, mids   / 100],
    [1.0, highs  / 100],
  ];
}

// ─── Adjustment section HTML ──────────────────────────────────────────────
function _curvesSectionHtml(layer, channel) {
  const pts = _getCurves(layer, channel);
  const sliders = _pointsToSliders(pts);
  const prefix = 'aiCurv' + channel;
  return `
    <div class="adj-curves-section" data-channel="${channel}">
      <div class="adj-curve-preview" id="${prefix}Preview"></div>
      ${rangeRow('Blacks',     prefix + 'Blacks', 0, 100, 1, sliders.blacks)}
      ${rangeRow('Mids',       prefix + 'Mids',   0, 100, 1, sliders.mids)}
      ${rangeRow('Highlights', prefix + 'Highs',  0, 100, 1, sliders.highs)}
    </div>`;
}

const HSL_RANGES = ['reds','oranges','yellows','greens','cyans','blues','purples'];

function _hslSectionHtml(layer) {
  const activeRange = 'reds';
  const hsl = _getHsl(layer, activeRange);
  const chipsHtml = HSL_RANGES.map(r =>
    `<button class="adj-hsl-chip${r === activeRange ? ' active' : ''}" data-range="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`
  ).join('');
  return `
    <div id="hslSection">
      <div class="adj-hsl-chips">${chipsHtml}</div>
      <div id="hslSliders">
        ${rangeRow('Hue',        'aiHslH', -180, 180, 1, hsl.hue)}
        ${rangeRow('Saturation', 'aiHslS', -100, 100, 1, hsl.saturation)}
        ${rangeRow('Luminance',  'aiHslL', -100, 100, 1, hsl.luminance)}
      </div>
    </div>`;
}

function _adjustmentsHtml(layer) {
  return `<div class="section">
    <div class="section-title">Adjustments</div>
    ${rangeRow('Brightness', 'aiBright', -100, 100, 1, _adjVal(layer, 'brightness'))}
    ${rangeRow('Contrast',   'aiContr',  -100, 100, 1, _adjVal(layer, 'contrast'))}
    ${rangeRow('Saturation', 'aiSat',    -100, 100, 1, _adjVal(layer, 'saturation'))}
    <div class="adj-picker-section" style="margin-top:8px;">
      <div class="adj-category-label">Add adjustment</div>
      <div style="margin-bottom:4px;">
        <div class="adj-category-label">Tone</div>
        <div class="adj-picker-grid">
          <button class="adj-pick-btn" data-type="highlights">Highlights</button>
          <button class="adj-pick-btn" data-type="shadows">Shadows</button>
          <button class="adj-pick-btn" data-type="curves">Curves</button>
        </div>
      </div>
      <div>
        <div class="adj-category-label">Color</div>
        <div class="adj-picker-grid">
          <button class="adj-pick-btn" data-type="vibrance">Vibrance</button>
          <button class="adj-pick-btn" data-type="temperature">Temperature</button>
          <button class="adj-pick-btn" data-type="tint">Tint</button>
          <button class="adj-pick-btn" data-type="hsl">HSL</button>
        </div>
      </div>
      <button class="smallbtn full" id="aiAutoEnhance" style="margin-top:8px;">Auto</button>
    </div>

    <div id="adjSliders">
      ${_adjSliderHtml(layer)}
    </div>
  </div>`;
}

function _adjSliderHtml(layer) {
  const adjs = layer.adjustments || [];
  const types = adjs.map(a => a.type);
  let html = '';

  // Dynamic scalar adjustments (brightness/contrast/saturation are always shown above)
  const scalars = [
    { type: 'highlights',  label: 'Highlights',   id: 'aiHighl',   min: -100, max: 100 },
    { type: 'shadows',     label: 'Shadows',      id: 'aiShad',    min: -100, max: 100 },
    { type: 'vibrance',    label: 'Vibrance',     id: 'aiVibr',    min: -100, max: 100 },
    { type: 'temperature', label: 'Temperature',  id: 'aiTemp',    min: -100, max: 100 },
    { type: 'tint',        label: 'Tint',         id: 'aiTint',    min: -100, max: 100 },
  ];
  for (const s of scalars) {
    if (types.includes(s.type)) {
      html += `<div class="adj-slider-group" data-type="${s.type}">
        <div class="adj-slider-header">
          <span>${s.label}</span>
          <button class="adj-remove-btn" data-remove="${s.type}" title="Remove">✕</button>
        </div>
        ${rangeRow('', s.id, s.min, s.max, 1, _adjVal(layer, s.type))}
      </div>`;
    }
  }

  // Curves
  const curveChannels = ['rgb', 'r', 'g', 'b'];
  for (const ch of curveChannels) {
    const hasCurve = adjs.some(a => a.type === 'curves' && a.channel === ch);
    if (hasCurve) {
      const chLabel = { rgb: 'RGB', r: 'Red Channel', g: 'Green Channel', b: 'Blue Channel' }[ch];
      html += `<div class="adj-slider-group" data-type="curves-${ch}">
        <div class="adj-slider-header">
          <span>Curves — ${chLabel}</span>
          <button class="adj-remove-btn" data-remove="curves-${ch}" title="Remove">✕</button>
        </div>
        ${_curvesSectionHtml(layer, ch)}
      </div>`;
    }
  }

  // HSL
  if (adjs.some(a => a.type === 'hsl')) {
    html += `<div class="adj-slider-group" data-type="hsl">
      <div class="adj-slider-header">
        <span>HSL</span>
        <button class="adj-remove-btn" data-remove="hsl" title="Remove">✕</button>
      </div>
      ${_hslSectionHtml(layer)}
    </div>`;
  }

  return html;
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

// ─── Wire adjustments ─────────────────────────────────────────────────────

// Returns a function that safely re-renders the dynamic slider region
// and syncs the base slider values.
function makeRerenderSliders(layer) {
  return () => {
    const container = byId('adjSliders');
    if (container) container.innerHTML = _adjSliderHtml(layer);
    wireAdjSliders(layer);
    // Sync always-present base slider display values
    const syncBase = (id, type) => {
      const el = byId(id);
      if (el) {
        const v = _adjVal(layer, type);
        el.value = v;
        const valEl = byId(id + 'val');
        if (valEl) valEl.textContent = v;
      }
    };
    syncBase('aiBright', 'brightness');
    syncBase('aiContr',  'contrast');
    syncBase('aiSat',    'saturation');
  };
}

// Wire the three always-present base sliders (brightness/contrast/saturation).
// Called once from wireImageProps; they persist across adjSliders re-renders.
function wireBaseSliders(layer) {
  if (!layer.adjustments) layer.adjustments = [];
  const baseIds = { aiBright: 'brightness', aiContr: 'contrast', aiSat: 'saturation' };
  for (const [id, type] of Object.entries(baseIds)) {
    const el = byId(id);
    if (!el) continue;
    el.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      const valEl = byId(id + 'val');
      if (valEl) valEl.textContent = v;
      let adj = layer.adjustments.find(a => a.type === type);
      if (adj) { adj.value = v; } else { layer.adjustments.push({ type, value: v }); }
      clearAdjustCache();
      scheduleRender();
    });
    el.addEventListener('change', () => pushHistory());
  }
}

function wireAdjSliders(layer) {
  if (!layer.adjustments) layer.adjustments = [];

  // ── Dynamic scalar sliders (added via picker) ──
  const scalarIds = {
    aiHighl:  'highlights',
    aiShad:   'shadows',
    aiVibr:   'vibrance',
    aiTemp:   'temperature',
    aiTint:   'tint',
  };
  for (const [id, type] of Object.entries(scalarIds)) {
    const el = byId(id);
    if (!el) continue;
    el.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      const valEl = byId(id + 'val');
      if (valEl) valEl.textContent = v;
      let adj = layer.adjustments.find(a => a.type === type);
      if (adj) { adj.value = v; } else { layer.adjustments.push({ type, value: v }); }
      clearAdjustCache();
      scheduleRender();
    });
    el.addEventListener('change', () => pushHistory());
  }

  // ── Curves sliders ──
  for (const channel of ['rgb', 'r', 'g', 'b']) {
    const prefix = 'aiCurv' + channel;
    const sliderIds = [prefix + 'Blacks', prefix + 'Mids', prefix + 'Highs'];
    const xPositions = [0, 0.5, 1.0];

    for (let si = 0; si < sliderIds.length; si++) {
      const sliderId = sliderIds[si];
      const xPos = xPositions[si];
      const el = byId(sliderId);
      if (!el) continue;

      el.addEventListener('input', (e) => {
        const v = Number(e.target.value) / 100;
        const valEl = byId(sliderId + 'val');
        if (valEl) valEl.textContent = Math.round(v * 100);

        // Rebuild the 3-point curve from all three sliders
        const prefixB = prefix + 'Blacks', prefixM = prefix + 'Mids', prefixH = prefix + 'Highs';
        const blacks = (byId(prefixB) ? Number(byId(prefixB).value) : 0)   / 100;
        const mids   = (byId(prefixM) ? Number(byId(prefixM).value) : 50)  / 100;
        const highs  = (byId(prefixH) ? Number(byId(prefixH).value) : 100) / 100;

        const points = _slidersToPoints(blacks * 100, mids * 100, highs * 100);

        let adj = layer.adjustments.find(a => a.type === 'curves' && a.channel === channel);
        if (adj) { adj.points = points; } else { layer.adjustments.push({ type: 'curves', channel, points }); }

        _drawCurvePreview(prefix + 'Preview', points);
        clearAdjustCache();
        scheduleRender();
      });
      el.addEventListener('change', () => pushHistory());
    }

    // Initial curve preview
    const pts = _getCurves(layer, channel);
    if (pts) _drawCurvePreview(prefix + 'Preview', pts);
  }

  // ── HSL sliders ──
  let _activeHslRange = 'reds';
  const hslContainer = byId('hslSection');
  if (hslContainer) {
    // Wire chips
    hslContainer.querySelectorAll('.adj-hsl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        _activeHslRange = chip.dataset.range;
        hslContainer.querySelectorAll('.adj-hsl-chip').forEach(c => c.classList.toggle('active', c === chip));
        // Update sliders to show this range's values
        const hsl = _getHsl(layer, _activeHslRange);
        const hEl = byId('aiHslH'), sEl = byId('aiHslS'), lEl = byId('aiHslL');
        if (hEl) { hEl.value = hsl.hue;        byId('aiHslHval') && (byId('aiHslHval').textContent = hsl.hue); }
        if (sEl) { sEl.value = hsl.saturation; byId('aiHslSval') && (byId('aiHslSval').textContent = hsl.saturation); }
        if (lEl) { lEl.value = hsl.luminance;  byId('aiHslLval') && (byId('aiHslLval').textContent = hsl.luminance); }
      });
    });

    // Wire H/S/L sliders
    const hslSliderDefs = [
      { id: 'aiHslH', field: 'hue' },
      { id: 'aiHslS', field: 'saturation' },
      { id: 'aiHslL', field: 'luminance' },
    ];
    for (const { id, field } of hslSliderDefs) {
      const el = byId(id);
      if (!el) continue;
      el.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        const valEl = byId(id + 'val');
        if (valEl) valEl.textContent = v;

        let adj = layer.adjustments.find(a => a.type === 'hsl' && a.range === _activeHslRange);
        if (adj) {
          adj[field] = v;
        } else {
          const entry = { type: 'hsl', range: _activeHslRange, hue: 0, saturation: 0, luminance: 0 };
          entry[field] = v;
          layer.adjustments.push(entry);
        }
        clearAdjustCache();
        scheduleRender();
      });
      el.addEventListener('change', () => pushHistory());
    }
  }

  // ── Remove buttons ──
  const rerenderSliders = makeRerenderSliders(layer);
  document.querySelectorAll('.adj-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const removeKey = btn.dataset.remove;
      if (removeKey === 'hsl') {
        layer.adjustments = (layer.adjustments || []).filter(a => a.type !== 'hsl');
      } else if (removeKey && removeKey.startsWith('curves-')) {
        const ch = removeKey.slice(7);
        layer.adjustments = (layer.adjustments || []).filter(a => !(a.type === 'curves' && a.channel === ch));
      } else if (removeKey) {
        layer.adjustments = (layer.adjustments || []).filter(a => a.type !== removeKey);
      }
      clearAdjustCache();
      scheduleRender();
      pushHistory('Remove adjustment');
      rerenderSliders();
    });
  });
}

// Simple canvas curve preview
function _drawCurvePreview(canvasId, points) {
  const el = byId(canvasId);
  if (!el) return;
  // The preview div becomes a small canvas
  if (el.tagName !== 'CANVAS') {
    el.innerHTML = '<canvas width="120" height="60" style="display:block;margin:4px auto;border-radius:4px;opacity:0.7;"></canvas>';
    const cvs = el.querySelector('canvas');
    _drawOnCurveCanvas(cvs, points);
  } else {
    _drawOnCurveCanvas(el, points);
  }
}

function _drawOnCurveCanvas(cvs, points) {
  const ctx = cvs.getContext('2d');
  const w = cvs.width, h = cvs.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, w, h);
  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 0.5;
  for (const v of [0.25, 0.5, 0.75]) {
    ctx.beginPath(); ctx.moveTo(v * w, 0); ctx.lineTo(v * w, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, v * h); ctx.lineTo(w, v * h); ctx.stroke();
  }
  // Curve
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const y = _sampleCurve(points, x);
    const px = x * w;
    const py = h - y * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // Control points
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const pt of points) {
    ctx.beginPath();
    ctx.arc(pt[0] * w, h - pt[1] * h, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function _sampleCurve(points, x) {
  if (!points || points.length === 0) return x;
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (x <= pts[i+1][0]) {
      const t = (x - pts[i][0]) / (pts[i+1][0] - pts[i][0]);
      return pts[i][1] * (1 - t) + pts[i+1][1] * t;
    }
  }
  return x;
}

export function wireImageProps(layer) {
  byId('iReplace').addEventListener('click', () => { setPendingImageTarget(layer); triggerFilePicker(); });
  byId('iCrop').addEventListener('click', () => openCropModal(layer));
  byId('iFlipH').addEventListener('click', () => { layer.flipX = !layer.flipX; renderPropsPanel(); scheduleRender(); pushHistory('Flip horizontal'); });
  byId('iFlipV').addEventListener('click', () => { layer.flipY = !layer.flipY; renderPropsPanel(); scheduleRender(); pushHistory('Flip vertical'); });
  byId('iAspect').addEventListener('change', (e) => { layer.aspectLocked = e.target.checked; pushHistory(); });

  // ---- Filter preset strip ----
  _wireFilterStrip(layer);

  // ---- Adjustments section ----
  if (!layer.adjustments) layer.adjustments = [];
  wireCollapsible('adjSection');

  // Wire the always-present base sliders (not re-rendered on picker changes)
  wireBaseSliders(layer);

  const rerenderSliders = makeRerenderSliders(layer);

  // Picker buttons — add new adjustment type
  document.querySelectorAll('.adj-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      if (!type) return;

      if (type === 'curves') {
        // Add RGB curves by default if not present
        const already = (layer.adjustments || []).some(a => a.type === 'curves' && a.channel === 'rgb');
        if (!already) {
          layer.adjustments.push({ type: 'curves', channel: 'rgb', points: [[0,0],[0.5,0.5],[1,1]] });
        }
      } else if (type === 'hsl') {
        const already = (layer.adjustments || []).some(a => a.type === 'hsl');
        if (!already) {
          layer.adjustments.push({ type: 'hsl', range: 'reds', hue: 0, saturation: 0, luminance: 0 });
        }
      } else {
        const already = (layer.adjustments || []).some(a => a.type === type);
        if (!already) {
          layer.adjustments.push({ type, value: 0 });
        }
      }
      clearAdjustCache();
      rerenderSliders();
    });
  });

  // Auto-enhance button
  const autoBtn = byId('aiAutoEnhance');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      _runAutoEnhance(layer, rerenderSliders);
    });
  }

  // Wire initial sliders
  wireAdjSliders(layer);

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

// ─── Auto-enhance ─────────────────────────────────────────────────────────
function _runAutoEnhance(layer, rerenderSliders) {
  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) return;

  const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const sw = Math.max(1, Math.round(crop.w * nw));
  const sh = Math.max(1, Math.round(crop.h * nh));
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sw; srcCanvas.height = sh;
  srcCanvas.getContext('2d').drawImage(img, crop.x * nw, crop.y * nh, crop.w * nw, crop.h * nh, 0, 0, sw, sh);

  const suggestions = computeAutoEnhance(srcCanvas);
  if (!suggestions || suggestions.length === 0) return;

  // Merge suggestions into layer.adjustments (overwrite existing same types)
  for (const s of suggestions) {
    const existing = (layer.adjustments || []).find(a => a.type === s.type);
    if (existing) {
      existing.value = s.value;
    } else {
      layer.adjustments.push(s);
    }
  }
  clearAdjustCache();
  scheduleRender();
  pushHistory('Auto enhance');
  rerenderSliders();
}

// ─── Progress / AI helpers (unchanged from Phase 0) ───────────────────────
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
