let inpaintImpl = null;

export function getInpaintImpl() {
  if (!inpaintImpl) {
    return async (srcCanvas, maskCanvas, onProgress) => {
      throw new Error('Generative Fill: no AI backend configured');
    };
  }
  return inpaintImpl;
}

export function _setInpaintImpl(fn) {
  inpaintImpl = fn;
}
