import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';

// ============================================================================
// Star mode. The photosphere is a sphere whose fragment is assembled from a
// fixed template plus an editable `starSurface()` body (the Shader panel edits
// that body live; validateStarShaderBody() compile-checks it against the real
// GL context before the engine swaps materials).
//
// The surface emits LINEAR HDR radiance: the pipeline adds the chromosphere,
// prominences and corona around the disc (STAR_CORONA_GLSL, composite pass),
// then bloom and the ACES tone map — the glare comes from real overexposure,
// not a painted rim.
//
//   colour      blackbody chromaticity from the effective temperature
//               (Planckian locus fit) x an artistic tint
//   granulation animated convection cells: bright upwelling centres, dark
//               intergranular lanes; footprint-filtered to their mean
//   network     supergranulation lanes -> faculae, brightest toward the limb
//   sunspots    active-latitude belts; umbra / filamented penumbra at the
//               right blackbody temperatures (T^4 intensity), plage around
//   limb        quadratic limb darkening, stronger in blue (limb reddens)
// ============================================================================

export const STAR_OCTAVES = 5;

const STAR_UNIFORMS_GLSL = /* glsl */ `
uniform float uStarTemp;       // effective temperature (K)
uniform vec3  uStarTint;       // artistic tint on the blackbody colour (sRGB)
uniform float uStarBright;     // emission scale
uniform float uStarScale;      // granulation frequency
uniform float uStarWarp;       // supergranulation / network strength
uniform float uStarGranules;   // granulation contrast
uniform float uStarFlow;       // convection speed
uniform float uStarSpots;      // sunspot coverage 0..1
uniform float uStarSpotScale;  // active-region size
uniform float uStarLimb;       // limb darkening strength (1 = solar)
uniform float uStarFaculae;    // facular brightening

// Planckian locus (Krystek 1985, 1000..15000 K) -> linear sRGB at luminance 1
vec3 blackbody(float t) {
  t = clamp(t, 1000.0, 15000.0);
  float u = (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t)
          / (1.0 + 8.42420235e-4 * t + 7.08145163e-7 * t * t);
  float v = (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t)
          / (1.0 - 2.89741816e-5 * t + 1.61456053e-7 * t * t);
  float x = 3.0 * u / (2.0 * u - 8.0 * v + 4.0);
  float y = 2.0 * v / (2.0 * u - 8.0 * v + 4.0);
  vec3 XYZ = vec3(x / y, 1.0, (1.0 - x - y) / y);
  vec3 rgb = vec3( 3.2404542 * XYZ.x - 1.5371385 * XYZ.y - 0.4985314 * XYZ.z,
                  -0.9692660 * XYZ.x + 1.8760108 * XYZ.y + 0.0415560 * XYZ.z,
                   0.0556434 * XYZ.x - 0.2040259 * XYZ.y + 1.0572252 * XYZ.z);
  return max(rgb, vec3(0.0));
}

// photosphere colour at a fraction of the effective temperature, with the
// Stefan-Boltzmann T^4 intensity ratio (spots are dark because they are cool).
// True blackbody chroma is very pale on a D65 display; it is boosted a little
// toward how stars are perceived (G stars yellow-white, M stars orange).
vec3 starColorAt(float frac) {
  vec3 tint = pow(max(uStarTint, vec3(0.0)), vec3(2.2));
  vec3 bb = blackbody(uStarTemp * frac);
  float l = dot(bb, vec3(0.2126, 0.7152, 0.0722));
  bb = max(l + (bb - l) * 1.7, vec3(0.0));
  return bb * tint * pow(frac, 4.0);
}
`;

