
export function buildFontString(layer) {
  const style = layer.italic ? 'italic ' : '';
  const weight = layer.bold ? 'bold ' : '';
  return `${style}${weight}${layer.size}px ${layer.font}`;
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

export function drawTextLayer(ctx, layer) {
  ctx.font = buildFontString(layer);
  if (layer.box && layer.box.enabled) {
    drawRoundedRect(ctx, 0, 0, layer.w, layer.h, 0);
    ctx.fillStyle = layer.box.color;
    ctx.fill();
  }
  const lines = getWrappedLines(ctx, layer);
  const lineHeight = layer.size * layer.lineHeight;
  const totalH = lineHeight * lines.length;
  let startY;
  if (layer.vAlign === 'top') startY = layer.padding + layer.size * 0.82;
  else if (layer.vAlign === 'bottom') startY = layer.h - layer.padding - totalH + layer.size * 0.82;
  else startY = (layer.h - totalH) / 2 + layer.size * 0.82;

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
