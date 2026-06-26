/**
 * GIF export — encode the layer stack as an animated GIF using gif.js.
 *
 * Each layer is rendered as a separate frame (one frame per layer).
 * Only visible layers are included.
 *
 * Requires gif.js to be loaded via CDN (window.GIF).
 */

import { state } from '../core/state.js';
import { renderScene, renderLayersToCtx } from './renderer.js';

/**
 * Export the current canvas as an animated GIF where each visible layer
 * is a separate frame.
 *
 * @param {number} frameDelayMs  Delay between frames in milliseconds (default 100)
 * @returns {Promise<Blob>}
 */
export async function exportGif(frameDelayMs = 100) {
  if (typeof GIF === 'undefined') {
    throw new Error('gif.js is not loaded. Add the gif.js CDN script to index.html.');
  }

  const W = state.width;
  const H = state.height;

  const visibleLayers = state.layers.filter(l => l.visible);

  if (visibleLayers.length === 0) {
    // No visible layers — export the full scene as a single frame
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    renderScene(ctx, { forExport: true });
    return canvasToGifBlob([off], frameDelayMs);
  }

  // One frame per visible layer
  const frames = [];
  for (const layer of visibleLayers) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    renderLayersToCtx(ctx, [layer]);
    frames.push(off);
  }

  return canvasToGifBlob(frames, frameDelayMs);
}

function canvasToGifBlob(frames, frameDelayMs) {
  return new Promise((resolve, reject) => {
    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: frames[0].width,
      height: frames[0].height,
      workerScript: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
    });

    for (const frame of frames) {
      gif.addFrame(frame, { delay: frameDelayMs });
    }

    gif.on('finished', (blob) => resolve(blob));
    gif.on('error', reject);
    gif.render();
  });
}
