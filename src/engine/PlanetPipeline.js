import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL, ATMOSPHERE_GLSL, CLOUD_FIELD_GLSL, SURFACE_GLSL, LIGHTNING_GLSL } from './surfaceGLSL.js';
import { STAR_CORONA_GLSL } from './star.js';
import { PLANET_PAINT_GLSL } from '../paint/planetPaintGLSL.js';

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

export const TONEMAP_GLSL = /* glsl */ `
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

// ---------------------------------------------------------------------------
// Embedding (PLANET_EMBED): the planet is composited over a host three.js
// frame instead of owning it. The passes run in planet-local space (the
// renderer builds a proxy camera relative to the planet object), so every
// ray / sphere test stays origin-centred; only the depth written into the
// host's depth buffer uses the host camera's projection.
// ---------------------------------------------------------------------------
export const EMBED_GLSL = /* glsl */ `
uniform mat4  uViewMat;       // planet-local -> host view space
uniform mat4  uHostProj;      // host camera projection
uniform float uLogDepthFC;    // > 0: host uses a logarithmic depth buffer
uniform float uBoundRadius;   // everything the planet draws lies inside this sphere
uniform vec3  uRingAxis;      // gas giant ring plane normal (planet-local)
uniform vec2  uRingRange;     // ring inner / outer radius (0 = no rings)

float hostDepth(vec3 p) {
  vec4 clip = uHostProj * (uViewMat * vec4(p, 1.0));
  float d = uLogDepthFC > 0.0
    ? log2(1.0 + max(clip.w, 0.0)) * uLogDepthFC * 0.5
    : clip.z / clip.w * 0.5 + 0.5;
  return clamp(d, 0.0, 1.0);
}

