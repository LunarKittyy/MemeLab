# Track A — Tone Adjustments

## Context

MemeLab is a browser-based meme/photo editor. Phase 0 landed a non-destructive adjustment stack (`layer.adjustments: [{ type, value }]`) and a WebGL pipeline in `src/render/glAdjust.js`. That pipeline currently supports brightness, contrast, and saturation. Track A extends it with vibrance, temperature/tint, highlights/shadows, curves, HSL, and auto-enhance.

This file is your complete specification. Read it, then build it. You will not have access to any other planning documents.

**Depends on: Phase 0 section 4 (adjustment stack must exist — it does).**

---

## What you are building

1. **Vibrance** — saturation boost that protects already-saturated colors (smarter than uniform saturation).
2. **Temperature/tint** — warm/cool color shift and green/magenta tint.
3. **Highlights/shadows** — selectively lift shadows or pull down highlights without affecting mid-tones.
4. **Curves** — per-channel tone curve. The interaction must be designed for touch, not a desktop mouse graph. Read the design note below before deciding on the interaction.
5. **HSL (Hue/Saturation/Luminance per color range)** — adjust H, S, and L independently for 6–8 color ranges (reds, oranges, yellows, greens, cyans, blues, purples).
6. **Auto-enhance** — analyze image histogram and apply a balanced set of adjustments automatically.
7. **Adjustment type picker** — the existing "Add adjustment" UI in `imageProps.js` currently shows brightness/contrast/saturation. Extend it with the new types, grouped into labeled categories (Tone, Effects, Looks) rather than a flat list.

---

## Files you will touch

### Primary
- `src/render/glAdjust.js` — the WebGL shader; extend it to support new adjustment types.
- `src/ui/props/imageProps.js` — the adjustment UI in the image props panel.

### Supporting
- `src/render/adjustCache.js` — `getAdjustedCanvas(layer)` and `clearAdjustCache()`; you will call these, not change them.
- `src/core/layers.js` — `defaultImageLayer()` already has `adjustments: []`; no changes needed.
- `src/persistence/autosave.js` — `applyLoadedSnapshot()` already initializes `adjustments: []`; no changes needed for the array itself.
- `src/ui/props/shared.js` — `collapsibleHtml()`, `wireCollapsible()`, `rangeRow()`, `byId()`.

---

## Real API shapes from Phase 0

### Layer schema
```js
layer.adjustments  // array of { type: string, value: number } OR { type: string, ...params }
                   // always access as layer.adjustments || []
// Current types in the shader:
// 'brightness'  — { type: 'brightness', value: -100..100 }
// 'contrast'    — { type: 'contrast', value: -100..100 }
// 'saturation'  — { type: 'saturation', value: -100..100 }
```

New types you will add:
```js
{ type: 'vibrance', value: -100..100 }
{ type: 'temperature', value: -100..100 }  // negative = cool, positive = warm
{ type: 'tint', value: -100..100 }         // negative = green, positive = magenta
{ type: 'highlights', value: -100..100 }   // reduce overexposed areas
{ type: 'shadows', value: -100..100 }      // lift dark areas
{ type: 'curves', channel: 'rgb'|'r'|'g'|'b', points: [[x,y], ...] }
// points: control points in 0..1 space, monotonically increasing x
{ type: 'hsl', hue: 0, saturation: 0, luminance: 0, range: 'reds'|'oranges'|'yellows'|'greens'|'cyans'|'blues'|'purples' }
```

### glAdjust.js current state (you will extend this file)
```js
// Current shader handles: brightness, contrast, saturation in a single pass.
// The file exports:
export function applyAdjustments(srcCanvas, adjustments)
// srcCanvas: HTMLCanvasElement
// adjustments: array of { type, value, ... }
// Returns: HTMLCanvasElement | null (null if all adjustments are no-ops)
```

The current implementation is a single fragment shader with three uniforms. You need to extend it. Approach:
- **For scalar adjustments (vibrance, temperature, tint, highlights, shadows)**: Add uniforms to the existing single-pass shader. Keep it one pass — adding uniforms is cheap.
- **For curves**: Add a lookup-table (LUT) texture approach — encode the curve as a 256-entry 1D texture, sample it in the shader. One LUT texture per active curve channel (RGB, R, G, B).
- **For HSL**: This is a per-pixel operation that remaps hue, saturation, and luminance selectively by color range. It fits naturally as an additional pass or additional shader uniforms. Given the complexity, consider a second shader program for the HSL pass, run sequentially after the basic adjustments pass. Use the ping-pong framebuffer approach (render to an offscreen FBO, then draw that to the output).

