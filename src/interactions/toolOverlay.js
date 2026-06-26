/**
 * toolOverlay.js — Shared overlay state for selection tools.
 *
 * This tiny module exists to break the circular import between
 * selectionTools.js (which needs renderer.js for scheduleRender) and
 * renderer.js (which needs to read in-progress tool state for the overlay).
 *
 * Both modules import from here; neither imports from the other.
 */

export const overlay = {
  // lasso
  lassoPoints: [],

  // polygon
  polygonVertices: [],
  polygonOpen: false,

  // cursor (used by multiple tools)
  cursorPos: null,

  // gradient
  gradientStart: null,
  gradientEnd: null,

  // brush
  brushCursorPos: null,
  brushSize: 30,
  brushMode: 'reveal', // 'reveal' | 'hide'
};
