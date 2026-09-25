import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL, ATMOSPHERE_GLSL, CLOUD_FIELD_GLSL, SURFACE_GLSL } from './surfaceGLSL.js';
import { STAR_CORONA_GLSL } from './star.js';

// ============================================================================
// PlanetPipeline — deferred, physically based planet rendering.
//
//   1. scene pass   terrain (and gas / star bodies) -> HDR colour + float depth
//   2. cloud pass   volumetric raymarch of the cloud shell (scaled resolution)
//                   against the scene depth; weather cubemap + 3D Perlin-Worley
//   3. composite    analytic ocean sphere (Beer-Lambert water column from the
//                   real seabed depth, GGX glint with footprint-filtered wave
//                   slopes, shore foam + whitecaps), clouds, single-scattering
//                   Rayleigh/Mie/ozone atmosphere, stars, ACES tone map, sRGB
//   4. bloom        (star mode) the composite stays linear HDR; a dual-filter
//                   mip chain spreads the overexposed disc into glare, then
//                   the final pass tone maps
//
// Baked helpers (re-baked only when their inputs change):
//   transmittance LUT (256x64)   sun colour through the air at any altitude
//   weather cubemap (512/face)   cloud field — also drives terrain shadows;
//                                re-baked one face per frame as it evolves
//   noise volume (128^3)         tileable Perlin-Worley + Worley fbm detail
//
// Gas mode goes through the same path as the planet (no ocean / clouds): its
// sphere and rings write linear HDR and the atmosphere uniforms describe the
// giant's haze layer. Star mode adds the chromosphere / prominences / corona
// around the disc, then bloom. The scene target's alpha holds how much of the
// background shows through (1 - ring coverage) so stars dim behind the rings.
// ============================================================================

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const TONEMAP_GLSL = /* glsl */ `
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

const NOISE_VOLUME_SIZE = 64;
const EROSION_VOLUME_SIZE = 64;
const WEATHER_SIZE = 512;
const MAX_CLOUD_STEPS = 128;

// ---------------------------------------------------------------------------
// Transmittance LUT: x = sun zenith cosine, y = altitude through the air.
// Quadratic sample spacing crowds samples into the dense low air.
// ---------------------------------------------------------------------------
const LUT_FRAGMENT = /* glsl */ `
precision highp float;
${TOON_GLSL}
${ATMOSPHERE_GLSL}

