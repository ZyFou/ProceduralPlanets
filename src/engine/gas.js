import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL, ATMOSPHERE_GLSL } from './surfaceGLSL.js';

// ============================================================================
// Gas giant: a shader sphere (+ optional ring disc) that swaps in for the
// terrain quadtree in gas mode. Physically motivated, not a texture:
//
//   bands     belts / zones from a noisy latitude phase; the zonal jets sit on
//             the belt-zone boundaries (cos of the same phase), with a
//             super-rotating equatorial jet
//   eddies    anisotropic domain-warped turbulence, advected by the jets with a
//             two-phase flow map (shear never winds up into pure stripes), and
//             strongest in the shear zones between bands
//   storms    elliptical vortices that SWIRL the flow they sit in (the bands and
//             eddies curl around them); one optional great spot + small ovals
//   poles     banding dissolves into chaotic cyclones under a polar haze
//   light     Minnaert limb darkening, sun through the gas atmosphere LUT
//             (terminator reddening), sky light, ring shadows — linear HDR
//             into the same pipeline as the terrain (atmosphere + tone map)
//   rings     optical-depth profile (C / B / Cassini / A / Encke + ringlets),
//             slab single scattering (lit and unlit face), planet shadow
// ============================================================================

export const GAS_OCTAVES = 5;

// Jet table: the zonal jet speed at each storm's latitude and at each row of
// the vortex lattice only depends on the band layout, not on the pixel. The
// live material reads them from a small float texture baked once per frame
// (GasJetTable) instead of re-evaluating the band profile (7 noise calls) ten
// times per pixel. Texels [0, 12) = storms, then one per vortex row.
const GAS_STORM_COUNT = 12;
const GAS_ROW_SPAN = 512;                 // rows -256..255 (slider max needs ±83)
const GAS_JETS_W = GAS_STORM_COUNT + GAS_ROW_SPAN;
const GAS_JET_DEFINES = {
  GAS_STORM_COUNT, GAS_ROW0: GAS_STORM_COUNT + GAS_ROW_SPAN / 2, GAS_JETS_W,
};

const GAS_UNIFORMS_GLSL = /* glsl */ `
uniform vec3  uGasZone;        // bright zones (sRGB albedo)
uniform vec3  uGasBelt;        // dark belts
uniform vec3  uGasAccent;      // chromophore tint (reddish belts)
uniform vec3  uGasStorm;       // great storm colour
uniform vec3  uGasPolar;       // polar haze colour
uniform float uGasBandCount;   // belt + zone count, pole to pole
uniform float uGasContrast;    // belt / zone contrast
uniform float uGasBandWarp;    // waviness of the band edges
uniform float uGasTurb;        // eddy strength
uniform float uGasScale;       // eddy frequency
uniform float uGasFlow;        // jet / churn speed
uniform float uGasPolarHaze;   // polar region extent + haze
uniform float uGasStorms;      // small oval count 0..1
uniform float uGasStormScale;  // small oval size
uniform float uGasGreatSpot;   // great storm size (0 = none)
uniform float uGasLimb;        // Minnaert limb darkening
uniform float uGasRingOn;
uniform float uGasRingInner;   // ring radii, x planet radius
uniform float uGasRingOuter;
uniform float uGasRingOpacity; // optical depth scale
uniform vec3  uGasRingColor;   // particle albedo (sRGB)
uniform vec3  uGasAxis;        // world-space spin axis (tilt)
`;

