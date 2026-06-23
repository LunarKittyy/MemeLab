// Shared constants for all cutout tools.
// Both the AI segmentation and the wand tool must import SIZE_CAP from here
// so they behave consistently when downscaling large images before processing.

// Maximum long-edge size (px) before we downscale the source image.
// Keeps inference memory manageable on mobile/WASM; 2048 is the agreed cap.
export const SIZE_CAP = 2048;
