// WebGL1 multi-pass adjustment pipeline.
// Pass 1 (main prog): brightness, contrast, saturation, vibrance,
//   temperature, tint, highlights, shadows, plus optional curve LUT textures.
// Pass 2 (HSL prog): per-range hue/saturation/luminance adjustments (only
//   when HSL adjustments are present).
//
// Singleton GL context — one offscreen canvas shared across all calls.
// Returns a 2D canvas with the result, or null if no adjustments have effect.

// ─── Vertex shader (shared by both programs) ───────────────────────────────
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ─── Main pass fragment shader ─────────────────────────────────────────────
const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_temperature;
uniform float u_tint;
uniform float u_highlights;
uniform float u_shadows;

// Curve LUT textures (256x1 RGBA, all channels carry the same mapped value)
uniform sampler2D u_lutRGB; // applied to all channels
uniform sampler2D u_lutR;
uniform sampler2D u_lutG;
uniform sampler2D u_lutB;
uniform int u_hasLutRGB;
uniform int u_hasLutR;
uniform int u_hasLutG;
uniform int u_hasLutB;

varying vec2 v_uv;

void main() {
  vec4 c = texture2D(u_tex, v_uv);

  // Brightness
  c.rgb += u_brightness;

  // Contrast
  c.rgb = (c.rgb - 0.5) * (1.0 + u_contrast) + 0.5;

  // Saturation
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(lum), c.rgb, 1.0 + u_saturation);

  // Vibrance (protects already-saturated pixels)
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float sat = maxC - minC;
  float boost = u_vibrance * (1.0 - sat);
  float lum2 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(lum2), c.rgb, 1.0 + boost);

  // Temperature (warm/cool shift)
  c.r += u_temperature * 0.15;
  c.b -= u_temperature * 0.15;

  // Tint (green/magenta shift)
  c.g -= u_tint * 0.1;
  c.r += u_tint * 0.05;
  c.b += u_tint * 0.05;

  // Highlights / shadows (luminance-masked)
  float lum3 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float hiMask = smoothstep(0.5, 1.0, lum3);
  c.rgb += u_highlights * hiMask * (-0.3);
  float loMask = 1.0 - smoothstep(0.0, 0.5, lum3);
  c.rgb += u_shadows * loMask * 0.3;

  // Clamp before curve LUT sampling
  c.rgb = clamp(c.rgb, 0.0, 1.0);

  // Curves (LUT sampling)
  if (u_hasLutRGB == 1) {
    c.r = texture2D(u_lutRGB, vec2(c.r, 0.5)).r;
    c.g = texture2D(u_lutRGB, vec2(c.g, 0.5)).r;
    c.b = texture2D(u_lutRGB, vec2(c.b, 0.5)).r;
  }
  if (u_hasLutR == 1) {
    c.r = texture2D(u_lutR, vec2(c.r, 0.5)).r;
  }
  if (u_hasLutG == 1) {
    c.g = texture2D(u_lutG, vec2(c.g, 0.5)).r;
  }
  if (u_hasLutB == 1) {
    c.b = texture2D(u_lutB, vec2(c.b, 0.5)).r;
  }

  gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`;

// ─── HSL pass fragment shader ──────────────────────────────────────────────
// Handles up to 7 color ranges. Each range is encoded as:
//   u_hslData[i] = vec4(hue_center_norm, hue_half_width_norm, saturation_delta, luminance_delta)
//   u_hslHue[i]  = hue_delta (separate because vec4 is full)
const HSL_FRAG = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;

// 7 possible ranges (reds, oranges, yellows, greens, cyans, blues, purples)
uniform vec4 u_hslData[7];   // x=hue_center(0..1), y=hue_half_width(0..1), z=sat_delta(-1..1), w=lum_delta(-1..1)
uniform float u_hslHueDelta[7]; // hue rotation delta (-1..1 maps to -180..180 degrees)
uniform int u_hslCount;

vec3 rgb2hsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float delta = maxC - minC;
  float l = (maxC + minC) * 0.5;
  float s = 0.0;
  if (delta > 0.0001) {
    s = delta / (1.0 - abs(2.0 * l - 1.0));
  }
  float h = 0.0;
  if (delta > 0.0001) {
    if (maxC == c.r) {
      h = mod((c.g - c.b) / delta, 6.0) / 6.0;
    } else if (maxC == c.g) {
      h = ((c.b - c.r) / delta + 2.0) / 6.0;
    } else {
      h = ((c.r - c.g) / delta + 4.0) / 6.0;
    }
  }
  if (h < 0.0) h += 1.0;
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s < 0.0001) {
    return vec3(l);
  }
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0/3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0/3.0)
  );
}

float hueWeight(float pixH, float center, float halfWidth) {
  // Handle hue wrap-around (e.g. reds span 0/1 boundary)
  float dist = abs(pixH - center);
  if (dist > 0.5) dist = 1.0 - dist;
  return 1.0 - smoothstep(0.0, halfWidth, dist);
}

void main() {
  vec4 orig = texture2D(u_tex, v_uv);
  vec3 hsl = rgb2hsl(orig.rgb);

  float h = hsl.x, s = hsl.y, l = hsl.z;

  for (int i = 0; i < 7; i++) {
    if (i >= u_hslCount) break;
    vec4 d = u_hslData[i];
    float center = d.x;
    float halfW  = d.y;
    float satDelta = d.z;
    float lumDelta = d.w;
    float hueDelta = u_hslHueDelta[i];
    float w = hueWeight(h, center, halfW);
    if (w > 0.0001) {
      h = mod(h + hueDelta * w + 1.0, 1.0);
      s = clamp(s + satDelta * w, 0.0, 1.0);
      l = clamp(l + lumDelta * w, 0.0, 1.0);
    }
  }

  vec3 rgb = hsl2rgb(vec3(h, s, l));
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), orig.a);
}`;

