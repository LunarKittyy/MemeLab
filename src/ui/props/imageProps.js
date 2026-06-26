import { getLayerById, ensureImage } from '../../core/state.js';
import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { clearAdjustCache } from '../../render/adjustCache.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions, collapsibleHtml, wireCollapsible } from './shared.js';
import { renderPropsPanel } from './panel.js';
import { setPendingImageTarget, triggerFilePicker } from '../toolbar.js';
import { removeBg } from '../../cutout/aiSegmentation.js';
import { getInpaintImpl } from '../../cutout/inpaint.js';
import { upscaleImage } from '../../cutout/upscale.js';
import { ICONS } from '../icons.js';
import { openCropModal } from '../cropModal.js';

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
      <div class="row">
        <button class="smallbtn full" id="iGenFill" style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <span class="icon" style="width:13px;height:13px;display:flex;align-items:center;">${ICONS.sparkles}</span>
          Generative fill
        </button>
      </div>
      <div class="row" style="align-items:center;gap:6px;">
        <button class="smallbtn" id="iUpscale2x" style="flex:1;">Upscale 2×</button>
        <button class="smallbtn" id="iUpscale4x" style="flex:1;">Upscale 4×</button>
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

  // ---- AI background removal ----
  byId('iBgRemove').addEventListener('click', () => runBgRemoval(layer));

  // ---- AI generative fill / object removal ----
  byId('iGenFill').addEventListener('click', () => runGenerativeFill(layer));

  // ---- AI upscale ----
  byId('iUpscale2x').addEventListener('click', () => runUpscale(layer, 2));
  byId('iUpscale4x').addEventListener('click', () => runUpscale(layer, 4));

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

/**
 * Helper: disable all AI buttons, return a function that re-enables them.
 */
function lockAiButtons() {
  const ids = ['iBgRemove', 'iGenFill', 'iUpscale2x', 'iUpscale4x'];
  ids.forEach(id => { const b = byId(id); if (b) b.disabled = true; });
  return function unlockAiButtons() {
    ids.forEach(id => { const b = byId(id); if (b) b.disabled = false; });
  };
}

async function runBgRemoval(layer) {
  const btn = byId('iBgRemove');
  if (!btn || btn.disabled) return;

  const unlock = lockAiButtons();
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
    unlock();
  }
}

/**
 * Generative fill / object removal.
 *
 * Uses the layer's current mask (layer.mask.src, white = fill, black = preserve).
 * After inpainting:
 *   - The result is baked into layer.src (destructive, undoable via history).
 *   - layer.mask is cleared.
 */