The file uses a singleton WebGL1 context (`_gl`, `_glCanvas`, `_prog`). When adding a second shader program (for HSL), add it as a second program (`_hslProg`), initialized lazily alongside `_prog`.

### adjustCache.js API (do NOT modify)
```js
export function getAdjustedCanvas(layer)  // returns cached canvas or null
export function clearAdjustCache()        // call after mutating layer.adjustments
```

### renderer.js exports (do NOT change their signatures)
```js
export function renderScene(ctx, opts)
export function renderLayersToCtx(ctx, layers)
export async function exportPng(scale)
export function scheduleRender()
```

### history.js
```js
export function pushHistory(label)
```

### shared.js
```js
export function collapsibleHtml(id, title, innerHtml, { defaultOpen = false } = {})
export function wireCollapsible(id)
export function rangeRow(labelText, id, min, max, step, value)
export function byId(id)
```

---

## Design note: curves interaction for touch

Do NOT default to a desktop-style drag-the-graph curves editor for mobile. Snapseed's own most recent redesign moved away from classic curve graphs to arc-based sliders for touch, and for good reason: precise point dragging on a small touch screen is error-prone.

Recommended approach:
- Show a simplified curves representation (not a full editable graph).
- Expose the curve via **two or three meaningful sliders** that correspond to control points at standard positions: Blacks (low end), Mids (midpoint), Highlights (high end) — each slider moves that point up/down on the curve. This covers 95% of what photographers do with curves without requiring precise graph touch.
- Optionally show a read-only curve preview graph that updates as sliders move.
- Full per-point drag on the graph can be a "tap to enable advanced edit" mode, visible but not the default interaction.

Internally, the `curves` adjustment type stores `points: [[x,y], ...]` — the slider approach just creates 3-point curves. This keeps the data model flexible even if the initial UI is simplified.

---

## Implementation steps

### 1. Extend the WebGL shader in glAdjust.js

Add uniforms for the new scalar adjustments:
```glsl
uniform float u_vibrance;     // -1..1
uniform float u_temperature;  // -1..1 (negative = cool/blue, positive = warm/orange)
uniform float u_tint;         // -1..1 (negative = green, positive = magenta)
uniform float u_highlights;   // -1..1
uniform float u_shadows;      // -1..1
```

Fragment shader math for each:

**Vibrance** (protects already-saturated pixels):
```glsl
float maxC = max(max(c.r, c.g), c.b);
float minC = min(min(c.r, c.g), c.b);
float sat = maxC - minC;
float boost = u_vibrance * (1.0 - sat);
float lum2 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
c.rgb = mix(vec3(lum2), c.rgb, 1.0 + boost);
```

**Temperature** (shift toward warm/cool):
```glsl
c.r += u_temperature * 0.15;
c.b -= u_temperature * 0.15;
```

**Tint** (shift toward green/magenta):
```glsl
c.g -= u_tint * 0.1;
c.r += u_tint * 0.05;
c.b += u_tint * 0.05;
```

**Highlights** (pull down bright areas):
```glsl
float lum3 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
float hiMask = smoothstep(0.5, 1.0, lum3);
c.rgb += u_highlights * hiMask * (-0.3);
```

**Shadows** (lift dark areas):
```glsl
float loMask = 1.0 - smoothstep(0.0, 0.5, lum3);
c.rgb += u_shadows * loMask * 0.3;
```

All clamped to `[0, 1]` at the end.

### 2. Curves implementation