void main() {
  float mu = floor(gl_FragCoord.x) / (LUT_SIZE.x - 1.0) * 2.0 - 1.0;
  float y = floor(gl_FragCoord.y) / (LUT_SIZE.y - 1.0);
  float H = max(uAtmoTop - uAtmoGround, 1e-3);
  float r = uAtmoGround + max(y, 0.002) * H;
  float muH = -sqrt(max(1.0 - (uAtmoGround * uAtmoGround) / (r * r), 0.0));
  float m = max(mu, muH + 0.004);

  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(sqrt(max(1.0 - m * m, 0.0)), m, 0.0);
  float tTop = max(raySphere(ro, rd, uAtmoTop).y, 0.0);
  vec3 od = vec3(0.0);
  const int N = 48;
  for (int i = 0; i < N; i++) {
    float a = float(i) / float(N);
    float b = float(i + 1) / float(N);
    float t0 = tTop * a * a;
    float t1 = tTop * b * b;
    vec3 p = ro + rd * (0.5 * (t0 + t1));
    float h = max(length(p) - uAtmoGround, 0.0);
    od += (uAtmoRayleigh * exp(-h / uAtmoHR) + vec3(uAtmoMie * 1.11 * exp(-h / uAtmoHM))
         + uAtmoOzone * ozoneDensity(h)) * (t1 - t0);
  }
  // planet shadow with a soft penumbra (sun disc + refraction smear)
  float lit = smoothstep(muH - 0.035, muH + 0.012, mu);
  gl_FragColor = vec4(exp(-od) * lit, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Weather cubemap. Faces follow the GL cube-map convention so a plain
// textureCube(dir) lookup lands on the texel baked for dir.
// ---------------------------------------------------------------------------
const WEATHER_FRAGMENT = /* glsl */ `
precision highp float;
#define OCTAVES 6
${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}

uniform float uFace;
uniform float uFaceSize;
uniform float uCloudScale;
uniform float uWeatherTime;

vec3 faceDir(float face, vec2 st) {
  if (face < 0.5) return vec3(1.0, -st.y, -st.x);
  if (face < 1.5) return vec3(-1.0, -st.y, st.x);
  if (face < 2.5) return vec3(st.x, 1.0, st.y);
  if (face < 3.5) return vec3(st.x, -1.0, -st.y);
  if (face < 4.5) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}

float fbmN(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * gnoise(p);
    n += a;
    a *= 0.52;
    p = OCT_ROT * p * 2.03;
  }
  return s / n;
}

void main() {
  vec2 st = gl_FragCoord.xy / uFaceSize * 2.0 - 1.0;
  vec3 d = normalize(faceDir(uFace, st));
  float t = uWeatherTime;

  // systems are stretched east-west (zonal flow)
  vec3 p = d * uCloudScale * vec3(1.0, 1.7, 1.0) + uSeedOffset * 0.37;

  // two-level evolving swirl warp: fronts curl, cyclones wind up
  vec3 q = vec3(fbmN(p * 0.55 + vec3(0.0, 0.0, t), 3),
                fbmN(p * 0.55 + vec3(5.2, 1.3, -t), 3),
                fbmN(p * 0.55 + vec3(2.8, 7.7, t * 0.7), 3));
  vec3 pw = p + q * 3.2;
  float f = fbmN(pw + vec3(t * 0.3, 0.0, -t * 0.2), 6);
  // frontal bands: long narrow ridges of a second warped field
  float fb = 1.0 - abs(fbmN(pw * 0.7 + vec3(19.1, 7.3, 3.9) - vec3(0.0, t * 0.2, 0.0), 5)) * 5.5;

  // Hadley / Ferrel circulation: cloudy ITCZ and storm tracks, clear
  // subtropical highs
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float cells = cos(lat * 6.0);
  float v = 0.47 + f * 1.6 + max(fb, 0.0) * 0.2 + cells * 0.05;

  // cloud type: tall convective cells (tropics) vs flat stratiform decks
  float type = clamp(0.45 + gnoise(p * 1.6 + 31.0) * 1.3 + (1.0 - abs(d.y)) * 0.25 - 0.12, 0.0, 1.0);

  gl_FragColor = vec4(clamp(v, 0.0, 1.0), type, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Tileable 3D noise volumes (one layer per draw). The shaders only ever use
// the Worley octaves as one weighted sum, so it is baked pre-summed:
//   r = Worley fbm (4 / 8 / 16 cells, 0.625 / 0.25 / 0.125), g = Perlin-Worley
// The shape volume is RG8 (both), the detail volume R8 (Worley fbm only):
// 2 and 1 bytes per texel instead of 4 keep the raymarch's scattered fetches
// in cache.
// ---------------------------------------------------------------------------
const NOISE_VOLUME_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uLayer;
uniform float uSize;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float worleyTile(vec3 p, float F) {
  vec3 q = p * F;
  vec3 i = floor(q);
  vec3 f = fract(q);
  float d = 1.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(mod(i + g, F) + 13.7);
    vec3 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}

float gradTile(vec3 p, float F) {
  vec3 q = p * F;
  vec3 i = floor(q);
  vec3 f = fract(q);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define G(c) dot(hash33(mod(i + c, F)) * 2.0 - 1.0, f - c)
  float v000 = G(vec3(0.0, 0.0, 0.0)), v100 = G(vec3(1.0, 0.0, 0.0));
  float v010 = G(vec3(0.0, 1.0, 0.0)), v110 = G(vec3(1.0, 1.0, 0.0));
  float v001 = G(vec3(0.0, 0.0, 1.0)), v101 = G(vec3(1.0, 0.0, 1.0));
  float v011 = G(vec3(0.0, 1.0, 1.0)), v111 = G(vec3(1.0, 1.0, 1.0));
  #undef G
  return mix(mix(mix(v000, v100, u.x), mix(v010, v110, u.x), u.y),
             mix(mix(v001, v101, u.x), mix(v011, v111, u.x), u.y), u.z);
}

float worleyFbm(vec3 p, float F) {
  return worleyTile(p, F) * 0.625 + worleyTile(p, F * 2.0) * 0.25 + worleyTile(p, F * 4.0) * 0.125;
}

void main() {
  vec3 p = vec3(gl_FragCoord.xy, uLayer + 0.5) / uSize;
  float perlin = gradTile(p, 4.0) + 0.5 * gradTile(p, 8.0) + 0.25 * gradTile(p, 16.0);
  perlin = clamp(0.5 + perlin * 0.75, 0.0, 1.0);
  float w1 = worleyFbm(p, 4.0);
  // Perlin dilated by Worley: billowy cells with connected bodies
  float pw = clamp((perlin - (w1 - 1.0)) / (2.0 - w1), 0.0, 1.0);
  float low = w1 * 0.625 + worleyFbm(p, 8.0) * 0.25 + worleyFbm(p, 16.0) * 0.125;
  gl_FragColor = vec4(low, pw, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Volumetric clouds
// ---------------------------------------------------------------------------
const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler3D;
${NOISE_UNIFORMS_GLSL}
${TOON_GLSL}
${ATMOSPHERE_GLSL}
${CLOUD_FIELD_GLSL}

uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uCloudRes;
uniform float uCloudSteps;
uniform float uCloudDetail;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;

float remap(float v, float a, float b, float c, float d) {
  return c + (v - a) / max(b - a, 1e-5) * (d - c);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// density at world point p (0..1); hf = height fraction in the shell
float cloudDensity(vec3 p, bool detail, out float hf) {
  float r = length(p);
  hf = (r - uCloudBottom) / (uCloudTop - uCloudBottom);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec3 dr = cloudRotate(p / r);
  vec4 w = textureLod(uWeatherMap, dr, 0.0);
  float cov = cloudCover(w);
  if (cov < 0.01) return 0.0;

  // vertical profile: flat bases, rounded tops; convective cells and dense
  // cover build taller
  float top = mix(0.3, 1.0, sat(w.g * 0.75 + cov * 0.45));
  float prof = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(top * 0.45, top, hf));
  if (prof <= 0.0) return 0.0;

  vec3 pr = dr * r;   // move the detail with the weather
  vec2 n = textureLod(uCloudNoise, pr * uCloudShapeFreq + uCloudWind * 0.35, 0.0).rg;
  float base = sat(remap(n.y, n.x - 1.0, 1.0, 0.0, 1.0));
  // profile BEFORE the coverage remap: each column gets its own top height
  // (cauliflower tops); coverage thresholds the billows so system fringes
  // break into cumulus fields, and scales density so they turn translucent
  float dens = sat(remap(base * prof, 1.0 - cov, 1.0, 0.0, 1.0)) * cov;
  if (!detail || dens <= 0.0) return dens;

  // erosion: wispy bottoms, billowy tops
  float hfb = textureLod(uCloudErosion, pr * uCloudDetailFreq + uCloudWind, 0.0).r;
  float m = mix(hfb, 1.0 - hfb, sat(hf * 4.0));
  return sat(remap(dens, m * 0.8 * uCloudDetail, 1.0, 0.0, 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uCloudRes;
  float depth = textureLod(tDepth, uv, 0.0).x;
  vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(wp - ro);
  float sceneT = depth >= 1.0 ? 1e20 : length(wp - ro);

  vec2 tOut = raySphere(ro, rd, uCloudTop);
  if (tOut.x > tOut.y || tOut.y < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 tIn = raySphere(ro, rd, uCloudBottom);
  bool hitsIn = tIn.x < tIn.y && tIn.x > 0.0;
  float camR = length(ro);
  float t0, t1;
  if (camR > uCloudTop)          { t0 = tOut.x; t1 = hitsIn ? tIn.x : tOut.y; }
  else if (camR > uCloudBottom)  { t0 = 0.0;    t1 = hitsIn ? tIn.x : tOut.y; }
  else                           { t0 = tIn.y;  t1 = tOut.y; }
  t1 = min(t1, sceneT);
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float thick = uCloudTop - uCloudBottom;
  float len = t1 - t0;
  float steps = clamp(len / (thick * 0.035), 24.0, uCloudSteps);
  float ds = len / steps;
  float t = t0 + ds * ign(gl_FragCoord.xy);

  // extinction per world unit: a full-thickness dense column is ~OD 14
  float sigma = 14.0 / thick * uCloudDensity;
  float cosT = dot(rd, uSunDir);
  vec3 tint = srgbToLinear(uCloudColor);
  vec3 ambTint = srgbToLinear(uCloudShadow);
  // multiple-scattering octaves (Wrenninge): light survives deep inside,
  // forward lobe gives silver linings, back lobe keeps sides lit. The phase
  // of each octave only depends on the view / sun angle: evaluated once.
  vec3 msPh = vec3(mix(phaseHG(cosT, 0.7), phaseHG(cosT, -0.25), 0.4),
                   mix(phaseHG(cosT, 0.35), phaseHG(cosT, -0.125), 0.4) * 0.5,
                   mix(phaseHG(cosT, 0.175), phaseHG(cosT, -0.0625), 0.4) * 0.25);

  float T = 1.0;
  vec3 L = vec3(0.0);
  for (int i = 0; i < ${MAX_CLOUD_STEPS}; i++) {
    if (float(i) >= steps || T < 0.01) break;
    vec3 p = ro + rd * t;
    float hf;
    float dens = cloudDensity(p, true, hf);
    if (dens > 0.003) {
      // light march toward the sun (cone-ish growing steps)
      float odL = 0.0;
      float ls = thick * 0.06;
      vec3 lp = p;
      for (int j = 0; j < 5; j++) {
        lp += uSunDir * ls;
        float hj;
        odL += cloudDensity(lp, j < 2, hj) * ls;
        ls *= 1.6;
      }
      odL *= sigma;

      float ms = dot(msPh, exp(-odL * vec3(1.0, 0.55, 0.3025)));
      // powder: dark crevices where light has not diffused in yet
      float powder = 1.0 - exp(-dens * sigma * thick * 0.15);
      vec3 sunC = sunIrradiance(p);
      vec3 amb = skyIrradiance(p, normalize(p)) / PI * mix(0.45, 1.0, hf) * ambTint;
      vec3 S = (sunC * ms * mix(0.45, 1.0, powder) * 2.8 + amb * 1.1) * tint;

      float Tr = exp(-dens * sigma * ds);
      L += T * S * (1.0 - Tr);
      T *= Tr;
    }
    t += ds;
  }
  gl_FragColor = vec4(L, T);
}
`;

// ---------------------------------------------------------------------------
// Composite: ocean + clouds + atmosphere + stars + tone mapping
// ---------------------------------------------------------------------------
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
#define OCTAVES 4
${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${ATMOSPHERE_GLSL}
${CLOUD_FIELD_GLSL}
${SURFACE_GLSL}
${STAR_CORONA_GLSL}

uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tClouds;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uPixelAngle;
uniform float uMode;            // 0 planet, 1 gas, 2 star
uniform float uHDROut;          // 1 = write linear HDR (bloom follows)
uniform float uWaterOn;
uniform float uCloudsOn;
uniform float uExposure;
uniform vec2 uCloudTexel;

uniform float uSeaRadius;
uniform vec3  uWaterAbsorb;
uniform float uWaveSize;
uniform float uWaveHeight;
uniform float uWaveSpeed;
uniform float uWaterSpec;
uniform float uFoamWidth;
uniform float uFoamAmount;
uniform float uWhitecaps;
uniform float uWaterEmissive;

varying vec2 vUv;

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// ---- stars: point sources with sub-pixel gaussian footprints ---------------
vec3 starField(vec3 rd) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 3; l++) {
    float N = 70.0 * pow(1.9, float(l));
    vec3 q = rd * N + float(l) * 31.7;
    vec3 cell = floor(q);
    if (hash13(cell + 7.0) > 0.045) continue;
    vec3 sp = cell + 0.3 + 0.4 * vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1));
    vec3 sd = normalize(sp - float(l) * 31.7);
    float px = length(cross(sd, rd)) / uPixelAngle;
    float mag = pow(hash13(cell + 9.1), 10.0) * 5.0 + 0.06;
    mag /= 1.0 + float(l) * 0.8;
    float temp = hash13(cell + 3.3);
    vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.62, 0.78, 1.0), temp);
    tint = mix(tint, vec3(1.0), 0.45);
    col += tint * mag * exp(-px * px * 1.4);
  }
  // faint galactic band
  vec3 gp = normalize(vec3(0.35, 0.82, -0.45));
  float band = exp(-pow(dot(rd, gp) / 0.22, 2.0));
  // off the band its dust is far below one display level: skip the noise
  if (band > 0.01) {
    float dust = 0.5 + 0.5 * gnoise(rd * 9.0) + 0.25 * gnoise(rd * 23.0);
    col += vec3(0.55, 0.6, 0.75) * band * dust * 0.012;
  }
  return col * 0.25;
}

