import * as THREE from 'three';

// ============================================================================
// Clouds V2 — billowy weather-map cumulus (the ThreeTerrain "Realistic V2"
// look) on the planet's spherical cloud shell. Selected with
// params.cloudModel = 'v2'; the classic model is untouched.
//
// Two baked, mip-mapped, tileable volumes (shared per renderer, built on first
// use by PlanetPipeline):
//   noise    128^3 RGBA8  r = Perlin-Worley (billowy bodies)
//                         g / b / a = Worley fbm at 4 / 8 / 16 cells (erosion)
//   weather  128^3 RGBA8  r = Perlin fbm, g = Worley cells, b = second Perlin
//
// The flat original reads a 2D weather map; on a sphere any 2D projection
// seams or pinches, so the weather is baked as a 3D tile and sampled at the
// cloud base radius: a seamless 2D slice of it wraps the planet. The planet's
// own weather cubemap and regional systems (storms, hurricanes, fronts) still
// set WHERE the sky is cloudy; V2 decides what those clouds look like.
//
// The shaders are in surfaceGLSL.js (density field, shared with the terrain
// shadows) and PlanetPipeline.js (the raymarch pass).
// ============================================================================

export const NOISE_V2_SIZE = 128;
export const WEATHER_V2_SIZE = 128;

// Tileable gradient / cellular noise. The zero-valued uLoopGuard keeps the
// cell loops real loops on ANGLE/D3D (FXC otherwise unrolls 243 cell visits).
const NOISE_GEN_GLSL = /* glsl */ `
precision highp float;
uniform int uLoopGuard;
uniform float uLayer;
uniform float uSize;

float nv2Sat(float x) { return clamp(x, 0.0, 1.0); }
float nv2Remap(float v, float a, float b, float c, float d) {
  return c + (v - a) / (b - a) * (d - c);
}

uvec3 nv2Pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 nv2Hash33(vec3 p) {
  return vec3(nv2Pcg3(uvec3(ivec3(p)))) * (1.0 / 4294967296.0);
}

float nv2Grad(vec3 i, vec3 f, vec3 o, float per) {
  return dot(nv2Hash33(mod(i + o, per) + per * 3.0) * 2.0 - 1.0, f - o);
}

float nv2Perlin(vec3 x, float per) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = mix(
    mix(nv2Grad(i, f, vec3(0.0, 0.0, 0.0), per), nv2Grad(i, f, vec3(1.0, 0.0, 0.0), per), u.x),
    mix(nv2Grad(i, f, vec3(0.0, 1.0, 0.0), per), nv2Grad(i, f, vec3(1.0, 1.0, 0.0), per), u.x),
    u.y);
  float b = mix(
    mix(nv2Grad(i, f, vec3(0.0, 0.0, 1.0), per), nv2Grad(i, f, vec3(1.0, 0.0, 1.0), per), u.x),
    mix(nv2Grad(i, f, vec3(0.0, 1.0, 1.0), per), nv2Grad(i, f, vec3(1.0, 1.0, 1.0), per), u.x),
    u.y);
  return mix(a, b, u.z);
}

float nv2Worley(vec3 x, float per) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float md = 1e9;
  for (int a = -1; a <= 1 + uLoopGuard; a++)
  for (int b = -1; b <= 1 + uLoopGuard; b++)
  for (int c = -1; c <= 1 + uLoopGuard; c++) {
    vec3 o = vec3(float(a), float(b), float(c));
    vec3 h = nv2Hash33(mod(i + o + per, per) + per * 5.0);
    vec3 r = o + h - f;
    md = min(md, dot(r, r));
  }
  return nv2Sat(1.0 - sqrt(md));
}

float nv2PerlinFbm(vec3 p, float per, int octaves) {
  float amp = 1.0;
  float sum = 0.0;
  for (int i = 0; i < 6 + uLoopGuard; i++) {
    if (i >= octaves) break;
    sum += amp * nv2Perlin(p * per, per);
    per *= 2.0;
    amp *= 0.55;
  }
  return sum;
}

float nv2WorleyFbm(vec3 p, float per) {
  return nv2Worley(p * per, per) * 0.625
    + nv2Worley(p * per * 2.0, per * 2.0) * 0.25
    + nv2Worley(p * per * 4.0, per * 4.0) * 0.125;
}
`;

export const NOISE_V2_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
void main() {
  vec3 p = vec3(gl_FragCoord.xy, uLayer + 0.5) / uSize;
  float perlin = nv2Sat(0.5 + 0.62 * nv2PerlinFbm(p, 4.0, 6));
  float w0 = nv2WorleyFbm(p, 4.0);
  float w1 = nv2WorleyFbm(p, 8.0);
  float w2 = nv2WorleyFbm(p, 16.0);
  // Perlin dilated by Worley: connected billowy bodies
  gl_FragColor = vec4(nv2Remap(perlin, 0.0, 1.0, w0, 1.0), w0, w1, w2);
}
`;

// The flat weather map, extended to a 3D tile with the same channels and
// cell counts per tile
export const WEATHER_V2_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
void main() {
  vec3 p = vec3(gl_FragCoord.xy, uLayer + 0.5) / uSize;
  float perlin = nv2Sat(0.5 + 0.75 * nv2PerlinFbm(p, 3.0, 5));
  float cells = nv2Worley(p * 6.0, 6.0) * 0.50
    + nv2Worley(p * 13.0, 13.0) * 0.32
    + nv2Worley(p * 29.0, 29.0) * 0.18;
  float perlinB = nv2Sat(0.5 + 0.75 * nv2PerlinFbm(p + vec3(0.31, 0.57, 0.5), 5.0, 4));
  gl_FragColor = vec4(perlin, cells, perlinB, 1.0);
}
`;

