import { state, nextId, ensureImage } from '../core/state.js';

// splitLayerByMask(layer, maskCanvas) -> { keptLayer, restLayer }
//
// Takes an image layer and a same-resolution mask canvas whose pixels encode
// "how much to keep" (bright = keep, dark = cut).  Returns two new image layer
// objects that together are pixel-identical to the original layer.
//
// Both output layers inherit every transform field from the original so the
// visual result is identical immediately after a split.  The caller must:
//   1. Replace the original layer in state.layers with both outputs.
//   2. Call pushHistory() once.
//   3. Call renderLayerList() + scheduleRender().
export function splitLayerByMask(layer, maskCanvas) {
  // Work at the layer's natural resolution so no pixel data is lost.
  const nw = layer.naturalW;
  const nh = layer.naturalH;

  const img = ensureImage(layer.src);
  if (!img || !img.naturalWidth) throw new Error('splitLayerByMask: image not loaded');

  // Source pixels at natural resolution.
  const src = document.createElement('canvas');
  src.width = nw; src.height = nh;
  const srcCtx = src.getContext('2d');
  if (layer.flipX || layer.flipY) {
    srcCtx.translate(layer.flipX ? nw : 0, layer.flipY ? nh : 0);
    srcCtx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  }
  srcCtx.drawImage(img, 0, 0, nw, nh);
  const srcData = srcCtx.getImageData(0, 0, nw, nh);

  // Mask pixels resampled to natural resolution.
  const maskScaled = document.createElement('canvas');
  maskScaled.width = nw; maskScaled.height = nh;
  maskScaled.getContext('2d').drawImage(maskCanvas, 0, 0, nw, nh);
  const maskData = maskScaled.getContext('2d').getImageData(0, 0, nw, nh);

  const keptData   = new Uint8ClampedArray(srcData.data);
  const restData   = new Uint8ClampedArray(srcData.data);

  for (let i = 0; i < srcData.data.length; i += 4) {
    // Use the red channel of the mask as the keep-alpha (masks are typically greyscale).
    const keepAlpha = maskData.data[i] / 255;
    const origAlpha = srcData.data[i + 3] / 255;
    keptData[i + 3] = Math.round(origAlpha * keepAlpha * 255);
    restData[i + 3] = Math.round(origAlpha * (1 - keepAlpha) * 255);
  }

  function toDataUrl(pixelData) {
    const off = document.createElement('canvas');
    off.width = nw; off.height = nh;
    off.getContext('2d').putImageData(new ImageData(pixelData, nw, nh), 0, 0);
    return off.toDataURL('image/png');
  }

  const keptSrc = toDataUrl(keptData);
  const restSrc = toDataUrl(restData);

  function cloneLayer(src, nameSuffix) {
    return {
      ...JSON.parse(JSON.stringify(layer)),
      id: nextId(),
      name: layer.name + nameSuffix,
      src,
      naturalW: nw,
      naturalH: nh,
    };
  }

  // Pre-warm the image cache so the layers render immediately.
  ensureImage(keptSrc);
  ensureImage(restSrc);

  return {
    keptLayer: cloneLayer(keptSrc, ' (subject)'),
    restLayer: cloneLayer(restSrc, ' (background)'),
  };
}
