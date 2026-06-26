import { getLayerById, ensureImage, state } from '../../core/state.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { clearAdjustCache } from '../../render/adjustCache.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions, collapsibleHtml, wireCollapsible } from './shared.js';
import { renderPropsPanel } from './panel.js';
import { setPendingImageTarget, triggerFilePicker } from '../toolbar.js';
import { removeBg } from '../../cutout/aiSegmentation.js';
import { ICONS } from '../icons.js';
import { openCropModal } from '../cropModal.js';
import { setActiveTool } from '../../interactions/pointer.js';
import { setWandTolerance, getWandTolerance, setGradientType, getGradientType } from '../../interactions/selectionTools.js';
import { setBrushSize, setBrushMode } from '../../interactions/brushMask.js';
import { overlay } from '../../interactions/toolOverlay.js';

function _adjVal(layer, type) {
  const a = (layer.adjustments || []).find(x => x.type === type);
  return a ? a.value : 0;
}

function _adjustmentsHtml(layer) {
  const inner = `
    ${rangeRow('Brightness', 'aiBright', -100, 100, 1, _adjVal(layer, 'brightness'))}
    ${rangeRow('Contrast',   'aiContr',  -100, 100, 1, _adjVal(layer, 'contrast'))}
    ${rangeRow('Saturation', 'aiSat',    -100, 100, 1, _adjVal(layer, 'saturation'))}`;
  return `<div class="section">${collapsibleHtml('adjSection', 'Adjustments', inner)}</div>`;
}

function _maskToolsHtml() {
  const t = state.activeTool;
  const wandTol = getWandTolerance();
  const bSize = overlay.brushSize;
  const bMode = overlay.brushMode;
  const gType = getGradientType();
  return `
    <div style="margin-top:8px;">
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Masking tools</div>
      <div class="seg" style="flex-wrap:wrap;gap:4px;" id="iMaskToolBtns">
        <button data-tool="lasso"        class="${t === 'lasso' ? 'active' : ''}">Lasso</button>
        <button data-tool="polygon"      class="${t === 'polygon' ? 'active' : ''}">Polygon</button>
        <button data-tool="wand"         class="${t === 'wand' ? 'active' : ''}">Wand</button>
        <button data-tool="brushMask"    class="${t === 'brushMask' ? 'active' : ''}">Brush</button>
        <button data-tool="gradientMask" class="${t === 'gradientMask' ? 'active' : ''}">Gradient</button>
      </div>
      <div id="iWandControls" style="display:${t === 'wand' ? 'block' : 'none'};margin-top:6px;">
        ${rangeRow('Tolerance', 'iWandTol', 0, 255, 1, wandTol)}
      </div>
      <div id="iBrushControls" style="display:${t === 'brushMask' ? 'block' : 'none'};margin-top:6px;">
        ${rangeRow('Brush size', 'iBrushSize', 2, 200, 1, bSize)}
        <div class="row" style="margin-top:4px;"><label>Mode</label>
          <div class="seg" id="iBrushModeSeg">
            <button data-m="reveal" class="${bMode === 'reveal' ? 'active' : ''}">Reveal</button>
            <button data-m="hide"   class="${bMode === 'hide'   ? 'active' : ''}">Hide</button>
          </div>
        </div>
      </div>
      <div id="iGradientControls" style="display:${t === 'gradientMask' ? 'block' : 'none'};margin-top:6px;">
        <div class="row"><label>Type</label>
          <div class="seg" id="iGradTypeSeg">
            <button data-gt="linear" class="${gType === 'linear' ? 'active' : ''}">Linear</button>
            <button data-gt="radial" class="${gType === 'radial' ? 'active' : ''}">Radial</button>
          </div>
        </div>
      </div>
      <div id="iPolyControls" style="display:${t === 'polygon' ? 'block' : 'none'};margin-top:6px;">
        <div class="row"><button class="smallbtn full" id="iPolyClose">Close polygon</button></div>
        <div class="row"><button class="smallbtn full danger" id="iPolyCancel">Cancel polygon</button></div>
      </div>
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
      ${_maskToolsHtml()}
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
  function wireAdj(id, type) {
    byId(id).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      byId(id + 'val').textContent = v;
      let adj = layer.adjustments.find(a => a.type === type);
      if (adj) { adj.value = v; } else { layer.adjustments.push({ type, value: v }); }
      clearAdjustCache();
      scheduleRender();
    });
    byId(id).addEventListener('change', () => pushHistory());
  }
  wireAdj('aiBright', 'brightness');
  wireAdj('aiContr',  'contrast');
  wireAdj('aiSat',    'saturation');
  wireCollapsible('adjSection');

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

  // ---- Masking tool buttons ----
  const toolBtns = document.querySelectorAll('#iMaskToolBtns button');
  toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      setActiveTool(tool);
      // Re-render the props panel so active state reflects the toggle
      renderPropsPanel();
    });
  });

  // Wand tolerance
  const wandTolEl = byId('iWandTol');
  if (wandTolEl) {
    wandTolEl.addEventListener('input', (e) => {
      setWandTolerance(Number(e.target.value));
      byId('iWandTolval').textContent = e.target.value;
    });
  }

  // Brush controls
  const brushSizeEl = byId('iBrushSize');
  if (brushSizeEl) {
    brushSizeEl.addEventListener('input', (e) => {
      setBrushSize(Number(e.target.value));
      byId('iBrushSizeval').textContent = e.target.value;
      scheduleRender();
    });
  }
  const brushModeBtns = document.querySelectorAll('#iBrushModeSeg button');
  brushModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setBrushMode(btn.dataset.m);
      brushModeBtns.forEach((b) => b.classList.toggle('active', b.dataset.m === btn.dataset.m));
    });
  });

  // Gradient type
  const gradTypeBtns = document.querySelectorAll('#iGradTypeSeg button');
  gradTypeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setGradientType(btn.dataset.gt);
      gradTypeBtns.forEach((b) => b.classList.toggle('active', b.dataset.gt === btn.dataset.gt));
    });
  });

  // Polygon close / cancel
  const polyCloseBtn = byId('iPolyClose');
  if (polyCloseBtn) {
    polyCloseBtn.addEventListener('click', () => {
      import('../../interactions/selectionTools.js').then((m) => m.polygonClose());
    });
  }
  const polyCancelBtn = byId('iPolyCancel');
  if (polyCancelBtn) {
    polyCancelBtn.addEventListener('click', () => {
      import('../../interactions/selectionTools.js').then((m) => m.polygonCancel());
    });
  }

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
