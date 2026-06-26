import { pushHistory } from '../../core/history.js';
import { scheduleRender } from '../../render/renderer.js';
import { clearAdjustCache } from '../../render/adjustCache.js';
import { invalidateDrawCache, rasterizeStrokes } from '../../render/drawLayer.js';
import { drawState, state, nextId } from '../../core/state.js';
import { byId, rangeRow, transformHtml, actionsHtml, wireActions } from './shared.js';
import { updateCursor, updateMiniToolbar, ensureMiniToolbar } from '../../interactions/drawTools.js';
import { renderLayerList } from '../layerList.js';

// Use lazy import to avoid circular dep: panel.js → drawProps.js → panel.js
function renderPropsPanel() {
  import('./panel.js').then(m => m.renderPropsPanel());
}

const TOOLS = [
  { id: 'brush',     label: 'Brush' },
  { id: 'eraser',    label: 'Eraser' },
  { id: 'line',      label: 'Line' },
  { id: 'ellipse',   label: 'Ellipse' },
  { id: 'polygon',   label: 'Polygon' },
  { id: 'gradient',  label: 'Gradient' },
  { id: 'bucket',    label: 'Bucket' },
  { id: 'eyedropper', label: 'Eyedrop' },
];

export function drawPropsHtml(layer) {
  const strokes = layer.strokes || [];
  const toolBtns = TOOLS.map(t =>
    `<button class="smallbtn" data-tool="${t.id}" style="flex:1;min-width:70px">${t.label}</button>`
  ).join('');

  const gradientSection = `
    <div class="row" id="dGradientSection" style="display:${drawState.activeTool === 'gradient' ? 'flex' : 'none'}">
      <label>Type</label>
      <div class="seg" id="dGradTypeSeg">
        <button data-v="linear" class="${drawState.gradientType === 'linear' ? 'active' : ''}">Linear</button>
        <button data-v="radial" class="${drawState.gradientType === 'radial' ? 'active' : ''}">Radial</button>
      </div>
    </div>
    <div class="row" id="dGradColor2Row" style="display:${drawState.activeTool === 'gradient' ? 'flex' : 'none'}">
      <label>Color 2</label>
      <input type="color" id="dBrushColor2" value="${drawState.gradientColor2 || '#0000ff'}">
    </div>`;

  return `
    <div class="section">
      <div class="section-title">Draw Tools</div>
      <div class="draw-tool-seg" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
        ${toolBtns}
      </div>
      <div class="row">
        <label>Color</label>
        <input type="color" id="dBrushColor" value="${drawState.brushColor}">
      </div>
      ${gradientSection}
      ${rangeRow('Size', 'dSize', 1, 200, 1, drawState.brushSize)}
      ${rangeRow('Opacity', 'dOpac', 0, 1, 0.01, drawState.brushOpacity)}
      ${rangeRow('Hardness', 'dHard', 0, 1, 0.01, drawState.brushHardness)}
      <div class="row">
        <span style="color:var(--text-dim,#9b92b0);font-size:11.5px;" id="drawStrokeCount">
          ${strokes.length} stroke${strokes.length === 1 ? '' : 's'}
        </span>
      </div>
      <div class="row">
        <button class="smallbtn full danger" id="dClearStrokes">Clear all strokes</button>
      </div>
      <div class="row">
        <button class="smallbtn full" id="dFlatten">Flatten to image</button>
      </div>
    </div>
    ${transformHtml(layer)}
    ${actionsHtml()}`;
}

export function wireDrawProps(layer) {
  // Ensure mini toolbar exists
  ensureMiniToolbar();

  // Tool selector buttons
  const toolBtns = document.querySelectorAll('.draw-tool-seg button[data-tool]');
  toolBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === drawState.activeTool);
    btn.addEventListener('click', () => {
      drawState.activeTool = btn.dataset.tool;
      toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === drawState.activeTool));
      updateCursor();
      updateMiniToolbar();
      // Show/hide gradient-specific controls
      const gradSection = byId('dGradientSection');
      const gradColor2 = byId('dGradColor2Row');
      if (gradSection) gradSection.style.display = drawState.activeTool === 'gradient' ? 'flex' : 'none';
      if (gradColor2) gradColor2.style.display = drawState.activeTool === 'gradient' ? 'flex' : 'none';
    });
  });

  // Color picker
  byId('dBrushColor').addEventListener('input', (e) => {
    drawState.brushColor = e.target.value;
    updateMiniToolbar();
  });

  // Gradient color 2
  const brushColor2El = byId('dBrushColor2');
  if (brushColor2El) {
    brushColor2El.addEventListener('input', (e) => {
      drawState.gradientColor2 = e.target.value;
    });
  }

  // Gradient type
  const gradTypeSeg = byId('dGradTypeSeg');
  if (gradTypeSeg) {
    gradTypeSeg.querySelectorAll('button[data-v]').forEach(btn => {
      btn.addEventListener('click', () => {
        drawState.gradientType = btn.dataset.v;
        gradTypeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === drawState.gradientType));
      });
    });
  }

  // Size slider
  byId('dSize').addEventListener('input', (e) => {
    drawState.brushSize = +e.target.value;
    byId('dSizeval').textContent = e.target.value;
    updateMiniToolbar();
  });

  // Opacity slider
  byId('dOpac').addEventListener('input', (e) => {
    drawState.brushOpacity = +e.target.value;
    byId('dOpacval').textContent = e.target.value;
    updateMiniToolbar();
  });

  // Hardness slider
  byId('dHard').addEventListener('input', (e) => {
    drawState.brushHardness = +e.target.value;
    byId('dHardval').textContent = e.target.value;
  });

  // Clear all strokes
  byId('dClearStrokes').addEventListener('click', () => {
    layer.strokes = [];
    invalidateDrawCache(layer.id);
    clearAdjustCache();
    scheduleRender();
    pushHistory('Clear drawing');
    // Re-render panel to update count
    renderPropsPanel();
  });

  // Flatten to image
  byId('dFlatten').addEventListener('click', () => flattenDrawLayer(layer));

  wireActions(layer);
  updateCursor();
  updateMiniToolbar();
}

function flattenDrawLayer(layer) {
  // Rasterize all strokes to PNG dataURL, replace draw layer with image layer
  const w = layer.w, h = layer.h;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const ctx = off.getContext('2d');
  const strokes = layer.strokes || [];
  if (strokes.length > 0) {
    // Import and use rasterizeStrokes at runtime
    const bmp = rasterizeStrokes(layer);
    if (bmp) ctx.drawImage(bmp, 0, 0);
  }
  const src = off.toDataURL('image/png');
  const idx = state.layers.findIndex(l => l.id === layer.id);
  if (idx === -1) return;
  const imageLayer = {
    id: nextId(),
    type: 'image',
    name: layer.name + ' (flat)',
    x: layer.x, y: layer.y, w, h,
    rotation: layer.rotation,
    opacity: layer.opacity,
    visible: layer.visible,
    locked: layer.locked,
    aspectLocked: false,
    src, naturalW: w, naturalH: h,
    flipX: false, flipY: false,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    mask: { enabled: false, src: null, invert: false, feather: 0 },
    adjustments: [], blendMode: layer.blendMode || 'normal',
  };
  state.layers.splice(idx, 1, imageLayer);
  state.selectedId = imageLayer.id;
  invalidateDrawCache(layer.id);
  pushHistory('Flatten draw layer');
  renderLayerList();
  renderPropsPanel();
  scheduleRender();
}
