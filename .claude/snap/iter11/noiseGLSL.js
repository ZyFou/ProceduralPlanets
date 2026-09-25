// ============================================================================
// Shared GLSL noise + planet height field. Every planet material includes this
// so they all agree on the same surface. Heights are evaluated on the GPU only;
// PlanetHeightSampler.js is a value-only CPU mirror used by the exporter.
//
// heightField(dir, ...) returns the [0,1] height fraction AND its analytic
// gradient, so the terrain fragment gets exact normals from ONE evaluation —
// no finite-difference blur when zooming in, and a third of the cost.
//
// Composition: domain-warped gradient-noise continents through a shelf curve,
// ridged-multifractal mountain ranges concentrated along winding tectonic
// belts, optional multi-size craters. All knobs are uniforms so edits are
// live; only OCTAVES is a compile-time define.
//
// The value-noise helpers (hash13 / vnoise3 / fbm / ridgedFbm / worley) are
// kept unchanged for the gas giant and star shaders.
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
// -- hash / value noise (gas + star shaders) ---------------------------------
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

// -- gradient noise ------------------------------------------------------------
// Lattice gradient noise (quintic fade) — no value-noise grid streaks. gnoised
// also returns the analytic derivative (IQ), which drives exact terrain
// normals, ocean wave slopes and detail bump mapping.
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx) * 2.0 - 1.0;
}

// x: value (~[-1,1]), yzw: d/dp
vec4 gnoised(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  vec3 ga = hash33(i);
  vec3 gb = hash33(i + vec3(1.0, 0.0, 0.0));
  vec3 gc = hash33(i + vec3(0.0, 1.0, 0.0));
  vec3 gd = hash33(i + vec3(1.0, 1.0, 0.0));
  vec3 ge = hash33(i + vec3(0.0, 0.0, 1.0));
  vec3 gf = hash33(i + vec3(1.0, 0.0, 1.0));
  vec3 gg = hash33(i + vec3(0.0, 1.0, 1.0));
  vec3 gh = hash33(i + vec3(1.0, 1.0, 1.0));

  float va = dot(ga, f);
  float vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, f - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, f - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, f - vec3(1.0, 1.0, 1.0));

  float k1 = vb - va, k2 = vc - va, k3 = ve - va;
  float k4 = va - vb - vc + vd;
  float k5 = va - vc - ve + vg;
  float k6 = va - vb - ve + vf;
  float k7 = -va + vb + vc - vd + ve - vf - vg + vh;

  float v = va + k1 * u.x + k2 * u.y + k3 * u.z
          + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x
          + k7 * u.x * u.y * u.z;
  vec3 d = ga + (gb - ga) * u.x + (gc - ga) * u.y + (ge - ga) * u.z
         + (ga - gb - gc + gd) * u.x * u.y
         + (ga - gc - ge + gg) * u.y * u.z
         + (ga - gb - ge + gf) * u.z * u.x
         + (-ga + gb + gc - gd + ge - gf - gg + gh) * u.x * u.y * u.z
         + du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
                     k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,
                     k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  return vec4(v, d);
}

