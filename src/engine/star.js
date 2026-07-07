import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';

// ============================================================================
// Star mode: the sun surface material, its corona halo, and the custom-shader
// pipeline. The surface fragment is assembled from a fixed template plus an
// editable `starSurface()` body — the Shader panel edits that body live, and
// validateStarShaderBody() compile-checks it against the real GL context
// before the engine swaps materials, so a typo can never kill the frame loop.
// ============================================================================

export const STAR_OCTAVES = 5;

const STAR_UNIFORMS_GLSL = /* glsl */ `
uniform vec3  uStarCore;       // hottest color
uniform vec3  uStarMid;        // mid-temperature color
uniform vec3  uStarEdge;       // coolest surface tone
uniform vec3  uStarSpotCol;    // sunspot color
uniform float uStarScale;      // granulation frequency
uniform float uStarWarp;       // domain warp / turbulence
uniform float uStarGranules;   // granulation contrast
uniform float uStarFlow;       // boil speed
uniform float uStarSpots;      // sunspot coverage 0..1
uniform float uStarSpotScale;  // sunspot cell frequency
uniform float uStarLimb;       // limb darkening strength
uniform float uStarBands;      // posterize levels (0 = smooth)
uniform float uStarGlow;       // additive hot rim
`;

// The editable part of the star fragment shader — shown verbatim in the
// Shader panel. Must define starSurface(dir, viewDir, t).
export const DEFAULT_STAR_BODY = `// starSurface(dir, viewDir, t) -> surface color (linear RGB).
//   dir      unit sphere direction of this fragment
//   viewDir  surface -> camera direction
//   t        seconds
// Toolbox: hash13(vec3), vnoise3(vec3), fbm(vec3), plus every uStar*
// uniform (bound live to the Star panel sliders) and uSeedOffset from
// the seed box. Edit anything below and hit Apply.
vec3 starSurface(vec3 dir, vec3 viewDir, float t) {
  vec3 p = dir * uStarScale + uSeedOffset * 0.5;

  // boiling granulation: domain-warped fbm drifting over time
  float drift = t * 0.05 * uStarFlow;
  vec3 warp = vec3(
    fbm(p * 1.3 + drift),
    fbm(p * 1.3 + 19.7 - drift),
    fbm(p * 1.3 + 43.1)
  ) - 0.5;
  p += warp * uStarWarp * 2.0;
  float g = fbm(p * 1.6 + vec3(0.0, drift, 0.0)) * 0.65
          + fbm(p * 3.4 - drift) * 0.35;
  g = 0.5 + (g - 0.5) * (0.6 + uStarGranules * 2.2);

  // posterize into hard cartoon bands (0 = smooth gradient)
  if (uStarBands >= 1.0) g = floor(g * uStarBands + 0.5) / uStarBands;
  g = clamp(g, 0.0, 1.0);

  // temperature ramp: cool edge tone -> mid -> hot core
  vec3 col = mix(uStarEdge, uStarMid, smoothstep(0.18, 0.52, g));
  col = mix(col, uStarCore, smoothstep(0.52, 0.90, g));

  // sunspot blotches: slow low-frequency field, hard threshold
  float sf = fbm(dir * uStarSpotScale + uSeedOffset * 1.7 + t * 0.01 * uStarFlow);
  float cut = 0.78 - uStarSpots * 0.30;
  float spots = smoothstep(cut, cut + 0.05, sf) * step(0.01, uStarSpots);
  col = mix(col, uStarSpotCol, spots);

  // limb darkening + hot additive rim
  float mu = clamp(dot(viewDir, dir), 0.0, 1.0);
  col *= mix(1.0, 0.30 + 0.70 * mu, uStarLimb);
  col += uStarCore * pow(1.0 - mu, 3.0) * uStarGlow;

  return col;
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
  // slow breathing plus a noisy simmer so the silhouette never sits still
  float pulse = sin(uTime * uStarPulseSpeed) * 0.5 + 0.5;
  float wob = fbm(dir * 4.0 + uSeedOffset + uTime * 0.12 * uStarPulseSpeed) - 0.5;
  vec4 wp = modelMatrix * vec4(position * (1.0 + (pulse + wob * 1.5) * uStarPulseAmt), 1.0);
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
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
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
  const prefix = `#define OCTAVES ${STAR_OCTAVES}\n` +
    'precision highp float;\nuniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\n';
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
// Corona — additive back-side halo with slowly rotating wispy streaks.
// ---------------------------------------------------------------------------

const CORONA_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vNormal = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CORONA_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}

uniform vec3  uStarCoronaCol;
uniform float uStarCoronaStr;
uniform float uStarFlares;

varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - abs(dot(viewDir, n)), 2.0);

  // wispy streaks drifting around the disc
  float t = uTime * 0.08;
  float wisp = fbm(n * 5.0 + uSeedOffset * 0.7 + vec3(0.0, t, 0.0));
  wisp = smoothstep(0.35, 0.75, wisp);

  float a = rim * (0.5 + wisp * uStarFlares) * uStarCoronaStr;
  gl_FragColor = vec4(uStarCoronaCol * (0.7 + wisp * 0.6), a);
}
`;

export function createCoronaMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { OCTAVES: STAR_OCTAVES },
    vertexShader: CORONA_VERTEX,
    fragmentShader: CORONA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
}
