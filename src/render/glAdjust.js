// WebGL1 single-pass adjustment pipeline: brightness, contrast, saturation.
// Singleton GL context — one offscreen canvas shared across all calls.
// Returns a 2D canvas with the result, or null if no adjustments have effect.

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  c.rgb += u_brightness;
  c.rgb = (c.rgb - 0.5) * (1.0 + u_contrast) + 0.5;
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(lum), c.rgb, 1.0 + u_saturation);
  gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`;

let _gl = null;
let _glCanvas = null;
let _prog = null;
let _uBright, _uContrast, _uSat;

function initGL() {
  if (_gl) return true;
  _glCanvas = document.createElement('canvas');
  _gl = _glCanvas.getContext('webgl') || _glCanvas.getContext('experimental-webgl');
  if (!_gl) return false;

  const gl = _gl;
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }
  _prog = gl.createProgram();
  gl.attachShader(_prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(_prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(_prog);
  gl.useProgram(_prog);

  // Full-screen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(_prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  _uBright  = gl.getUniformLocation(_prog, 'u_brightness');
  _uContrast = gl.getUniformLocation(_prog, 'u_contrast');
  _uSat     = gl.getUniformLocation(_prog, 'u_saturation');
  gl.uniform1i(gl.getUniformLocation(_prog, 'u_tex'), 0);
  return true;
}

// Perspective warp: draw srcCanvas onto destCtx warped to the given four corners.
// corners: { tl, tr, bl, br } each { x, y } in destCtx coordinate space.
// Uses triangle subdivision (fake perspective) — works without additional WebGL setup.
export function perspectiveWarpCanvas(srcCanvas, destCtx, corners, destW, destH) {
  const STEPS = 16; // subdivision grid per side
  const { tl, tr, bl, br } = corners;
  const sw = srcCanvas.width, sh = srcCanvas.height;

  destCtx.save();
  // Clip to the bounding box of the destination to avoid overdraw.
  destCtx.beginPath();
  destCtx.moveTo(tl.x, tl.y);
  destCtx.lineTo(tr.x, tr.y);
  destCtx.lineTo(br.x, br.y);
  destCtx.lineTo(bl.x, bl.y);
  destCtx.closePath();
  destCtx.clip();

  // Bilinear interpolation of corner positions.
  function lerp(a, b, t) { return a + (b - a) * t; }
  function bilerp(u, v) {
    const x = lerp(lerp(tl.x, tr.x, u), lerp(bl.x, br.x, u), v);
    const y = lerp(lerp(tl.y, tr.y, u), lerp(bl.y, br.y, u), v);
    return { x, y };
  }

  for (let row = 0; row < STEPS; row++) {
    for (let col = 0; col < STEPS; col++) {
      const u0 = col / STEPS, u1 = (col + 1) / STEPS;
      const v0 = row / STEPS, v1 = (row + 1) / STEPS;

      // Four corners of this cell in dest space
      const p00 = bilerp(u0, v0);
      const p10 = bilerp(u1, v0);
      const p01 = bilerp(u0, v1);
      const p11 = bilerp(u1, v1);

      // Source pixel rect for this cell
      const sx0 = u0 * sw, sx1 = u1 * sw;
      const sy0 = v0 * sh, sy1 = v1 * sh;
      const scx = (sx0 + sx1) / 2, scy = (sy0 + sy1) / 2;

      // Draw two triangles per cell using transform trick.
      // Triangle 1: p00, p10, p01
      drawTriangle(destCtx, srcCanvas,
        p00.x, p00.y, p10.x, p10.y, p01.x, p01.y,
        sx0, sy0, sx1, sy0, sx0, sy1,
        sw, sh);
      // Triangle 2: p11, p01, p10
      drawTriangle(destCtx, srcCanvas,
        p11.x, p11.y, p01.x, p01.y, p10.x, p10.y,
        sx1, sy1, sx0, sy1, sx1, sy0,
        sw, sh);
    }
  }
  destCtx.restore();
}

// Draw a textured triangle onto destCtx.
// d0,d1,d2: destination vertices; s0,s1,s2: corresponding source UV in pixels.
function drawTriangle(ctx, src, dx0, dy0, dx1, dy1, dx2, dy2, sx0, sy0, sx1, sy1, sx2, sy2, sw, sh) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();

  // Compute the affine transform that maps (sx0,sy0),(sx1,sy1),(sx2,sy2) → (dx0,dy0),(dx1,dy1),(dx2,dy2)
  const dxA = dx1 - dx0, dyA = dy1 - dy0;
  const dxB = dx2 - dx0, dyB = dy2 - dy0;
  const sxA = sx1 - sx0, syA = sy1 - sy0;
  const sxB = sx2 - sx0, syB = sy2 - sy0;

  const det = sxA * syB - syA * sxB;
  if (Math.abs(det) < 1e-6) { ctx.restore(); return; }
  const idet = 1 / det;

  const a = (dxA * syB - dxB * syA) * idet;
  const b = (dxB * sxA - dxA * sxB) * idet;
  const c = (dyA * syB - dyB * syA) * idet;
  const d = (dyB * sxA - dyA * sxB) * idet;
  const e = dx0 - a * sx0 - b * sy0;
  const f = dy0 - c * sx0 - d * sy0;

  ctx.transform(a, c, b, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

export function applyAdjustments(srcCanvas, adjustments) {
  let brightness = 0, contrast = 0, saturation = 0;
  for (const adj of (adjustments || [])) {
    if (adj.type === 'brightness') brightness = adj.value / 100;
    else if (adj.type === 'contrast') contrast = adj.value / 100;
    else if (adj.type === 'saturation') saturation = adj.value / 100;
  }
  if (brightness === 0 && contrast === 0 && saturation === 0) return null;

  if (!initGL()) return null;

  const gl = _gl;
  const w = srcCanvas.width, h = srcCanvas.height;
  if (_glCanvas.width !== w || _glCanvas.height !== h) {
    _glCanvas.width = w; _glCanvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

  gl.uniform1f(_uBright, brightness);
  gl.uniform1f(_uContrast, contrast);
  gl.uniform1f(_uSat, saturation);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.deleteTexture(tex);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(_glCanvas, 0, 0);
  return out;
}