vec3 sunDisc(vec3 rd) {
  float c = dot(rd, uSunDir);
  float disc = smoothstep(0.999965, 0.999985, c) * 300.0;
  float th2 = max(2.0 * (1.0 - c), 0.0);           // ~angle^2
  float glow = exp(-th2 / 1.2e-4) * 2.5 + exp(-th2 / 4e-3) * 0.05;
  return vec3(1.0, 0.97, 0.92) * (disc + glow) * uSunIntensity;
}

// ---- single-scattering atmosphere along the view ray -----------------------
vec3 atmosphere(vec3 ro, vec3 rd, float tMax, out vec3 transmittance) {
  transmittance = vec3(1.0);
  if (uAtmoOn < 0.5) return vec3(0.0);
  vec2 ta = raySphere(ro, rd, uAtmoTop);
  if (ta.x > ta.y || ta.y < 0.0) return vec3(0.0);
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, tMax);
  if (t1 <= t0) return vec3(0.0);

  const int N = 24;
  float ds = (t1 - t0) / float(N);
  float jit = ign(gl_FragCoord.xy + 17.0);
  vec3 od = vec3(0.0);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float t = t0 + (float(i) + jit) * ds;
    vec3 p = ro + rd * t;
    float r = length(p);
    float h = max(r - uAtmoGround, 0.0);
    float dR = exp(-h / uAtmoHR);
    float dM = exp(-h / uAtmoHM);
    vec3 stepOD = (uAtmoRayleigh * dR + vec3(uAtmoMie * 1.11 * dM) + uAtmoOzone * ozoneDensity(h)) * ds;
    vec3 Tv = exp(-(od + stepOD * 0.5));
    vec3 Ts = atmoTransmittance(r, dot(p, uSunDir) / r);
    sumR += dR * Tv * Ts * ds;
    sumM += dM * Tv * Ts * ds;
    od += stepOD;
  }
  transmittance = exp(-od);
  float mu = dot(rd, uSunDir);
  vec3 E = vec3(SUN_E * uSunIntensity);
  return E * (uAtmoRayleigh * sumR * phaseRayleigh(mu) + uAtmoMie * sumM * phaseHG(mu, 0.76));
}