// depth of what this pixel shows: the solid surface when it hits one; for
// translucent pixels (air, rings, corona) the entry into the planet's
// bounding volume, so host objects in front of it keep covering it. From
// inside the bounding sphere the sky only fills the host's background.
float embedDepth(vec3 ro, vec3 rd, float surfT) {
  if (surfT < 1e19) return hostDepth(ro + rd * surfT);
  if (uRingRange.y > 0.0) {
    float dn = dot(rd, uRingAxis);
    if (abs(dn) > 1e-6) {
      float tp = -dot(ro, uRingAxis) / dn;
      float rr = length(ro + rd * tp);
      if (tp > 0.0 && rr >= uRingRange.x && rr <= uRingRange.y) return hostDepth(ro + rd * tp);
    }
  }
  if (dot(ro, ro) <= uBoundRadius * uBoundRadius) return 1.0;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uBoundRadius * uBoundRadius;
  float h = b * b - c;
  if (h < 0.0 || -b + sqrt(h) < 0.0) return 1.0;
  return hostDepth(ro + rd * max(-b - sqrt(h), 0.0));
}
`;

const NOISE_VOLUME_SIZE = 64;
const WEATHER_TARGET = {
  type: THREE.UnsignedByteType,
  format: THREE.RGFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  generateMipmaps: false,
};
const EROSION_VOLUME_SIZE = 64;
const WEATHER_SIZE = 512;
const WEATHER_STEP = 0.004;   // weather time between crossfaded keyframes
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
  for (int i = 0; i < DYN(6); i++) {
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
${LIGHTNING_GLSL}

uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uViewScale;        // rendered view / allocated scene target
uniform float uCloudSilver;     // forward-scattering glow toward the sun
uniform vec2 uCloudRes;         // cloud pass grid over the whole view
uniform float uWaterOn;
uniform float uSeaRadius;
uniform vec2 uCloudOffset;      // this pass covers the cloud shell's screen rect only: its origin
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

// The vertical shape of one column, from its weather sample w (cloudWeather:
// cover, type, rain; w.w = column noise). Computed once per raymarch sample
// and reused by its light march.
struct CloudCol { vec4 g; float cov; };

CloudCol cloudColumnOf(vec4 w) {
  CloudCol c;
  c.cov = w.x;
  // vertical profile by cloud type: low stratiform decks, cumulus domes,
  // cumulonimbus filling the shell. (No flat anvil shelf: a thin plateau over
  // the deck reads as a second cloud layer with a shadowed rim.)
  vec4 g = cloudGradient(w.y, w.x);
  // convective columns top out cell by cell (w.w), so a field reads as
  // separate towers instead of the cover map extruded upward; stratiform
  // decks stay level. Only the top moves: a column's body stays as dense as
  // its neighbours, so no vertical striping shows through translucent sides
  float tt = sat(w.y * (0.4 + 1.2 * uCloudTowering));
  g.w = min(g.w * mix(1.0, mix(0.62, 1.18, w.w), 0.3 + 0.7 * tt), 1.0);
  g.z = min(g.z, g.w * 0.8);
  c.g = g;
  return c;
}

// Density at radius r (0..1) of column c; dr = drifted, sheared direction for
// the billow noise. hf = height fraction in the shell.
float cloudShape(float r, vec3 dr, CloudCol c, bool detail, out float hf) {
  hf = (r - uCloudBottom) / (uCloudTop - uCloudBottom);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  float prof = cloudProfile(hf, c.g);
  if (prof <= 0.0) return 0.0;
  float cov = c.cov;

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

// 1 when a segment (in the rain layer) crosses the cap of a raining system:
// its endpoints and midpoint against each cap, widened by the segment's span
float rainCapsOnSegment(vec3 a, vec3 b) {
  vec3 da = normalize(a), db = normalize(b), dm = normalize(a + b);
  float span = 1.0 - dot(da, db);
  for (int i = 0; i < MAX_WX; i++) {
    if (i >= uWxCount) break;
    if (uWxC[i].y <= 0.0 || uWxB[i].z > 2.5) continue;
    vec3 c = uWxA[i].xyz;
    float lim = uWxA[i].w - span;
    if (max(dot(da, c), max(dot(db, c), dot(dm, c))) > lim) return 1.0;
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy + uCloudOffset;   // pixel on the view's cloud grid
  vec2 uv = px / uCloudRes;
  float depth = textureLod(tDepth, uv * uViewScale, 0.0).x;
  vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(wp - ro);
  float sceneT = depth >= 1.0 ? 1e20 : length(wp - ro);
  float camR = length(ro);
  float thick = uCloudTop - uCloudBottom;

  // The ocean is analytic and absent from tDepth. It still occludes clouds.
  if (uWaterOn > 0.5) {
    vec2 water = raySphere(ro, rd, uSeaRadius);
    if (water.x < water.y && water.y > 0.0) sceneT = min(sceneT, max(water.x, 0.0));
  }

  // cloud shell segment [t0, t1] (empty: t1 <= t0)
  vec2 tOut = raySphere(ro, rd, uCloudTop);
  vec2 tIn = raySphere(ro, rd, uCloudBottom);
  bool hitsIn = tIn.x < tIn.y && tIn.x > 0.0;
  float t0 = 0.0, t1 = -1.0;
  if (tOut.x < tOut.y && tOut.y > 0.0) {
    if (camR > uCloudTop)          { t0 = tOut.x; t1 = hitsIn ? tIn.x : tOut.y; }
    else if (camR > uCloudBottom)  { t0 = 0.0;    t1 = hitsIn ? tIn.x : tOut.y; }
    else                           { t0 = tIn.y;  t1 = tOut.y; }
    t1 = min(t1, sceneT);
  }

  float T = 1.0;
  vec3 L = vec3(0.0);
  float rainSeen = 0.0;   // heaviest precipitation met in the clouds (rain shafts below)
  if (t1 > t0) {
    float len = t1 - t0;
    // step length from the field's finest structure: the erosion detail spans
    // ~0.4 x the shell thickness, a few jittered samples across it resolve it
    // (bench: 3x fewer steps than thick * 0.035 at SSIM > 0.998 vs 64 steps)
    // (the billows' size, not the shell thickness: a thick shell stacks more
    // of them; identical to thick * 0.1 at the default thickness)
    float steps = clamp(len / (0.0625 / uCloudShapeFreq), 12.0, uCloudSteps);
    float ds = len / steps;
    float t = t0 + ds * ign(px);

    // extinction per world unit: a full-thickness dense column is ~OD 14
    float sigma = 14.0 / thick * uCloudDensity;
    float cosT = dot(rd, uSunDir);
    vec3 tint = srgbToLinear(uCloudColor);
    vec3 ambTint = srgbToLinear(uCloudShadow);
    // multiple-scattering octaves (Wrenninge): light survives deep inside,
    // forward lobe gives silver linings, back lobe keeps sides lit. The phase
    // of each octave only depends on the view / sun angle: evaluated once.
    vec3 msPh = vec3(mix(phaseHG(cosT, 0.7), phaseHG(cosT, -0.25), 0.4) + phaseHG(cosT, 0.88) * 0.3 * uCloudSilver,
                     mix(phaseHG(cosT, 0.35), phaseHG(cosT, -0.125), 0.4) * 0.5,
                     mix(phaseHG(cosT, 0.175), phaseHG(cosT, -0.0625), 0.4) * 0.25);
    // powder darkening (crevices the light has not diffused into) eases off
    // looking toward the sun, where thin edges glow instead
    float powderView = 1.0 - 0.7 * sat(cosT);
    float lightning = float(uFlashCount > 0);

    for (int i = 0; i < ${MAX_CLOUD_STEPS}; i++) {
      if (float(i) >= steps || T < 0.01) break;
      vec3 p = ro + rd * t;
      float r = length(p);
      float hf = (r - uCloudBottom) / thick;
      if (hf > 0.0 && hf < 1.0) {
        // one weather lookup per sample, reused by the light march (the sun
        // ray crosses the thin shell within a texel or two of the field)
        vec3 d = p / r;
        vec4 w = cloudWeather(d, hf);
        float dens = 0.0;
        CloudCol col = CloudCol(vec4(0.0), 0.0);
        // the billows ride a little of the shear (the cover outline leans
        // fully); its direction barely changes along the light march
        vec3 sh = shearOffset(d, 0.3);
        if (w.x > 0.01) {
          vec3 drs = cloudRotate(d + sh * hf);
          // per-column tower height: Worley cells about as wide as the shell
          // is thick, sampled at the base radius so it is constant up a
          // column (inside a system cloudWeather already fetched it). It only
          // moves the top ramp, which never starts below half the column's
          // top: lower samples skip the tap (any value gives the same density)
          if (w.w < 0.0) {
            vec4 g0 = cloudGradient(w.y, w.x);
            w.w = hf > min(g0.z, g0.w * 0.49) - 0.02
              ? textureLod(uCloudNoise, cloudRotate(d + sh * (hf / 0.3)) * uCloudBottom * uCloudCellFreq + uCloudWind * 0.2, 0.0).r : 0.5;
          }
          col = cloudColumnOf(w);
          dens = cloudShape(r, drs, col, true, hf);
        }
        if (dens > 0.003) {
          rainSeen = max(rainSeen, w.z);
          // rain clouds are heavier and darker (big drops absorb and scatter
          // forward): denser, greyer
          float heavy = 1.0 + w.z * 0.9;
          // light march toward the sun (cone-ish growing steps)
          float odL = 0.0;
          float ls = thick * 0.06;
          vec3 lp = p;
          for (int j = 0; j < 5; j++) {
            lp += uSunDir * ls;
            float rl = length(lp);
            float hj = (rl - uCloudBottom) / thick;
            vec3 dl = cloudRotate(lp / rl + sh * sat(hj));
            odL += cloudShape(rl, dl, col, j < 2, hj) * ls;
            ls *= 1.6;
          }
          odL *= sigma * heavy;

          float ms = dot(msPh, exp(-odL * vec3(1.0, 0.55, 0.3025)));
          // powder: dark crevices where light has not diffused in yet
          float powder = 1.0 - exp(-dens * sigma * thick * 0.15);
          vec3 sunC = sunIrradiance(p);
          // sky light: less of the dome reaches deep under a tall top
          float skyVis = mix(0.4, 1.0, sat(hf / max(col.g.w, 0.05)));
          vec3 amb = skyIrradiance(p, d) / PI * skyVis * ambTint * mix(1.0, 0.45, w.z);
          // light bounced off the sunlit ground below the bases
          vec3 bounce = sunC * (max(dot(d, uSunDir), 0.0) * 0.05 * (1.0 - hf));
          vec3 S = (sunC * ms * mix(1.0, mix(0.45, 1.0, powder), powderView) * 2.8 + amb * 1.1 + bounce)
                 * tint * mix(vec3(1.0), uRainColor * 0.55, w.z * 0.85 * (1.0 - hf * 0.75));
          if (lightning > 0.5) S += flashLight(p) * tint;

          float Tr = exp(-dens * sigma * heavy * ds);
          L += T * S * (1.0 - Tr);
          T *= Tr;
        }
      }
      t += ds;
    }
  }

  // ---- precipitation shafts between the cloud base and the ground: grey
  // curtains under raining clouds. Only marched where the clouds above (or
  // the air around a low camera) actually rain.
  if (uRainOn > 0.5 && T > 0.02) {
    if (camR < uCloudBottom) rainSeen = max(rainSeen, uRainCam);
    vec2 tb = tIn;
    float a0 = max(tb.x, 0.0), a1 = min(tb.y, sceneT);
    vec2 tg = raySphere(ro, rd, uAtmoGround);
    if (tg.x < tg.y && tg.x > 0.0) a1 = min(a1, tg.x);
    // a ray that passes UNDER raining clouds never met them above: test the
    // segment against the raining systems' caps (analytic, no lookups)
    if (rainSeen <= 0.01 && a1 > a0) rainSeen = rainCapsOnSegment(ro + rd * a0, ro + rd * a1);
    float layer = max(uCloudBottom - uAtmoGround, thick * 0.1);
    if (rainSeen > 0.01 && tb.x < tb.y && a1 > a0) {
      const int RN = 6;
      float rs = (a1 - a0) / float(RN);
      float s = a0 + rs * ign(px + 37.0);
      float Tr = 1.0;
      vec3 Lr = vec3(0.0);
      float sigR = 2.4 / layer;
      vec3 rainTint = uRainColor;
      for (int k = 0; k < RN; k++) {
        vec3 q = ro + rd * s;
        float rq = length(q);
        vec3 dq = q / rq;
        float hr = sat((rq - uAtmoGround) / layer);   // 0 ground .. 1 cloud base
        float pr = cloudRainAt(dq);
        if (pr > 0.01) {
          // shafts: billow noise at the cloud base above, so it runs down
          // the column, slanted by the wind toward the ground
          vec3 dq2 = cloudRotate(dq + shearOffset(dq, (1.0 - hr) * 0.6));
          float n = textureLod(uCloudNoise, dq2 * uCloudBottom * uCloudShapeFreq * 1.6 + uCloudWind * 0.35, 0.0).g;
          float shaft = smoothstep(0.25, 0.65, n + pr * 0.35);
          // light rain evaporates before it lands (virga)
          float reach = smoothstep(0.0, 0.25 + (1.0 - pr) * 0.6, hr);
          float dens = pr * shaft * reach;
          vec3 Sr = (sunIrradiance(q) * (0.06 + 0.2 * (1.0 - pr)) * phaseHG(dot(rd, uSunDir), 0.5) * 4.0
                   + skyIrradiance(q, dq) / PI * 0.55) * rainTint;
          if (uFlashCount > 0) Sr += flashLight(q) * 0.5;
          float st = exp(-dens * sigR * rs);
          Lr += Tr * Sr * (1.0 - st);
          Tr *= st;
        }
        s += rs;
      }
      // composite: the rain is in front of the clouds when the camera is
      // below them, behind them otherwise
      if (camR < uCloudBottom) L = Lr + Tr * L;
      else L += T * Lr;
      T *= Tr;
    }
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
${LIGHTNING_GLSL}
${SURFACE_GLSL}
${STAR_CORONA_GLSL}
${PLANET_PAINT_GLSL}

uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tClouds;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uViewScale;        // rendered view / allocated scene target
uniform float uPixelAngle;
uniform float uMode;            // 0 planet, 1 gas, 2 star
uniform float uHDROut;          // 1 = write linear HDR (bloom follows)
uniform float uWaterOn;
uniform float uCloudsOn;
uniform float uExposure;
uniform vec2 uCloudTexel;
uniform vec2 uCloudUV;          // view -> cloud target UV scale
uniform vec2 uCloudOffset;      // the cloud rect's origin in the cloud target (UV)
uniform vec2 uCloudMax;         // last texel centre of the rect (UV)
uniform float uLinearOut;       // embed: 0 tone map + sRGB, 1 linear HDR, 2 tone map (sRGB target encodes)

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
  for (int l = 0; l < DYN(3); l++) {
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
  // optical depths and sums in units of ds (scaled once at the end)
  vec3 od = vec3(0.0);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  for (int i = 0; i < DYN(N); i++) {
    float t = t0 + (float(i) + jit) * ds;
    vec3 p = ro + rd * t;
    float r = length(p);
    float h = max(r - uAtmoGround, 0.0);
    float dR = exp(-h / uAtmoHR);
    float dR2 = dR * dR;
    float dM = dR2 * dR2 * dR;            // exp(-h / uAtmoHM): HM = HR / 5 (Engine)
    vec3 stepOD = uAtmoRayleigh * dR + vec3(uAtmoMie * 1.11 * dM) + uAtmoOzone * ozoneDensity(h);
    vec3 w = exp(-(od + stepOD * 0.5) * ds) * atmoTransmittance(r, dot(p, uSunDir) / r);
    sumR += dR * w;
    sumM += dM * w;
    od += stepOD;
  }
  sumR *= ds;
  sumM *= ds;
  transmittance = exp(-od * ds);
  float mu = dot(rd, uSunDir);
  vec3 E = vec3(SUN_E * uSunIntensity);
  return E * (uAtmoRayleigh * sumR * phaseRayleigh(mu) + uAtmoMie * sumM * phaseHG(mu, 0.76));
}

// transmittance of the air between the camera and a point P on its view ray,
// from the transmittance LUT (to-space ratios, taken along whichever way of
// the ray leaves the planet)
vec3 airBetween(vec3 ro, vec3 P, vec3 rd) {
  float rC = length(ro), rP = length(P);
  vec3 a, b;
  if (dot(P, rd) >= 0.0) { a = atmoTransmittance(rC, dot(ro, rd) / rC); b = atmoTransmittance(rP, dot(P, rd) / rP); }
  else { a = atmoTransmittance(rP, -dot(P, rd) / rP); b = atmoTransmittance(rC, -dot(ro, rd) / rC); }
  return clamp(a / max(b, vec3(1e-4)), 0.0, 1.0);
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
  for (int i = 0; i < DYN(6); i++) {
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
  for (int i = 0; i < DYN(3); i++) {
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
  // A distant island or the far side of the planet can be beyond the ray's
  // water interval. It is not this water column's seabed: using its radius
  // produces zero depth and paints shoreline foam across open ocean.
  noFloor = noFloor || sceneT >= tExit;
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
  float pathLen = max((noFloor ? tExit : sceneT) - tW, 0.0);
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
  if (uFoamAmount > 0.001) {
    // Foam belongs to the water point P, not to the terrain hit farther
    // along the viewing ray. At grazing angles that hit can be a distant
    // shore and project its foam across deep foreground water.
    float shoreDepth = max(uSeaRadius - (uRadius + terrainHeight(N) + paintHeight(N)), 0.0);
    float fw = max(uFoamWidth * uHeightScale * 0.05, 1e-3);
    float shore = 1.0 - smoothstep(0.0, fw, shoreDepth - (tex - 0.45) * fw * 1.2);
    // breakers: short broken crests rolling in, only close to shore
    float phase = shoreDepth / fw * 1.1 - t * 0.45 + gnoise(P * (0.6 / max(uWaveSize, 0.01))) * 0.8;
    float fr = fract(phase);
    float surf = smoothstep(0.7, 0.9, fr) * (1.0 - smoothstep(0.9, 1.0, fr));
    surf = mix(surf, 0.1, smoothstep(0.15, 0.45, fwidth(phase)));
    surf *= (1.0 - smoothstep(fw * 0.8, fw * 2.2, shoreDepth)) * smoothstep(0.45, 0.75, tex);
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

// ---- weather seen from the composite -------------------------------------
// Only in the WEATHER_FX variant, drawn on the frames that need it (a flash,
// rain around the camera): this code would cost every frame register space
// in the big composite program even with its branches never taken.
#ifdef WEATHER_FX
// ground lit around lightning strikes (radiance added on the surface)
vec3 flashGround(vec3 P) {
  vec3 L = vec3(0.0);
  float rP = length(P);
  for (int i = 0; i < MAX_FLASH; i++) {
    if (i >= uFlashCount) break;
    vec4 fp = uFlashPos[i];
    vec4 fc = uFlashCol[i];
    vec3 g = normalize(fp.xyz) * rP;   // under the flash, at this pixel's radius
    float r = fp.w * (fc.w > 0.5 ? 1.6 : 1.1);
    float x2 = dot(P - g, P - g) / (r * r);
    L += fc.rgb * (fc.w > 0.5 ? 0.004 : 0.0012) / (1.0 + x2 * 4.0);
  }
  return L;
}

// cloud-to-ground channels: distance from the view ray to each segment,
// a sharp core (at least ~a pixel wide, energy-scaled) and a soft halo
vec3 boltGlow(vec3 ro, vec3 rd, float tMax) {
  vec3 L = vec3(0.0);
  for (int b = 0; b < MAX_BOLT; b++) {
    if (b >= uBoltCount) break;
    vec4 bc = uBoltCol[b];
    vec3 p0 = uBoltPts[b * BOLT_PTS].xyz;
    vec3 p1 = uBoltPts[b * BOLT_PTS + BOLT_PTS - 1].xyz;
    vec3 oc = 0.5 * (p0 + p1) - ro;
    float tc = max(dot(oc, rd), 0.0);
    float reach = length(p1 - p0) * 0.75 + bc.w * 60.0 + tc * uPixelAngle * 40.0;
    if (dot(oc, oc) - tc * tc > reach * reach) continue;
    float best = 1e20, tb = 0.0;
    for (int k = 0; k < BOLT_PTS - 1; k++) {
      vec3 a = uBoltPts[b * BOLT_PTS + k].xyz;
      vec3 e = uBoltPts[b * BOLT_PTS + k + 1].xyz - a;
      vec3 w0 = ro - a;
      float B = dot(rd, e), C = dot(e, e), D = dot(rd, w0), E = dot(e, w0);
      float sc = clamp((E - B * D) / max(C - B * B, 1e-9), 0.0, 1.0);
      float tr = max(B * sc - D, 0.0);
      float dd = length(w0 + rd * tr - e * sc);
      if (dd < best) { best = dd; tb = tr; }
    }
    if (tb > tMax) continue;
    float wpx = max(bc.w, tb * uPixelAngle * 0.7);
    float x = best / wpx;
    L += bc.rgb * max(bc.w / wpx, 0.2) * (exp(-x * x) + 0.04 * exp(-x * 0.3));
  }
  return L;
}

// a camera under raining clouds: visibility drops into grey rain, and
// streaks fall past in three depth layers fixed to the local vertical
vec3 rainNearCamera(vec3 col, vec3 ro, vec3 rd, float surfT, float camR) {
  vec3 up = ro / camR;
  float pr = uRainCam;
  vec3 fogC = uRainColor * skyIrradiance(ro, up) / PI * 0.55;
  float layer = max(uCloudBottom - uAtmoGround, 1e-3);
  float dist = min(surfT, layer * 60.0);
  float vis = layer * mix(12.0, 1.0, pr);
  col = mix(col, fogC, (1.0 - exp(-dist / vis)) * pr * 0.92);
  vec3 east = normalize(cross(up, abs(up.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 north = cross(east, up);
  float az = atan(dot(rd, north), dot(rd, east)) / (2.0 * PI);
  float el = dot(rd, up);
  float streak = 0.0;
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float cols = 140.0 * pow(1.7, fl);
    float u = az * cols;
    float v = el * cols * 0.09 + uTime * (3.2 - 0.7 * fl);
    vec2 cell = floor(vec2(u, v));
    if (hash13(vec3(cell, fl + 3.0)) > pr * 0.65) continue;
    float fx = fract(u) - (0.15 + 0.7 * hash13(vec3(cell, fl + 11.0)));
    float fy = fract(v);
    float wdt = min(fwidth(u), 0.3) * 1.2 + 0.03;
    streak += (1.0 - smoothstep(0.0, wdt, abs(fx))) * smoothstep(0.0, 0.3, fy) * (1.0 - smoothstep(0.5, 1.0, fy))
            * (0.55 - 0.13 * fl);
  }
  streak *= 1.0 - smoothstep(0.7, 0.97, abs(el));
  return col + fogC * streak * 2.2 * pr;
}

#endif

${TONEMAP_GLSL}

#ifdef PLANET_EMBED
${EMBED_GLSL}

// premultiplied output over the host frame: alpha = 1 - background transmittance
void embedOut(vec3 col, float alpha, float surfT, vec3 ro, vec3 rd) {
  gl_FragDepth = embedDepth(ro, rd, surfT);
  if (uHDROut > 0.5) { gl_FragColor = vec4(col, alpha); return; }
  if (alpha < 0.002 && max(col.r, max(col.g, col.b)) < 1e-4) discard;
  if (uLinearOut > 0.5 && uLinearOut < 1.5) {
    gl_FragColor = vec4(col * uExposure * 0.85, alpha);
    return;
  }
  vec3 c = aces(col * uExposure * 0.85);
  // an sRGB render target encodes on write (and blends in linear)
  if (uLinearOut > 1.5) { gl_FragColor = vec4(c, alpha); return; }
  gl_FragColor = vec4(linearToSrgb(c) + (ign(gl_FragCoord.xy) - 0.5) / 255.0 * alpha, alpha);
}
#endif

void main() {
  vec4 sceneS = texture2D(tScene, vUv * uViewScale);
  vec3 scene = sceneS.rgb;
  float depth = texture2D(tDepth, vUv * uViewScale).x;
  bool bg = depth >= 1.0;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, bg ? 1.0 : depth * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(wp - ro);
  float sceneT = bg ? 1e20 : length(wp - ro);

#ifdef STAR_MODE
  {
    // star: emissive disc; around it the chromosphere, prominences, corona
    vec3 c = scene;
    if (bg) {
      float tc = max(-dot(ro, rd), 0.0);
      vec3 pc = ro + rd * tc;
      float b = length(pc) / uRadius;
#ifdef PLANET_EMBED
      c += starHalo(pc, b);
#else
      c += starHalo(pc, b) + starField(rd) * 0.6;
#endif
    }
#ifdef PLANET_EMBED
    embedOut(c, bg ? 0.0 : 1.0, sceneT, ro, rd);
    return;
#endif
    if (uHDROut > 0.5) { gl_FragColor = vec4(c, 1.0); return; }
    c = aces(c * uExposure * 0.85);
    gl_FragColor = vec4(linearToSrgb(c) + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
    return;
  }
#else
  vec3 col = scene;
  float surfT = sceneT;
  float bgT = 1.0;   // how much of the background shows through (embed alpha)

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
#ifdef PLANET_EMBED
  if (surfT > 1e19) bgT = sceneS.a;
  else bgT = 0.0;
#else
  if (surfT > 1e19) col = scene + (starField(rd) + sunDisc(rd)) * sceneS.a;
#endif

  float clT = 1.0;
  vec3 behind = col;            // what the clouds sit in front of
  if (uCloudsOn > 0.5) {
    // tent-filtered upsample of the reduced-res cloud pass: hides the
    // per-pixel raymarch jitter
    // outside the rect the edge texels (no cloud: T = 1) are clamped in
    vec2 o = uCloudTexel * 0.75;
    vec2 cuv = vUv * uCloudUV - uCloudOffset;
    vec2 cmin = uCloudTexel * 0.5;
    vec4 cl = texture2D(tClouds, clamp(cuv, cmin, uCloudMax)) * 0.36
            + (texture2D(tClouds, clamp(cuv + vec2(o.x, o.y), cmin, uCloudMax)) + texture2D(tClouds, clamp(cuv + vec2(-o.x, o.y), cmin, uCloudMax))
             + texture2D(tClouds, clamp(cuv + vec2(o.x, -o.y), cmin, uCloudMax)) + texture2D(tClouds, clamp(cuv + vec2(-o.x, -o.y), cmin, uCloudMax))) * 0.16;
    // Reject sky samples that the reduced-resolution filter spreads over
    // foreground water/terrain at the horizon, using this pixel's own ray.
    vec2 cloudOuter = raySphere(ro, rd, uCloudTop);
    vec2 cloudInner = raySphere(ro, rd, uCloudBottom);
    float cloudStart = length(ro) < uCloudBottom ? cloudInner.y : max(cloudOuter.x, 0.0);
    if (surfT <= cloudStart || cloudOuter.y < 0.0 || cloudOuter.x > cloudOuter.y) cl = vec4(0.0, 0.0, 0.0, 1.0);
    col = col * cl.a + cl.rgb;
    bgT *= cl.a;
    clT = cl.a;

#ifdef WEATHER_FX
    // weather: lightning on the ground and its channels (behind the clouds
    // when seen from above), rain around a camera under the clouds
    float camR = length(ro);
    if (uFlashCount > 0 && surfT < 1e19) col += flashGround(ro + rd * surfT) * (camR > uCloudBottom ? clT : 1.0);
    if (uBoltCount > 0) col += boltGlow(ro, rd, surfT) * (camR > uCloudBottom ? clT : 1.0);
    if (uRainCam > 0.01 && camR < uCloudBottom) col = rainNearCamera(col, ro, rd, surfT, camR);
#endif
  }

  vec3 T;
  // the clouds sit at about the middle of their shell: only the air in front
  // of them veils them; the air behind shows through their gaps. (Hazing a
  // cloud with the whole path to the ground painted a coloured band across
  // distant clouds.)
  vec3 ins = atmosphere(ro, rd, surfT, T);
  if (clT < 0.999 && uAtmoOn > 0.5) {
    vec2 tm = raySphere(ro, rd, 0.5 * (uCloudBottom + uCloudTop));
    float tS = tm.x > 0.0 ? tm.x : tm.y;
    if (tS > 0.0 && tS < surfT) {
      // the front air's share of the in-scatter, in proportion to its
      // share of the extinction (cheap; no second march)
      vec3 TF = max(airBetween(ro, ro + rd * tS, rd), T);
      vec3 insF = ins * (1.0 - TF) / max(1.0 - T, vec3(1e-4));
      // col = behind * clT + cloud light (+ effects): the cloud part gets
      // the front air only, the background the whole path
      col = insF + TF * (col - behind * clT) + clT * (ins - insF + T * behind);
    } else col = col * T + ins;
  } else col = col * T + ins;

#ifdef PLANET_EMBED
  embedOut(col, 1.0 - bgT * dot(T, vec3(1.0 / 3.0)), surfT, ro, rd);
  return;
#endif
  if (uHDROut > 0.5) { gl_FragColor = vec4(col, 1.0); return; }
  col = aces(col * uExposure * 0.85);
  col = linearToSrgb(col) + (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
#endif
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
uniform vec2 uSrcScale;    // the source view inside its (larger) target
uniform float uFirst;      // clamp fireflies on the first (full-res) level
varying vec2 vUv;
vec3 tap(vec2 uv) {
  vec3 c = texture2D(tSrc, min(uv, uSrcScale - 0.5 * uTexel)).rgb;
  if (uFirst > 0.5) c = min(c, vec3(60.0));
  return c;
}
void main() {
  vec2 o = uTexel;
  vec2 uv = vUv * uSrcScale;
  vec3 c = tap(uv) * 4.0 + tap(uv + vec2(-o.x, -o.y)) + tap(uv + vec2(o.x, -o.y))
         + tap(uv + vec2(-o.x, o.y)) + tap(uv + vec2(o.x, o.y));
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
uniform vec2 uHdrScale;       // the HDR view inside the (shared, larger) cloud target
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

#ifdef PLANET_EMBED
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uViewScale;
uniform float uLinearOut;
${EMBED_GLSL}
#endif

void main() {
  vec4 hdr = texture2D(tHDR, vUv * uHdrScale);
  vec3 c = hdr.rgb;
  vec3 b = texture2D(tBloom, vUv).rgb * uBloomNorm;
  // wide soft glare + a tighter core halo around overexposed pixels
  c += b * 0.1 * uBloom;
#ifdef PLANET_EMBED
  float depth = texture2D(tDepth, vUv * uViewScale).x;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, depth >= 1.0 ? 1.0 : depth * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 rd = normalize(wp - uCamPos);
  gl_FragDepth = embedDepth(uCamPos, rd, depth >= 1.0 ? 1e20 : length(wp - uCamPos));
  float alpha = hdr.a;
  if (alpha < 0.002 && max(c.r, max(c.g, c.b)) < 1e-4) discard;
  if (uLinearOut > 0.5 && uLinearOut < 1.5) { gl_FragColor = vec4(c * uExposure * 0.85, alpha); return; }
#else
  float alpha = 1.0;
#endif
  // hue-preserving tone map: per-channel ACES would clip the red of a cool
  // star first and turn it yellow. Map luminance, keep the chromaticity, and
  // only let what still overflows bleach toward white.
  c *= uExposure * 0.85;
  float L = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  c *= aces(vec3(L)).x / L;
  float m = max(max(c.r, c.g), c.b);
  if (m > 1.0) c = mix(c / m, vec3(1.0), sat01((m - 1.0) * 0.6));
#ifdef PLANET_EMBED
  if (uLinearOut > 1.5) { gl_FragColor = vec4(c, alpha); return; }
#endif
  gl_FragColor = vec4(linearToSrgb(c) + (ign(gl_FragCoord.xy) - 0.5) / 255.0 * alpha, alpha);
}
`;

