// ============================================================================
// Shared GLSL noise + planet height field. Every material (terrain, water,
// clouds) includes this so they all agree on the same surface. Heights are
// evaluated on the GPU only — no CPU heightmap exists anywhere.
//
// height01(dir): unit sphere direction -> [0,1] height fraction.
// Composition: domain-warped fbm continents, ridged mountains masked to land,
// optional worley crater dents, polar flattening. All knobs are uniforms so
// terrain edits are live; only OCTAVES is a compile-time define.
// ============================================================================

export const NOISE_UNIFORMS_GLSL = /* glsl */ `
uniform vec3  uSeedOffset;     // random domain offset derived from the seed
uniform float uRadius;         // planet radius (world units)
uniform float uHeightScale;    // max terrain height above r=uRadius
uniform float uSeaLevel;       // 0..1 fraction of uHeightScale
uniform float uNoiseScale;     // base frequency of the continent fbm
uniform float uPersistence;    // fbm amplitude falloff
uniform float uLacunarity;     // fbm frequency growth
uniform float uWarp;           // domain warp strength
uniform float uRidge;          // 0..1 ridged-mountain blend
uniform float uMountainScale;  // frequency of the ridged layer
uniform float uCraters;        // 0..1 crater dent strength
uniform float uCraterScale;    // crater cell frequency
uniform float uContinents;     // continent shelf shaping (0 = raw fbm)
uniform float uTime;
`;

export const NOISE_FUNCTIONS_GLSL = /* glsl */ `
// -- hash / value noise -------------------------------------------------------
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1, 0, 0));
  float c = hash13(i + vec3(0, 1, 0));
  float d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1));
  float g = hash13(i + vec3(1, 0, 1));
  float h = hash13(i + vec3(0, 1, 1));
  float k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
             mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    sum += vnoise3(p) * amp;
    norm += amp;
    amp *= uPersistence;
    p *= uLacunarity;
  }
  return sum / max(norm, 1e-5);
}

// ridged variant: sharp crests for mountain ranges
float ridgedFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    float n = 1.0 - abs(vnoise3(p) * 2.0 - 1.0);
    sum += n * n * amp;
    norm += amp;
    amp *= uPersistence;
    p *= uLacunarity;
  }
  return sum / max(norm, 1e-5);
}

// worley F1 for crater dents
float worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 8.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 41.7));
    d = min(d, length(g + o - f));
  }
  return d;
}

// -- planet height field ------------------------------------------------------
// dir: unit sphere direction. Returns height fraction in [0,1].
float height01(vec3 dir) {
  vec3 p = dir * uNoiseScale + uSeedOffset;

  // domain warp gives coastlines their organic wobble
  vec3 w = vec3(
    vnoise3(p * 1.7 + 11.3),
    vnoise3(p * 1.7 + 47.9),
    vnoise3(p * 1.7 + 83.1)
  ) - 0.5;
  p += w * uWarp;

  // continents: fbm pushed through a shelf curve so oceans are broad basins
  // and land masses have coherent interiors
  float c = fbm(p);
  float shelf = smoothstep(0.38, 0.62, c);
  c = mix(c, shelf * 0.72 + c * 0.28, uContinents);

  // ridged mountains, masked to the land interior so ranges don't spike the sea
  float landMask = smoothstep(0.48, 0.62, c);
  float m = ridgedFbm(p * uMountainScale + 7.7);
  c += m * m * landMask * uRidge * 0.55;

  // crater dents (moon-like styles): inverted worley bowls with a raised rim
  if (uCraters > 0.001) {
    float d = worley(dir * uCraterScale + uSeedOffset);
    float bowl = 1.0 - smoothstep(0.0, 0.55, d);
    float rim  = smoothstep(0.42, 0.55, d) * (1.0 - smoothstep(0.55, 0.75, d));
    c += (rim * 0.35 - bowl * bowl * 0.9) * uCraters * 0.35;
  }

  return clamp(c, 0.0, 1.0);
}

float terrainHeight(vec3 dir) {
  return height01(dir) * uHeightScale;
}
`;
