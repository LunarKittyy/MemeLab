// WebGL1 multi-pass adjustment pipeline.
// Pass 1 (_prog): brightness, contrast, saturation, vignette, split-tone, grain.
// Pass 2 (_spatialProg): clarity, sharpen, noise reduction, dehaze (spatial sampling).
// Returns a 2D canvas with the result, or null if no adjustments have effect.

// ---------------------------------------------------------------------------
// Pass 1 vertex shader (shared)
// ---------------------------------------------------------------------------
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
// Pass 1 fragment shader — color-remap effects
// ---------------------------------------------------------------------------
const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_vignette;
uniform vec3  u_highlight_color;
uniform vec3  u_shadow_color;
uniform float u_split_balance;
uniform float u_split_active;
uniform float u_grain;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);

  // Brightness / contrast / saturation
  c.rgb += u_brightness;
  c.rgb = (c.rgb - 0.5) * (1.0 + u_contrast) + 0.5;
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(lum), c.rgb, 1.0 + u_saturation);

  // Vignette — darken (negative) or lighten (positive) edges
  float dist = length(v_uv - vec2(0.5));
  float vigMask = smoothstep(0.3, 0.75, dist);
  c.rgb *= 1.0 - u_vignette * vigMask * 0.8;

  // Split-tone
  if (u_split_active > 0.5) {
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float hiWeight = smoothstep(0.4 + u_split_balance * 0.2, 0.9, luma);
    float loWeight = smoothstep(0.5 - u_split_balance * 0.2, 0.0, luma);
    c.rgb = mix(c.rgb, mix(c.rgb, u_highlight_color, hiWeight * 0.4), 1.0);
    c.rgb = mix(c.rgb, mix(c.rgb, u_shadow_color,    loWeight * 0.4), 1.0);
  }

  // Grain — pseudo-random noise
  if (u_grain > 0.0) {
    float noise = fract(sin(dot(v_uv * 100.0 + vec2(0.1, 0.2), vec2(12.9898, 78.233))) * 43758.5453);
    c.rgb += (noise - 0.5) * u_grain * 0.15;
  }

  gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`;

// ---------------------------------------------------------------------------
// Pass 2 fragment shader — spatial (neighborhood) effects
// ---------------------------------------------------------------------------
const SPATIAL_FRAG = `
precision mediump float;
uniform sampler2D u_src;
uniform vec2  u_texelSize;
uniform float u_clarity;
uniform float u_sharpen;
uniform float u_nr_luma;
uniform float u_nr_color;
uniform float u_dehaze;
varying vec2 v_uv;

// 3x3 box blur
vec4 boxBlur3(sampler2D tex, vec2 uv, vec2 ts) {
  vec4 s = vec4(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      s += texture2D(tex, uv + vec2(float(dx), float(dy)) * ts);
    }
  }
  return s / 9.0;
}

// 5x5 box blur (for stronger NR / dehaze)
vec4 boxBlur5(sampler2D tex, vec2 uv, vec2 ts) {
  vec4 s = vec4(0.0);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      s += texture2D(tex, uv + vec2(float(dx), float(dy)) * ts);
    }
  }
  return s / 25.0;
}

// RGB -> YCbCr (BT.601)
vec3 rgbToYCbCr(vec3 rgb) {
  float y  =  0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  float cb = -0.169 * rgb.r - 0.331 * rgb.g + 0.500 * rgb.b + 0.5;
  float cr =  0.500 * rgb.r - 0.419 * rgb.g - 0.081 * rgb.b + 0.5;
  return vec3(y, cb, cr);
}

// YCbCr -> RGB
vec3 yCbCrToRgb(vec3 ycbcr) {
  float y  = ycbcr.x;
  float cb = ycbcr.y - 0.5;
  float cr = ycbcr.z - 0.5;
  float r = y + 1.402 * cr;
  float g = y - 0.344 * cb - 0.714 * cr;
  float b = y + 1.772 * cb;
  return vec3(r, g, b);
}