// Ring optical depth at radius rr (planet radii). fw = radial footprint in
// ring-space units so ringlets narrower than a pixel average out instead of
// shimmering. Shared by the ring disc and the ring shadow on the planet.
const RING_GLSL = /* glsl */ `
float ringGap(float u, float c, float w) {
  return 1.0 - smoothstep(0.0, w, abs(u - c)) ;
}

float ringDepth(float rr, float fw) {
  float span = max(uGasRingOuter - uGasRingInner, 1e-3);
  float u = (rr - uGasRingInner) / span;
  if (u <= 0.0 || u >= 1.0) return 0.0;
  float s = uSeedOffset.y * 0.037;
  float j1 = gnoise(vec3(s, 1.3, 0.0)) * 0.08;
  float j2 = gnoise(vec3(s, 4.7, 0.0)) * 0.05;
  float cEdge = 0.24 + j1;          // C ring -> B ring
  float cassini = 0.64 + j2;        // Cassini division
  // broad structure: faint C ring, dense B ring (brightest outward), A ring
  float tau = mix(0.08, 0.28, smoothstep(0.0, cEdge, u));
  tau = mix(tau, mix(0.9, 1.9, smoothstep(cEdge, cassini, u)), smoothstep(cEdge - 0.01, cEdge + 0.015, u));
  tau = mix(tau, 0.65, smoothstep(cassini + 0.02, cassini + 0.035, u));
  tau *= 1.0 - 0.94 * ringGap(u, cassini + 0.012, 0.024);
  tau *= 1.0 - 0.9 * ringGap(u, 0.915 + j1 * 0.2, 0.006);
  tau *= smoothstep(0.0, 0.02, u) * (1.0 - smoothstep(0.975, 1.0, u));
  // ringlets: 1D gradient noise at rising frequency, footprint-filtered
  float rl = 0.0;
  float f = 38.0, a = 0.55;
  for (int i = 0; i < 5; i++) {
    float fade = 1.0 - smoothstep(0.2, 0.5, f * fw);
    rl += a * gnoise(vec3(u * f, s + float(i) * 3.1, 0.5)) * fade;
    f *= 2.6;
    a *= 0.72;
  }
  tau *= clamp(1.0 + rl * 2.2, 0.08, 3.0);
  return tau * uGasRingOpacity;
}

// fraction of sunlight reaching world point p through the ring plane
float ringShadow(vec3 p) {
  if (uGasRingOn < 0.5) return 1.0;
  float d = dot(uSunDir, uGasAxis);
  if (abs(d) < 1e-4) return 1.0;
  float t = -dot(p, uGasAxis) / d;
  if (t <= 0.0) return 1.0;
  vec3 h = p + uSunDir * t;
  float tau = ringDepth(length(h) / uRadius, 0.004);
  return exp(-tau / abs(d));
}
`;