// ---- ocean -----------------------------------------------------------------
// Waves: 6 octaves of gradient noise in WORLD units (wavelengths are to
// scale). Deep-water dispersion: long waves travel faster. Octaves smaller
// than ~2 px fold their slope variance into the GGX roughness, so from orbit
// the ocean shows a broad, correct sun glint; up close, individual waves.
vec3 oceanNormal(vec3 P, vec3 N, float fp, float wind, out float rough, out float crest) {
  float t = uTime * uWaveSpeed;
  vec3 windDir = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-4, 0.0, 0.0));
  vec3 slope = vec3(0.0);
  float lost = 0.0;
  crest = 0.0;
  float wl = max(uWaveSize, 0.01);
  float amp = 1.0;
  for (int i = 0; i < 6; i++) {
    float f = 1.0 / wl;
    float fade = 1.0 - smoothstep(0.18, 0.45, f * fp);
    if (fade <= 0.0) {
      // sub-pixel octave (and all finer ones): only its slope variance
      // survives, folded into the roughness
      lost += amp * amp;
      wl *= 0.53;
      amp *= 0.9;
      continue;
    }
    float travel = sqrt(wl) * t * 0.9;
    vec3 q = (P - windDir * travel) * f + float(i) * vec3(7.13, 3.31, 5.97)
           + N * (t * 0.22 * sqrt(uWaveSize * f));
    vec4 n = gnoised(q);
    // squash along the wind so crests run across it
    vec3 g = n.yzw - windDir * dot(n.yzw, windDir) * 0.35;
    slope += g * (amp * fade);
    lost += amp * amp * (1.0 - fade);
    if (i < 2) crest += n.x * fade * (i == 0 ? 0.7 : 0.45);
    wl *= 0.53;
    amp *= 0.9;
  }
  float steep = uWaveHeight * 0.16 * mix(0.3, 1.0, wind);
  slope -= N * dot(slope, N);
  rough = sqrt(0.0016 + lost * steep * steep * 0.9);
  return normalize(N - slope * steep);
}

// lacy foam texture (ridged noise webs), footprint-filtered to its mean
float foamPattern(vec3 P, float fp, float t) {
  float s = 0.0, wsum = 0.0;
  float f = 1.0 / max(uWaveSize * 0.28, 0.005);
  float a = 1.0;
  for (int i = 0; i < 3; i++) {
    float fade = 1.0 - smoothstep(0.18, 0.45, f * fp);
    float n = 0.0;
    if (fade > 0.0) {
      n = 1.0 - abs(gnoise(P * f + vec3(t * 0.05, t * 0.03, 0.0) + float(i) * 11.7) * 2.2);
      n = clamp(n, 0.0, 1.0);
      n *= n;
    }
    s += a * mix(0.42, n, fade);
    wsum += a;
    f *= 2.4;
    a *= 0.6;
  }
  return s / wsum;
}