When a `curves` adjustment is present:
1. Interpolate the control `points` using a monotone cubic spline (or simple linear interpolation for a simpler first pass) to produce a 256-entry LUT.
2. Upload the LUT as a `LUMINANCE` or `RGBA` 1D texture (use a 256×1 texture — WebGL1 doesn't have true 1D textures).
3. In the fragment shader, sample the LUT: `c.rgb = texture2D(u_lut, vec2(c.r, 0.5)).r;` — apply per-channel or to all channels depending on `channel`.

Add a second shader program or extend the existing one with the LUT sampling. Using a second pass (render to FBO, then apply LUT shader) keeps concerns separate and is easier to debug.

### 3. HSL per-range implementation

Add a separate shader pass for HSL. The HSL shader:
- Converts RGB to HSL.
- For each of the 8 color ranges (defined by hue center + feather), computes a weight for the current pixel's hue.
- Applies the H, S, L adjustments weighted by that range's weight.
- Converts back to RGB.

Use an `_hslProg` program initialized alongside `_prog`. Run it as a second sequential pass after the main adjustments pass, only if any HSL adjustments are present.

### 4. Auto-enhance

Auto-enhance analyzes the layer's source image histogram and returns a suggested `adjustments` array:
1. Read pixel data from the source canvas via `ctx.getImageData()`.
2. Compute average luminance, channel histograms.
3. If the image is underexposed (average luminance < 0.4), add a brightness adjustment.
4. If the dynamic range is compressed (max-min in luminance < 0.6), add contrast.
5. If the average saturation is low, add a saturation boost.
6. Apply the resulting adjustments array to `layer.adjustments`.

Add an "Auto" button in the adjustments UI that calls this function and then calls `clearAdjustCache()` + `scheduleRender()` + `pushHistory('Auto enhance')`.

### 5. Adjustment picker UI

The current `imageProps.js` adjustment section shows sliders for brightness/contrast/saturation and a basic "Add adjustment" picker. Extend to:
- **Group the picker** into three labeled categories:
  - **Tone**: Brightness, Contrast, Highlights, Shadows, Curves
  - **Color**: Saturation, Vibrance, Temperature, Tint, HSL
  - These don't need to be separate accordions — a simple grouped `<select>` or a two-column button grid works fine.
- **Per-type slider UIs**:
  - Scalar types: a `rangeRow` as currently implemented.
  - Curves: the simplified slider approach (Blacks, Mids, Highlights sliders) with optional graph preview.
  - HSL: a color-range selector (tabs or chips for each of the 8 ranges) plus H/S/L sliders beneath it.

The adjustment section is always visible but starts empty per the Phase 0 design. No adjustment type gets its own permanent slider area outside this one picker.

---

## Migration

New adjustment types are just new entries in the `adjustments` array — no migration needed. Old saved projects without these types will simply have an empty or partial `adjustments` array, which is already the correct default.

For HSL: `{ type: 'hsl', hue: 0, saturation: 0, luminance: 0, range: 'reds' }` — if an old project has no HSL entries, the shader won't apply any (correct behavior). No migration needed.

---

## How to run tests

```bash
cd /home/lumi/Projects/MemeLab
python3 -m http.server 8731 &
python3 tests/test_full.py
```

The existing suite has 62 tests. Add new test cases covering:
- Adding a vibrance adjustment updates `layer.adjustments` correctly.
- Adding a temperature adjustment renders without errors.
- Curves with 3 control points produces a valid export.
- HSL adjustment for 'reds' renders without errors.
- Auto-enhance adds at least one adjustment entry for a poorly-exposed test image.
- All new adjustment types: export produces a valid PNG of the same dimensions.
- Undo after each new adjustment type reverts `layer.adjustments`.

All 62 existing tests must remain green.

---

## Hard constraints (never violate)

- Do NOT change the call-site shapes of `renderScene()`, `renderLayersToCtx()`, `exportPng()`, the thumbnail renderer, or `mergeLayerDown()`.
- All new adjustment complexity lives inside `glAdjust.js` and `imageProps.js` — it does not leak to callers.
- Call `clearAdjustCache()` after every mutation of `layer.adjustments`.
- No future adjustment type gets its own permanent slider area outside the single "Adjustments" section in `imageProps.js`.
- Defensive access: `layer.adjustments || []`, `layer.blendMode || 'normal'`, `layer.mask?.enabled`.

---

## When done

1. Write a complete write-up to `docs/build-notes/track-a.md` in your worktree: what you built, key design decisions, any deviations from this prompt, files touched, known issues/TODOs, how you tested it.
2. Commit that file as part of your branch, alongside the feature work.
3. Report back exactly: status (done/blocked), the output of `git diff --stat` (not the full diff body), and a one-line pointer to the notes file. Nothing else.
