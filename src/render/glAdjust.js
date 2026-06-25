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
