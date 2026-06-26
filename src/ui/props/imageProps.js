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

function _adjVal(layer, type) {
  const a = (layer.adjustments || []).find(x => x.type === type);
  return a ? a.value : 0;
}

function _adjProp(layer, type, prop, def) {
  const a = (layer.adjustments || []).find(x => x.type === type);
  return a ? (a[prop] ?? def) : def;
}

function _adjustmentsHtml(layer) {
  // Split-tone values
  const st = (layer.adjustments || []).find(x => x.type === 'split_tone') || {};
  const stHHue = st.highlightHue ?? 0;
  const stHSat = st.highlightSat ?? 0;
  const stSHue = st.shadowHue    ?? 0;
  const stSSat = st.shadowSat    ?? 0;
  const stBal  = st.balance      ?? 0;

  const toneHtml = `
    ${rangeRow('Brightness', 'aiBright', -100, 100, 1, _adjVal(layer, 'brightness'))}
    ${rangeRow('Contrast',   'aiContr',  -100, 100, 1, _adjVal(layer, 'contrast'))}
    ${rangeRow('Saturation', 'aiSat',    -100, 100, 1, _adjVal(layer, 'saturation'))}`;

  const effectsHtml = `
    ${rangeRow('Clarity',    'aiClarity',  0, 100, 1,    _adjVal(layer, 'clarity'))}
    ${rangeRow('Dehaze',     'aiDehaze',  -100, 100, 1,  _adjVal(layer, 'dehaze'))}
    ${rangeRow('Sharpen',    'aiSharpen',  0, 100, 1,    _adjVal(layer, 'sharpen'))}
    ${rangeRow('Noise Reduc.','aiNR',     0, 100, 1,    _adjVal(layer, 'noise_reduction'))}
    ${rangeRow('Color Noise','aiNRColor',  0, 100, 1,    _adjProp(layer, 'noise_reduction', 'colorNoise', 0))}
    ${rangeRow('Vignette',   'aiVignette',-100, 100, 1,  _adjVal(layer, 'vignette'))}
    <div class="row" style="margin-top:4px;"><label style="font-size:11px;color:var(--text-dim);">Split-tone</label></div>
    ${rangeRow('Highlight Hue', 'aiStHHue',   0, 360, 1, stHHue)}
    ${rangeRow('Highlight Sat', 'aiStHSat',   0, 100, 1, stHSat)}
    ${rangeRow('Shadow Hue',    'aiStSHue',   0, 360, 1, stSHue)}
    ${rangeRow('Shadow Sat',    'aiStSSat',   0, 100, 1, stSSat)}
    ${rangeRow('ST Balance',    'aiStBal', -100, 100, 1, stBal)}
    <div class="row" style="margin-top:4px;"><label style="font-size:11px;color:var(--text-dim);">Grain</label></div>
    ${rangeRow('Amount', 'aiGrain',    0, 100, 1, _adjVal(layer, 'grain'))}
    ${rangeRow('Size',   'aiGrainSize',1, 5, 0.5, _adjProp(layer, 'grain', 'size', 1))}`;

  const inner = `
    ${collapsibleHtml('adjTone',    'Tone',    toneHtml,    { defaultOpen: true })}
    ${collapsibleHtml('adjEffects', 'Effects', effectsHtml)}`;

  return `<div class="section">${collapsibleHtml('adjSection', 'Adjustments', inner)}</div>`;
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

  // ---- Adjustments ----
  if (!layer.adjustments) layer.adjustments = [];

  function getOrCreate(type, defaults) {
    let adj = layer.adjustments.find(a => a.type === type);
    if (!adj) { adj = Object.assign({ type }, defaults); layer.adjustments.push(adj); }
    return adj;
  }

  function wireAdj(id, type) {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      byId(id + 'val').textContent = v;
      let adj = layer.adjustments.find(a => a.type === type);
      if (adj) { adj.value = v; } else { layer.adjustments.push({ type, value: v }); }
      clearAdjustCache();
      scheduleRender();
    });
    el.addEventListener('change', () => pushHistory());
  }

  function wireAdjProp(id, type, prop, defaults) {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      byId(id + 'val').textContent = v;
      const adj = getOrCreate(type, defaults);
      adj[prop] = v;
      clearAdjustCache();
      scheduleRender();
    });
    el.addEventListener('change', () => pushHistory());
  }

  // Tone
  wireAdj('aiBright', 'brightness');
  wireAdj('aiContr',  'contrast');
  wireAdj('aiSat',    'saturation');

  // Effects — simple value sliders
  wireAdj('aiClarity',  'clarity');
  wireAdj('aiDehaze',   'dehaze');
  wireAdj('aiSharpen',  'sharpen');
  wireAdj('aiVignette', 'vignette');

  // Noise reduction (two params on one adjustment entry)
  wireAdjProp('aiNR',      'noise_reduction', 'value',      { value: 0, colorNoise: 0 });
  wireAdjProp('aiNRColor', 'noise_reduction', 'colorNoise', { value: 0, colorNoise: 0 });

  // Grain (two params)
  wireAdjProp('aiGrain',     'grain', 'value', { value: 0, size: 1 });
  wireAdjProp('aiGrainSize', 'grain', 'size',  { value: 0, size: 1 });

  // Split-tone (multiple params on one entry)
  function wireSplitTone(id, prop) {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      byId(id + 'val').textContent = v;
      const adj = getOrCreate('split_tone', {
        highlightHue: 0, highlightSat: 0, shadowHue: 0, shadowSat: 0, balance: 0,
      });
      adj[prop] = v;
      clearAdjustCache();
      scheduleRender();
    });
    el.addEventListener('change', () => pushHistory());
  }
  wireSplitTone('aiStHHue', 'highlightHue');
  wireSplitTone('aiStHSat', 'highlightSat');
  wireSplitTone('aiStSHue', 'shadowHue');
  wireSplitTone('aiStSSat', 'shadowSat');
  wireSplitTone('aiStBal',  'balance');

  wireCollapsible('adjSection');
  wireCollapsible('adjTone');
  wireCollapsible('adjEffects');

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