// ─── Singleton GL state ────────────────────────────────────────────────────
let _gl = null;
let _glCanvas = null;

// Main program
let _prog = null;
let _uBright, _uContrast, _uSat;
let _uVibrance, _uTemperature, _uTint, _uHighlights, _uShadows;
let _uLutRGB, _uLutR, _uLutG, _uLutB;
let _uHasLutRGB, _uHasLutR, _uHasLutG, _uHasLutB;

// HSL program
let _hslProg = null;
let _uHslTex, _uHslData, _uHslHueDelta, _uHslCount;

// Shared geometry buffer
let _quadBuf = null;

// Ping-pong FBO for HSL pass
let _fbo = null;
let _fboTex = null;
let _fboW = 0, _fboH = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────
function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(sh));
  }
  return sh;
}

function createProgram(gl, vertSrc, fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
  }
  return prog;
}

function initGL() {
  if (_gl) return true;
  _glCanvas = document.createElement('canvas');
  _gl = _glCanvas.getContext('webgl') || _glCanvas.getContext('experimental-webgl');
  if (!_gl) return false;

  const gl = _gl;

  // ── Main program ──
  _prog = createProgram(gl, VERT, FRAG);
  gl.useProgram(_prog);

  // Shared full-screen quad
  _quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, _quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  function bindQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, _quadBuf);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
  bindQuad(_prog);

  // Main uniforms
  _uBright     = gl.getUniformLocation(_prog, 'u_brightness');
  _uContrast   = gl.getUniformLocation(_prog, 'u_contrast');
  _uSat        = gl.getUniformLocation(_prog, 'u_saturation');
  _uVibrance   = gl.getUniformLocation(_prog, 'u_vibrance');
  _uTemperature= gl.getUniformLocation(_prog, 'u_temperature');
  _uTint       = gl.getUniformLocation(_prog, 'u_tint');
  _uHighlights = gl.getUniformLocation(_prog, 'u_highlights');
  _uShadows    = gl.getUniformLocation(_prog, 'u_shadows');
  _uHasLutRGB  = gl.getUniformLocation(_prog, 'u_hasLutRGB');
  _uHasLutR    = gl.getUniformLocation(_prog, 'u_hasLutR');
  _uHasLutG    = gl.getUniformLocation(_prog, 'u_hasLutG');
  _uHasLutB    = gl.getUniformLocation(_prog, 'u_hasLutB');

  // Texture samplers for main pass
  gl.uniform1i(gl.getUniformLocation(_prog, 'u_tex'), 0);
  _uLutRGB = gl.getUniformLocation(_prog, 'u_lutRGB');
  _uLutR   = gl.getUniformLocation(_prog, 'u_lutR');
  _uLutG   = gl.getUniformLocation(_prog, 'u_lutG');
  _uLutB   = gl.getUniformLocation(_prog, 'u_lutB');
  gl.uniform1i(_uLutRGB, 1);
  gl.uniform1i(_uLutR,   2);
  gl.uniform1i(_uLutG,   3);
  gl.uniform1i(_uLutB,   4);

  // ── HSL program ──
  _hslProg = createProgram(gl, VERT, HSL_FRAG);
  gl.useProgram(_hslProg);
  bindQuad(_hslProg);

  _uHslTex      = gl.getUniformLocation(_hslProg, 'u_tex');
  _uHslData     = gl.getUniformLocation(_hslProg, 'u_hslData');
  _uHslHueDelta = gl.getUniformLocation(_hslProg, 'u_hslHueDelta');
  _uHslCount    = gl.getUniformLocation(_hslProg, 'u_hslCount');
  gl.uniform1i(_uHslTex, 0);

  // ── FBO for ping-pong (allocated on first use) ──
  _fbo    = gl.createFramebuffer();
  _fboTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, _fboTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return true;
}