// The editable part of the star fragment shader — shown verbatim in the
// Shader panel. Must define starSurface(dir, viewDir, t).
export const DEFAULT_STAR_BODY = `// starSurface(dir, viewDir, t) -> emitted radiance (linear HDR RGB).
//   dir      unit sphere direction of this fragment
//   viewDir  surface -> camera direction
//   t        seconds
// Toolbox: hash13/hash33, gnoise/gnoised, fbm, blackbody(K), starColorAt(f),
// every uStar* uniform (bound live to the Star panels) and uSeedOffset.
// Edit anything below and hit Apply.

vec3 starRotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// animated cellular noise: x = F1, y = F2, z = random value of the nearest
// cell (convection cells)
vec3 starCells(vec3 p, float t) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 h = hash33(i + g);
    vec3 o = 0.5 + 0.38 * sin(t + 6.2831 * h);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h.x; } else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(vec2(f1, f2)), id * 0.5 + 0.5);
}

// granulation brightness in [~-1, 1]: bright rounded upwellings, narrow
// dark downflow lanes; the domain is warped so cells are irregular
float granules(vec3 p, float t, float fp) {
  p += vec3(gnoise(p * 0.45), gnoise(p * 0.45 + 7.1), gnoise(p * 0.45 + 3.3)) * 0.7;
  vec3 c = starCells(p, t);
  float lane = smoothstep(0.0, 0.24, c.y - c.x);
  float dome = 1.0 - c.x * c.x * 0.7;
  // each granule has its own brightness (young / fading / exploding)
  float g = lane * dome * (1.5 + c.z * 1.0) - 1.1 + gnoise(p * 3.1 + t * 0.2) * 0.4;
  // cells smaller than ~2 px fade to their mean
  return g * (1.0 - smoothstep(0.25, 0.6, fp));
}

float spotFbm(vec3 p, out vec3 grad) {
  float s = 0.0, a = 0.5;
  grad = vec3(0.0);
  mat3 J = mat3(1.0);
  for (int i = 0; i < 4; i++) {
    vec4 n = gnoised(p);
    s += a * n.x;
    grad += a * (transpose(J) * n.yzw);
    a *= 0.5;
    p = OCT_ROT * p * 2.1;
    J = OCT_ROT * J * 2.1;
  }
  return s;
}

vec3 starSurface(vec3 dir, vec3 viewDir, float t) {
  // differential rotation: the equator laps the poles
  float lat = dir.y;
  vec3 d = starRotY(dir, t * 0.004 * uStarFlow * (1.0 - 0.3 * lat * lat));
  float boil = t * 0.35 * uStarFlow;
  float fpx = length(fwidth(dir));

  // granulation (two scales) over a slowly breathing supergranular network
  float gf = uStarScale * 22.0;
  vec3 gp = d * gf + uSeedOffset;
  float g = granules(gp, boil, fpx * gf) * 0.7
          + granules(gp * 2.3 + 17.0, boil * 1.4, fpx * gf * 2.3) * 0.3;
  vec3 sc = starCells(d * uStarScale * 3.2 + uSeedOffset * 0.3, boil * 0.05);
  float network = 1.0 - smoothstep(0.0, 0.12, sc.y - sc.x);
  float meso = gnoise(d * uStarScale * 7.0 + uSeedOffset * 0.7 + boil * 0.02);

  float I = 1.0 + g * 0.3 * uStarGranules + meso * 0.16 * uStarWarp;

  // active regions: sunspot belts at mid latitudes, drifting with the spin
  vec3 sg;
  float sf = spotFbm(d * uStarSpotScale * 2.2 + uSeedOffset * 1.7, sg);
  float belt = exp(-pow((abs(lat) - 0.33) / 0.16, 2.0));
  float act = sf + belt * 0.35 - 0.2;
  float cut = 0.42 - uStarSpots * 0.3;
  float on = step(0.01, uStarSpots);
  float pen = smoothstep(cut, cut + 0.025, act) * on;
  float umb = smoothstep(cut + 0.07, cut + 0.1, act) * on;
  float plage = smoothstep(cut - 0.16, cut - 0.02, act) * (1.0 - pen) * on;

  // penumbral filaments run radially out of the spot: noise squashed along
  // the spot field's gradient
  vec3 gh = sg - dir * dot(sg, dir);
  gh /= max(length(gh), 1e-4);
  vec3 fq = d * uStarSpotScale * 90.0;
  fq -= gh * dot(fq, gh) * 0.93;
  float fil = gnoise(fq + uSeedOffset) * 0.5 + gnoise(fq * 2.3) * 0.25;

  // faculae: network + plage light up toward the limb
  float mu = clamp(dot(viewDir, dir), 0.0, 1.0);
  float limbFac = pow(1.0 - mu, 1.5);
  I *= 1.0 + (network * 0.5 * uStarWarp + plage) * limbFac * 0.9 * uStarFaculae;

  vec3 photo = starColorAt(1.0) * I;
  vec3 penC = starColorAt(0.9) * (1.0 + fil * 0.45);
  vec3 umbC = starColorAt(0.68) * (1.0 + g * 0.1);
  vec3 col = mix(photo, penC, pen);
  col = mix(col, umbC, umb);

  // limb darkening, stronger at short wavelengths: the limb reddens
  float x = 1.0 - mu;
  vec3 a = vec3(0.36, 0.47, 0.62) * uStarLimb;
  vec3 b = vec3(0.24, 0.24, 0.20) * uStarLimb;
  col *= max(1.0 - a * x - b * x * x, vec3(0.0));

  return col * uStarBright;
}`;

