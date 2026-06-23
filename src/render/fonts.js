// The fonts themselves are declared via @font-face in css/styles.css and
// loaded from assets/fonts/*.woff2. Canvas text measurement/drawing doesn't
// automatically wait for @font-face the way DOM text does, so we explicitly
// ask the Font Loading API to load (or confirm) them before the first draw,
// otherwise early renders can measure/wrap against a fallback font.

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
