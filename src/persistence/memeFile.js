/**
 * .meme project file format — a JSZip-based zip archive.
 *
 * Structure:
 *   manifest.json   — snapshot with src fields replaced by asset paths
 *   assets/img-<id>.png — binary image data for each image src
 *
 * Import routes through applyLoadedSnapshot() for migration safety.
 */

import { state } from '../core/state.js';
import { snapshot } from '../core/history.js';
import { applyLoadedSnapshot } from './autosave.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender } from '../render/renderer.js';

function getJSZip() {
  if (typeof JSZip !== 'undefined') return JSZip;
  throw new Error('JSZip is not loaded. Add the JSZip CDN script to index.html.');
}

/** Convert a dataURL to a Uint8Array of its binary content. */
function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Convert a Uint8Array + mime type back to a dataURL. */
function bytesToDataUrl(bytes, mime) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,` + btoa(binary);
}

/** Detect MIME from the first few bytes (magic bytes). */
function detectMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return 'image/png'; // fallback
}

/**
 * Export the current project as a .meme zip file, triggering download.
 */
export async function exportMemeFile() {
  const JSZip = getJSZip();
  const zip = new JSZip();
  const assets = zip.folder('assets');

  const snap = snapshot();
  const manifest = JSON.parse(JSON.stringify(snap));

  // Collect all src values and replace with asset paths.
  function replaceSrc(obj, key, assetName) {
    const src = obj[key];
    if (!src || !src.startsWith('data:')) return;
    const bytes = dataUrlToBytes(src);
    assets.file(assetName, bytes);
    obj[key] = 'assets/' + assetName;
  }

  if (manifest.background && manifest.background.src) {
    replaceSrc(manifest.background, 'src', 'img-background.png');
  }

  (manifest.layers || []).forEach((layer) => {
    if (layer.type === 'image') {
      if (layer.src) replaceSrc(layer, 'src', `img-${layer.id}.png`);
      if (layer.mask && layer.mask.src) replaceSrc(layer.mask, 'src', `img-${layer.id}-mask.png`);
    }
  });

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.meme';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Import a .meme file, restoring the project state.
 * @param {File} file
 */
export async function importMemeFile(file) {
  const JSZip = getJSZip();
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const manifestText = await zip.file('manifest.json').async('string');
  const manifest = JSON.parse(manifestText);

  // Restore asset paths back to dataURLs.
  async function restoreSrc(obj, key) {
    const path = obj[key];
    if (!path || !path.startsWith('assets/')) return;
    const zipEntry = zip.file(path);
    if (!zipEntry) return;
    const bytes = await zipEntry.async('uint8array');
    const mime = detectMime(bytes);
    obj[key] = bytesToDataUrl(bytes, mime);
  }

  if (manifest.background && manifest.background.src) {
    await restoreSrc(manifest.background, 'src');
  }

  for (const layer of (manifest.layers || [])) {
    if (layer.type === 'image') {
      if (layer.src) await restoreSrc(layer, 'src');
      if (layer.mask && layer.mask.src) await restoreSrc(layer.mask, 'src');
    }
  }

  applyLoadedSnapshot(manifest);
  scheduleRender();
  pushHistory('Load .meme file');
}
