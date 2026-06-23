// Canvas doesn't wait for @font-face; explicitly load fonts before first draw.
let readyPromise = null;

export function fontsReady() {
  if (readyPromise) return readyPromise;
  if (!('fonts' in document)) {
    readyPromise = Promise.resolve();
    return readyPromise;
  }
  readyPromise = Promise.all([
    document.fonts.load('16px FuturaCondXBold'),
    document.fonts.load('16px MemeImpact'),
  ]).catch(() => {});
  return readyPromise;
}
