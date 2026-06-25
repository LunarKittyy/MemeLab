# Track B — Local Effects

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed a non-destructive adjustment stack (`layer.adjustments: [{ type, value }]`) and WebGL pipeline in `src/render/glAdjust.js`. Track B extends that pipeline with clarity, dehaze, sharpen, noise reduction, vignette, split-tone, and grain.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Depends on: Phase 0 section 4 (adjustment stack must exist — it does).**

---

## Important: these are NOT all "one more shader uniform"

Some effects in this track are uniform-color-remap operations (vignette, grain, split-tone) — they're a natural extension of the existing single-pass shader. But **noise reduction and dehaze both require neighborhood/spatial sampling** (multiple texture reads per output pixel, not a 1:1 color remap). These are meaningfully different in shader shape. Budget them as their own design pass within this track — do not assume you can drop them into the existing shader.

**Clarity and sharpen** also require neighborhood sampling (they're unsharp-mask-style operations). Design them together with noise reduction, not with the simple uniform adjustments.

---

## What you are building

1. **Clarity** — local contrast enhancement (unsharp mask applied to mid-tones only).
2. **Dehaze** — reduce haze/fog by boosting contrast and saturation in specific tonal ranges.
3. **Sharpen** — standard unsharp mask sharpening.
4. **Noise reduction** — Gaussian-blur-based luminance and color noise reduction.
5. **Vignette** — darken or lighten the image edges with a radial falloff.
6. **Split-tone** — independently color-grade highlights and shadows (different hue/saturation for each tonal zone).
7. **Grain** — add film grain (pseudo-random noise texture overlay).

---

## Files you will touch

### Primary
- `src/render/glAdjust.js` — the WebGL shader and pipeline; you will add new shader programs and extend the API.
- `src/ui/props/imageProps.js` — the adjustment UI in the image props panel.

### Supporting
- `src/render/adjustCache.js` — `getAdjustedCanvas(layer)` and `clearAdjustCache()`; call these, do not change them.
- `src/core/layers.js` — no changes needed; `defaultImageLayer()` already has `adjustments: []`.
- `src/persistence/autosave.js` — no changes needed; `applyLoadedSnapshot()` already handles `adjustments: []`.
- `src/ui/props/shared.js` — `collapsibleHtml()`, `wireCollapsible()`, `rangeRow()`, `byId()`.

---

## Real API shapes from Phase 0

### Layer schema
```js
layer.adjustments  // array of { type: string, value: number } or { type: string, ...params }
                   // always access as layer.adjustments || []
// Existing types (Track A may add more):
// 'brightness', 'contrast', 'saturation'
```

New types you will add:
```js
{ type: 'clarity', value: 0..100 }
{ type: 'dehaze', value: -100..100 }    // positive = reduce haze, negative = add haze
{ type: 'sharpen', value: 0..100 }
{ type: 'noise_reduction', value: 0..100, colorNoise: 0..100 }
{ type: 'vignette', value: -100..100 }  // negative = darken edges, positive = lighten edges
{ type: 'split_tone', highlightHue: 0..360, highlightSat: 0..100, shadowHue: 0..360, shadowSat: 0..100, balance: -100..100 }
{ type: 'grain', value: 0..100, size: 1..5 }
```

### glAdjust.js current exports (you will extend this file)
```js
export function applyAdjustments(srcCanvas, adjustments)
// srcCanvas: HTMLCanvasElement
// adjustments: array of { type, value, ... }
// Returns: HTMLCanvasElement | null
```

The current implementation uses a single WebGL1 shader program (`_prog`) that handles brightness/contrast/saturation in one pass. You will add new shader programs for the spatial-sampling effects.

### adjustCache.js API (do NOT modify)
```js
export function getAdjustedCanvas(layer)
export function clearAdjustCache()
```

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function scheduleRender()
```

### shared.js
```js
export function collapsibleHtml(id, title, innerHtml, { defaultOpen = false } = {})
export function wireCollapsible(id)
export function rangeRow(labelText, id, min, max, step, value)
export function byId(id)
```

---

## Implementation steps

### 1. Simple additive effects (extend the existing shader pass)

Add to the existing `_prog` shader in `glAdjust.js`:

**Vignette** — radial falloff from center:
```glsl
uniform float u_vignette;   // -1..1
// In fragment shader, after other effects:
float dist = length(v_uv - vec2(0.5));
float vigMask = smoothstep(0.3, 0.75, dist);
c.rgb *= 1.0 - u_vignette * vigMask * 0.8;
```

**Split-tone** — color-grade highlights and shadows:
```glsl
uniform vec3 u_highlight_color;   // hue+sat encoded as RGB tint
uniform vec3 u_shadow_color;
uniform float u_split_balance;    // -1..1
// Compute luma, then blend tint into highlights vs shadows:
float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
float hiWeight = smoothstep(0.4 + u_split_balance * 0.2, 0.9, luma);
float loWeight = smoothstep(0.5 - u_split_balance * 0.2, 0.0, luma);
c.rgb = mix(c.rgb, mix(c.rgb, u_highlight_color, hiWeight * 0.4), 1.0);
c.rgb = mix(c.rgb, mix(c.rgb, u_shadow_color, loWeight * 0.4), 1.0);
```

**Grain** — pseudo-random noise:
```glsl
uniform float u_grain;      // 0..1
// Simple noise using fract(sin()) or a fixed pattern:
float noise = fract(sin(dot(v_uv * 100.0 + vec2(0.1, 0.2), vec2(12.9898, 78.233))) * 43758.5453);
c.rgb += (noise - 0.5) * u_grain * 0.15;
```

### 2. Spatial-sampling effects (new shader programs)

For clarity, sharpen, noise reduction, and dehaze — effects that need to read neighboring pixels — add separate shader programs. Run them as additional passes after the main `_prog` pass.

**Architecture**: extend `applyAdjustments` to run multiple passes:
1. Pass 1: `_prog` (brightness/contrast/saturation/vignette/split-tone/grain) — existing single-pass.
2. Pass 2 (if needed): `_spatialProg` — clarity/sharpen/noise reduction/dehaze. Run only if any of these are active.

Use ping-pong framebuffers for the two passes: render pass 1 to an offscreen FBO, read from that FBO's texture as input to pass 2.

**Unsharp mask** (used by both clarity and sharpen):
The standard unsharp mask: `result = original + amount * (original - blurred)`.
In WebGL, the blur is a separable Gaussian — do it in two sub-passes (horizontal, then vertical) or approximate it with a box blur using a 3×3 or 5×5 kernel:
```glsl
// 3x3 box blur sample in fragment shader:
uniform sampler2D u_src;
uniform vec2 u_texelSize;  // vec2(1.0/width, 1.0/height)
vec4 blurred = (
  texture2D(u_src, v_uv + vec2(-u_texelSize.x, 0.0)) +
  texture2D(u_src, v_uv + vec2(0.0, 0.0)) +
  texture2D(u_src, v_uv + vec2(u_texelSize.x, 0.0)) +
  // ... 9 samples for 3x3
) / 9.0;
vec4 detail = texture2D(u_src, v_uv) - blurred;
```

**Clarity** (mid-tone contrast): Apply unsharp mask only where luminance is mid-range (0.2–0.8), using a smoothstep mask.

**Sharpen**: Full unsharp mask across all tones.

**Noise reduction**: Gaussian blur to reduce noise, blended with the original based on the noise_reduction value. For color noise: blur only the chroma channels (convert to YCbCr, blur Cb and Cr, reconvert). For luminance noise: blur the Y channel.

**Dehaze**: A simplified approach — dehaze is approximately the inverse of adding haze. Haze adds a uniform light overlay. Remove it by: boosting contrast, reducing brightness slightly, and using the unsharp mask to recover local contrast. More sophisticated approaches exist but this covers the common case without a dedicated algorithm.

### 3. Shader initialization changes in glAdjust.js

The current `initGL()` initializes `_prog`. Extend to also initialize `_spatialProg` lazily (when a spatial effect is first needed). Store:
```js
let _spatialProg = null;
let _spatialTexelSizeLoc = null;
let _spatialClarityLoc = null;
// etc.
```

Use FBOs for ping-pong:
```js
let _fbo = null;
let _fboTex = null;
// Initialize in initGL() or lazily on first use.
```

### 4. UI in imageProps.js

Add the new adjustment types to the picker in the existing Adjustments section. Group them under an "Effects" category in the picker (alongside "Tone" for brightness/contrast/etc. from Track A, or just add them to the same flat or grouped list if Track A hasn't landed yet).

Per-type slider UIs:
- Clarity, dehaze, sharpen, noise reduction: a single `rangeRow` each.
- Noise reduction: add a second slider for "Color noise" (maps to `colorNoise` in the adjustment params).
- Vignette: a single `rangeRow` (negative = darken, positive = lighten; 0 = no vignette).
- Split-tone: two hue wheels or hue sliders + saturation sliders for highlights and shadows, plus a balance slider. Hue as a 0–360 range slider is acceptable.
- Grain: amount slider + size slider (1–5).

All in the existing single Adjustments section — no second separate section for "local effects."

---

## Migration

New adjustment types are additional entries in the `adjustments` array. Old projects without these types have empty/partial arrays — correct behavior, no migration needed.

Split-tone has multiple params:
```js
{ type: 'split_tone', highlightHue: 30, highlightSat: 20, shadowHue: 220, shadowSat: 15, balance: 0 }
```
If a project is loaded with a partial `split_tone` entry (e.g. missing `balance`), access defensively: `adj.balance ?? 0`, `adj.highlightHue ?? 0`, etc.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Adding a vignette adjustment renders without errors and produces a valid export.
- Adding a sharpen adjustment renders without errors.
- Adding clarity renders without errors.
- Adding noise reduction renders without errors.
- Adding grain renders without errors.
- Adding split-tone renders without errors.
- Dehaze renders without errors.
- All new types: export dimensions match original.
- Undo after each new adjustment type reverts `layer.adjustments`.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- Noise reduction and dehaze require neighborhood sampling — do not attempt to implement them as a simple uniform color remap. Design them as their own shader pass.
- All new complexity is inside `glAdjust.js` and `imageProps.js` — not leaking to callers.
- Call `clearAdjustCache()` after every mutation of `layer.adjustments`.
- No new adjustment type gets its own permanent panel outside the single Adjustments section.
- Defensive access: `layer.adjustments || []`, `layer.blendMode || 'normal'`, `layer.mask?.enabled`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-b.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
