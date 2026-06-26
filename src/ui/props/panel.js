import { state, getSelected } from '../../core/state.js';
import { wireCommonTransformProps } from './shared.js';
import { textPropsHtml, wireTextProps } from './textProps.js';
import { imagePropsHtml, wireImageProps } from './imageProps.js';
import { rectPropsHtml, wireRectProps } from './rectProps.js';
import { backgroundPropsHtml, wireBackgroundProps } from './backgroundProps.js';
import { drawPropsHtml, wireDrawProps } from './drawProps.js';

export function renderPropsPanel() {
  const body = document.getElementById('propsBody');
  if (state.selectedId === 'background') {
    body.innerHTML = backgroundPropsHtml();
    wireBackgroundProps();
    return;
  }
  const layer = getSelected();
  if (!layer) {
    body.innerHTML = '<div class="empty-props">Select a layer to edit its style.</div>';
    return;
  }
  if (layer.type === 'text') body.innerHTML = textPropsHtml(layer);
  else if (layer.type === 'image') body.innerHTML = imagePropsHtml(layer);
  else if (layer.type === 'draw') body.innerHTML = drawPropsHtml(layer);
  else body.innerHTML = rectPropsHtml(layer);
  if (layer.type === 'draw') {
    // Draw layers are full-canvas; no per-layer transform panel needed.
    wireDrawProps(layer);
  } else {
    wireCommonTransformProps(layer);
    if (layer.type === 'text') wireTextProps(layer);
    else if (layer.type === 'image') wireImageProps(layer);
    else wireRectProps(layer);
  }
}