// gasAlbedo(dir) shared by the live material and the export baker: linear
// albedo of the cloud tops at local (unrotated) direction dir. h = eddy field,
// used by the live shader as a bump height.
const GAS_SURFACE_GLSL = /* glsl */ `
vec3 gasRotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

float gfbm(vec3 p, int oct) {
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

float gasLat(vec3 d) { return asin(clamp(d.y, -1.0, 1.0)) / 1.5707963; }

// latitude profile: x = zone-ness (-1 belt .. 1 zone), y = zonal jet (signed),
// z = chromophore accent, w = fine sub-banding
vec4 gasBands(float y) {
  float x = y * uGasBandCount * 0.5;
  float s = uSeedOffset.x * 0.173;
  float ph = x * 3.14159 + gnoise(vec3(x * 0.42, s, 1.7)) * 2.4
                         + gnoise(vec3(x * 1.07, s, 5.3)) * 0.9;
  float jet = cos(ph) + 1.4 * exp(-y * y * 90.0);     // equatorial super-rotation
  float fine = gnoise(vec3(x * 3.1, s, 9.1)) * 0.5 + gnoise(vec3(x * 7.7, s, 3.9)) * 0.3
             + gnoise(vec3(x * 17.3, s, 7.4)) * 0.2;
  float acc = gnoise(vec3(x * 0.33, s + 4.0, 2.2)) + gnoise(vec3(x * 1.3, s + 8.0, 6.2)) * 0.4;
  return vec4(sin(ph), jet, acc, fine);
}

// ---- storms: elliptical vortices ------------------------------------------
vec3 gasStormHash(int i) {
  return hash33(vec3(float(i) * 7.13, 3.1, 1.7) + uSeedOffset * 0.01) * 0.5 + 0.5;
}

float gasStormLat(int i, vec3 h) {
  if (i == 0) return -0.2 - h.x * 0.12;
  float lat = (h.x * 2.0 - 1.0) * 0.72;
  return lat + sign(lat) * 0.06;
}

// vortex lattice: columns around a latitude circle (rows are twice as dense)
float gasVortexN() { return floor(10.0 + uGasBandCount * 1.6 * uGasScale / 3.0); }
float gasRowLat(float row, float N) { return (row + 0.5) / (N * 2.2) * 6.2831853; }

// zonal jet at storm i (latitude lat) and at vortex row "row" (latitude rowLat)
#ifdef GAS_JET_TABLE
uniform highp sampler2D uGasJets;
float gasStormJet(int i, float lat) { return texelFetch(uGasJets, ivec2(i, 0), 0).r; }
float gasRowJet(float row, float rowLat) {
  int x = clamp(int(row) + GAS_ROW0, GAS_STORM_COUNT, GAS_JETS_W - 1);
  return texelFetch(uGasJets, ivec2(x, 0), 0).r;
}
#else
float gasStormJet(int i, float lat) { return gasBands(lat).y; }
float gasRowJet(float row, float rowLat) { return gasBands(rowLat / 1.5707963).y; }
#endif

// Each vortex rotates the sampling direction inside its ellipse, so whatever
// flows past (bands, eddies) is wound into it. mask = storm body, ring = its
// bright collar, kind: 0 great spot, 1 white oval, 2 dark barge.
vec3 gasStorms(vec3 d, float T, out float mask, out float ring, out float kind) {
  mask = 0.0; ring = 0.0; kind = 1.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec3 h = gasStormHash(i);
    float size;
    if (i == 0) {
      if (uGasGreatSpot < 0.01) continue;
      size = 0.07 + 0.12 * uGasGreatSpot;
    } else {
      if (fi > uGasStorms * 11.0) break;
      size = (0.018 + 0.032 * h.z) * uGasStormScale;
    }
    float lat = gasStormLat(i, h);
    // drift with the local jet
    float jet = gasStormJet(i, lat);
    float lon = h.y * 6.2831853 - T * jet * 0.5;
    float cl = cos(lat * 1.5707963);
    vec3 c = vec3(cl * cos(lon), sin(lat * 1.5707963), cl * sin(lon));
    if (dot(d, c) < 0.8) continue;
    vec3 e = normalize(vec3(-c.z, 0.0, c.x));          // east
    vec3 n = cross(c, e);                                // north
    float aspect = i == 0 ? 1.8 : 1.35 + h.z * 0.5;
    vec3 v = d - c;
    vec2 q = vec2(dot(v, e) / (size * aspect), dot(v, n) / size);
    float r2 = dot(q, q);
    if (r2 > 4.0) continue;
    // anticyclones: clockwise in the north, counter-clockwise in the south
    float spin = (i == 0 ? 2.6 : 2.0) * sign(lat) * exp(-r2 * 1.1);
    float cs = cos(spin), sn = sin(spin);
    vec2 qr = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
    d = normalize(c * (1.0 + dot(v, c)) + e * qr.x * size * aspect + n * qr.y * size);
    float body = 1.0 - smoothstep(0.45, 1.0, r2);
    float collar = smoothstep(0.55, 0.95, r2) * (1.0 - smoothstep(0.95, 1.6, r2));
    if (body > mask) {
      mask = body;
      kind = i == 0 ? 0.0 : (h.z > 0.72 ? 2.0 : 1.0);
    }
    ring = max(ring, collar * (i == 0 ? 1.0 : 0.5));
  }
  return d;
}

// ---- vortex street: a lattice of small eddies (lon x lat cells, wider than
// tall) that curl whatever flows through them. Each row of cells drifts with
// its own jet, each eddy fades in and out over its lifetime, and they die out
// toward the poles where the lon grid converges.
vec3 gasVortices(vec3 d, float T) {
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float lon = atan(d.z, d.x);
  float N = gasVortexN();
  vec2 uv = vec2(lon / 6.2831853 * N, lat / 6.2831853 * N * 2.2);
  float fy = fract(uv.y);
  float iy = floor(uv.y);
  vec2 acc = vec2(0.0);
  for (int gy = -1; gy <= 1; gy++) {
    float row = iy + float(gy);
    float rowLat = gasRowLat(row, N);
    float drift = T * gasRowJet(row, rowLat) * 0.5 / 6.2831853 * N;
    float ux = uv.x + drift;
    float ix = floor(ux);
    float fx = fract(ux);
    for (int gx = -1; gx <= 1; gx++) {
      vec2 cell = vec2(mod(ix + float(gx), N), row);
      vec3 h = hash33(vec3(cell, 5.7) + uSeedOffset * 0.013) * 0.5 + 0.5;
      if (h.z > 0.35 + 0.5 * min(uGasTurb, 1.0)) continue;
      vec2 c = vec2(float(gx) + 0.2 + 0.6 * h.x - fx, float(gy) + 0.2 + 0.6 * h.y - fy);
      float life = sin(3.14159 * fract(T * 0.35 + h.x * 7.0));
      float rr = 0.25 + 0.17 * h.y;
      // hard window: an eddy never reaches past the 3x3 search, so rows
      // with different drifts stay seamless
      float fall = exp(-dot(c, c) / (rr * rr)) * (1.0 - smoothstep(0.55, 0.95, length(c)));
      // spin sense from the eddy's own hemisphere (not the pixel's), so the
      // equator never shows a seam
      float ang = (h.z < 0.2 ? -1.0 : 1.0) * (rowLat < 0.0 ? -1.0 : 1.0) * 3.0 * fall * life;
      float cs = cos(ang), sn = sin(ang);
      vec2 rel = -c;
      acc += vec2(cs * rel.x - sn * rel.y, sn * rel.x + cs * rel.y) - rel;
    }
  }
  float pole = 1.0 - smoothstep(0.55, 0.95, abs(lat) / 1.5707963);
  acc *= pole * min(uGasTurb * 1.3, 1.0);
  float lon2 = lon + acc.x / N * 6.2831853;
  float lat2 = clamp(lat + acc.y / (N * 2.2) * 6.2831853, -1.5707, 1.5707);
  return vec3(cos(lat2) * cos(lon2), sin(lat2), cos(lat2) * sin(lon2));
}

// eddies in the frame advected by the jets for flow phase ph; cycle reseeds
// the field each time the phase wraps (the flow keeps evolving)
vec2 gasEddies(vec3 d, float jet, float ph, float cycle) {
  vec3 q = gasRotY(d, jet * (ph - 0.5) * 0.5);
  vec3 p = q * uGasScale * vec3(1.0, 4.5, 1.0) + uSeedOffset * 0.29
         + vec3(cycle * 7.31, cycle * 1.73, cycle * 3.97);
  vec2 w = vec2(gfbm(p, 4), gfbm(p * 1.31 + vec3(5.2, 1.3, 8.4), 4));
  vec3 pw = p + vec3(w.x, w.y * 0.45, -w.x) * (0.6 + 3.2 * uGasTurb);
  float f = gfbm(pw * 1.7 + vec3(1.7, 9.2, 5.5), 4);
  return vec2(f, w.y);
}

vec3 gasAlbedo(vec3 dir, out float h) {
  float T = uTime * 0.012 * uGasFlow;
  // slow planetary spin
  vec3 d = gasRotY(dir, uTime * 0.003 * uGasFlow);

  float sMask, sRing, sKind;
  d = gasStorms(d, T, sMask, sRing, sKind);
  d = gasVortices(d, T);

  float y = gasLat(d);
  vec4 b0 = gasBands(y);

  // two-phase flow map: each phase shears along the jets, then resets
  float pa = fract(T);
  float pb = fract(T + 0.5);
  float wb = abs(pa * 2.0 - 1.0);
  vec2 ea = gasEddies(d, b0.y, pa, floor(T));
  vec2 eb = gasEddies(d, b0.y, pb, floor(T + 0.5) + 0.5);
  // blend without the flow-map contrast dip
  vec2 e = (ea * (1.0 - wb) + eb * wb) / sqrt((1.0 - wb) * (1.0 - wb) + wb * wb);
  h = e.x;

  // shear zones (belt/zone boundaries) carry the strongest turbulence
  float shear = 1.0 - abs(b0.x);
  float bw = 2.0 / max(uGasBandCount, 1.0);
  float large = gfbm(d * vec3(2.2, 5.0, 2.2) + uSeedOffset * 0.11, 3);
  float yb = y + bw * (large * 1.2 * uGasBandWarp
                     + e.y * 0.8 * uGasBandWarp
                     + e.x * 1.6 * uGasTurb * (0.3 + shear));
  vec4 b = gasBands(yb);

  vec3 zoneC = srgbToLinear(uGasZone);
  vec3 beltC = srgbToLinear(uGasBelt);
  float zone = smoothstep(-1.0, 1.0, b.x * (0.6 + uGasContrast * 3.0));
  zone = mix(0.5, zone, 0.35 + 0.65 * uGasContrast);
  vec3 col = mix(beltC, zoneC, zone);
  // every band gets its own brightness / warmth
  float tone = gnoise(vec3(yb * uGasBandCount * 0.9, uSeedOffset.z * 0.1, 3.3));
  col *= 1.0 + tone * 0.35 * (0.4 + uGasContrast);
  // chromophores collect in the belts
  float acc = sat(b.z * 1.4 + 0.15) * (1.0 - zone);
  col = mix(col, srgbToLinear(uGasAccent), acc * 0.85);
  // sub-bands and cloud texture: bright puffs in zones, dark rifts in belts
  col *= 1.0 + b.w * 0.45 * (0.3 + uGasContrast);
  col *= 1.0 + e.x * 0.35 * uGasTurb;
  // thin bright streaks where the eddies stretch along the jets
  float streak = smoothstep(0.1, 0.3, e.x) * shear;
  col = mix(col, zoneC * 1.05, streak * 0.35 * uGasTurb);

  // storms
  vec3 storm = sKind < 0.5 ? srgbToLinear(uGasStorm)
             : sKind < 1.5 ? zoneC * 1.08 : beltC * 0.72;
  float inner = mix(0.85, 1.12, sat(0.5 + e.x * 2.0));
  col = mix(col, storm * inner, sMask * (sKind < 0.5 ? 0.92 : 0.85));
  col = mix(col, zoneC * 1.04, sRing * 0.55 * (1.0 - sMask));

  // poles: banding dissolves into cyclones under a bluish-grey haze
  float ay = abs(y);
  float pol = smoothstep(0.72 - 0.3 * uGasPolarHaze, 0.97, ay + e.x * 0.06) * uGasPolarHaze;
  vec3 polC = srgbToLinear(uGasPolar) * (1.0 + e.x * 0.7);
  col = mix(col, polC, pol);

  return max(col, vec3(0.0));
}
`;