const STAR_VERTEX = /* glsl */ `
${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}

uniform float uStarPulseAmt;
uniform float uStarPulseSpeed;

varying vec3 vDir;
varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize(position);
  // optional slow breathing (pulsating variables); 0 = a quiet star
  float pulse = sin(uTime * uStarPulseSpeed) * 0.5 + 0.5;
  float wob = gnoise(dir * 3.0 + uSeedOffset + uTime * 0.12 * uStarPulseSpeed);
  vec4 wp = modelMatrix * vec4(position * (1.0 + (pulse + wob) * uStarPulseAmt), 1.0);
  vDir = dir;
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export function buildStarFragmentSource(body) {
  return /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${STAR_UNIFORMS_GLSL}

varying vec3 vDir;
varying vec3 vWorldPos;

${body}

void main() {
  vec3 dir = normalize(vDir);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 col = starSurface(dir, viewDir, uTime);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;
}

/**
 * Equirectangular bake fragment for export: maps UV -> sphere direction using
 * three's SphereGeometry UV convention, then evaluates the SAME starSurface()
 * body as the viewport (custom shader included). viewDir = dir bakes the
 * view-independent surface (no limb darkening), tone-mapped like the viewport.
 */
export function buildStarBakeFragment(body) {
  return /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${STAR_UNIFORMS_GLSL}

uniform float uExposure;

varying vec2 vUv;

${body}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  float phi = vUv.x * 6.28318530718;
  float theta = (1.0 - vUv.y) * 3.14159265359;
  vec3 dir = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
  vec3 col = aces(max(starSurface(dir, dir, uTime), vec3(0.0)) * uExposure * 0.85);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;
}

export function createStarSurfaceMaterial(shared, body) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { OCTAVES: STAR_OCTAVES },
    vertexShader: STAR_VERTEX,
    fragmentShader: buildStarFragmentSource(body),
    side: THREE.FrontSide,
  });
}

/**
 * Compile-check a starSurface() body against the live GL context. Returns
 * null when it compiles, otherwise the info log with line numbers remapped
 * to the editable body so they match what the user sees in the editor.
 */
export function validateStarShaderBody(gl, body) {
  const frag = buildStarFragmentSource(body);
  // stand-in for the prefix three.js prepends to every ShaderMaterial
  const prefix = '#version 300 es\n#define varying in\nout highp vec4 pc_fragColor;\n'
    + '#define gl_FragColor pc_fragColor\n#define texture2D texture\n'
    + `#define OCTAVES ${STAR_OCTAVES}\n`
    + 'precision highp float;\nuniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\n';
  const full = prefix + frag;
  const bodyLine = full.slice(0, full.indexOf(body)).split('\n').length - 1;

  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(sh, full);
  gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
  const log = ok ? null : (gl.getShaderInfoLog(sh) || 'Unknown shader compile error');
  gl.deleteShader(sh);
  if (!log) return null;
  return log.replace(/\u0000/g, '').replace(/ERROR:\s*0:(\d+)/g, (m, n) => {
    const line = parseInt(n, 10) - bodyLine;
    return line >= 1 ? `Line ${line}` : m;
  }).trim();
}