vec3 shadeOcean(vec3 ro, vec3 rd, float tW, float tExit, float sceneT, bool noFloor, vec3 seabed) {
  vec3 P = ro + rd * tW;
  vec3 N = normalize(P);
  vec3 V = -rd;
  float NoVm = max(dot(N, V), 0.02);
  float fp = max(tW * uPixelAngle, 1e-5) / sqrt(NoVm);
  float t = uTime * uWaveSpeed;

  // calm / rough regions — visible from orbit as texture in the sun glint
  float wind = sat(0.55 + (gnoise(P * (5.0 / uRadius) + uSeedOffset * 0.2)
                         + 0.5 * gnoise(P * (13.0 / uRadius) + 3.1)) * 1.1);

  float rough, crest;
  vec3 n = oceanNormal(P, N, fp, wind, rough, crest);
  float NoV = max(dot(n, V), 1e-3);

  // lighting at the surface
  vec3 L = uSunDir;
  float shadow = cloudShadow(P);
  vec3 sunI = sunIrradiance(P) * (1.0 - shadow);
  vec3 skyI = skyIrradiance(P, N);
  float muS = max(dot(N, L), 0.0);

  // water column: Beer-Lambert along the view path through the real depth,
  // sunlight attenuated on its way down to the seabed; single scattering
  // gives the deep-water body colour
  float pathLen = (noFloor ? tExit : sceneT) - tW;
  float vDepth = noFloor ? 1e4 : max(uSeaRadius - length(ro + rd * sceneT), 0.0);
  vec3 Tv = exp(-uWaterAbsorb * pathLen);
  vec3 Td = exp(-uWaterAbsorb * vDepth / max(muS, 0.12));
  vec3 bodyAlb = srgbToLinear(uColDeep);
  vec3 inscatter = bodyAlb * (sunI * muS + skyI) / PI * (1.0 - Tv);
  vec3 refr = (noFloor ? vec3(0.0) : seabed * Tv * Td) + inscatter;

  // reflection: sky dome (brighter toward the horizon) + GGX sun glint
  vec3 R = reflect(-V, n);
  float up = max(dot(R, N), 0.0);
  float Fv = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 skyRefl = skyIrradiance(P, N) / PI * (1.0 + 2.5 * pow(1.0 - up, 4.0));

  vec3 H = normalize(L + V);
  float NoL = max(dot(n, L), 0.0);
  float NoH = max(dot(n, H), 0.0);
  float VoH = max(dot(V, H), 0.0);
  float a2 = rough * rough;
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = rough * 0.5;
  float G = NoL / (NoL * (1.0 - k) + k) * NoV / (NoV * (1.0 - k) + k);
  float Fh = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
  vec3 spec = sunI * (D * G * Fh / (4.0 * NoV)) * uWaterSpec * step(0.0, dot(N, L));

  vec3 col = refr * (1.0 - Fv) + skyRefl * Fv + spec;

  // foam: solid band at the waterline, surf lines rolling in over the
  // shelf, whitecaps on big crests where the wind is strong
  float foam = 0.0;
  float tex = foamPattern(P, fp, t);
  if (!noFloor) {
    float fw = max(uFoamWidth * uHeightScale * 0.05, 1e-3);
    float shore = 1.0 - smoothstep(0.0, fw, vDepth - (tex - 0.45) * fw * 1.2);
    // breakers: short broken crests rolling in, only close to shore
    float phase = vDepth / fw * 1.1 - t * 0.45 + gnoise(P * (0.6 / max(uWaveSize, 0.01))) * 0.8;
    float fr = fract(phase);
    float surf = smoothstep(0.7, 0.9, fr) * (1.0 - smoothstep(0.9, 1.0, fr));
    surf = mix(surf, 0.1, smoothstep(0.15, 0.45, fwidth(phase)));
    surf *= (1.0 - smoothstep(fw * 0.8, fw * 2.2, vDepth)) * smoothstep(0.45, 0.75, tex);
    foam = max(shore, surf * 0.85) * smoothstep(0.2, 0.55, tex + shore * 0.3);
  }
  // whitecaps: small blotches streaked along the wind on the big crests
  float capFade = 1.0 - smoothstep(0.18, 0.45, fp * 2.2 / max(uWaveSize, 0.01));
  float capN = capFade > 0.0
    ? gnoise(P * (2.2 / max(uWaveSize, 0.01)) + vec3(t * 0.1, 0.0, 0.0)) * 0.5 + 0.5 : 0.0;
  capN = mix(0.35, capN, capFade);
  float caps = smoothstep(0.25, 0.55, crest) * smoothstep(0.55, 0.95, wind) * uWhitecaps
             * smoothstep(0.62, 0.8, capN + crest * 0.2);
  foam = sat((foam + caps) * uFoamAmount);
  vec3 foamCol = srgbToLinear(uColFoam) * (sunI * muS + skyI) / PI;
  col = mix(col, foamCol, foam);

  // molten seas: drifting plates of cooled crust (foam colour) with
  // glowing cracks between them; the shore and whitecap foam stay crust too
  if (uWaterEmissive > 0.001) {
    float plates = gnoise(P * (0.35 / max(uWaveSize, 0.01)) + vec3(0.0, t * 0.02, 0.0)) * 0.5
                 + gnoise(P * (1.1 / max(uWaveSize, 0.01)) - vec3(t * 0.03, 0.0, 0.0)) * 0.25;
    float crust = sat(smoothstep(-0.3, 0.0, plates) * (1.0 - smoothstep(0.55, 0.85, tex)) + foam);
    float hot = sat(0.4 + crest * 0.8 + (tex - 0.45) * 1.5);
    vec3 e = mix(srgbToLinear(uColDeep), srgbToLinear(uColShallow), hot) * 3.0;
    vec3 crustCol = srgbToLinear(uColFoam) * (sunI * muS + skyI) / PI + e * 0.04;
    col = mix(col, mix(e, crustCol, crust), uWaterEmissive);
  }

  // sea ice toward the poles
  float ice = polarIce(N, tex - 0.45 + gnoise(P * (40.0 / uRadius)) * 0.8);
  vec3 iceCol = srgbToLinear(uColSnow) * 0.85 * (1.0 + (tex - 0.45) * 0.3) * (sunI * muS + skyI) / PI;
  col = mix(col, iceCol, ice);
  return col;
}

