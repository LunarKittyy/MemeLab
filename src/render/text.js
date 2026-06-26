
export function resolvedFontSize(layer) {
  if (layer.sizeScale !== undefined) return Math.max(1, Math.round(layer.sizeScale * layer.h));
  return layer.size || 40;
}

export function buildFontString(layer) {
  const style = layer.italic ? 'italic ' : '';
  const weight = layer.bold ? 'bold ' : '';
  return `${style}${weight}${resolvedFontSize(layer)}px ${layer.font}`;
}

function wrapParagraph(ctx, text, maxWidth) {
  if (text === '') return [''];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current);
  return lines;
}

export function getWrappedLines(ctx, layer) {
  const maxWidth = Math.max(10, layer.w - layer.padding * 2);
  const paragraphs = layer.text.split('\n');
  let lines = [];
  for (const p of paragraphs) lines = lines.concat(wrapParagraph(ctx, p, maxWidth));
  return lines;
}

export function drawRoundedRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (r <= 0.01) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw a single text string along a circular arc.
// arcDeg: total bend in degrees (positive = curve up / concave top, negative = curve down)
// The text is placed so the arc spans the layer width, centered vertically in the layer.
function drawTextOnArc(ctx, text, layer, arcDeg, baseY) {
  const fs = resolvedFontSize(layer);
  // Radius is derived so the chord length == layer width at the given arc.
  // arc length ≈ chord for small angles, but we want the chord = layer.w.
  const arcRad = (arcDeg * Math.PI) / 180;
  // chord = 2r sin(θ/2)  →  r = chord / (2 sin(θ/2))
  const halfAngle = Math.abs(arcRad) / 2;
  const minHalfAngle = 0.001; // prevent div/0 when very small
  const r = halfAngle < minHalfAngle
    ? layer.w * 1000  // effectively straight
    : (layer.w / 2) / Math.sin(Math.max(halfAngle, minHalfAngle));

  // Measure total text width to determine angular span
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const totalWidth = ctx.measureText(text).width;
  const totalAngle = totalWidth / r; // angle subtended by all text

  // Centre of the arc circle
  // For positive arcDeg (curve up) the centre is below the text baseline.
  // For negative arcDeg (curve down) the centre is above.
  const sign = arcDeg >= 0 ? -1 : 1; // -1 = centre below (text curves up)

  // Starting horizontal offset based on align
  let startX;
  if (layer.align === 'left') startX = layer.padding;
  else if (layer.align === 'right') startX = layer.w - layer.padding - totalWidth;
  else startX = (layer.w - totalWidth) / 2;

  // Arc centre in layer-local coords
  const cx = startX + totalWidth / 2;
  const cy = baseY + sign * r;

  // Starting angle: text starts at the left of its arc span
  const startAngle = -Math.PI / 2 - (sign * totalAngle / 2);

  // Iterate over characters
  let advance = 0;
  for (const ch of text) {
    const cw = ctx.measureText(ch).width;
    const charAngle = startAngle + sign * (advance + cw / 2) / r;
    ctx.save();
    ctx.translate(cx + r * Math.cos(charAngle), cy + r * Math.sin(charAngle));
    // Rotate the char to follow the arc tangent
    ctx.rotate(charAngle + Math.PI / 2);
    if (layer.stroke && layer.stroke.enabled && layer.stroke.width > 0) {
      ctx.strokeStyle = layer.stroke.color;
      ctx.lineWidth = layer.stroke.width;
      ctx.strokeText(ch, 0, 0);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    advance += cw;
  }
}

export function drawTextLayer(ctx, layer) {
  ctx.font = buildFontString(layer);
  if (layer.box && layer.box.enabled) {
    drawRoundedRect(ctx, 0, 0, layer.w, layer.h, 0);
    ctx.fillStyle = layer.box.color;
    ctx.fill();
  }

  const arc = layer.arc || 0;

  if (arc !== 0) {
    // Arc path: render each line on its own arc, stacked vertically.
    const lines = getWrappedLines(ctx, layer);
    const fs = resolvedFontSize(layer);
    const lineHeight = fs * layer.lineHeight;
    const totalH = lineHeight * lines.length;
    let startY;
    if (layer.vAlign === 'top') startY = layer.padding + fs * 0.82;
    else if (layer.vAlign === 'bottom') startY = layer.h - layer.padding - totalH + fs * 0.82;
    else startY = (layer.h - totalH) / 2 + fs * 0.82;

    if ('letterSpacing' in ctx) {
      try { ctx.letterSpacing = (layer.letterSpacing || 0) + 'px'; } catch (e) {}
    }
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.textBaseline = 'alphabetic';

    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      drawTextOnArc(ctx, line, layer, arc, y);
    });
    return;
  }

  // Flat (original) rendering path — unchanged
  const lines = getWrappedLines(ctx, layer);
  const fs = resolvedFontSize(layer);
  const lineHeight = fs * layer.lineHeight;
  const totalH = lineHeight * lines.length;
  let startY;
  if (layer.vAlign === 'top') startY = layer.padding + fs * 0.82;
  else if (layer.vAlign === 'bottom') startY = layer.h - layer.padding - totalH + fs * 0.82;
  else startY = (layer.h - totalH) / 2 + fs * 0.82;

  let xPos;
  ctx.textAlign = layer.align;
  if (layer.align === 'left') xPos = layer.padding;
  else if (layer.align === 'right') xPos = layer.w - layer.padding;
  else xPos = layer.w / 2;

  if ('letterSpacing' in ctx) {
    try { ctx.letterSpacing = (layer.letterSpacing || 0) + 'px'; } catch (e) {}
  }
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    if (layer.stroke && layer.stroke.enabled && layer.stroke.width > 0) {
      ctx.strokeStyle = layer.stroke.color;
      ctx.lineWidth = layer.stroke.width;
      ctx.strokeText(line, xPos, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, xPos, y);
  });
}
