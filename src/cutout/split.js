import { state, nextId, ensureImage } from '../core/state.js';

export function splitLayerByMask(layer, maskCanvas) {
  const nw = layer.naturalW;
  const nh = layer.naturalH;

  const img = ensureImage(layer.src);
  if (!img || !img.naturalWidth) throw new Error('splitLayerByMask: image not loaded');

  const src = document.createElement('canvas');
  src.width = nw; src.height = nh;
  const srcCtx = src.getContext('2d');
  if (layer.flipX || layer.flipY) {
    srcCtx.translate(layer.flipX ? nw : 0, layer.flipY ? nh : 0);
    srcCtx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  }
  srcCtx.drawImage(img, 0, 0, nw, nh);
  const srcData = srcCtx.getImageData(0, 0, nw, nh);

  const maskScaled = document.createElement('canvas');
  maskScaled.width = nw; maskScaled.height = nh;
  maskScaled.getContext('2d').drawImage(maskCanvas, 0, 0, nw, nh);
  const maskData = maskScaled.getContext('2d').getImageData(0, 0, nw, nh);

  const keptData   = new Uint8ClampedArray(srcData.data);
  const restData   = new Uint8ClampedArray(srcData.data);

  for (let i = 0; i < srcData.data.length; i += 4) {
    const keepAlpha = maskData.data[i] / 255; // mask is greyscale; red channel = keep weight
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

  ensureImage(keptSrc);
  ensureImage(restSrc);

  return {
    keptLayer: cloneLayer(keptSrc, ' (subject)'),
    restLayer: cloneLayer(restSrc, ' (background)'),
  };
}