// ─── Curve LUT helpers ────────────────────────────────────────────────────
// Monotone cubic (Fritsch-Carlson) spline interpolation.
function buildLut(points) {
  const N = 256;
  const lut = new Uint8Array(N);

  if (!points || points.length === 0) {
    // Identity
    for (let i = 0; i < N; i++) lut[i] = i;
    return lut;
  }

  // Sort by x, clamp to [0,1]
  const pts = points.slice().sort((a, b) => a[0] - b[0]);

  // Ensure endpoints span 0..1 for natural-looking curves
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] < 1) pts.push([1, pts[pts.length - 1][1]]);

  const n = pts.length - 1;
  if (n === 0) {
    for (let i = 0; i < N; i++) lut[i] = Math.round(pts[0][1] * 255);
    return lut;
  }

  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);

  // Compute slopes
  const dx = [], dy = [], m = [], alpha = [];
  for (let i = 0; i < n; i++) {
    dx[i] = xs[i+1] - xs[i];
    dy[i] = ys[i+1] - ys[i];
    m[i]  = dy[i] / dx[i];
  }

  // Tangents (Catmull-Rom style, then enforce monotonicity)
  const t = new Array(n + 1);
  t[0] = m[0];
  t[n] = m[n - 1];
  for (let i = 1; i < n; i++) {
    t[i] = (m[i-1] + m[i]) * 0.5;
  }
  // Fritsch-Carlson monotonicity fix
  for (let i = 0; i < n; i++) {
    if (Math.abs(m[i]) < 1e-9) { t[i] = t[i+1] = 0; continue; }
    alpha[i] = t[i] / m[i];
    const beta  = t[i+1] / m[i];
    const mag   = alpha[i] * alpha[i] + beta * beta;
    if (mag > 9) {
      const scale = 3 / Math.sqrt(mag);
      t[i]   = alpha[i] * scale * m[i];
      t[i+1] = beta  * scale * m[i];
    }
  }

  for (let k = 0; k < N; k++) {
    const x = k / (N - 1);
    // Find segment
    let seg = n - 1;
    for (let i = 0; i < n; i++) {
      if (x <= xs[i+1]) { seg = i; break; }
    }
    const h   = dx[seg];
    const tRel= (x - xs[seg]) / h;
    const t2  = tRel * tRel, t3 = t2 * tRel;
    const y = (2*t3 - 3*t2 + 1) * ys[seg]
            + (t3 - 2*t2 + tRel) * h * t[seg]
            + (-2*t3 + 3*t2) * ys[seg+1]
            + (t3 - t2) * h * t[seg+1];
    lut[k] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

function uploadLut(gl, lut, unit) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Upload as RGBA so we can sample .r in the shader
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgba[i*4]   = lut[i];
    rgba[i*4+1] = lut[i];
    rgba[i*4+2] = lut[i];
    rgba[i*4+3] = 255;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  return tex;
}