const GAS_VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vWorldPos;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GAS_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${ATMOSPHERE_GLSL}
${GAS_UNIFORMS_GLSL}
${RING_GLSL}

varying vec3 vDir;
varying vec3 vWorldPos;

${GAS_SURFACE_GLSL}

void main() {
  vec3 dir = normalize(vDir);
  vec3 P = vWorldPos;
  vec3 N = normalize(P);
  vec3 V = normalize(cameraPosition - P);

  float h;
  vec3 albedo = gasAlbedo(dir, h);

  // cloud-top relief from the eddy field (screen-space bump): only reads near
  // the terminator, like the storm towers in low-sun probe images
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = (dhx * r1 + dhy * r2) / (abs(det) > 1e-12 ? det : 1e-12);
  float bump = uRadius * 0.0015;
  vec3 Nb = normalize(N - grad * bump * (1.0 - smoothstep(0.02, 0.2, length(dpx) / uRadius)));

  // Minnaert: k > 1 darkens the limb (hazy cloud tops)
  float k = 1.0 + 0.55 * uGasLimb;
  float mu0 = max(dot(Nb, uSunDir), 0.0);
  float mu = max(dot(N, V), 1e-3);
  float diff = toonShade(pow(mu0, k) * pow(mu, k - 1.0));
  vec3 sun = sunIrradiance(P) * ringShadow(P);
  vec3 col = albedo * (sun * diff + skyIrradiance(P, N)) / PI;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createGasSurfaceMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { OCTAVES: GAS_OCTAVES, GAS_JET_TABLE: 1, ...GAS_JET_DEFINES },
    vertexShader: GAS_VERTEX,
    fragmentShader: GAS_FRAGMENT,
    side: THREE.FrontSide,
  });
}

