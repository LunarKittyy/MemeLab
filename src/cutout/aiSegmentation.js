// AI background removal via RMBG-1.4 (BRIA AI / CC BY-NC 4.0) through transformers.js.
import { SIZE_CAP } from './config.js';

let pipeline = null;
let loadPromise = null;

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';
const MODEL_ID = 'briaai/RMBG-1.4';

async function getTransformers() {
  const mod = await import(/* webpackIgnore: true */ TRANSFORMERS_URL);
  return mod;
}

export async function loadModel(onProgress) {
  if (pipeline) return pipeline;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onProgress && onProgress('download', 0);

    const { pipeline: createPipeline, env } = await getTransformers();

    env.allowRemoteModels = true;
    env.allowLocalModels  = false;

    pipeline = await createPipeline(
      'image-segmentation',
      MODEL_ID,
      {
        device: 'auto',
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
    loadPromise = null;
    throw err;
  }
}

function prepareSrcCanvas(imageEl) {
  let w = imageEl.naturalWidth || imageEl.width;
  let h = imageEl.naturalHeight || imageEl.height;

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

export async function removeBg(imageEl, onProgress) {
  const pl = await loadModel(onProgress);
  onProgress && onProgress('inference', 0);
  const srcCanvas = prepareSrcCanvas(imageEl);
  const results = await pl(srcCanvas);

  onProgress && onProgress('inference', 1);

  if (!results || !results.length || !results[0].mask) {
    throw new Error('RMBG pipeline returned no mask');
  }

  const { mask } = results[0];
  const mW = mask.width;
  const mH = mask.height;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width  = mW;
  maskCanvas.height = mH;
  const mCtx = maskCanvas.getContext('2d');

  const rgba = new Uint8ClampedArray(mW * mH * 4);
  for (let i = 0; i < mW * mH; i++) {
    const v = mask.data[i];
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  mCtx.putImageData(new ImageData(rgba, mW, mH), 0, 0);

  return maskCanvas;
}
