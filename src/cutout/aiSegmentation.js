// AI background removal via RMBG-1.4 (BRIA AI) loaded through transformers.js.
//
// The model (~80 MB) is downloaded on first use and cached by the browser's
// HTTP cache via the jsDelivr CDN — no re-download on subsequent page loads.
//
// Runs in the main thread but all heavy work (model load + inference) is
// gated behind the onProgress callback so the caller can show a progress bar.
// The UI should remain responsive because the pipeline itself is async and
// yields to the event loop between steps.
//
// License note: RMBG-1.4 is CC BY-NC 4.0 — free for non-commercial use.

import { SIZE_CAP } from './config.js';

// Lazy-loaded; only initialised on first call to removeBg().
let pipeline = null;
let loadPromise = null;

// CDN import — no bundler needed; transformers.js ships browser-ready ESM.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';
const MODEL_ID = 'briaai/RMBG-1.4';

async function getTransformers() {
  // Dynamic import so the ~400 kB library isn't loaded until the feature is used.
  const mod = await import(/* webpackIgnore: true */ TRANSFORMERS_URL);
  return mod;
}

// Load or return the cached pipeline.
// onProgress(phase, pct) is called during download (phase='download') and
// model initialisation (phase='init') with a 0–1 progress fraction.
export async function loadModel(onProgress) {
  if (pipeline) return pipeline;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onProgress && onProgress('download', 0);

    const { pipeline: createPipeline, env } = await getTransformers();

    // Allow the CDN to serve model weights directly (no local proxy needed).
    env.allowRemoteModels = true;
    env.allowLocalModels  = false;

    pipeline = await createPipeline(
      'image-segmentation',
      MODEL_ID,
      {
        // Use WebGPU when available (Chrome 113+), fall back to WASM silently.
        device: 'auto',
        // Progress callback fires during weight download.
        progress_callback: (info) => {
          if (!onProgress) return;
          if (info.status === 'downloading') {
            const pct = info.total > 0 ? info.loaded / info.total : 0;
            onProgress('download', pct);
          } else if (info.status === 'initiate' || info.status === 'ready') {
            onProgress('init', info.status === 'ready' ? 1 : 0.5);
          }
        },
      }
    );

    onProgress && onProgress('ready', 1);
    return pipeline;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    // Reset so the user can retry.
    loadPromise = null;
    throw err;
  }
}

// Downscale imageEl to fit within SIZE_CAP on the long edge.
// Returns a canvas at the (possibly reduced) size.
function prepareSrcCanvas(imageEl) {
  let w = imageEl.naturalWidth;
  let h = imageEl.naturalHeight;

  if (Math.max(w, h) > SIZE_CAP) {
    const scale = SIZE_CAP / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(imageEl, 0, 0, w, h);
  return canvas;
}

// Run background removal on an HTMLImageElement.
// Returns a canvas whose pixels are the RMBG-1.4 alpha mask
// (white = foreground/keep, black = background/remove).
//
// onProgress(phase, pct) is forwarded to loadModel() if the model isn't
// loaded yet, then called with ('inference', 0) and ('inference', 1).
export async function removeBg(imageEl, onProgress) {
  const pl = await loadModel(onProgress);

  onProgress && onProgress('inference', 0);

  // Downscale to cap before inference.
  const srcCanvas = prepareSrcCanvas(imageEl);

  // The pipeline accepts a canvas / ImageData / URL.
  // It returns [{ label, score, mask }] where mask is an ImageData.
  const results = await pl(srcCanvas);

  onProgress && onProgress('inference', 1);

  if (!results || !results.length || !results[0].mask) {
    throw new Error('RMBG pipeline returned no mask');
  }

  // results[0].mask is a RawImage from transformers.js — it has .width, .height, .data (Uint8Array).
  // The data is single-channel greyscale: 255 = foreground (keep), 0 = background (remove).
  // We need to convert it to a canvas so splitLayerByMask can read it.
  const { mask } = results[0];
  const mW = mask.width;
  const mH = mask.height;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width  = mW;
  maskCanvas.height = mH;
  const mCtx = maskCanvas.getContext('2d');

  // Build an RGBA ImageData where R=G=B=mask_value, A=255.
  // splitLayerByMask reads the red channel, so this is exactly right.
  const rgba = new Uint8ClampedArray(mW * mH * 4);
  for (let i = 0; i < mW * mH; i++) {
    const v = mask.data[i]; // single-channel value 0–255
    rgba[i * 4]     = v; // R
    rgba[i * 4 + 1] = v; // G
    rgba[i * 4 + 2] = v; // B
    rgba[i * 4 + 3] = 255; // A (fully opaque; alpha is stored in R channel)
  }
  mCtx.putImageData(new ImageData(rgba, mW, mH), 0, 0);

  return maskCanvas;
}