${TONEMAP_GLSL}

void main() {
  vec4 sceneS = texture2D(tScene, vUv);
  vec3 scene = sceneS.rgb;
  float depth = texture2D(tDepth, vUv).x;
  bool bg = depth >= 1.0;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, bg ? 1.0 : depth * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(wp - ro);
  float sceneT = bg ? 1e20 : length(wp - ro);

  if (uMode > 1.5) {
    // star: emissive disc; around it the chromosphere, prominences, corona
    vec3 c = scene;
    if (bg) {
      float tc = max(-dot(ro, rd), 0.0);
      vec3 pc = ro + rd * tc;
      float b = length(pc) / uRadius;
      c += starHalo(pc, b) + starField(rd) * 0.6;
    }
    if (uHDROut > 0.5) { gl_FragColor = vec4(c, 1.0); return; }
    c = aces(c * uExposure * 0.85);
    gl_FragColor = vec4(linearToSrgb(c) + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
    return;
  }

  vec3 col = scene;
  float surfT = sceneT;

  if (uWaterOn > 0.5) {
    vec2 to = raySphere(ro, rd, uSeaRadius);
    if (to.x < to.y && to.y > 0.0) {
      float tW = max(to.x, 0.0);
      if (tW < sceneT) {
        col = shadeOcean(ro, rd, tW, to.y, sceneT, bg, scene);
        surfT = tW;
      }
    }
  }

  // background shows through whatever the scene left uncovered (ring gaps)
  if (surfT > 1e19) col = scene + (starField(rd) + sunDisc(rd)) * sceneS.a;

  if (uCloudsOn > 0.5) {
    // tent-filtered upsample of the reduced-res cloud pass: hides the
    // per-pixel raymarch jitter
    vec2 o = uCloudTexel * 0.75;
    vec4 cl = texture2D(tClouds, vUv) * 0.36
            + (texture2D(tClouds, vUv + vec2(o.x, o.y)) + texture2D(tClouds, vUv + vec2(-o.x, o.y))
             + texture2D(tClouds, vUv + vec2(o.x, -o.y)) + texture2D(tClouds, vUv + vec2(-o.x, -o.y))) * 0.16;
    col = col * cl.a + cl.rgb;
  }

  vec3 T;
  vec3 ins = atmosphere(ro, rd, surfT, T);
  col = col * T + ins;

  if (uHDROut > 0.5) { gl_FragColor = vec4(col, 1.0); return; }
  col = aces(col * uExposure * 0.85);
  col = linearToSrgb(col) + (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Bloom: dual-filter (Kawase / Bjorge) mip chain. Down taps 5, up taps 8;
// every level adds into the next larger one, the final pass tone maps
// scene + bloom.
// ---------------------------------------------------------------------------
const BLOOM_DOWN_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;       // source texel
uniform float uFirst;      // clamp fireflies on the first (full-res) level
varying vec2 vUv;
vec3 tap(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  if (uFirst > 0.5) c = min(c, vec3(60.0));
  return c;
}
void main() {
  vec2 o = uTexel;
  vec3 c = tap(vUv) * 4.0 + tap(vUv + vec2(-o.x, -o.y)) + tap(vUv + vec2(o.x, -o.y))
         + tap(vUv + vec2(-o.x, o.y)) + tap(vUv + vec2(o.x, o.y));
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

const BLOOM_UP_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;       // source (smaller level) texel
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec3 c = texture2D(tSrc, vUv + vec2(-2.0 * o.x, 0.0)).rgb
         + texture2D(tSrc, vUv + vec2( 2.0 * o.x, 0.0)).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -2.0 * o.y)).rgb
         + texture2D(tSrc, vUv + vec2(0.0,  2.0 * o.y)).rgb
         + (texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb
          + texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x,  o.y)).rgb) * 2.0;
  gl_FragColor = vec4(c / 12.0, 1.0);
}
`;

const FINAL_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tHDR;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uBloomNorm;
uniform float uExposure;
varying vec2 vUv;
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
${TONEMAP_GLSL}
float sat01(float x) { return clamp(x, 0.0, 1.0); }
void main() {
  vec3 c = texture2D(tHDR, vUv).rgb;
  vec3 b = texture2D(tBloom, vUv).rgb * uBloomNorm;
  // wide soft glare + a tighter core halo around overexposed pixels
  c += b * 0.1 * uBloom;
  // hue-preserving tone map: per-channel ACES would clip the red of a cool
  // star first and turn it yellow. Map luminance, keep the chromaticity, and
  // only let what still overflows bleach toward white.
  c *= uExposure * 0.85;
  float L = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  c *= aces(vec3(L)).x / L;
  float m = max(max(c.r, c.g), c.b);
  if (m > 1.0) c = mix(c / m, vec3(1.0), sat01((m - 1.0) * 0.6));
  gl_FragColor = vec4(linearToSrgb(c) + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}
`;

const BLOOM_LEVELS = 7;

// ============================================================================

export class PlanetPipeline {
  constructor(renderer, uniforms) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.cloudBudget = 0.5;   // user resolution scale = pixel budget
    this.cloudScale = 0.5;    // effective scale this frame
    this.width = 1;
    this.height = 1;
    this.lutDirty = true;
    this.weatherDirty = true;
    this._weatherClock = 0;
    this._noiseBaked = false;