void main() {
  vec4 orig = texture2D(u_src, v_uv);
  vec4 c = orig;

  // ---- Noise reduction ----
  if (u_nr_luma > 0.0 || u_nr_color > 0.0) {
    vec4 blurred5 = boxBlur5(u_src, v_uv, u_texelSize);
    if (u_nr_luma > 0.0 && u_nr_color > 0.0) {
      // Both: blend full in YCbCr space
      vec3 ycbcr_orig    = rgbToYCbCr(c.rgb);
      vec3 ycbcr_blurred = rgbToYCbCr(blurred5.rgb);
      float y  = mix(ycbcr_orig.x, ycbcr_blurred.x, u_nr_luma);
      float cb = mix(ycbcr_orig.y, ycbcr_blurred.y, u_nr_color);
      float cr = mix(ycbcr_orig.z, ycbcr_blurred.z, u_nr_color);
      c.rgb = yCbCrToRgb(vec3(y, cb, cr));
    } else if (u_nr_luma > 0.0) {
      vec3 ycbcr_orig    = rgbToYCbCr(c.rgb);
      vec3 ycbcr_blurred = rgbToYCbCr(blurred5.rgb);
      float y = mix(ycbcr_orig.x, ycbcr_blurred.x, u_nr_luma);
      c.rgb = yCbCrToRgb(vec3(y, ycbcr_orig.y, ycbcr_orig.z));
    } else {
      vec3 ycbcr_orig    = rgbToYCbCr(c.rgb);
      vec3 ycbcr_blurred = rgbToYCbCr(blurred5.rgb);
      float cb = mix(ycbcr_orig.y, ycbcr_blurred.y, u_nr_color);
      float cr = mix(ycbcr_orig.z, ycbcr_blurred.z, u_nr_color);
      c.rgb = yCbCrToRgb(vec3(ycbcr_orig.x, cb, cr));
    }
  }

  // ---- Dehaze ----
  // Haze = uniform light overlay; remove by boosting contrast locally,
  // reducing brightness slightly, and recovering detail with unsharp mask.
  if (u_dehaze > 0.0) {
    vec4 blurred3 = boxBlur3(u_src, v_uv, u_texelSize);
    vec4 detail = orig - blurred3;
    // Contrast boost
    c.rgb = (c.rgb - 0.5) * (1.0 + u_dehaze * 0.5) + 0.5;
    // Slight brightness reduction (haze lifts midtones)
    c.rgb -= u_dehaze * 0.05;
    // Local contrast recovery via unsharp mask
    c.rgb += detail.rgb * u_dehaze * 0.8;
  } else if (u_dehaze < 0.0) {
    // Negative dehaze = add haze: blend toward a bright flat overlay
    float hazeAmt = -u_dehaze;
    c.rgb = mix(c.rgb, vec3(0.85), hazeAmt * 0.4);
  }

  // ---- Sharpen (full unsharp mask) ----
  if (u_sharpen > 0.0) {
    vec4 blurred3 = boxBlur3(u_src, v_uv, u_texelSize);
    vec4 detail = orig - blurred3;
    c.rgb += detail.rgb * u_sharpen * 2.0;
  }

  // ---- Clarity (mid-tone contrast via unsharp mask) ----
  if (u_clarity > 0.0) {
    vec4 blurred3 = boxBlur3(u_src, v_uv, u_texelSize);
    vec4 detail = orig - blurred3;
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float midMask = smoothstep(0.15, 0.35, luma) * (1.0 - smoothstep(0.65, 0.85, luma));
    c.rgb += detail.rgb * u_clarity * 1.5 * midMask;
  }

  gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`;

// ---------------------------------------------------------------------------
// Singleton GL state
// ---------------------------------------------------------------------------
let _gl        = null;
let _glCanvas  = null;

// Pass 1
let _prog       = null;
let _uBright, _uContrast, _uSat;
let _uVignette;
let _uHighlightColor, _uShadowColor, _uSplitBalance, _uSplitActive;
let _uGrain;

// Pass 2
let _spatialProg     = null;
let _uSpatialTexSrc  = null;
let _uTexelSize      = null;
let _uClarity        = null;
let _uSharpen        = null;
let _uNrLuma         = null;
let _uNrColor        = null;
let _uDehaze         = null;

// FBO for ping-pong between passes
let _fbo    = null;
let _fboTex = null;
let _fboW   = 0;
let _fboH   = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('glAdjust shader error:', gl.getShaderInfoLog(sh));
  }
  return sh;
}

function createProgram(gl, vertSrc, fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('glAdjust link error:', gl.getProgramInfoLog(prog));
  }
  return prog;
}

function bindQuad(gl, prog) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
function initGL() {
  if (_gl) return true;
  _glCanvas = document.createElement('canvas');
  _gl = _glCanvas.getContext('webgl') || _glCanvas.getContext('experimental-webgl');
  if (!_gl) return false;

  const gl = _gl;

  // Pass 1 program
  _prog = createProgram(gl, VERT, FRAG);
  gl.useProgram(_prog);

  _uBright         = gl.getUniformLocation(_prog, 'u_brightness');
  _uContrast       = gl.getUniformLocation(_prog, 'u_contrast');
  _uSat            = gl.getUniformLocation(_prog, 'u_saturation');
  _uVignette       = gl.getUniformLocation(_prog, 'u_vignette');
  _uHighlightColor = gl.getUniformLocation(_prog, 'u_highlight_color');
  _uShadowColor    = gl.getUniformLocation(_prog, 'u_shadow_color');
  _uSplitBalance   = gl.getUniformLocation(_prog, 'u_split_balance');
  _uSplitActive    = gl.getUniformLocation(_prog, 'u_split_active');
  _uGrain          = gl.getUniformLocation(_prog, 'u_grain');
  gl.uniform1i(gl.getUniformLocation(_prog, 'u_tex'), 0);

  return true;
}

function initSpatialProg() {
  if (_spatialProg) return;
  const gl = _gl;

  _spatialProg = createProgram(gl, VERT, SPATIAL_FRAG);
  gl.useProgram(_spatialProg);
  bindQuad(gl, _spatialProg);

  _uSpatialTexSrc = gl.getUniformLocation(_spatialProg, 'u_src');
  _uTexelSize     = gl.getUniformLocation(_spatialProg, 'u_texelSize');
  _uClarity       = gl.getUniformLocation(_spatialProg, 'u_clarity');
  _uSharpen       = gl.getUniformLocation(_spatialProg, 'u_sharpen');
  _uNrLuma        = gl.getUniformLocation(_spatialProg, 'u_nr_luma');
  _uNrColor       = gl.getUniformLocation(_spatialProg, 'u_nr_color');
  _uDehaze        = gl.getUniformLocation(_spatialProg, 'u_dehaze');
  gl.uniform1i(_uSpatialTexSrc, 0);
}

function ensureFBO(gl, w, h) {
  if (_fboW === w && _fboH === h && _fbo) return;

  if (_fbo) gl.deleteFramebuffer(_fbo);
  if (_fboTex) gl.deleteTexture(_fboTex);

  _fboTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, _fboTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  _fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, _fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _fboTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  _fboW = w; _fboH = h;
}

// ---------------------------------------------------------------------------
// Utility: hue+saturation → RGB tint color
// ---------------------------------------------------------------------------
function hueToRgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  h = h / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1/3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1/3)];
}

function makeTexture(gl, src) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  return tex;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function applyAdjustments(srcCanvas, adjustments) {
  const adjs = adjustments || [];

  // Extract all values
  let brightness = 0, contrast = 0, saturation = 0;
  let vignette   = 0;
  let grain = 0, grainSize = 1;
  let clarity = 0, sharpen = 0, nrLuma = 0, nrColor = 0, dehaze = 0;
  let splitTone = null;

  for (const adj of adjs) {
    switch (adj.type) {
      case 'brightness':    brightness  = adj.value / 100; break;
      case 'contrast':      contrast    = adj.value / 100; break;
      case 'saturation':    saturation  = adj.value / 100; break;
      case 'vignette':      vignette    = adj.value / 100; break;  // -1..1
      case 'grain':         grain       = (adj.value ?? 0) / 100;  // 0..1
                            grainSize   = adj.size ?? 1; break;
      case 'clarity':       clarity     = (adj.value ?? 0) / 100; break;
      case 'sharpen':       sharpen     = (adj.value ?? 0) / 100; break;
      case 'noise_reduction':
        nrLuma  = (adj.value ?? 0) / 100;
        nrColor = (adj.colorNoise ?? 0) / 100;
        break;
      case 'dehaze':        dehaze      = (adj.value ?? 0) / 100; break; // -1..1
      case 'split_tone':    splitTone   = adj; break;
    }
  }

  // Check if anything is actually active
  const hasSpatial = clarity !== 0 || sharpen !== 0 || nrLuma !== 0 || nrColor !== 0 || dehaze !== 0;
  const hasPass1   = brightness !== 0 || contrast !== 0 || saturation !== 0
                  || vignette !== 0 || grain !== 0 || splitTone !== null;

  if (!hasSpatial && !hasPass1) return null;
  if (!initGL()) return null;

  const gl = _gl;
  const w = srcCanvas.width, h = srcCanvas.height;

  // Resize GL canvas if needed
  if (_glCanvas.width !== w || _glCanvas.height !== h) {
    _glCanvas.width = w;
    _glCanvas.height = h;
    gl.viewport(0, 0, w, h);
  } else {
    gl.viewport(0, 0, w, h);
  }

  // Upload source texture
  const srcTex = makeTexture(gl, srcCanvas);

  // ---------------------------------------------------------------------------
  // Pass 1 — color remap (renders to FBO if spatial pass needed, else to canvas)
  // ---------------------------------------------------------------------------
  gl.useProgram(_prog);

  // Re-bind quad for pass 1
  const buf1 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf1);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc1 = gl.getAttribLocation(_prog, 'a_pos');
  gl.enableVertexAttribArray(loc1);
  gl.vertexAttribPointer(loc1, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);

  gl.uniform1f(_uBright,   brightness);
  gl.uniform1f(_uContrast, contrast);
  gl.uniform1f(_uSat,      saturation);
  gl.uniform1f(_uVignette, vignette);
  gl.uniform1f(_uGrain,    grain);

  if (splitTone) {
    const hHue = (splitTone.highlightHue ?? 0);
    const hSat = (splitTone.highlightSat ?? 0) / 100;
    const sHue = (splitTone.shadowHue    ?? 0);
    const sSat = (splitTone.shadowSat    ?? 0) / 100;
    const bal  = (splitTone.balance      ?? 0) / 100;
    const [hr, hg, hb] = hslToRgb(hHue, hSat, 0.5);
    const [sr, sg, sb] = hslToRgb(sHue, sSat, 0.5);
    gl.uniform3f(_uHighlightColor, hr, hg, hb);
    gl.uniform3f(_uShadowColor, sr, sg, sb);
    gl.uniform1f(_uSplitBalance, bal);
    gl.uniform1f(_uSplitActive, 1.0);
  } else {
    gl.uniform3f(_uHighlightColor, 0.5, 0.5, 0.5);
    gl.uniform3f(_uShadowColor,    0.5, 0.5, 0.5);
    gl.uniform1f(_uSplitBalance, 0.0);
    gl.uniform1f(_uSplitActive, 0.0);
  }

  if (hasSpatial) {
    // Render pass 1 to FBO
    ensureFBO(gl, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, _fbo);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  gl.deleteTexture(srcTex);
  gl.deleteBuffer(buf1);

  // ---------------------------------------------------------------------------
  // Pass 2 — spatial effects (reads from FBO texture)
  // ---------------------------------------------------------------------------
  if (hasSpatial) {
    initSpatialProg();
    gl.useProgram(_spatialProg);

    // Re-bind quad for pass 2
    const buf2 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf2);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc2 = gl.getAttribLocation(_spatialProg, 'a_pos');
    gl.enableVertexAttribArray(loc2);
    gl.vertexAttribPointer(loc2, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _fboTex);

    gl.uniform2f(_uTexelSize, 1.0 / w, 1.0 / h);
    gl.uniform1f(_uClarity,  clarity);
    gl.uniform1f(_uSharpen,  sharpen);
    gl.uniform1f(_uNrLuma,   nrLuma);
    gl.uniform1f(_uNrColor,  nrColor);
    gl.uniform1f(_uDehaze,   dehaze);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.deleteBuffer(buf2);
  }

  // ---------------------------------------------------------------------------
  // Read result out to a 2D canvas
  // ---------------------------------------------------------------------------
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(_glCanvas, 0, 0);
  return out;
}