/** A tileable, mip-mapped RGBA8 volume target (mips are built after the bake). */
export function createVolumeV2Target(size) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false });
  const t = rt.texture;
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  // three (r160) only builds 2D / cube render-target mips: PlanetPipeline
  // calls generateMipmapsV2() once the last layer is drawn
  t.generateMipmaps = false;
  return rt;
}

/** gl.generateMipmap on a baked 3D target (three r160 binds TEXTURE_2D for it). */
export function generateMipmapsV2(renderer, rt) {
  const gl = renderer.getContext();
  const tex = renderer.properties.get(rt.texture).__webglTexture;
  if (!tex || !gl.TEXTURE_3D) return;
  renderer.state.bindTexture(gl.TEXTURE_3D, tex);
  gl.generateMipmap(gl.TEXTURE_3D);
  renderer.state.unbindTexture();
}

// ---------------------------------------------------------------------------
// Uniform derivation. The reference look is authored in metres for a 1350 m
// thick layer; `unit` rescales it to the planet's shell, so the same
// sliders read the same at any radius / thickness.
// ---------------------------------------------------------------------------
const REFERENCE_THICKNESS = 1350;
const REFERENCE_NOISE_TILE = 4300;
const REFERENCE_WEATHER_TILE = 26000;
const REFERENCE_WARP = 1500;
// optical depth of a full-thickness column at density 1 (planet default 0.8)
const REFERENCE_OPTICAL_DEPTH = 0.036 * REFERENCE_THICKNESS;
const DEFAULT_DENSITY = 0.8;
const DEFAULT_SOFTNESS = 0.18;
const DEFAULT_DETAIL = 0.7;
const DEFAULT_TOWERING = 0.55;

export function createCloudV2Uniforms() {
  return {
    uCloudModel:     { value: 0 },        // 0 classic, 1 v2
    uNoiseV2:        { value: null },
    uWeatherV2:      { value: null },
    uV2WeatherFreq:  { value: 1e-3 },     // weather tiles per world unit
    uV2NoiseFreq:    { value: 1e-2 },     // shape-noise tiles per world unit
    uV2Warp:         { value: 0.05 },     // billow warp of the weather lookup (tiles)
    uV2Edge:         { value: 0.22 },     // coverage ramp width
    uV2Detail:       { value: 1 },        // erosion strength
    uV2TopMin:       { value: 0.42 },     // lowest top of a thin cloud (0..1)
    uV2Contrast:     { value: 0.78 },
    uV2Sigma:        { value: 1 },        // extinction per world unit at density 1
    uV2Drift:        { value: new THREE.Vector4() },   // xyz wind drift (world), w evolution (noise tiles)
    uV2Seed:         { value: new THREE.Vector3() },
  };
}

function seedOffsetV2(seed) {
  // three decorrelated offsets in [0, 1) tiles from the integer seed
  let s = (Number(seed) >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [next(), next(), next()];
}

/**
 * Per-frame V2 uniforms from the planet params. `thick` = shell thickness
 * (world units), `ct` = the planet's integrated cloud clock.
 */
export function applyCloudV2Uniforms(u, p, thick, ct) {
  u.uCloudModel.value = p.cloudModel === 'v2' ? 1 : 0;
  if (p.cloudModel !== 'v2') return;
  const unit = thick / REFERENCE_THICKNESS;
  const cell = Math.max(0.1, p.cloudCellSize ?? 1);
  const billow = Math.max(0.1, p.cloudDetailScale ?? 1);
  u.uV2WeatherFreq.value = 1 / (REFERENCE_WEATHER_TILE * unit * cell);
  u.uV2NoiseFreq.value = 1 / (REFERENCE_NOISE_TILE * unit * billow);
  u.uV2Warp.value = (REFERENCE_WARP / REFERENCE_WEATHER_TILE) * billow / cell;
  u.uV2Edge.value = THREE.MathUtils.clamp(0.22 * p.cloudSoftness / DEFAULT_SOFTNESS, 0.04, 0.6);
  u.uV2Detail.value = Math.min(1.9, p.cloudDetail / DEFAULT_DETAIL);
  u.uV2TopMin.value = THREE.MathUtils.clamp(0.42 + (p.cloudTowering - DEFAULT_TOWERING) * 0.8, 0.15, 0.98);
  u.uV2Contrast.value = 0.78;
  u.uV2Sigma.value = REFERENCE_OPTICAL_DEPTH / Math.max(thick, 1e-4) * (p.cloudDensity / DEFAULT_DENSITY);
  const seed = seedOffsetV2(p.seed);
  u.uV2Seed.value.set(seed[0], seed[1], seed[2]);
  // drift: formations cross about one cell per ~90 cloud seconds, and
  // evolve (move through the noise volume) a little slower
  const weatherTile = REFERENCE_WEATHER_TILE * unit * cell;
  const drift = ct * weatherTile * 0.0019;
  u.uV2Drift.value.set(drift, drift * 0.21, -drift * 0.55, ct * 0.0045);
}