// ---------------------------------------------------------------------------
// Embed depth pass: writes the planet's SOLID surface (terrain / ocean / gas
// or star disc) into the host depth buffer, colour writes off. Runs after the
// colour composite so translucent air never occludes later host geometry.
// ---------------------------------------------------------------------------
const DEPTH_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uViewScale;
uniform float uSeaRadius;
uniform float uWaterOn;
${EMBED_GLSL}
varying vec2 vUv;
void main() {
  float depth = texture2D(tDepth, vUv * uViewScale).x;
  bool bg = depth >= 1.0;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, bg ? 1.0 : depth * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(wp - ro);
  float t = bg ? 1e20 : length(wp - ro);
  if (uWaterOn > 0.5) {
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - uSeaRadius * uSeaRadius);
    if (h >= 0.0) {
      float tw = -b - sqrt(h);
      if (-b + sqrt(h) > 0.0) t = min(t, max(tw, 0.0));
    }
  }
  if (t > 1e19) discard;
  gl_FragDepth = hostDepth(ro + rd * t);
  gl_FragColor = vec4(0.0);
}
`;

const BLOOM_LEVELS = 7;

const _rc = new THREE.Vector3();
const _rv = new THREE.Vector3();
const _shellRect = new THREE.Vector4();

const HALF_LINEAR = {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  generateMipmaps: false,
};

// toneMapped: false — the passes tone map themselves; it also keeps the host
// renderer's toneMapping out of the program key (one variant, not one per
// host setting)
function screenMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

// premultiplied "over" onto the host frame (colour and alpha)
export function setEmbedBlending(material, embed, depthTest) {
  if (!!material.defines.PLANET_EMBED !== embed) {
    if (embed) material.defines.PLANET_EMBED = 1;
    else delete material.defines.PLANET_EMBED;
    material.needsUpdate = true;
  }
  material.transparent = embed;
  material.blending = embed ? THREE.CustomBlending : THREE.NormalBlending;
  material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrc = material.blendSrcAlpha = THREE.OneFactor;
  material.blendDst = material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.depthTest = embed && depthTest;
  material.depthWrite = false;
}

// ============================================================================
// PlanetPasses — the per-planet half of the pipeline: the planet's own
// transmittance LUT and weather keyframes, and the screen-pass materials bound
// to its uniforms. Programs are shared between planets through three's
// program cache (same sources + defines).
// ============================================================================
export class PlanetPasses {
  constructor(pipeline, uniforms) {
    this.pipeline = pipeline;
    this.uniforms = uniforms;
    this.cloudBudget = 0.5;   // user resolution scale = pixel budget
    this.cloudScale = 0.5;    // effective scale this frame
    this.lutDirty = true;
    this.weatherDirty = true;

    this.lutRT = new THREE.WebGLRenderTarget(256, 64, HALF_LINEAR);
    this.lutRT.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.lutRT.texture.wrapT = THREE.ClampToEdgeWrapping;

    // r = cloud field, g = cloud type. The weather evolves through keyframes
    // WEATHER_STEP apart: the shaders crossfade keyframe A -> B while the one
    // after B is baked one face per frame into the third cube (no
    // multi-millisecond hitch). When the clock passes B they rotate.
    // 8-bit (both fields are 0..1: identical frames to 16-bit float, half the
    // memory) and sized to the planet on screen (fitWeatherSize).
    this.weatherSize = WEATHER_SIZE;
    this.weatherRTs = [];
    this._allocWeather(WEATHER_SIZE);

    uniforms.uTransmittanceLUT.value = this.lutRT.texture;
    uniforms.uCloudNoise.value = pipeline.noiseRT.texture;
    uniforms.uCloudErosion.value = pipeline.erosionRT.texture;

    this.lutMat = screenMaterial(LUT_FRAGMENT, { ...uniforms });
    this.lutMat.name = 'pp.lut';
    this.weatherMat = screenMaterial(WEATHER_FRAGMENT, {
      ...uniforms,
      uFace: { value: 0 },
      uFaceSize: { value: this.weatherSize },
      uWeatherTime: { value: 0 },
    });
    this.weatherMat.name = 'pp.weather';
    this.cloudMat = screenMaterial(CLOUD_FRAGMENT, {
      ...uniforms,
      ...pipeline.view,
      uCloudRes: { value: new THREE.Vector2(1, 1) },
      uCloudOffset: { value: new THREE.Vector2(0, 0) },
      uCloudSteps: { value: 64 },
      uWaterOn: { value: 0 },
    });
    this.cloudMat.name = 'pp.clouds';
    // two composite programs over one uniform set: planets / gas giants
    // (ocean, clouds, atmosphere) and stars (chromosphere, corona) — each
    // compiles faster than one shader holding both, and a planet never
    // waits for the star code
    const compositeUniforms = {
      ...uniforms,
      ...pipeline.view,
      ...pipeline.embed,
      tScene: { value: pipeline.sceneRT.texture },
      tClouds: { value: pipeline.cloudRT.texture },
      uPixelAngle: { value: 0.001 },
      uMode: { value: 0 },
      uHDROut: { value: 0 },
      uWaterOn: { value: 1 },
      uCloudsOn: { value: 1 },
      uCloudTexel: { value: new THREE.Vector2(1, 1) },
      uCloudUV: { value: new THREE.Vector2(1, 1) },
      uCloudOffset: { value: new THREE.Vector2(0, 0) },
      uCloudMax: { value: new THREE.Vector2(1, 1) },
      uLinearOut: { value: 0 },
    };
    // (+ the planet program with the weather effects compiled in, drawn only
    // on frames with lightning or rain at the camera)
    this.compositeMats = {
      planet: screenMaterial(COMPOSITE_FRAGMENT, compositeUniforms),
      weather: screenMaterial(COMPOSITE_FRAGMENT, compositeUniforms),
      star: screenMaterial(COMPOSITE_FRAGMENT, compositeUniforms),
    };
    this.compositeMats.star.defines = { STAR_MODE: 1 };
    this.compositeMats.weather.defines = { WEATHER_FX: 1 };
    this.compositeMats.planet.name = 'pp.composite';
    this.compositeMats.weather.name = 'pp.composite.weather';
    this.compositeMats.star.name = 'pp.composite.star';
    this.compositeUniforms = compositeUniforms;
  }

  /** The composite material for a body type (weatherFx: with lightning / near rain). */
  compositeFor(mode, weatherFx = false) {
    if (mode === 'star') return this.compositeMats.star;
    return weatherFx ? this.compositeMats.weather : this.compositeMats.planet;
  }

  /** Match shore height sampling to the applied terrain, including graph uniforms. */
  setTerrain(material, program) {
    if (this._shoreMaterial === material && this._shoreProgram === program) return;
    this._shoreMaterial = material; this._shoreProgram = program;
    Object.assign(this.compositeUniforms, material.uniforms);
    const shaderProgram = program?.identityParams ? null : program;
    const source = COMPOSITE_FRAGMENT
      .replace('#define OCTAVES 4', `#define OCTAVES ${material.defines.OCTAVES}`)
      .replace(NOISE_FUNCTIONS_GLSL, shaderProgram?.glsl ?? NOISE_FUNCTIONS_GLSL);
    // both planet programs (with and without the weather effects) shade the
    // shore from the same terrain
    for (const composite of [this.compositeMats.planet, this.compositeMats.weather]) {
      if (composite.fragmentShader !== source) {
        composite.fragmentShader = source; composite.needsUpdate = true;
      }
    }
  }

  _allocWeather(size) {
    for (const rt of this.weatherRTs) rt.dispose();
    this.weatherSize = size;
    this.weatherRTs = [0, 1, 2].map(() => new THREE.WebGLCubeRenderTarget(size, WEATHER_TARGET));
    this._wA = 0; this._wB = 0; this._wC = 1;   // indices: shown, next, baking
    this._tA = 0; this._tB = 0; this._tC = 0;   // their weather times
    this._weatherFace = -1;   // next face of the background bake (-1 = ready)
    this._initFace = 0;       // next face of the initial keyframe A bake
    this.weatherDirty = true;
    this.uniforms.uWeatherMap.value = this.weatherRTs[0].texture;
    this.uniforms.uWeatherMapNext.value = this.weatherRTs[0].texture;
    if (this.weatherMat) this.weatherMat.uniforms.uFaceSize.value = size;
  }

  /**
   * Weather resolution for a planet `px` pixels in radius on screen
   * (texture streaming): 128 / 256 / 512 per face, with hysteresis. Far
   * planets keep 16x less memory; at these sizes the switch is invisible
   * (the field's finest features span 5+ texels at 128, 10+ at 256).
   */
  fitWeatherSize(px) {
    const s = this.weatherSize;
    let want = s;
    if (px > 180) want = WEATHER_SIZE;
    else if (px > 48) want = s === WEATHER_SIZE && px > 135 ? WEATHER_SIZE : 256;
    else want = s !== 128 && px > 36 ? 256 : 128;
    if (want !== s) this._allocWeather(want);
  }

  setCloudResolution(scale) {
    this.cloudBudget = THREE.MathUtils.clamp(scale, 0.25, 1);
  }

  // Cloud cost scales with the pixels that actually see the cloud shell, so a
  // planet that fills little of the screen can afford full-resolution clouds
  // (crisp edges); close up, the scale drops back to the budget. Quantised,
  // with hysteresis so a camera hovering on a step boundary doesn't toggle it
  // every frame.
  fitCloudScale(camDist, fovDeg, aspect, shellRadius) {
    let frac = 1;
    if (camDist > shellRadius) {
      const a = Math.asin(Math.min(shellRadius / camDist, 1));
      const r = Math.tan(a) / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
      frac = Math.min(1, (Math.PI * r * r) / (4 * aspect));
    }
    const s = Math.min(1, this.cloudBudget / Math.sqrt(Math.max(frac, 1e-3)));
    const q = Math.max(0.25, Math.round(s * 8) / 8);
    if (q !== this.cloudScale && Math.abs(s - this.cloudScale) > 0.09) this.cloudScale = q;
    return this.cloudScale;
  }

  /** One face of weather keyframe `idx` at weather time `time`. */
  _bakeWeatherFace(idx, time, face) {
    const wu = this.weatherMat.uniforms;
    wu.uWeatherTime.value = time;
    wu.uFace.value = face;
    this.pipeline._blit(this.weatherMat, this.weatherRTs[idx], face);
  }

  /** Start baking the keyframe after B into the free cube. */
  _queueWeather() {
    this._wC = [0, 1, 2].find((i) => i !== this._wA && i !== this._wB);
    this._tC = this._tB + WEATHER_STEP;
    this._weatherFace = 0;
  }

  /**
   * Bake keyframe A a few faces per call (loading: no multi-face hitch).
   * Returns true once the weather is ready to show.
   */
  bakeWeatherSlice(wt, faces = 1) {
    if (!this.weatherDirty) return true;
    for (let i = 0; i < faces && this._initFace < 6; i++, this._initFace++) {
      this._bakeWeatherFace(this._wA, wt, this._initFace);
    }
    if (this._initFace < 6) return false;
    this._startWeather(wt);
    return true;
  }

  // keyframe A is complete at weather time wt: B aliases it until the
  // background bake delivers the next state
  _startWeather(wt) {
    this._initFace = 0;
    this._wB = this._wA;
    this._tA = this._tB = wt;
    this._shown = this._wtPrev = wt;
    this._queueWeather();
    this.weatherDirty = false;
  }

  /**
   * Advance the weather keyframes to weather time wt and set the crossfade.
   * Seed / scale changes rebake keyframe A at once; B aliases A until the
   * background bake delivers the next state, so evolution resumes smoothly.
   */
  updateWeather(wt) {
    if (this.weatherDirty) this.bakeWeatherSlice(wt, 6);
    // the displayed weather clock follows wt but waits at keyframe B until
    // the next one is baked, then catches up at 1.5x (never a jump)
    const dw = Math.max(0, wt - this._wtPrev);
    this._wtPrev = wt;
    const behind = wt - this._shown > dw;
    this._shown = Math.min(this._shown + dw * (behind ? 1.5 : 1), wt, this._tB);
    // one face of the background keyframe per frame; if the clock ran more
    // than half a step past B (very fast wind / low fps), finish it now
    // rather than let the crossfade fall behind
    if (this._weatherFace >= 0) {
      const late = wt - this._tB > WEATHER_STEP * 0.5;
      do {
        this._bakeWeatherFace(this._wC, this._tC, this._weatherFace);
      } while (++this._weatherFace < 6 && late);
      if (this._weatherFace === 6) this._weatherFace = -1;
    }
    // reached B with the next keyframe ready: rotate
    if (this._shown >= this._tB && this._weatherFace < 0) {
      this._wA = this._wB; this._tA = this._tB;
      this._wB = this._wC; this._tB = this._tC;
      this._queueWeather();
    }
    const span = this._tB - this._tA;
    const blend = span > 0 ? THREE.MathUtils.clamp((this._shown - this._tA) / span, 0, 1) : 0;
    this.uniforms.uWeatherMap.value = this.weatherRTs[this._wA].texture;
    this.uniforms.uWeatherMapNext.value = this.weatherRTs[this._wB].texture;
    this.uniforms.uWeatherBlend.value = blend;
  }

  /** Screen-pass materials, for shader pre-compilation. */
  get materials() {
    return [this.lutMat, this.weatherMat, this.cloudMat, this.compositeMats.planet, this.compositeMats.weather,
      this.compositeMats.star];
  }

  dispose() {
    for (const rt of [this.lutRT, ...this.weatherRTs]) rt.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// ============================================================================
// PlanetPipeline — the shared half: GPU resources every planet drawn by one
// WebGLRenderer can reuse, because each planet is composited onto the output
// before the next one starts (scene + depth target, cloud target, noise
// volumes, bloom chain, fullscreen quad).
// ============================================================================
export class PlanetPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 1;           // rendered view
    this.height = 1;
    this._allocW = 1;         // allocated scene target
    this._allocH = 1;
    this._noiseBaked = false;
    this._noiseVol = 0;       // resumable noise bake: volume, next layer
    this._noiseLayer = 0;
    this._cloudCap = new THREE.Vector2(0, 0);

    // scene: HDR colour + float depth (read back by the screen passes)
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      ...HALF_LINEAR,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });
    // cloud pass: drawn into the lower-left cw x ch of this target, which
    // only ever grows (planets with different cloud scales share it)
    this.cloudRT = new THREE.WebGLRenderTarget(1, 1, HALF_LINEAR);

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

    // ---- passes
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    this.noiseMat = screenMaterial(NOISE_VOLUME_FRAGMENT, { uLayer: { value: 0 }, uSize: { value: 1 } });
    this.noiseMat.name = 'pp.noise';

    // camera + embed uniforms: shared value objects, set before each planet
    this.view = {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uViewScale: { value: new THREE.Vector2(1, 1) },
      tDepth: { value: this.sceneRT.depthTexture },
    };
    this.embed = {
      uViewMat: { value: new THREE.Matrix4() },
      uHostProj: { value: new THREE.Matrix4() },
      uLogDepthFC: { value: 0 },
      uBoundRadius: { value: 1 },
      uRingAxis: { value: new THREE.Vector3(0, 1, 0) },
      uRingRange: { value: new THREE.Vector2(0, 0) },
    };

    // bloom mip chain (allocated on first use); the star's HDR frame itself
    // goes into the cloud target (stars have no clouds, and each planet is
    // finished before the next starts)
    this.bloomRTs = [];
    this.bloomDownMat = screenMaterial(BLOOM_DOWN_FRAGMENT, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uSrcScale: { value: new THREE.Vector2(1, 1) },
      uFirst: { value: 0 },
    });
    this.bloomUpMat = screenMaterial(BLOOM_UP_FRAGMENT, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    });
    this.bloomUpMat.blending = THREE.AdditiveBlending;
    this.bloomUpMat.transparent = true;
    this.finalMat = screenMaterial(FINAL_FRAGMENT, {
      ...this.view,
      ...this.embed,
      tHDR: { value: null },
      uHdrScale: { value: new THREE.Vector2(1, 1) },
      tBloom: { value: null },
      uBloom: { value: 1 },
      uBloomNorm: { value: 1 / BLOOM_LEVELS },
      uExposure: { value: 1 },
      uLinearOut: { value: 0 },
    });

    this.depthMat = screenMaterial(DEPTH_FRAGMENT, {
      ...this.view,
      ...this.embed,
      uSeaRadius: { value: 1 },
      uWaterOn: { value: 0 },
    });
    this.depthMat.defines = {};
    this.depthMat.colorWrite = false;
    this.depthMat.depthTest = true;
    this.depthMat.depthWrite = true;
  }

  createPasses(uniforms) {
    return new PlanetPasses(this, uniforms);
  }

  _ensureBloomTargets() {
    const w = this.width, h = this.height;
    if (this._bloomW === w && this._bloomH === h && this.bloomRTs.length) return;
    this._disposeBloom();
    this._bloomW = w;
    this._bloomH = h;
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      const rt = new THREE.WebGLRenderTarget(bw, bh, HALF_LINEAR);
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.bloomRTs.push(rt);
    }
  }

  _disposeBloom() {
    for (const rt of this.bloomRTs) rt.dispose();
    this.bloomRTs = [];
  }

  _renderBloom(target, strength) {
    const r = this.renderer;
    const levels = this.bloomRTs;
    const dm = this.bloomDownMat.uniforms;
    const cap = this._cloudCap;
    const hdrScale = [this.width / cap.x, this.height / cap.y];
    let src = this.cloudRT;
    for (let i = 0; i < levels.length; i++) {
      dm.tSrc.value = src.texture;
      dm.uTexel.value.set(1 / src.width, 1 / src.height);
      if (i === 0) dm.uSrcScale.value.set(hdrScale[0], hdrScale[1]);
      else dm.uSrcScale.value.set(1, 1);
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
    const fu = this.finalMat.uniforms;
    fu.tHDR.value = this.cloudRT.texture;
    fu.uHdrScale.value.set(hdrScale[0], hdrScale[1]);
    fu.tBloom.value = levels[0].texture;
    fu.uBloom.value = strength;
    this._blit(this.finalMat, target);
  }

  /**
   * Drawing-buffer size in pixels of the output: the shared targets are
   * allocated at this size, and it is the view rendered by default.
   */
  setSize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    this.width = w;
    this.height = h;
    this.view.uViewScale.value.set(1, 1);
    if (w === this._allocW && h === this._allocH) return;
    this._allocW = w;
    this._allocH = h;
    this.sceneRT.setSize(w, h);
    this._cloudCap.set(0, 0);
  }

  /**
   * Render a smaller view (impostor captures) into the lower-left corner of
   * the allocated targets — no reallocation. setSize() restores the full
   * view. Clamped to the allocation.
   */
  setViewSize(w, h) {
    this.width = Math.max(1, Math.min(Math.floor(w), this._allocW));
    this.height = Math.max(1, Math.min(Math.floor(h), this._allocH));
    this.view.uViewScale.value.set(this.width / this._allocW, this.height / this._allocH);
  }

  /**
   * Conservative pixel rectangle (in the current view) of a sphere of
   * `radius` (view units) at the camera's planet-local origin: null = the
   * whole view (it straddles the camera), false = off screen.
   */
  screenRect(cam, radius, out) {
    const center = _rc.set(0, 0, 0).applyMatrix4(cam.matrixWorldInverse);
    const w = this.width;
    const h = this.height;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _rv.set(
        center.x + (i & 1 ? radius : -radius),
        center.y + (i & 2 ? radius : -radius),
        center.z + (i & 4 ? radius : -radius)
      );
      if (_rv.z > -cam.near) return null;
      _rv.applyMatrix4(cam.projectionMatrix);
      x0 = Math.min(x0, _rv.x); x1 = Math.max(x1, _rv.x);
      y0 = Math.min(y0, _rv.y); y1 = Math.max(y1, _rv.y);
    }
    const px0 = Math.max(0, Math.floor((x0 * 0.5 + 0.5) * w) - 2);
    const py0 = Math.max(0, Math.floor((y0 * 0.5 + 0.5) * h) - 2);
    const px1 = Math.min(w, Math.ceil((x1 * 0.5 + 0.5) * w) + 2);
    const py1 = Math.min(h, Math.ceil((y1 * 0.5 + 0.5) * h) + 2);
    if (px1 <= px0 || py1 <= py0) return false;
    return out.set(px0, py0, px1 - px0, py1 - py0);
  }

  _ensureCloudTarget(cw, ch) {
    const cap = this._cloudCap;
    if (cw <= cap.x && ch <= cap.y) return;
    cap.set(Math.max(cw, cap.x), Math.max(ch, cap.y));
    this.cloudRT.setSize(cap.x, cap.y);
  }

  _blit(material, target, face = 0) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target, face);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /** Bake up to `layers` more layers of the noise volumes; true once complete. */
  bakeNoiseSlice(layers = Infinity) {
    if (this._noiseBaked) return true;
    const nu = this.noiseMat.uniforms;
    const vols = [this.noiseRT, this.erosionRT];
    for (let n = 0; n < layers; n++) {
      const rt = vols[this._noiseVol];
      nu.uSize.value = rt.depth;
      nu.uLayer.value = this._noiseLayer;
      this._blit(this.noiseMat, rt, this._noiseLayer);
      if (++this._noiseLayer < rt.depth) continue;
      this._noiseLayer = 0;
      if (++this._noiseVol === vols.length) {
        this._noiseBaked = true;
        return true;
      }
    }
    return false;
  }

  _bakeNoise() {
    this.bakeNoiseSlice(Infinity);
  }

  /**
   * Render one planet. `camera` is the planet-local (proxy) camera; `scene`
   * the planet's internal scene. The output target must already be sized
   * (setSize) and hold the host frame when embedding.
   * opts: { mode: 'planet'|'gas'|'star', water, clouds, cloudSteps, weatherFx,
   *         weatherTime, bloom, camDist, embed, depthTest, depthWrite,
   *         output: 0 tone map + sRGB | 1 linear HDR | 2 tone map (sRGB
   *         target), rect: Vector4 (pixels) | null, setHostScissor(rect|null) }
   */
  render(passes, scene, camera, opts, target = null) {
    const r = this.renderer;
    r.autoClear = true;

    const mode = opts.mode || 'planet';
    const planet = mode === 'planet';
    const clouds = planet && !!opts.clouds;
    const bloom = opts.bloom > 0.001;
    const embed = !!opts.embed;
    // bloom spreads over the whole frame: no scissor for stars
    const rect = bloom ? null : opts.rect;
    const u = passes.uniforms;

    // the transmittance LUT lights the terrain AND the gas giant
    if (mode !== 'star' && passes.lutDirty) {
      this._blit(passes.lutMat, passes.lutRT);
      passes.lutDirty = false;
    }
    if (planet) {
      if (clouds || u.uCloudShadowStr.value > 0) {
        if (!this._noiseBaked) this._bakeNoise();
        // weather evolves through crossfaded keyframes; drift is a free rotation
        passes.updateWeather(opts.weatherTime);
      }
    }

    // camera matrices for the screen passes
    camera.updateMatrixWorld();
    this.view.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.view.uCamWorld.value.copy(camera.matrixWorld);
    this.view.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const composite = passes.compositeFor(mode, planet && clouds && !!opts.weatherFx);
    passes.compositeUniforms.uPixelAngle.value = (2 * Math.tan(fovRad / 2)) / (camera.zoom * this.height);

    // 1. scene (into the view: the whole target unless an impostor capture)
    const partial = this.width < this._allocW || this.height < this._allocH;
    this.sceneRT.viewport.set(0, 0, this.width, this.height);
    this.sceneRT.scissorTest = !!rect || partial;
    if (rect) this.sceneRT.scissor.copy(rect);
    else this.sceneRT.scissor.set(0, 0, this.width, this.height);
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    this.sceneRT.scissorTest = false;
    this.sceneRT.viewport.set(0, 0, this._allocW, this._allocH);

    // 2. clouds
    const cu = passes.compositeUniforms;
    if (clouds) {
      const s = passes.fitCloudScale(opts.camDist, camera.fov, camera.aspect, u.uCloudTop.value);
      const cw = Math.max(1, Math.round(this.width * s));
      const ch = Math.max(1, Math.round(this.height * s));
      // only the cloud shell's screen rect (x the embed scissor) is traced,
      // into a target of that size: no full-frame allocation for a planet
      // that covers a quarter of it
      let x0 = 0, y0 = 0, x1 = cw, y1 = ch;
      let cr = this.screenRect(camera, u.uCloudTop.value * (opts.radiusScale ?? 1), _shellRect);
      if (cr === false) cr = _shellRect.set(0, 0, 0, 0);
      if (rect) {
        // x the embed scissor
        if (!cr) cr = _shellRect.copy(rect);
        else {
          const ax = Math.max(cr.x, rect.x), ay = Math.max(cr.y, rect.y);
          const bx = Math.min(cr.x + cr.z, rect.x + rect.z), by = Math.min(cr.y + cr.w, rect.y + rect.w);
          cr.set(ax, ay, Math.max(0, bx - ax), Math.max(0, by - ay));
        }
      }
      if (cr) {
        x0 = Math.max(0, Math.floor(cr.x * s) - 2);
        y0 = Math.max(0, Math.floor(cr.y * s) - 2);
        x1 = Math.min(cw, Math.ceil((cr.x + cr.z) * s) + 2);
        y1 = Math.min(ch, Math.ceil((cr.y + cr.w) * s) + 2);
      }
      const rw = Math.max(1, x1 - x0);
      const rh = Math.max(1, y1 - y0);
      this._ensureCloudTarget(rw, rh);
      const cap = this._cloudCap;
      this.cloudRT.viewport.set(0, 0, rw, rh);
      this.cloudRT.scissorTest = false;
      const cm = passes.cloudMat.uniforms;
      cm.uWaterOn.value = opts.water ? 1 : 0;
      cm.uCloudSteps.value = opts.cloudSteps;
      cm.uCloudRes.value.set(cw, ch);
      cm.uCloudOffset.value.set(x0, y0);
      cu.uCloudTexel.value.set(1 / cap.x, 1 / cap.y);
      cu.uCloudUV.value.set(cw / cap.x, ch / cap.y);
      cu.uCloudOffset.value.set(x0 / cap.x, y0 / cap.y);
      cu.uCloudMax.value.set((rw - 0.5) / cap.x, (rh - 0.5) / cap.y);
      this._blit(passes.cloudMat, this.cloudRT);
    }

    // 3. composite
    setEmbedBlending(composite, embed, opts.depthTest);
    cu.uMode.value = mode === 'star' ? 2 : mode === 'gas' ? 1 : 0;
    cu.uWaterOn.value = planet && opts.water ? 1 : 0;
    cu.uCloudsOn.value = clouds ? 1 : 0;
    cu.uHDROut.value = bloom ? 1 : 0;
    cu.uLinearOut.value = opts.output ?? 0;
    if (bloom) {
      // the HDR frame is overwritten, not blended onto; it lives in the
      // (idle in star mode) cloud target
      composite.depthTest = false;
      // The HDR intermediate owns every pixel, including transparent space.
      // Blending an alpha-zero star background onto clear alpha=1 made the
      // final bloom pass overwrite the entire host sky when a star appeared.
      composite.transparent = false;
      composite.blending = THREE.NoBlending;
      this._ensureBloomTargets();
      this._ensureCloudTarget(this.width, this.height);
      this.cloudRT.viewport.set(0, 0, this.width, this.height);
      this.cloudRT.scissorTest = false;
      // the composite's cloud sampler must not stay bound to its own target
      // (a feedback loop: WebGL drops the draw)
      cu.tClouds.value = null;
      this._blit(composite, this.cloudRT);
      cu.tClouds.value = this.cloudRT.texture;
      setEmbedBlending(this.finalMat, embed, opts.depthTest);
      this.finalMat.uniforms.uExposure.value = u.uExposure.value;
      this.finalMat.uniforms.uLinearOut.value = opts.output ?? 0;
      opts.setHostScissor?.(null);
      this._renderBloom(target, opts.bloom);
    } else {
      r.autoClear = false;
      opts.setHostScissor?.(rect);
      this._blit(composite, target);
    }

    // 4. embed: the solid surface into the host depth buffer
    if (embed && opts.depthWrite) {
      r.autoClear = false;
      this.depthMat.uniforms.uSeaRadius.value = u.uSeaRadius.value;
      this.depthMat.uniforms.uWaterOn.value = cu.uWaterOn.value;
      this._blit(this.depthMat, target);
    }
  }

  dispose() {
    for (const rt of [this.sceneRT, this.cloudRT, this.noiseRT, this.erosionRT]) rt.dispose();
    this.sceneRT.depthTexture?.dispose();
    this._disposeBloom();
    for (const m of [this.noiseMat, this.bloomDownMat, this.bloomUpMat, this.finalMat, this.depthMat]) m.dispose();
    this.quad.geometry.dispose();
  }
}