// ─── HSL range definitions ─────────────────────────────────────────────────
// Each range: [hue_center_0_1, half_width_0_1]
const HSL_RANGES = {
  reds:    [0.0,    0.083],
  oranges: [0.083,  0.058],
  yellows: [0.153,  0.055],
  greens:  [0.333,  0.1],
  cyans:   [0.5,    0.083],
  blues:   [0.667,  0.083],
  purples: [0.833,  0.083],
};

// ─── Main export ───────────────────────────────────────────────────────────
export function applyAdjustments(srcCanvas, adjustments) {
  const adjs = adjustments || [];

  // Collect scalar values
  let brightness = 0, contrast = 0, saturation = 0;
  let vibrance = 0, temperature = 0, tint = 0, highlights = 0, shadows = 0;
  const curveAdjs = {};  // channel -> points
  const hslAdjs = {};    // range -> { hue, saturation, luminance }

  for (const adj of adjs) {
    switch (adj.type) {
      case 'brightness':  brightness  = adj.value / 100; break;
      case 'contrast':    contrast    = adj.value / 100; break;
      case 'saturation':  saturation  = adj.value / 100; break;
      case 'vibrance':    vibrance    = adj.value / 100; break;
      case 'temperature': temperature = adj.value / 100; break;
      case 'tint':        tint        = adj.value / 100; break;
      case 'highlights':  highlights  = adj.value / 100; break;
      case 'shadows':     shadows     = adj.value / 100; break;
      case 'curves':
        if (adj.channel && adj.points) curveAdjs[adj.channel] = adj.points;
        break;
      case 'hsl':
        if (adj.range) {
          if (!hslAdjs[adj.range]) hslAdjs[adj.range] = { hue: 0, saturation: 0, luminance: 0 };
          hslAdjs[adj.range].hue        = (adj.hue        || 0);
          hslAdjs[adj.range].saturation = (adj.saturation || 0);
          hslAdjs[adj.range].luminance  = (adj.luminance  || 0);
        }
        break;
    }
  }

  const hasCurves = Object.keys(curveAdjs).length > 0;
  const hasHsl    = Object.keys(hslAdjs).length > 0;
  const hasScalar = brightness !== 0 || contrast !== 0 || saturation !== 0
                 || vibrance !== 0   || temperature !== 0 || tint !== 0
                 || highlights !== 0 || shadows !== 0;

  if (!hasScalar && !hasCurves && !hasHsl) return null;

  if (!initGL()) return null;

  const gl = _gl;
  const w = srcCanvas.width, h = srcCanvas.height;

  // Resize GL canvas
  if (_glCanvas.width !== w || _glCanvas.height !== h) {
    _glCanvas.width = w; _glCanvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  // ── Upload source texture (unit 0) ──
  const srcTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

  // ── Build and upload curve LUT textures ──
  const lutTextures = [];

  function setupLut(channel, unit, hasUniform, lutUniform) {
    if (curveAdjs[channel]) {
      const lut = buildLut(curveAdjs[channel]);
      const tex = uploadLut(gl, lut, unit);
      lutTextures.push(tex);
      gl.useProgram(_prog);
      gl.uniform1i(hasUniform, 1);
    } else {
      gl.useProgram(_prog);
      gl.uniform1i(hasUniform, 0);
    }
  }

  gl.useProgram(_prog);
  setupLut('rgb', 1, _uHasLutRGB, _uLutRGB);
  setupLut('r',   2, _uHasLutR,   _uLutR);
  setupLut('g',   3, _uHasLutG,   _uLutG);
  setupLut('b',   4, _uHasLutB,   _uLutB);

  // ── Set scalar uniforms ──
  gl.uniform1f(_uBright,      brightness);
  gl.uniform1f(_uContrast,    contrast);
  gl.uniform1f(_uSat,         saturation);
  gl.uniform1f(_uVibrance,    vibrance);
  gl.uniform1f(_uTemperature, temperature);
  gl.uniform1f(_uTint,        tint);
  gl.uniform1f(_uHighlights,  highlights);
  gl.uniform1f(_uShadows,     shadows);

  // ── Pass 1: main adjustments → either glCanvas or FBO ──
  if (hasHsl) {
    // Render to FBO so HSL pass can read the result
    if (_fboW !== w || _fboH !== h) {
      _fboW = w; _fboH = h;
      gl.bindTexture(gl.TEXTURE_2D, _fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, _fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _fboTex, 0);
    gl.viewport(0, 0, w, h);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
  }

  gl.useProgram(_prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // ── Pass 2: HSL (if needed) → glCanvas ──
  if (hasHsl) {
    // Build uniform arrays for up to 7 ranges
    const rangeOrder = ['reds','oranges','yellows','greens','cyans','blues','purples'];
    const activeRanges = rangeOrder.filter(r => hslAdjs[r]);
    const count = activeRanges.length;

    const dataArr = new Float32Array(7 * 4); // vec4 array
    const hueDeltaArr = new Float32Array(7);

    for (let i = 0; i < activeRanges.length; i++) {
      const r = activeRanges[i];
      const def = HSL_RANGES[r] || [0, 0.083];
      const adj = hslAdjs[r];
      dataArr[i*4 + 0] = def[0];               // hue center
      dataArr[i*4 + 1] = def[1];               // half-width
      dataArr[i*4 + 2] = adj.saturation / 100; // sat delta (-1..1)
      dataArr[i*4 + 3] = adj.luminance  / 100; // lum delta (-1..1)
      hueDeltaArr[i]   = adj.hue        / 360; // hue delta (-0.5..0.5)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(_hslProg);

    // Bind the FBO result as input texture (unit 0)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _fboTex);

    gl.uniform4fv(_uHslData,     dataArr);
    gl.uniform1fv(_uHslHueDelta, hueDeltaArr);
    gl.uniform1i(_uHslCount,     count);

    // Re-bind quad (in case HSL program uses different attrib location)
    gl.bindBuffer(gl.ARRAY_BUFFER, _quadBuf);
    const loc = gl.getAttribLocation(_hslProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Cleanup curve LUT textures
  for (const tex of lutTextures) gl.deleteTexture(tex);
  gl.deleteTexture(srcTex);

  // Copy to 2D output canvas
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(_glCanvas, 0, 0);
  return out;
}

// ─── Auto-enhance ─────────────────────────────────────────────────────────
// Analyzes a canvas and returns a suggested adjustments array.
export function computeAutoEnhance(srcCanvas) {
  const ctx = srcCanvas.getContext('2d');
  const w = srcCanvas.width, h = srcCanvas.height;
  // Sample at most 200x200 for performance
  const sw = Math.min(w, 200), sh = Math.min(h, 200);
  const offscreen = document.createElement('canvas');
  offscreen.width = sw; offscreen.height = sh;
  offscreen.getContext('2d').drawImage(srcCanvas, 0, 0, sw, sh);
  const imgData = offscreen.getContext('2d').getImageData(0, 0, sw, sh);
  const data = imgData.data;
  const n = sw * sh;

  let sumLum = 0, minLum = 1, maxLum = 0, sumSat = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]   / 255;
    const g = data[i+1] / 255;
    const b = data[i+2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumLum += lum;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    sumSat += maxC - minC;
  }

  const avgLum = sumLum / n;
  const dynRange = maxLum - minLum;
  const avgSat = sumSat / n;

  const result = [];

  // Underexposed
  if (avgLum < 0.4) {
    const adj = Math.round((0.4 - avgLum) * 120);
    result.push({ type: 'brightness', value: Math.min(adj, 60) });
  }
  // Overexposed
  if (avgLum > 0.7) {
    const adj = Math.round((avgLum - 0.7) * 100);
    result.push({ type: 'brightness', value: -Math.min(adj, 40) });
  }
  // Compressed dynamic range
  if (dynRange < 0.6) {
    const adj = Math.round((0.6 - dynRange) * 80);
    result.push({ type: 'contrast', value: Math.min(adj, 50) });
  }
  // Low saturation
  if (avgSat < 0.25) {
    const adj = Math.round((0.25 - avgSat) * 160);
    result.push({ type: 'vibrance', value: Math.min(adj, 50) });
  }

  return result;
}