    const halfLinear = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    };

    // scene: HDR colour + float depth (read back by the screen passes)
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      ...halfLinear,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });
    this.cloudRT = new THREE.WebGLRenderTarget(1, 1, halfLinear);
    this.lutRT = new THREE.WebGLRenderTarget(256, 64, halfLinear);
    this.lutRT.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.lutRT.texture.wrapT = THREE.ClampToEdgeWrapping;

    // r = cloud field, g = cloud type. Double buffered: while the weather
    // evolves, the next state is baked one face per frame into the back
    // buffer (no multi-millisecond hitch), then the two swap.
    const weather = { ...halfLinear, format: THREE.RGFormat };
    this.weatherRT = new THREE.WebGLCubeRenderTarget(WEATHER_SIZE, weather);
    this.weatherBackRT = new THREE.WebGLCubeRenderTarget(WEATHER_SIZE, weather);
    this._weatherFace = -1;   // next face of the back-buffer bake (-1 = idle)
    this._weatherNext = 0;    // weather time being baked into the back buffer

    const volume = (format, size) => {
      const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
        depthBuffer: false,
      });
      const t = rt.texture;
      t.format = format;
      t.type = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
      t.generateMipmaps = false;
      return rt;
    };
    this.noiseRT = volume(THREE.RGFormat, NOISE_VOLUME_SIZE);
    this.erosionRT = volume(THREE.RedFormat, EROSION_VOLUME_SIZE);

    uniforms.uTransmittanceLUT.value = this.lutRT.texture;
    uniforms.uWeatherMap.value = this.weatherRT.texture;
    uniforms.uCloudNoise.value = this.noiseRT.texture;
    uniforms.uCloudErosion.value = this.erosionRT.texture;

    // ---- passes
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    const screen = (fragmentShader, extra = {}) => new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...extra },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    this.lutMat = screen(LUT_FRAGMENT);
    this.weatherMat = screen(WEATHER_FRAGMENT, {
      uFace: { value: 0 },
      uFaceSize: { value: WEATHER_SIZE },
      uWeatherTime: { value: 0 },
    });
    this.noiseMat = screen(NOISE_VOLUME_FRAGMENT, { uLayer: { value: 0 }, uSize: { value: 1 } });

    this.view = {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      tDepth: { value: this.sceneRT.depthTexture },
    };
    this.cloudMat = screen(CLOUD_FRAGMENT, {
      ...this.view,
      uCloudRes: { value: new THREE.Vector2(1, 1) },
      uCloudSteps: { value: 64 },
    });
    this.compositeMat = screen(COMPOSITE_FRAGMENT, {
      ...this.view,
      tScene: { value: this.sceneRT.texture },
      tClouds: { value: this.cloudRT.texture },
      uPixelAngle: { value: 0.001 },
      uMode: { value: 0 },
      uHDROut: { value: 0 },
      uWaterOn: { value: 1 },
      uCloudsOn: { value: 1 },
      uCloudTexel: { value: new THREE.Vector2(1, 1) },
    });

    // bloom (allocated on first use)
    this._halfLinear = halfLinear;
    this.hdrRT = null;
    this.bloomRTs = [];
    const post = (fragmentShader, uniformsIn) => new THREE.ShaderMaterial({
      uniforms: uniformsIn,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.bloomDownMat = post(BLOOM_DOWN_FRAGMENT, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 },
    });
    this.bloomUpMat = post(BLOOM_UP_FRAGMENT, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    });
    this.bloomUpMat.blending = THREE.AdditiveBlending;
    this.bloomUpMat.transparent = true;
    this.finalMat = post(FINAL_FRAGMENT, {
      tHDR: { value: null },
      tBloom: { value: null },
      uBloom: { value: 1 },
      uBloomNorm: { value: 1 / BLOOM_LEVELS },
      uExposure: uniforms.uExposure,
    });
  }

  _ensureBloomTargets() {
    const w = this.width, h = this.height;
    if (this.hdrRT && this.hdrRT.width === w && this.hdrRT.height === h) return;
    this._disposeBloom();
    this.hdrRT = new THREE.WebGLRenderTarget(w, h, this._halfLinear);
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      const rt = new THREE.WebGLRenderTarget(bw, bh, this._halfLinear);
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.bloomRTs.push(rt);
    }
  }

  _disposeBloom() {
    this.hdrRT?.dispose();
    this.hdrRT = null;
    for (const rt of this.bloomRTs) rt.dispose();
    this.bloomRTs = [];
  }

  _renderBloom(target, strength) {
    const r = this.renderer;
    const levels = this.bloomRTs;
    const dm = this.bloomDownMat.uniforms;
    let src = this.hdrRT;
    for (let i = 0; i < levels.length; i++) {
      dm.tSrc.value = src.texture;
      dm.uTexel.value.set(1 / src.width, 1 / src.height);
      dm.uFirst.value = i === 0 ? 1 : 0;
      this._blit(this.bloomDownMat, levels[i]);
      src = levels[i];
    }
    // accumulate upward: level i += upsample(level i+1)
    const um = this.bloomUpMat.uniforms;
    r.autoClear = false;
    for (let i = levels.length - 2; i >= 0; i--) {
      um.tSrc.value = levels[i + 1].texture;
      um.uTexel.value.set(1 / levels[i + 1].width, 1 / levels[i + 1].height);
      this._blit(this.bloomUpMat, levels[i]);
    }
    r.autoClear = true;
    const fu = this.finalMat.uniforms;
    fu.tHDR.value = this.hdrRT.texture;
    fu.tBloom.value = levels[0].texture;
    fu.uBloom.value = strength;
    this._blit(this.finalMat, target);
  }

  setCloudResolution(scale) {
    this.cloudBudget = THREE.MathUtils.clamp(scale, 0.25, 1);
  }

  // Cloud cost scales with the pixels that actually see the cloud shell, so a
  // planet that fills little of the screen can afford full-resolution clouds
  // (crisp edges); close up, the scale drops back to the budget. Quantised so
  // the target is only reallocated when the step changes.
  _fitCloudScale(camera, shellRadius) {
    const d = camera.position.length();
    let frac = 1;
    if (d > shellRadius) {
      const a = Math.asin(Math.min(shellRadius / d, 1));
      const r = Math.tan(a) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      frac = Math.min(1, (Math.PI * r * r) / (4 * camera.aspect));
    }
    const s = Math.min(1, this.cloudBudget / Math.sqrt(Math.max(frac, 1e-3)));
    const q = Math.max(0.25, Math.round(s * 8) / 8);
    if (q !== this.cloudScale) {
      this.cloudScale = q;
      this.setSize(this.width, this.height);
    }
  }

  /** Drawing-buffer size in pixels. */
  setSize(w, h) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.sceneRT.setSize(this.width, this.height);
    const cw = Math.max(1, Math.round(this.width * this.cloudScale));
    const ch = Math.max(1, Math.round(this.height * this.cloudScale));
    this.cloudRT.setSize(cw, ch);
    this.cloudMat.uniforms.uCloudRes.value.set(cw, ch);
    this.compositeMat.uniforms.uCloudTexel.value.set(1 / cw, 1 / ch);
  }

  _blit(material, target, face = 0) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target, face);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  _bakeNoise() {
    const nu = this.noiseMat.uniforms;
    for (const rt of [this.noiseRT, this.erosionRT]) {
      nu.uSize.value = rt.depth;
      for (let z = 0; z < rt.depth; z++) {
        nu.uLayer.value = z;
        this._blit(this.noiseMat, rt, z);
      }
    }
    this._noiseBaked = true;
  }

  /** Bake the whole weather cubemap now (seed / scale changes). */
  _bakeWeather(time) {
    this.weatherMat.uniforms.uWeatherTime.value = time;
    for (let f = 0; f < 6; f++) {
      this.weatherMat.uniforms.uFace.value = f;
      this._blit(this.weatherMat, this.weatherRT, f);
    }
    this.weatherDirty = false;
    this._weatherFace = -1;
  }

  /** One face of the evolving weather into the back buffer; swap when done. */
  _stepWeather() {
    const wu = this.weatherMat.uniforms;
    wu.uWeatherTime.value = this._weatherNext;
    wu.uFace.value = this._weatherFace;
    this._blit(this.weatherMat, this.weatherBackRT, this._weatherFace);
    if (++this._weatherFace === 6) {
      [this.weatherRT, this.weatherBackRT] = [this.weatherBackRT, this.weatherRT];
      this.uniforms.uWeatherMap.value = this.weatherRT.texture;
      this._weatherFace = -1;
    }
  }

  /**
   * Render one frame.
   * opts: { mode: 'planet'|'gas'|'star', water, clouds, cloudSteps, weatherTime, bloom }
   */
  render(scene, camera, opts, target = null) {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = true;

    const mode = opts.mode || 'planet';
    const planet = mode === 'planet';
    const clouds = planet && !!opts.clouds;
    const bloom = opts.bloom > 0.001;

    // the transmittance LUT lights the terrain AND the gas giant
    if (mode !== 'star' && this.lutDirty) {
      this._blit(this.lutMat, this.lutRT);
      this.lutDirty = false;
    }
    if (planet) {
      if (clouds || this.uniforms.uCloudShadowStr.value > 0) {
        if (!this._noiseBaked) this._bakeNoise();
        // evolve the weather every couple of seconds; drift is a free rotation
        if (this.weatherDirty) {
          this._weatherClock = opts.weatherTime;
          this._bakeWeather(opts.weatherTime);
        } else if (this._weatherFace >= 0) {
          this._stepWeather();
        } else if (Math.abs(opts.weatherTime - this._weatherClock) > 0.004) {
          this._weatherClock = this._weatherNext = opts.weatherTime;
          this._weatherFace = 0;
          this._stepWeather();
        }
      }
    }

    // camera matrices for the screen passes
    camera.updateMatrixWorld();
    this.view.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.view.uCamWorld.value.copy(camera.matrixWorld);
    this.view.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    this.compositeMat.uniforms.uPixelAngle.value = (2 * Math.tan(fovRad / 2)) / this.height;

    // 1. scene
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2. clouds
    if (clouds) {
      this._fitCloudScale(camera, this.uniforms.uCloudTop.value);
      const cu = this.cloudMat.uniforms;
      cu.uCloudSteps.value = opts.cloudSteps;
      this._blit(this.cloudMat, this.cloudRT);
    }

    // 3. composite
    const u = this.compositeMat.uniforms;
    u.uMode.value = mode === 'star' ? 2 : mode === 'gas' ? 1 : 0;
    u.uWaterOn.value = planet && opts.water ? 1 : 0;
    u.uCloudsOn.value = clouds ? 1 : 0;
    u.uHDROut.value = bloom ? 1 : 0;
    if (bloom) {
      this._ensureBloomTargets();
      this._blit(this.compositeMat, this.hdrRT);
      this._renderBloom(target, opts.bloom);
    } else {
      this._blit(this.compositeMat, target);
    }

    r.autoClear = prevAutoClear;
  }

  dispose() {
    for (const rt of [this.sceneRT, this.cloudRT, this.lutRT, this.weatherRT, this.weatherBackRT,
      this.noiseRT, this.erosionRT]) rt.dispose();
    this.sceneRT.depthTexture?.dispose();
    this._disposeBloom();
    for (const m of [this.lutMat, this.weatherMat, this.noiseMat, this.cloudMat, this.compositeMat,
      this.bloomDownMat, this.bloomUpMat, this.finalMat]) m.dispose();
    this.quad.geometry.dispose();
  }
}