// value-only gradient noise (no derivative bookkeeping)
float gnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float va = dot(hash33(i), f);
  float vb = dot(hash33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float vc = dot(hash33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float vd = dot(hash33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float ve = dot(hash33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float vf = dot(hash33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float vg = dot(hash33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float vh = dot(hash33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y),
             mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

// Octave rotation (orthonormal): breaks the lattice alignment between octaves
// so no grid-aligned streaks survive in the fractal sums.
const mat3 OCT_ROT = mat3( 0.00,  0.80,  0.60,
                          -0.80,  0.36, -0.48,
                          -0.60, -0.48,  0.64);

// (OCT_ROT^T)^(OCTAVES-1): the fractal sums accumulate their gradients in the
// frame of the latest octave (one mat-vec per octave instead of carrying the
// full Jacobian) and rotate back to the domain frame once at the end.
// Constant-folded by the compiler.
mat3 octaveFrameToDomain() {
  mat3 m = mat3(1.0);
  for (int i = 1; i < OCTAVES; i++) m = m * OCT_ROT;
  return transpose(m);
}

// smoothstep + derivative: x = value, y = d/dt
vec2 smoothstepD(float a, float b, float t) {
  float x = clamp((t - a) / (b - a), 0.0, 1.0);
  return vec2(x * x * (3.0 - 2.0 * x), 6.0 * x * (1.0 - x) / (b - a));
}

// -- planet height field -------------------------------------------------------
const float CONT_GAIN = 1.0;     // maps the fbm spread onto the shelf curve
const float RIDGE_BIAS = 0.62;   // ridged multifractal floor (valleys -> 0)
const float RIDGE_GAIN = 3.3;

// fbm of gradient noise with gradient; cLow = continental low-pass (2 octaves)
vec4 continentFbm(vec3 p, out float cLow) {
  float sum = 0.0;
  vec3 grad = vec3(0.0);   // in the frame of the current octave
  float amp = 0.5, norm = 0.0;
  float lac = 1.0;         // d(q)/d(p) scale of the current octave
  vec3 q = p;
  cLow = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    vec4 n = gnoised(q);
    sum += amp * n.x;
    grad = OCT_ROT * grad + (amp * lac) * n.yzw;
    norm += amp;
    if (i == 1) cLow = sum / norm;
    amp *= uPersistence;
    lac *= uLacunarity;
    q = OCT_ROT * q * uLacunarity;
  }
  return vec4(sum, octaveFrameToDomain() * grad) / max(norm, 1e-5);
}

// The continent fbm's first CONT_LOW octaves and the mountain-belt noise are
// smooth at the vertex spacing of the terrain chunks: the terrain evaluates
// them per vertex and interpolates (see materials.js). HeightLow carries
// them: cont = partial fbm sum + its gradient (w.r.t. the warped point),
// cLow2 = the two-octave partial sum behind cLow, belt = belt noise value +
// gradient (w.r.t. its own input).
const int CONT_LOW = OCTAVES < 3 ? OCTAVES : 3;

struct HeightLow { vec4 cont; float cLow2; vec4 belt; };

// R^(CONT_LOW-1): the frame of the last low octave
mat3 contLowFrame() {
  mat3 m = mat3(1.0);
  for (int i = 1; i < CONT_LOW; i++) m = m * OCT_ROT;
  return m;
}

HeightLow heightLow(vec3 pw) {
  HeightLow L;
  float sum = 0.0, amp = 0.5, lac = 1.0;
  vec3 H = vec3(0.0);
  vec3 q = pw;
  L.cLow2 = 0.0;
  for (int i = 0; i < CONT_LOW; i++) {
    vec4 n = gnoised(q);
    sum += amp * n.x;
    H = OCT_ROT * H + (amp * lac) * n.yzw;
    if (i == 1) L.cLow2 = sum;
    amp *= uPersistence;
    lac *= uLacunarity;
    q = OCT_ROT * q * uLacunarity;
  }
  L.cont = vec4(sum, transpose(contLowFrame()) * H);
  L.belt = gnoised(pw * 0.55 + vec3(5.3, 1.7, 9.1));
  return L;
}

// continentFbm continued from (interpolated) low octaves
vec4 continentFbmFrom(vec3 pw, HeightLow L, out float cLow) {
  float amp = 0.5, norm = 0.0, lac = 1.0;
  vec3 q = pw;
  cLow = 0.0;
  for (int i = 0; i < CONT_LOW; i++) {
    norm += amp;
    if (i == 1) cLow = L.cLow2 / norm;
    amp *= uPersistence;
    lac *= uLacunarity;
    q = OCT_ROT * q * uLacunarity;
  }
  float sum = L.cont.x;
  vec3 H = contLowFrame() * L.cont.yzw;
  for (int i = CONT_LOW; i < OCTAVES; i++) {
    vec4 n = gnoised(q);
    sum += amp * n.x;
    H = OCT_ROT * H + (amp * lac) * n.yzw;
    norm += amp;
    amp *= uPersistence;
    lac *= uLacunarity;
    q = OCT_ROT * q * uLacunarity;
  }
  return vec4(sum, octaveFrameToDomain() * H) / max(norm, 1e-5);
}

// Musgrave ridged multifractal with gradient: sharp crests, and each octave is
// weighted by the previous one so detail piles onto ridgelines while valley
// floors stay smooth (reads like drainage-eroded ranges).
// Gradients (grad, dw) are carried in the frame of the current octave, like
// continentFbm's.
vec4 ridgedMF(vec3 p) {
  float sum = 0.0;
  vec3 grad = vec3(0.0);
  float amp = 0.5, norm = 0.0;
  float w = 1.0;
  vec3 dw = vec3(0.0);
  float lac = 1.0;
  vec3 q = p;
  for (int i = 0; i < OCTAVES; i++) {
    vec4 n = gnoised(q);
    vec3 gn = lac * n.yzw;
    float sgn = n.x >= 0.0 ? 1.0 : -1.0;
    float r = 1.0 - abs(n.x);
    float s = r * r;
    vec3 ds = -2.0 * r * sgn * gn;
    float sw = s * w;
    vec3 dsw = ds * w + s * dw;
    sum += amp * sw;
    grad = OCT_ROT * grad + amp * dsw;
    norm += amp;
    float wr = sw * 2.0;
    w = clamp(wr, 0.0, 1.0);
    dw = (wr > 0.0 && wr < 1.0) ? OCT_ROT * (dsw * 2.0) : vec3(0.0);
    amp *= uPersistence;
    lac *= uLacunarity;
    q = OCT_ROT * q * uLacunarity;
  }
  return vec4(sum, octaveFrameToDomain() * grad) / max(norm, 1e-5);
}

// worley F1 with gradient (crater bowls)
vec4 worleyD(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 8.0;
  vec3 best = vec3(1.0, 0.0, 0.0);
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 41.7));
    vec3 r = g + o - f;
    float l = length(r);
    if (l < d) { d = l; best = r; }
  }
  return vec4(d, -best / max(d, 1e-5));
}

// one crater octave: bowl + raised rim, value + gradient (w.r.t. p)
vec4 craterLayer(vec3 p) {
  vec4 w = worleyD(p);
  vec2 b = smoothstepD(0.0, 0.55, w.x);
  float bowl = 1.0 - b.x;
  vec2 r1 = smoothstepD(0.42, 0.55, w.x);
  vec2 r2 = smoothstepD(0.55, 0.75, w.x);
  float rim = r1.x * (1.0 - r2.x);
  float drim = r1.y * (1.0 - r2.x) - r1.x * r2.y;
  float v = rim * 0.35 - bowl * bowl * 0.9;
  float dv = drim * 0.35 + 1.8 * bowl * b.y;
  return vec4(v, w.yzw * dv);
}

// one warp axis: 2 octaves of gradient noise, value + gradient w.r.t. p
vec4 warpAxis(vec3 p, vec3 o1, vec3 o2) {
  vec4 a = gnoised(p * 0.9 + o1);
  vec4 b = gnoised(p * 1.9 + o2);
  return vec4(a.x + 0.5 * b.x, a.yzw * 0.9 + b.yzw * 0.95);
}

// domain warp (2 octaves per axis) — organic coastlines. Returns the warped
// noise-space point; JwT = (dpw/dp)^T keeps gradients exact through the warp.
vec3 warpDomain(vec3 dir, out mat3 JwT) {
  vec3 p = dir * uNoiseScale + uSeedOffset;
  vec4 wx = warpAxis(p, vec3(11.3, 0.0, 0.0), vec3(21.7, 3.1, 0.0));
  vec4 wy = warpAxis(p, vec3(0.0, 47.9, 0.0), vec3(0.0, 57.3, 7.7));
  vec4 wz = warpAxis(p, vec3(0.0, 0.0, 83.1), vec3(5.9, 0.0, 91.3));
  JwT = mat3(1.0) + uWarp * mat3(wx.yzw, wy.yzw, wz.yzw);
  return p + vec3(wx.x, wy.x, wz.x) * uWarp;
}

// dir: unit sphere direction, pw / JwT: its warpDomain(), C / cLowRaw: the
// continent fbm at pw. beltN = the belt noise when beltGiven (else evaluated
// here, on land only). Returns the height fraction in [0,1]; grad =
// d(height)/d(dir) in 3D (take the tangential part for normals). cLow =
// low-pass continent value (continentality), mtn = mountain mask.
float heightFromContinents(vec3 dir, vec3 pw, mat3 JwT, vec4 C, float cLowRaw,
                           bool beltGiven, vec4 beltIn,
                           out vec3 grad, out float cLow, out float mtn) {
  // continents: fbm pushed through a shelf curve so oceans are broad basins
  // and land masses have coherent interiors
  cLow = cLowRaw;
  float c = 0.465 + C.x * CONT_GAIN;
  vec3 dc = C.yzw * CONT_GAIN;
  cLow = 0.465 + cLow * CONT_GAIN;
  // Earth-like hypsometry: broad abyssal plains, a steep continental slope,
  // narrow shallow shelves and low land platforms (relief comes from ranges)
  vec2 shelf = smoothstepD(0.44, 0.54, c);
  float k = uContinents;
  float shaped = 0.28 + shelf.x * 0.18 + (c - 0.5) * 0.35;
  vec3 dShaped = dc * (shelf.y * 0.18 + 0.35);
  dc = mix(dc, dShaped, k);
  c = mix(c, shaped, k);

  // mountain ranges: ridged multifractal, strongest along winding belts
  // (zero-lines of a low-frequency field, like orogenic chains) and faded
  // out below the shoreline so ranges don't spike the ocean floor. The land
  // mask (and its slope) is exactly 0 over the deep ocean: skip the ranges.
  vec2 land = smoothstepD(0.40, 0.50, c);
  float amt = uRidge * 0.8;
  float mountains = 0.0;
  vec3 dMountains = vec3(0.0);
  mtn = 0.0;
  if (land.x > 0.0 && amt > 0.0) {
    vec3 dLand = land.y * dc;
    vec4 beltN = beltGiven ? beltIn : gnoised(pw * 0.55 + vec3(5.3, 1.7, 9.1));
    float beltSgn = beltN.x >= 0.0 ? 1.0 : -1.0;
    float belt = 1.0 - abs(beltN.x) * 4.5;
    vec3 dBelt = -4.5 * beltSgn * beltN.yzw * 0.55;
    vec2 bm = smoothstepD(0.15, 0.9, belt);
    float beltW = mix(0.12, 1.0, bm.x);
    vec3 dBeltW = 0.88 * bm.y * dBelt;

    vec4 R = ridgedMF(pw * uMountainScale + 7.7);
    // squared ramp: gentle foothills, sharp high peaks
    float mt = max(R.x - RIDGE_BIAS, 0.0) * RIDGE_GAIN;
    float m = mt * mt;
    vec3 dm = R.x > RIDGE_BIAS ? 2.0 * mt * R.yzw * uMountainScale * RIDGE_GAIN : vec3(0.0);

    mountains = m * land.x * beltW * amt;
    dMountains = (dm * land.x * beltW + m * dLand * beltW + m * land.x * dBeltW) * amt;
    mtn = clamp(mt * land.x * beltW, 0.0, 1.0);
  }

  float h = c + mountains;
  vec3 gp = dc + dMountains;

  // back through the warp and the p = dir * scale mapping
  grad = (JwT * gp) * uNoiseScale;

  // craters (moon-like styles): two sizes of inverted worley bowls with rims
  if (uCraters > 0.001) {
    vec3 cp = dir * uCraterScale + uSeedOffset;
    vec4 c1 = craterLayer(cp);
    vec4 c2 = craterLayer(cp * 2.3 + 17.0);
    float cs = uCraters * 0.35;
    h += (c1.x + c2.x * 0.45) * cs;
    grad += (c1.yzw * uCraterScale + c2.yzw * uCraterScale * 2.3 * 0.45) * cs;
  }

  if (h <= 0.0 || h >= 1.0) grad = vec3(0.0);
  return clamp(h, 0.0, 1.0);
}

float heightFieldWarped(vec3 dir, vec3 pw, mat3 JwT, out vec3 grad, out float cLow, out float mtn) {
  float cl;
  vec4 C = continentFbm(pw, cl);
  return heightFromContinents(dir, pw, JwT, C, cl, false, vec4(0.0), grad, cLow, mtn);
}

float heightField(vec3 dir, out vec3 grad, out float cLow, out float mtn) {
  mat3 JwT;
  vec3 pw = warpDomain(dir, JwT);
  return heightFieldWarped(dir, pw, JwT, grad, cLow, mtn);
}

float height01(vec3 dir) {
  vec3 g;
  float cl, mt;
  return heightField(dir, g, cl, mt);
}

float terrainHeight(vec3 dir) {
  return height01(dir) * uHeightScale;
}
`;