// ---------------------------------------------------------------------------
// Jet table bake (see GAS_STORM_COUNT): one texel per storm / vortex row,
// evaluated with the very same functions the direct path uses.
// ---------------------------------------------------------------------------
const GAS_JET_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${ATMOSPHERE_GLSL}
${GAS_UNIFORMS_GLSL}
${GAS_SURFACE_GLSL}

void main() {
  int x = int(gl_FragCoord.x);
  float jet;
  if (x < GAS_STORM_COUNT) {
    jet = gasStormJet(x, gasStormLat(x, gasStormHash(x)));
  } else {
    float row = float(x - GAS_ROW0);
    jet = gasRowJet(row, gasRowLat(row, gasVortexN()));
  }
  gl_FragColor = vec4(jet, 0.0, 0.0, 1.0);
}
`;

export class GasJetTable {
  constructor(shared) {
    this.target = new THREE.WebGLRenderTarget(GAS_JETS_W, 1, {
      type: THREE.FloatType,
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared },
      defines: { OCTAVES: GAS_OCTAVES, ...GAS_JET_DEFINES },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: GAS_JET_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    shared.uGasJets.value = this.target.texture;
  }

  /** Re-bake (cheap: a few hundred texels) — band layout sliders are live. */
  update(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Rings — a flat annulus in the planet's equatorial plane (child of the tilted
// gas group). Geometry is a unit annulus r in [1, 2]; the vertex shader maps it
// onto the live inner/outer radii so the sliders never rebuild geometry.
// Output is premultiplied: rgb = scattered light, a = coverage. The pipeline's
// scene target keeps the background transmittance in alpha so the starfield
// shows through the gaps.
// ---------------------------------------------------------------------------
const RING_VERTEX = /* glsl */ `
uniform float uRadius;
uniform float uGasRingInner;
uniform float uGasRingOuter;
varying vec3 vWorldPos;
varying float vRR;
void main() {
  float u = length(position.xy) - 1.0;
  float rr = mix(uGasRingInner, uGasRingOuter, u);
  vec2 xy = normalize(position.xy) * rr * uRadius;
  vRR = rr;
  vec4 wp = modelMatrix * vec4(xy.x, 0.0, xy.y, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${ATMOSPHERE_GLSL}
${GAS_UNIFORMS_GLSL}
${RING_GLSL}

varying vec3 vWorldPos;
varying float vRR;

void main() {
  vec3 P = vWorldPos;
  vec3 V = normalize(cameraPosition - P);
  vec3 A = uGasAxis;
  float span = max(uGasRingOuter - uGasRingInner, 1e-3);
  float fw = fwidth(vRR) / span;
  float tau = ringDepth(vRR, fw);
  if (tau < 1e-4) discard;

  float mu = max(abs(dot(V, A)), 0.03);
  float mu0 = max(abs(dot(uSunDir, A)), 0.03);
  float alpha = 1.0 - exp(-tau / mu);

  // planet shadow (soft edge ~ the sun's disc)
  float along = dot(P, uSunDir);
  float bperp = length(P - uSunDir * along);
  float lit = along > 0.0 ? 1.0 : smoothstep(uRadius * 0.985, uRadius * 1.01, bperp);

  // slab single scattering: lit face reflects, the far face glows by
  // diffuse transmission (bright where the ring is thin)
  bool sameSide = dot(V, A) * dot(uSunDir, A) > 0.0;
  float slab;
  if (sameSide) {
    slab = mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu)));
  } else {
    float dm = mu - mu0;
    slab = abs(dm) < 1e-3
      ? tau / mu * exp(-tau / mu) * mu0 / mu
      : mu0 / dm * (exp(-tau / mu) - exp(-tau / mu0));
    slab = max(slab, 0.0);
  }
  // icy particles: strong backscatter (opposition) + a dusty forward lobe
  float cosS = dot(-uSunDir, V);
  float phase = 4.0 * PI * (0.75 * phaseHG(cosS, -0.4) + 0.25 * phaseHG(cosS, 0.65));
  // radial colour: darker grey C ring, warmer dense B ring
  float u = (vRR - uGasRingInner) / span;
  vec3 alb = srgbToLinear(uGasRingColor) * mix(0.55, 1.0, smoothstep(0.1, 0.35, u))
           * (1.0 + gnoise(vec3(u * 9.0, uSeedOffset.z * 0.03, 2.0)) * 0.25);
  vec3 E = vec3(SUN_E * uSunIntensity) * lit;
  vec3 col = alb * E * phase * slab * 0.18;
  // faint skylight / planetshine so the unlit face is never pitch black
  col += alb * alpha * SUN_E * uSunIntensity * uAmbient * 0.01;
  gl_FragColor = vec4(col, alpha);
}
`;

export function createRingMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { OCTAVES: GAS_OCTAVES },
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

/** Unit annulus (r 1..2, in the XY plane of the geometry) for the ring disc. */
export function createRingGeometry() {
  return new THREE.RingGeometry(1, 2, 256, 8);
}

/**
 * Equirectangular bake fragment for export — same UV -> direction mapping as
 * the star baker, same gasAlbedo() as the viewport. uBakeLighting optionally
 * folds a plain Lambert sun into the texture.
 */
export function buildGasBakeFragment() {
  return /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${ATMOSPHERE_GLSL}
${GAS_UNIFORMS_GLSL}

uniform bool uBakeLighting;

varying vec2 vUv;

${GAS_SURFACE_GLSL}

void main() {
  float phi = vUv.x * 6.28318530718;
  float theta = (1.0 - vUv.y) * 3.14159265359;
  vec3 dir = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
  float h;
  vec3 col = gasAlbedo(dir, h);
  if (uBakeLighting) {
    float diff = toonShade(max(dot(dir, uSunDir), 0.0));
    col *= uAmbient + diff * uSunIntensity;
  }
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`;
}

/**
 * Ring profile bake (1D strip, u = inner -> outer radius): sRGB ring albedo
 * in rgb, coverage for a ~60 degree view in alpha. Used by the baked /
 * standard-material tier (PlanetBaker), the live rings stay analytic.
 */
export function buildRingBakeFragment(width) {
  return /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${ATMOSPHERE_GLSL}
${GAS_UNIFORMS_GLSL}
${RING_GLSL}

varying vec2 vUv;

void main() {
  float u = vUv.x;
  float rr = mix(uGasRingInner, uGasRingOuter, u);
  float tau = ringDepth(rr, 1.0 / ${width.toFixed(1)});
  vec3 alb = uGasRingColor * mix(0.55, 1.0, smoothstep(0.1, 0.35, u))
           * (1.0 + gnoise(vec3(u * 9.0, uSeedOffset.z * 0.03, 2.0)) * 0.25);
  float alpha = 1.0 - exp(-tau / 0.5);
  gl_FragColor = vec4(clamp(alb, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;
}
