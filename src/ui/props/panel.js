import { state, getSelected } from '../../core/state.js';
import { wireCommonTransformProps } from './shared.js';
import { textPropsHtml, wireTextProps } from './textProps.js';
import { imagePropsHtml, wireImageProps } from './imageProps.js';
import { rectPropsHtml, wireRectProps } from './rectProps.js';
import { backgroundPropsHtml, wireBackgroundProps } from './backgroundProps.js';

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
  else body.innerHTML = rectPropsHtml(layer);
  wireCommonTransformProps(layer);
  if (layer.type === 'text') wireTextProps(layer);
  else if (layer.type === 'image') wireImageProps(layer);
  else wireRectProps(layer);
}
