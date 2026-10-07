// ============================================================================
// Shared shading GLSL. ONE source of truth — the terrain material, the ocean /
// cloud / atmosphere passes (PlanetPipeline.js) and the export texture baker
// all include these blocks, so nothing can drift apart.
//
// Include order matters (blocks only declare their own uniforms):
//   NOISE_UNIFORMS + NOISE_FUNCTIONS  (noiseGLSL.js — heightField, gnoise…)
//   TOON_GLSL                         (sun uniforms + optional toon banding)
//   ATMOSPHERE_GLSL                   (needs TOON_GLSL for uSunDir)
//   CLOUD_FIELD_GLSL                  (needs ATMOSPHERE_GLSL)
//   SURFACE_GLSL                      (climate, albedo, to-scale detail)
//
// Colour convention: palette params are sRGB (what the colour picker shows);
// shaders convert to linear albedo and output linear HDR radiance. Exposure,
// tone mapping and the sRGB transfer happen once, in the composite pass.
// ============================================================================

export const TOON_GLSL = /* glsl */ `
uniform float uToonEnabled;
uniform float uToonBands;
uniform float uToonSoftness;
uniform float uSunIntensity;
uniform float uAmbient;
uniform vec3  uSunDir;

// Quantize a diffuse term into hard cartoon bands.
float toonShade(float diff) {
  if (uToonEnabled < 0.5) return diff;
  float bands = max(uToonBands, 1.0);
  float x = diff * bands;
  float f = floor(x);
  float soft = max(uToonSoftness, 0.001) * bands;
  float edge = smoothstep(0.5 - soft, 0.5 + soft, x - f);
  return clamp((f + edge) / bands, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Physically based atmosphere helpers. Every length is derived from the
// planet radius in JS (Engine._syncAtmosphere): optical depths match Earth's,
// so the sky, limb glow and sunset reddening look right at ANY planet size.
// Sun transmittance comes from a baked LUT (radius x sun-zenith cosine).
// ---------------------------------------------------------------------------
export const ATMOSPHERE_GLSL = /* glsl */ `
#ifndef PI
#define PI 3.141592653589793
#endif
const float SUN_E = 6.0;           // sun irradiance at intensity 1 (HDR units)
const vec2 LUT_SIZE = vec2(256.0, 64.0);

uniform sampler2D uTransmittanceLUT;
uniform float uAtmoOn;             // 0 = vacuum (no scattering, planet shadow only)
uniform float uAtmoGround;         // scattering ground radius (sea level)
uniform float uAtmoTop;            // top of the atmosphere
uniform vec3  uAtmoRayleigh;       // scattering coefficients per world unit
uniform float uAtmoMie;
uniform vec3  uAtmoOzone;          // absorption per world unit (tent profile)
uniform float uAtmoHR;             // Rayleigh scale height (world units)
uniform float uAtmoHM;             // Mie scale height
uniform vec3  uSkyTint;            // normalised Rayleigh colour (sky light)

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// ray / sphere at the origin: (tNear, tFar); tNear > tFar means miss
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e20, -1e20);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

float ozoneDensity(float h) {
  float top = uAtmoTop - uAtmoGround;
  return max(0.0, 1.0 - abs(h - top * 0.25) / (top * 0.15));
}

// transmittance from a point at radius r toward a direction with zenith
// cosine mu, out to space (0 when the planet blocks it, soft penumbra)
vec3 atmoTransmittance(float r, float mu) {
  float y = sat((r - uAtmoGround) / max(uAtmoTop - uAtmoGround, 1e-4));
  vec2 uv = vec2(mu * 0.5 + 0.5, y);
  uv = (uv * (LUT_SIZE - 1.0) + 0.5) / LUT_SIZE;
  return textureLod(uTransmittanceLUT, uv, 0.0).rgb;
}

// direct sun irradiance reaching world point p (planet shadow + reddening)
vec3 sunIrradiance(vec3 p) {
  float r = length(p);
  return atmoTransmittance(r, dot(p / r, uSunDir)) * (SUN_E * uSunIntensity);
}

