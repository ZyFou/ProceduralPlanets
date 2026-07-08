// ============================================================================
// Shared shading GLSL: toon lighting, the biome-driven surface palette and the
// cloud coverage field. ONE source of truth — the live terrain material, the
// water/cloud shells and the export texture baker all include these blocks, so
// the baked texture can never drift from what the viewport shows.
//
// Include order matters (blocks only declare their own uniforms):
//   NOISE_UNIFORMS + NOISE_FUNCTIONS  (noiseGLSL.js — height01, fbm, vnoise3)
//   TOON_GLSL                         (sun + toon banding)
//   SURFACE_GLSL                      (biomes + surfaceColor + terrainNormal)
//   CLOUD_FIELD_GLSL                  (cloud coverage field, no sun needed)
//   CLOUD_SHADOW_GLSL                 (needs TOON_GLSL for uSunDir)
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
// Surface palette: a 3x3 biome grid (temperature x moisture) blended with the
// classic altitude ramp, plus beach / rock / snow / polar overlays. All knobs
// are uniforms; band() gives every transition the hard cartoon edge.
// ---------------------------------------------------------------------------
export const SURFACE_GLSL = /* glsl */ `
uniform float uBandSoftness;
uniform float uSnowLine;
uniform float uPolarCaps;
uniform float uBiomeAmount;   // 0 = plain altitude bands, 1 = full biome map
uniform float uTempBias;      // -1 frozen .. +1 scorching
uniform float uMoistScale;    // frequency of the moisture field
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

// hard-ish band helper: cartoon transitions with a controllable soft width
float band(float edge, float v) {
  return smoothstep(edge - uBandSoftness, edge + uBandSoftness, v);
}

// analytic normal from finite differences on the height field;
// also returns height fraction and slope for the palette
vec3 terrainNormal(vec3 dir, out float hC, out float slope) {
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, dir));
  vec3 t2 = cross(dir, t1);
  float eps = 0.0012;
  hC = height01(dir);
  float hA = height01(normalize(dir + t1 * eps));
  float hB = height01(normalize(dir + t2 * eps));
  vec3 pC = dir * (uRadius + hC * uHeightScale);
  vec3 pA = normalize(dir + t1 * eps) * (uRadius + hA * uHeightScale);
  vec3 pB = normalize(dir + t2 * eps) * (uRadius + hB * uHeightScale);
  vec3 n = normalize(cross(pA - pC, pB - pC));
  if (dot(n, dir) < 0.0) n = -n;
  slope = 1.0 - clamp(dot(n, dir), 0.0, 1.0);
  return n;
}

// temperature 0 (polar) .. 1 (equatorial), cooled by altitude, wobbled by
// noise so climate borders aren't perfect latitude rings
float biomeTemp(vec3 dir, float rel) {
  float lat = abs(dir.y);
  float wob = (vnoise3(dir * 4.0 + uSeedOffset * 0.7) - 0.5) * 0.18;
  return clamp(1.0 - lat * 1.1 - rel * 0.5 + uTempBias * 0.55 + wob, 0.0, 1.0);
}

// moisture: independent low-frequency field with boosted contrast so wet and
// dry regions read as distinct patches, not a mushy gradient
float biomeMoist(vec3 dir) {
  float m = fbm(dir * uMoistScale + uSeedOffset * 1.31 + 31.7);
  return clamp((m - 0.5) * 2.4 + 0.5, 0.0, 1.0);
}

vec3 biomeColor(vec3 dir, float rel) {
  float temp = biomeTemp(dir, rel);
  float moist = biomeMoist(dir);
  float t1 = band(0.38, temp);   // cold -> temperate
  float t2 = band(0.70, temp);   // temperate -> hot
  vec3 dry = mix(uBioTundra, uBioShrub,  t1); dry = mix(dry, uBioDesert,  t2);
  vec3 mid = mix(uBioSteppe, uColGrass,  t1); mid = mix(mid, uBioSavanna, t2);
  vec3 wet = mix(uBioTaiga,  uColForest, t1); wet = mix(wet, uBioJungle,  t2);
  float m1 = band(0.36, moist);
  float m2 = band(0.66, moist);
  vec3 col = mix(dry, mid, m1);
  return mix(col, wet, m2);
}

vec3 surfaceColor(vec3 dir, float h, float slope) {
  float sea = uSeaLevel;
  if (h < sea) {
    // seabed: sand near shore -> deep floor
    float depth = clamp((sea - h) / max(sea, 1e-4), 0.0, 1.0);
    return mix(uColSand * 0.72, uColDeep * 0.55, band(0.28, depth));
  }
  float rel = (h - sea) / max(1.0 - sea, 1e-4);   // 0..1 above sea

  // base vegetation: classic altitude ramp blended toward the biome map
  vec3 alt = mix(uColGrass, uColForest, band(0.35, rel));
  vec3 col = mix(alt, biomeColor(dir, rel), clamp(uBiomeAmount, 0.0, 1.0));

  // subtle macro tint so big single-biome regions don't read as flat fills
  col *= mix(0.95, 1.05, vnoise3(dir * 9.0 + uSeedOffset * 0.53));

  // beach ring just above the waterline
  col = mix(uColSand, col, band(0.05, rel));

  // high peaks: rock then snow; steep slopes read as rock at any altitude
  col = mix(col, uColRock, band(0.62, rel));
  col = mix(col, uColSnow, band(uSnowLine, rel + (1.0 - slope) * 0.02));
  col = mix(col, uColRock, band(0.42, slope) * (1.0 - band(uSnowLine, rel)));

  // polar caps override everything above water, with a wobbled edge
  float lat = abs(dir.y) + (vnoise3(dir * 6.0 + uSeedOffset) - 0.5) * 0.14;
  float polar = smoothstep(0.78, 0.92, lat) * uPolarCaps;
  return mix(col, uColSnow, polar);
}
`;

// ---------------------------------------------------------------------------
// Cloud coverage field — shared by the cloud shell (shape) and the terrain /
// water shaders (cast shadows), so shadows always match the clouds above.
// ---------------------------------------------------------------------------
export const CLOUD_FIELD_GLSL = /* glsl */ `
uniform float uCloudCoverage;
uniform float uCloudScale;
uniform float uCloudSpeed;

// slow rotation drift around the poles axis + morphing over time, with a
// mild zonal stretch so systems streak into belts. Kept warp-free on purpose:
// this block is inlined into the (already huge) terrain and water programs
// for cast shadows, and ANGLE's D3D compiler chokes on more inlined noise.
// The cloud fragment adds its own swirl warp on top (cloudWarp there).
vec3 cloudDomain(vec3 dir) {
  float t = uTime * uCloudSpeed * 0.02;
  float ca = cos(t), sa = sin(t);
  vec3 d = vec3(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);
  return d * uCloudScale * vec3(1.0, 1.35, 1.0) + uSeedOffset * 0.37 + vec3(0.0, t * 2.1, 0.0);
}

float cloudBase(vec3 dir) {
  return fbm(cloudDomain(dir));
}
`;

export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform float uCloudShadowStr;

// soft shadow the cloud layer casts on whatever is below — graded with the
// cloud density so thin cloud edges only dim slightly; sampled slightly
// toward the sun so shadows sit offset from their clouds
float cloudShadow(vec3 dir) {
  if (uCloudShadowStr < 0.005) return 0.0;
  float c = cloudBase(normalize(dir + uSunDir * 0.05));
  float cut = 1.0 - uCloudCoverage;
  return smoothstep(cut, cut + 0.30, c) * uCloudShadowStr * 0.85;
}
`;