// ---------------------------------------------------------------------------
// Around the disc — evaluated per background pixel in the composite pass from
// the ray's closest approach to the star (impact parameter b, in radii):
//   chromosphere  thin H-alpha rim hugging the limb
//   prominences   ridged loops rooted on the limb, rising a few % of R
//   corona        steep inner glow + power-law K-corona with radial streamers
// Needs NOISE_UNIFORMS / NOISE_FUNCTIONS (uRadius, uSeedOffset, uTime, gnoise).
// ---------------------------------------------------------------------------
export const STAR_CORONA_GLSL = /* glsl */ `
uniform float uStarCoronaOn;
uniform vec3  uStarCoronaCol;  // sRGB
uniform float uStarCoronaSize; // extent, x radius
uniform float uStarCoronaStr;
uniform float uStarFlares;     // streamer contrast
uniform float uStarProm;       // prominence amount
uniform vec3  uStarChromo;     // chromosphere / prominence colour (sRGB)
uniform float uStarBright;     // surface emission scale (the halo follows it)

vec3 starHalo(vec3 pc, float b) {
  vec3 col = vec3(0.0);
  float h = max(b - 1.0, 0.0);
  vec3 d = pc / max(length(pc), 1e-6);
  float t = uTime;
  vec3 chromo = pow(max(uStarChromo, vec3(0.0)), vec3(2.2));

  // chromosphere: a thin rim, a few thousandths of R
  col += chromo * exp(-h / 0.004) * 1.2 * step(1.0, b);

  // prominences: ridged loops seeded on active longitudes
  if (uStarProm > 0.001 && h < 0.2) {
    float act = smoothstep(0.05, 0.35, gnoise(d * 2.3 + uSeedOffset * 0.21));
    vec3 q = d * 16.0 + uSeedOffset * 0.5 + vec3(0.0, t * 0.01, 0.0);
    float ridge = 1.0 - abs(gnoise(q + vec3(h * 22.0, 0.0, h * 9.0)) * 2.0);
    ridge = pow(sat(ridge), 7.0);
    float lace = 0.6 + 0.8 * gnoise(d * 55.0 + vec3(h * 60.0, t * 0.05, 0.0));
    float fall = exp(-h / (0.025 + 0.03 * uStarProm)) * smoothstep(0.0, 0.004, h);
    col += chromo * ridge * lace * act * fall * uStarProm * 2.2;
  }

  if (uStarCoronaOn > 0.5) {
    float size = 0.15 + uStarCoronaSize;
    // streamers: angular structure only (radial streaks), slowly evolving;
    // helmet streamers widen at the base and taper outward
    vec3 sd = d;
    float ang = gnoise(sd * 2.2 + uSeedOffset * 0.13 + vec3(0.0, t * 0.004, 0.0)) * 0.7
              + gnoise(sd * 6.5 + uSeedOffset * 0.31) * 0.35
              + gnoise(sd * 19.0 - uSeedOffset * 0.17 + vec3(log(b) * 0.8, 0.0, 0.0)) * 0.18;
    float streak = max(0.0, 0.45 + ang * 2.2 * uStarFlares);
    // polar plumes are fainter than the equatorial streamer belt
    float eq = mix(0.55, 1.0, 1.0 - abs(d.y));
    float inner = exp(-h / (0.035 + 0.05 * size));
    float outer = pow(1.0 / max(b, 1.0), 2.0 + 2.2 / size);
    float k = (inner * 0.5 + outer * 0.35) * mix(1.0, streak, 0.85) * eq;
    col += pow(max(uStarCoronaCol, vec3(0.0)), vec3(2.2)) * k * uStarCoronaStr * step(1.0, b);
  }
  return col * uStarBright;
}
`;