async function runGenerativeFill(layer) {
  const btn = byId('iGenFill');
  if (!btn || btn.disabled) return;

  const unlock = lockAiButtons();
  byId('aiError') && (byId('aiError').style.display = 'none');

  // The mask must be enabled and have a src for us to know what region to fill.
  if (!layer.mask?.enabled || !layer.mask?.src) {
    showAiError('Enable and paint a mask first — the white region will be filled.');
    unlock();
    return;
  }

  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) {
    showAiError('Image not loaded yet — try again in a moment.');
    unlock();
    return;
  }

  // Bake the image into a canvas.
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width  = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  srcCanvas.getContext('2d').drawImage(img, 0, 0);

  // Load the mask (layer.mask.src is a dataURL with R=G=B=255, A=gray).
  // Convert back to luminance mask (R=G=B=gray, A=255) for the inpaint API.
  const maskImg = ensureImage(layer.mask.src);
  if (!maskImg || !maskImg.complete) {
    showAiError('Mask not ready yet — try again.');
    unlock();
    return;
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width  = srcCanvas.width;
  maskCanvas.height = srcCanvas.height;
  const mCtx = maskCanvas.getContext('2d');
  mCtx.drawImage(maskImg, 0, 0, maskCanvas.width, maskCanvas.height);
  // Invert the alpha encoding back to luminance: white = fill, black = preserve.
  const md = mCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  for (let i = 0; i < md.data.length; i += 4) {
    const lum = md.data[i + 3]; // alpha was gray
    md.data[i] = md.data[i + 1] = md.data[i + 2] = lum;
    md.data[i + 3] = 255;
  }
  mCtx.putImageData(md, 0, 0);

  // Apply mask invert if set.
  if (layer.mask.invert) {
    const id2 = mCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    for (let i = 0; i < id2.data.length; i += 4) {
      id2.data[i] = id2.data[i + 1] = id2.data[i + 2] = 255 - id2.data[i];
    }
    mCtx.putImageData(id2, 0, 0);
  }

  setProgress('Starting generative fill…', 0.05);
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    const inpaintImpl = getInpaintImpl();
    const resultCanvas = await inpaintImpl(srcCanvas, maskCanvas, (phase, pct) => {
      if (phase === 'download') {
        setProgress(`Downloading model… ${Math.round(pct * 100)}%`, pct * 0.7);
      } else if (phase === 'init') {
        setProgress('Initialising model…', 0.7 + pct * 0.15);
      } else if (phase === 'inference') {
        setProgress(pct < 1 ? 'Running AI…' : 'Processing result…', 0.85 + pct * 0.15);
      } else if (phase === 'ready') {
        setProgress('Ready', 1);
      }
    });

    const currentLayer = getLayerById(layer.id);
    if (!currentLayer) { hideProgress(); unlock(); return; }

    setProgress('Applying result…', 1);

    // Bake result into layer.src.
    currentLayer.src = resultCanvas.toDataURL('image/png');
    currentLayer.naturalW = resultCanvas.width;
    currentLayer.naturalH = resultCanvas.height;
    ensureImage(currentLayer.src);

    // Clear mask — the fill is now baked in.
    currentLayer.mask = { enabled: false, src: null, invert: false, feather: 0 };

    renderPropsPanel();
    scheduleRender();
    pushHistory('Generative fill');
    hideProgress();
  } catch (err) {
    console.error('Generative fill failed:', err);
    showAiError('Failed: ' + (err.message || 'Unknown error'));
    hideProgress();
  } finally {
    unlock();
  }
}

/**
 * AI upscale for a single image layer.
 *
 * The upscaled image replaces layer.src / naturalW / naturalH.
 * The display size (layer.w, layer.h) is NOT changed — more pixels, same size.
 *
 * @param {object} layer  - The image layer.
 * @param {2|4}    factor - Upscale factor.
 */
async function runUpscale(layer, factor) {
  const btnId = factor === 2 ? 'iUpscale2x' : 'iUpscale4x';
  const btn = byId(btnId);
  if (!btn || btn.disabled) return;

  const unlock = lockAiButtons();
  byId('aiError') && (byId('aiError').style.display = 'none');

  const img = ensureImage(layer.src);
  if (!img || !img.complete || !img.naturalWidth) {
    showAiError('Image not loaded yet — try again in a moment.');
    unlock();
    return;
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width  = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  srcCanvas.getContext('2d').drawImage(img, 0, 0);

  setProgress(`Starting ${factor}× upscale…`, 0.05);
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    const resultCanvas = await upscaleImage(srcCanvas, factor, (phase, pct) => {
      if (phase === 'download') {
        setProgress(`Downloading model… ${Math.round(pct * 100)}%`, pct * 0.7);
      } else if (phase === 'init') {
        setProgress('Initialising model…', 0.7 + pct * 0.15);
      } else if (phase === 'inference') {
        setProgress(pct < 1 ? `Upscaling (${factor}×)…` : 'Finalising…', 0.85 + pct * 0.15);
      } else if (phase === 'ready') {
        setProgress('Ready', 1);
      }
    });

    const currentLayer = getLayerById(layer.id);
    if (!currentLayer) { hideProgress(); unlock(); return; }

    setProgress('Applying result…', 1);

    // Update layer.src and natural dimensions; display size stays the same.
    currentLayer.src      = resultCanvas.toDataURL('image/png');
    currentLayer.naturalW = resultCanvas.width;
    currentLayer.naturalH = resultCanvas.height;
    ensureImage(currentLayer.src);

    renderPropsPanel();
    scheduleRender();
    pushHistory(`Upscale ${factor}×`);
    hideProgress();
  } catch (err) {
    console.error('AI upscale failed:', err);
    showAiError('Failed: ' + (err.message || 'Unknown error'));
    hideProgress();
  } finally {
    unlock();
  }
}