// diffuse sky light on a surface with normal n at p: blue-tinted, fades out
// across the terminator; a faint floor keeps the night side readable
vec3 skyIrradiance(vec3 p, vec3 n) {
  vec3 up = normalize(p);
  float mu = dot(up, uSunDir);
  float day = smoothstep(-0.22, 0.35, mu);
  vec3 tint = mix(vec3(1.0), uSkyTint, 0.75 * uAtmoOn);
  float facing = 0.62 + 0.38 * dot(n, up);
  vec3 sky = tint * (SUN_E * uSunIntensity * uAmbient * 0.35) * day * facing;
  return sky + vec3(0.004, 0.005, 0.008) * SUN_E;
}

float phaseRayleigh(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
`;

// ---------------------------------------------------------------------------
// Cloud field — the weather cubemap (baked in PlanetPipeline) drives the
// volumetric raymarch AND the shadows cast on terrain / ocean, so shadows
// always match the clouds above. Sampling a texture keeps the (already big)
// terrain program light on ANGLE/D3D.
// ---------------------------------------------------------------------------
export const CLOUD_FIELD_GLSL = /* glsl */ `
uniform samplerCube uWeatherMap;   // r: cloud field, g: cloud type
uniform samplerCube uWeatherMapNext; // the next evolution keyframe
uniform float uWeatherBlend;       // 0..1 between the two keyframes
uniform highp sampler3D uCloudNoise;   // tileable Worley fbm (r) + Perlin-Worley (g)
uniform highp sampler3D uCloudErosion; // the same Worley fbm alone (detail taps)
uniform float uCloudShapeFreq;     // world-space noise frequencies
uniform float uCloudDetailFreq;
uniform float uCloudCellFreq;      // column / storm-cell noise: cells as wide as the layer is thick
uniform vec3  uCloudWind;
uniform float uCloudCoverage;
uniform float uCloudSoftness;
uniform float uCloudDensity;
uniform float uCloudBottom;        // shell radii (world units)
uniform float uCloudTop;
uniform float uCloudRotation;      // drift angle around the pole axis
uniform vec2  uCloudRotCS;         // its cos / sin (per frame: no trig per lookup)
uniform float uCloudShadowStr;
uniform float uCloudTowering;      // vertical development of convective clouds
uniform float uCloudShear;         // wind shear: lookup offset at the shell top (direction units)

// Regional weather systems (weather.js packs them; uWxCount = 0 costs one
// branch). Each is a spherical cap around a planet-frame centre:
//   A  xyz centre, w cos(radius)
//   B  x 1 / sin(radius), y strength (fades applied), z kind, w spin angle
//   C  x coverage, y rain, z tower, w eye radius (fraction; sign = spin sense)
// kinds: 0 thunderstorm cluster, 1 hurricane, 2 stratiform rain, 3 clear sky
#define MAX_WX 8
uniform int   uWxCount;
uniform vec4  uWxA[MAX_WX];
uniform vec4  uWxB[MAX_WX];
uniform vec4  uWxC[MAX_WX];
uniform float uRainAmount;         // precipitation from dense convective cells
uniform float uRainOn;             // 1 when anything can rain
uniform vec3  uRainColor;
uniform float uRainCam;            // rain where the camera is (CPU, once per frame)

vec3 cloudRotate(vec3 d) {
  return vec3(d.x * uCloudRotCS.x - d.z * uCloudRotCS.y, d.y, d.x * uCloudRotCS.y + d.z * uCloudRotCS.x);
}

// weather at an already-rotated direction: the field evolves by crossfading
// two baked keyframes, so cloud systems grow and dissolve continuously
// instead of popping when a new state is swapped in
vec4 weatherRotated(vec3 dr) {
  return mix(textureLod(uWeatherMap, dr, 0.0), textureLod(uWeatherMapNext, dr, 0.0), uWeatherBlend);
}

vec4 weatherAt(vec3 dir) {
  return weatherRotated(cloudRotate(dir));
}

// 0..1 cloud cover from the weather field and the coverage slider
float cloudCover(vec4 w) {
  float cut = 1.0 - uCloudCoverage;
  float soft = max(uCloudSoftness, 0.01);
  return smoothstep(cut - soft * 0.15, cut + soft + 0.05, w.r);
}

// Zonal wind shear: the upper part of a cloud is carried downstream, so
// towers lean and their tops stream off instead of every column being
// the 2D field extruded straight up. Trade-wind easterlies in the tropics,
// westerlies at mid latitudes. Equivariant under the drift rotation.
vec3 shearOffset(vec3 d, float hf) {
  float lat = abs(d.y);
  float s = mix(-1.0, 1.0, smoothstep(0.42, 0.58, lat)) * (1.0 - smoothstep(0.85, 0.97, lat));
  return vec3(-d.z, 0.0, d.x) * (s * uCloudShear * hf);
}

vec3 rotateAxis(vec3 v, vec3 a, float ang) {
  float c = cos(ang), s = sin(ang);
  return v * c + cross(a, v) * s + a * (dot(a, v) * (1.0 - c));
}

// tangent frame of a system centre (same convention as weather.js)
void wxFrame(vec3 c, out vec3 e1, out vec3 e2) {
  e1 = normalize(cross(c, abs(c.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  e2 = cross(e1, c);
}

// Weather at a planet-frame unit direction and shell height fraction hf:
//   x cloud cover (coverage slider applied, 0..1)
//   y cloud type  (0 flat stratiform deck .. 1 deep convection)
//   z precipitation (0..1)
//   w column noise inside a system (the cloud pass reuses it for tower
//     heights), -1 elsewhere
// Hurricanes twist the lookup of the background field around their centre
// (rigid spin + a static spiral, so it never winds up over time), then every
// system blends its own structure over the cover.
vec4 cloudWeather(vec3 dir, float hf) {
  vec3 look = dir;
  float vk = 0.0;
  bool inAny = false;
  for (int i = 0; i < MAX_WX; i++) {
    if (i >= uWxCount) break;
    vec4 A = uWxA[i];
    if (dot(dir, A.xyz) <= A.w) continue;
    inAny = true;
    vec4 B = uWxB[i];
    if (abs(B.z - 1.0) > 0.5 || vk > 0.0) continue;
    vec3 e1, e2;
    wxFrame(A.xyz, e1, e2);
    float rr = length(vec2(dot(dir, e1), dot(dir, e2))) * B.x;
    float sense = sign(uWxC[i].w);
    look = rotateAxis(dir, A.xyz, -(B.w + sense * 2.4 * exp(-3.0 * rr)));
    vk = max(1.0 - smoothstep(0.7, 1.0, rr), 1e-4);
  }
  vec3 lk = cloudRotate(look + shearOffset(look, hf));
  vec4 w = weatherRotated(lk);
  if (vk > 0.0 && vk < 0.999) w = mix(weatherRotated(cloudRotate(dir + shearOffset(dir, hf))), w, vk);
  float cov = cloudCover(w);
  float type = w.g;
  float rain = 0.0;
  // system-scale cells (the baked field is far coarser than a storm): ONE
  // noise tap at the column-noise scale (cells about as wide as the clouds
  // are tall), turning with a hurricane's frame; only inside a system
  vec2 cn = vec2(-1.0);
  if (inAny) cn = textureLod(uCloudNoise, lk * uCloudBottom * uCloudCellFreq + uCloudWind * 0.2, 0.0).rg;
  for (int i = 0; i < MAX_WX && inAny; i++) {
    if (i >= uWxCount) break;
    vec4 A = uWxA[i];
    if (dot(dir, A.xyz) <= A.w) continue;
    vec4 B = uWxB[i];
    vec4 C = uWxC[i];
    vec3 e1, e2;
    wxFrame(A.xyz, e1, e2);
    vec2 q = vec2(dot(dir, e1), dot(dir, e2)) * B.x;   // |q| = 1 at the edge
    float rr = length(q);
    // ragged outline (fine cells + the broad background field), always
    // closed before the cap's edge
    float inCap = 1.0 - smoothstep(0.85, 1.0, rr);
    float k = B.y * (1.0 - smoothstep(0.45, 0.95, rr + (cn.r - 0.5) * 0.35 + (w.r - 0.5) * 0.6)) * inCap;
    if (B.z < 0.5) {
      // thunderstorm cluster: a dense mass whose cells set how high each
      // tower climbs (height, not density, varies cell to cell: varying the
      // cover per column would read as vertical stripes)
      float cells = smoothstep(0.45, 0.8, cn.r + 0.28 * (1.0 - rr) + 0.12 * cn.g);
      cov = mix(cov, max(cov, C.x * (0.72 + 0.28 * cells)), k);
      type = mix(type, mix(0.45, 1.0, cells), k * C.z);
      rain += k * C.y * (0.35 + 0.65 * cells);
    } else if (B.z < 1.5) {
      // hurricane: clear eye, towering eyewall, central dense overcast,
      // two log-spiral rain bands broken into cells (in the spinning frame)
      float sense = sign(C.w);
      float eye = abs(C.w);
      float ang = atan(q.y, q.x) - B.w;
      float arms = 0.5 + 0.5 * cos(2.0 * ang * sense + 5.5 * log(max(rr, 1e-3)) + (cn.r - 0.5) * 3.0 + w.r * 1.5);
      float we = (rr - eye * 1.9) / (eye * 1.15);
      float wall = exp(-we * we);
      float cdo = (1.0 - smoothstep(eye * 2.2, 0.42, rr)) * (0.8 + 0.3 * cn.g);
      float bands = smoothstep(0.45, 0.9, arms) * (1.0 - smoothstep(0.5, 1.0, rr)) * smoothstep(eye * 1.5, eye * 4.0, rr)
                  * smoothstep(0.25, 0.6, cn.g + 0.2);
      float s = max(wall, max(cdo, bands * (0.6 + 0.5 * w.r)));
      float eyeClear = 1.0 - smoothstep(eye * 0.8, eye * 1.45, rr);
      // subsiding moats between the bands thin the background clouds
      float kh = B.y * inCap * (1.0 - smoothstep(0.6, 1.0, rr));
      cov = mix(cov, max(cov * mix(1.0, 0.45, sat(rr * 2.0 - 0.4)), sat(s * C.x)), kh);
      cov *= 1.0 - eyeClear * kh;
      type = mix(type, 1.0, kh * C.z * max(wall, cdo * 0.8));
      rain += kh * C.y * s * (1.0 - eyeClear);
    } else if (B.z < 2.5) {
      // stratiform rain front: a long band of flat, thick grey deck
      vec2 qf = vec2(q.x * 0.82 + q.y * 0.57, q.y * 0.82 - q.x * 0.57);
      float re = length(vec2(qf.x, qf.y * 2.4)) + (cn.r - 0.5) * 0.5;
      float kf = B.y * (1.0 - smoothstep(0.45, 0.95, re)) * inCap;
      float deck = C.x * smoothstep(0.2, 0.5, cn.g * 0.7 + 0.32 + 0.2 * w.r);
      cov = mix(cov, max(cov, deck), kf);
      type = mix(type, 0.12 + 0.5 * C.z, kf);
      rain += kf * C.y * deck;
    } else {
      // clear sky: subsiding air dissolves the clouds
      cov *= 1.0 - k * C.x;
      rain *= 1.0 - k;
    }
  }
  if (uRainOn > 0.5) rain += uRainAmount * smoothstep(0.6, 0.95, cov) * smoothstep(0.55, 0.9, type);
  else rain = 0.0;
  return vec4(cov, type, sat(rain), cn.x);
}

// Precipitation alone, for the rain-shaft march: the same systems without
// the hurricane twist or the cell tap (the shafts' own noise breaks them up),
// so each step costs one weather lookup.
float cloudRainAt(vec3 dir) {
  vec4 w = weatherAt(dir);
  float cov = cloudCover(w);
  float rain = 0.0;
  for (int i = 0; i < MAX_WX; i++) {
    if (i >= uWxCount) break;
    vec4 A = uWxA[i];
    float c = dot(dir, A.xyz);
    if (c <= A.w) continue;
    vec4 B = uWxB[i];
    vec4 C = uWxC[i];
    // angular distance as a fraction of the radius (|q| of cloudWeather)
    float rr = sqrt(max(1.0 - c * c, 0.0)) * B.x;
    float k = B.y * (1.0 - smoothstep(0.45, 0.95, rr + (w.r - 0.5) * 0.6)) * (1.0 - smoothstep(0.85, 1.0, rr));
    if (B.z < 0.5) rain += k * C.y * 0.75;
    else if (B.z < 1.5) {
      float eye = abs(C.w);
      rain += k * C.y * (1.0 - smoothstep(0.42, 0.9, rr) * 0.6) * smoothstep(eye * 0.8, eye * 1.45, rr);
    } else if (B.z < 2.5) rain += k * C.y * 0.8 * (1.0 - smoothstep(0.3, 0.7, rr));
    else rain *= 1.0 - k;
  }
  rain += uRainAmount * smoothstep(0.6, 0.95, cov) * smoothstep(0.55, 0.9, w.g);
  return sat(rain);
}

// Vertical extent of the cloud types as fractions of the shell:
// x / y base ramp, z / w top ramp. Stratiform decks stay low and flat,
// cumulus are as tall as wide, cumulonimbus fill the shell. The cores of
// systems (high cover) build higher than their fringes, which shapes domes.
vec4 cloudGradient(float type, float cov) {
  float tt = sat(type * (0.4 + 1.2 * uCloudTowering));
  float top = mix(0.3, 1.0, sat(tt * 0.75 + cov * 0.45));
  // The density fades over most of the column's height. With the coverage
  // remap (density needs base x profile > 1 - cover) this shapes DOMES: a
  // system's thin fringe only holds cloud near the base, its dense core the
  // full height, so outlines round off upward instead of being the cover map
  // extruded into vertical walls. A short ramp would also give flat lids,
  // and lids at different heights read as stacked layers.
  return vec4(0.0, 0.07, top * mix(0.3, 0.15, tt), top);
}

float cloudProfile(float hf, vec4 g) {
  return smoothstep(g.x, g.y, hf) * (1.0 - smoothstep(g.z, g.w, hf));
}

// fraction of the shell a column of this type fills (shadows, rain)
float cloudColumn(vec4 g) {
  return max(0.5 * (g.z + g.w) - 0.5 * (g.x + g.y), 0.0);
}

// Fraction of sunlight blocked by the clouds above world point p: the sun
// ray meets the lower shell and the SAME cover + billow field as the volume
// is looked up there, so even small cumulus cast matching shadows. Their
// darkness follows the column's optical depth (type height x density, rain
// clouds are heavier) and the slant path through the layer: shadows are
// faint under thin fair-weather cumulus, deep under storms, long and dark at
// low sun. rain = precipitation at that point (wet ground).
float cloudShadowRain(vec3 p, out float rain) {
  rain = 0.0;
  if (uCloudShadowStr < 0.005 && uRainOn < 0.5) return 0.0;
  float rm = mix(uCloudBottom, uCloudTop, 0.25);
  vec2 t = raySphere(p, uSunDir, rm);
  vec3 q;
  if (t.y < 0.0 || t.x > t.y) q = normalize(p) * rm;
  else q = p + uSunDir * (t.x > 0.0 ? t.x : t.y);
  vec3 d = normalize(q);
  vec4 w = cloudWeather(d, 0.0);
  rain = w.z;
  if (w.x < 0.01 || uCloudShadowStr < 0.005) return 0.0;
  vec4 g = cloudGradient(w.y, w.x);
  vec3 dr = cloudRotate(d);
  vec2 n = textureLod(uCloudNoise, dr * rm * uCloudShapeFreq + uCloudWind * 0.35, 0.0).rg;
  float base = sat((n.y - (n.x - 1.0)) / (2.0 - n.x));
  float dens = sat((base - (1.0 - w.x)) / max(w.x, 1e-3)) * w.x;
  float mu = max(dot(d, uSunDir), 0.12);
  float od = dens * cloudColumn(g) * (1.0 + w.z) * uCloudDensity * 14.0 / sqrt(mu);
  return (1.0 - exp(-od)) * uCloudShadowStr;
}

float cloudShadow(vec3 p) {
  float rain;
  return cloudShadowRain(p, rain);
}
`;

// ---------------------------------------------------------------------------
// Lightning (weather.js schedules the strikes): a few point flashes that
// light the cloud volume from inside, and cloud-to-ground bolt polylines.
// Included by the cloud pass and the composite only.
// ---------------------------------------------------------------------------
export const LIGHTNING_GLSL = /* glsl */ `
#define MAX_FLASH 4
#define MAX_BOLT 2
#define BOLT_PTS 8
uniform int  uFlashCount;
uniform vec4 uFlashPos[MAX_FLASH];   // xyz planet-local, w glow radius
uniform vec4 uFlashCol[MAX_FLASH];   // rgb radiance, w 1 = reached the ground
uniform int  uBoltCount;
uniform vec4 uBoltPts[MAX_BOLT * BOLT_PTS];
uniform vec4 uBoltCol[MAX_BOLT];     // rgb radiance, w channel width (world)

// light a flash scatters at p (diffused through the cloud around it)
vec3 flashLight(vec3 p) {
  vec3 L = vec3(0.0);
  for (int i = 0; i < MAX_FLASH; i++) {
    if (i >= uFlashCount) break;
    vec3 d = p - uFlashPos[i].xyz;
    float r = uFlashPos[i].w;
    float x2 = dot(d, d) / (r * r);
    L += uFlashCol[i].rgb * exp(-sqrt(x2) * 1.8) / (1.0 + x2 * 3.0);
  }
  return L;
}
`;

// ---------------------------------------------------------------------------
// Climate noises — also included by the terrain VERTEX shader (which cannot
// take SURFACE_GLSL: it uses screen-space derivatives).
// ---------------------------------------------------------------------------
export const CLIMATE_NOISE_GLSL = /* glsl */ `
uniform float uMoistScale;    // frequency of the moisture field

// Low-frequency climate noises (biome jitter, moisture field). The terrain
// can evaluate them per vertex and interpolate (see materials.js), so they
// also come with their gradient w.r.t. dir (x = value, yzw = gradient).
float jitterNoise(vec3 dir) { return gnoise(dir * 11.0 + uSeedOffset * 0.53); }
vec4 jitterNoiseD(vec3 dir) {
  vec4 n = gnoised(dir * 11.0 + uSeedOffset * 0.53);
  return vec4(n.x, n.yzw * 11.0);
}
float moistNoise(vec3 dir) {
  vec3 q = dir * uMoistScale + uSeedOffset * 1.31 + 31.7;
  return gnoise(q) + 0.5 * gnoise(q * 2.07 + 13.1) + 0.25 * gnoise(q * 4.3 + 5.7);
}
vec4 moistNoiseD(vec3 dir) {
  vec3 q = dir * uMoistScale + uSeedOffset * 1.31 + 31.7;
  vec4 a = gnoised(q), b = gnoised(q * 2.07 + 13.1), c = gnoised(q * 4.3 + 5.7);
  return vec4(a.x + 0.5 * b.x + 0.25 * c.x,
              (a.yzw + b.yzw * (0.5 * 2.07) + c.yzw * (0.25 * 4.3)) * uMoistScale);
}
`;

// ---------------------------------------------------------------------------
// Surface: climate-driven biomes (temperature from latitude + altitude lapse,
// moisture from the Hadley/Ferrel cell pattern + continentality + noise),
// slope-driven rock, temperature-driven snow, and multi-octave world-space
// detail whose octaves fade with the pixel footprint — zooming in reveals new
// detail instead of aliasing, at any planet size.
// ---------------------------------------------------------------------------
export const SURFACE_GLSL = /* glsl */ `
${CLIMATE_NOISE_GLSL}
uniform float uBandSoftness;  // width of biome transitions
uniform float uSnowLine;
uniform float uPolarCaps;
uniform float uBiomeAmount;   // 0 = plain altitude ramp, 1 = full biome map
uniform float uTempBias;      // -1 frozen .. +1 scorching
uniform vec3 uColDeep;
uniform vec3 uColShallow;
uniform vec3 uColSand;
uniform vec3 uColGrass;
uniform vec3 uColForest;
uniform vec3 uColRock;
uniform vec3 uColSnow;
uniform vec3 uColFoam;
uniform vec3 uBioTundra;      // cold  / dry
uniform vec3 uBioSteppe;      // cold  / mid
uniform vec3 uBioTaiga;       // cold  / wet
uniform vec3 uBioShrub;       // temperate / dry   (mid+wet reuse grass/forest)
uniform vec3 uBioDesert;      // hot   / dry
uniform vec3 uBioSavanna;     // hot   / mid
uniform vec3 uBioJungle;      // hot   / wet

vec3 lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

float soft01(float edge, float v, float w) {
  return smoothstep(edge - w, edge + w, v);
}

// World-space fractal detail. Octave periods run from ~14 world units down to
// sub-unit; each fades out once it drops below ~2-4 pixels (fp = world units
// per pixel). slope is the self-similar bump gradient (per-octave unit slope).
// Octaves only get finer, so the first fully faded one ends the sum.
float surfaceDetail(vec3 wp, float fp, out vec3 slope) {
  float v = 0.0;
  slope = vec3(0.0);
  float f = 1.0 / 14.0;
  float a = 0.5;
  for (int i = 0; i < DYN(5); i++) {
    float fade = 1.0 - smoothstep(0.18, 0.45, f * fp);
    if (fade <= 0.0) break;
    vec4 n = gnoised(wp * f + float(i) * 17.31);
    v += n.x * a * fade;
    slope += n.yzw * fade * 0.55;
    f *= 2.13;
    a *= 0.62;
  }
  return v;
}

// temperature 0 (polar) .. 1 (equatorial); altitude lapse cools peaks
float climateTemp(vec3 dir, float rel, float jit) {
  float lat = abs(dir.y);
  float t = 1.0 - pow(lat, 1.35) * 1.02 - rel * 0.85 + uTempBias * 0.45 + jit * 0.07;
  t -= smoothstep(0.55, 0.98, lat) * uPolarCaps * 0.3;
  return sat(t);
}

// moisture: wet equator, dry subtropics (~30 deg), wet storm tracks (~60
// deg), dry poles — then continental interiors dry out, coasts stay humid.
// n = moistNoise(dir)
float climateMoist(vec3 dir, float cLow, float jit, float n) {
  float latA = asin(clamp(dir.y, -1.0, 1.0));
  float cells = cos(latA * 6.0);
  float interior = smoothstep(0.50, 0.66, cLow);
  return sat(0.50 + cells * 0.2 + n * 0.62 - interior * 0.24 + jit * 0.06);
}

vec3 biomeAlbedo(float temp, float moist) {
  float w = max(uBandSoftness * 2.0, 0.04);
  float t1 = soft01(0.34, temp, w);
  float t2 = soft01(0.68, temp, w);
  vec3 dry = mix(lin(uBioTundra), lin(uBioShrub),  t1); dry = mix(dry, lin(uBioDesert),  t2);
  vec3 mid = mix(lin(uBioSteppe), lin(uColGrass),  t1); mid = mix(mid, lin(uBioSavanna), t2);
  vec3 wet = mix(lin(uBioTaiga),  lin(uColForest), t1); wet = mix(wet, lin(uBioJungle),  t2);
  float m1 = soft01(0.34, moist, w);
  float m2 = soft01(0.62, moist, w);
  return mix(mix(dry, mid, m1), wet, m2);
}

// polar ice mask (land ice sheets + sea ice), shared with the ocean pass
float polarIce(vec3 dir, float jit) {
  float lat = abs(dir.y) + jit * 0.035;
  float edge = 0.985 - uPolarCaps * 0.22 - max(-uTempBias, 0.0) * 0.2;
  return smoothstep(edge - 0.03, edge + 0.03, lat) * step(0.01, uPolarCaps);
}

// linear albedo. det = surfaceDetail value, returns rock/snow cover for
// shading. noiseGiven: jitN / moistN are jitterNoise / moistNoise(dir)
// supplied by the caller (else evaluated here, moisture on land only).
vec3 surfaceAlbedoN(vec3 dir, float h, float slope, float cLow, float mtn, float det,
                    bool noiseGiven, float jitN, float moistN,
                    out float rockOut, out float snowOut) {
  float sea = uSeaLevel;
  float jit = (noiseGiven ? jitN : jitterNoise(dir)) * 0.7 + det * 0.6;
  rockOut = 0.0;
  snowOut = 0.0;

  if (h < sea) {
    // seabed: pale sand on the shelves, darker silt on the abyssal plain
    float depth = (sea - h) / max(sea, 1e-4);
    vec3 sand = lin(uColSand);
    vec3 silt = lin(uColRock) * vec3(0.55, 0.52, 0.5);
    return mix(sand, silt, smoothstep(0.02, 0.3, depth + jit * 0.04)) * (1.0 + det * 0.15);
  }
  float rel = (h - sea) / max(1.0 - sea, 1e-4);

  float temp = climateTemp(dir, rel, jit);
  float moist = climateMoist(dir, cLow, jit, noiseGiven ? moistN : moistNoise(dir));
  vec3 plain = mix(lin(uColGrass), lin(uColForest), smoothstep(0.02, 0.25, rel + jit * 0.03));
  vec3 col = mix(plain, biomeAlbedo(temp, moist), sat(uBiomeAmount));

  // vegetation density / soil variation at every scale
  col *= 1.0 + det * 0.22;
  col = mix(col, col * vec3(1.12, 1.0, 0.82), sat(gnoise(dir * 38.0 + uSeedOffset) * 0.8 + 0.2) * 0.35);

  // beaches: only on low, flat coasts
  float beach = (1.0 - smoothstep(0.004, 0.03, rel + det * 0.012)) * (1.0 - smoothstep(0.05, 0.16, slope));
  col = mix(col, lin(uColSand), beach);

  // bare rock: steep slopes and high ranges above the tree line, with
  // eroded strata banding close up
  float sph = h * 900.0 + det * 5.0;
  float strata = 0.85 + 0.15 * sin(sph) * (1.0 - smoothstep(0.4, 1.2, fwidth(sph)));
  vec3 rockCol = lin(uColRock) * strata * (1.0 + det * 0.25);
  // thresholds widen with the screen-space rate of change: no sub-pixel
  // sparkle on distant ridgelines
  float aaR = min(fwidth(rel) * 1.5, 0.2);
  float rock = max(smoothstep(0.16, 0.38, slope + det * 0.05),
                   smoothstep(0.30 - aaR, 0.55 + aaR, rel + mtn * 0.12 + det * 0.04) * 0.9);
  col = mix(col, rockCol, rock);
  rockOut = rock;

  // snow: altitude snow line that drops toward the poles and in cold
  // climates; steep faces shed it
  float lat = abs(dir.y);
  float line = uSnowLine * (1.0 - lat * lat * 0.85) - uTempBias * 0.25;
  float snow = smoothstep(line - 0.04 - aaR, line + 0.04 + aaR, rel + det * 0.035);
  snow *= 1.0 - smoothstep(0.30, 0.55 + aaR, slope);
  snow *= 1.0 - smoothstep(1.0, 1.1, uSnowLine);   // >1.1 = no altitude snow
  snow = max(snow, polarIce(dir, jit));
  col = mix(col, lin(uColSnow) * (1.0 + det * 0.05), snow);
  snowOut = snow;
  return col;
}

vec3 surfaceAlbedo(vec3 dir, float h, float slope, float cLow, float mtn, float det,
                   out float rockOut, out float snowOut) {
  return surfaceAlbedoN(dir, h, slope, cLow, mtn, det, false, 0.0, 0.0, rockOut, snowOut);
}
`;
