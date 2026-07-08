import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL } from './surfaceGLSL.js';

// ============================================================================
// Gas giant surface: a single shader sphere that swaps in for the terrain
// quadtree in gas mode (params.mode === 'gas'). The look is deliberately NOT the
// classic latitude-band archetype — the base field is a two-pass domain warp
// (marbled swirls) with storm ovals stamped through the same warp so their
// edges curl. uGasStretch (default 0) is the only concession to striping.
// No cloud shell, no atmosphere shell — the surface carries the whole look.
// ============================================================================

export const GAS_OCTAVES = 5;

const GAS_UNIFORMS_GLSL = /* glsl */ `
uniform vec3  uGasDeep;        // darkest troughs between flows
uniform vec3  uGasBase;        // body color
uniform vec3  uGasSwirl;       // bright flow crests / filaments
uniform vec3  uGasStorm;       // storm oval accent
uniform float uGasScale;       // base frequency of the flow field
uniform float uGasWarp;        // swirl turbulence (domain warp strength)
uniform float uGasContrast;    // flow field contrast
uniform float uGasFlow;        // drift / churn speed
uniform float uGasBands;       // posterize levels (0 = smooth)
uniform float uGasStretch;     // 0 = free swirls, >0 pulls toward lat stripes
uniform float uGasStorms;      // storm coverage 0..1
uniform float uGasStormScale;  // storm cell frequency
uniform float uGasLimb;        // limb darkening strength
`;

// gasSurface(dir, viewDir) shared by the live material and the export baker.
// The baker passes viewDir = dir, which zeroes the limb term — exactly what a
// texture wrapped on a sphere wants.
const GAS_SURFACE_GLSL = /* glsl */ `
vec3 gasRotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

vec3 gasSurface(vec3 dir, vec3 viewDir) {
  float t = uTime * 0.02 * uGasFlow;

  // differential rotation: the equator outruns the poles so features shear
  // gently over time without ever settling into stripes
  vec3 d = gasRotY(dir, t * (0.4 + 0.6 * (1.0 - dir.y * dir.y)));

  // uGasStretch squashes the domain along the pole axis — 0 keeps the flow
  // isotropic (no band archetype), raise it only if striping is wanted
  vec3 p = d * uGasScale * vec3(1.0, 1.0 + uGasStretch * 3.5, 1.0)
         + uSeedOffset * 0.6;

  // two-pass domain warp: fbm warped by fbm warped by fbm -> marbled swirls
  vec3 q = vec3(fbm(p),
                fbm(p + vec3(5.2, 1.3, 8.4)),
                fbm(p + vec3(2.8, 7.7, 4.1)));
  vec3 r = vec3(fbm(p + q * uGasWarp * 2.6 + vec3(1.7, 9.2, 5.5) + t * 0.35),
                fbm(p + q * uGasWarp * 2.6 + vec3(8.3, 2.8, 6.9) - t * 0.35),
                fbm(p + q * uGasWarp * 2.6 + vec3(4.1, 5.6, 1.2)));
  float f = fbm(p + (r - 0.5) * uGasWarp * 3.2);
  f = 0.5 + (f - 0.5) * (0.7 + uGasContrast * 2.4);

  // posterize into hard cartoon steps (0 = smooth gradient)
  if (uGasBands >= 1.0) f = floor(f * uGasBands + 0.5) / uGasBands;
  f = clamp(f, 0.0, 1.0);

  vec3 col = mix(uGasDeep, uGasBase, smoothstep(0.28, 0.52, f));
  col = mix(col, uGasSwirl, smoothstep(0.60, 0.90, f));

  // thin bright filaments where the warp field folds over itself
  float fil = smoothstep(0.46, 0.50, r.x) * (1.0 - smoothstep(0.53, 0.57, r.x));
  col = mix(col, uGasSwirl, fil * 0.35);

  // storm ovals: a low-frequency field sampled through the same warp, so the
  // spots get curled edges instead of clean ellipses
  float sf = fbm(d * uGasStormScale + (r - 0.5) * 0.9 + uSeedOffset * 1.9);
  float cut = 0.66 - uGasStorms * 0.26;
  float on = step(0.01, uGasStorms);
  float storm = smoothstep(cut, cut + 0.05, sf) * on;
  float core = smoothstep(cut + 0.11, cut + 0.17, sf) * on;
  col = mix(col, uGasStorm, storm);
  col = mix(col, mix(uGasStorm, vec3(1.0), 0.35), core);
  // dark "ink" ring just inside the storm edge — cartoon outline
  float ink = storm * (1.0 - smoothstep(cut + 0.03, cut + 0.09, sf));
  col = mix(col, uGasDeep * 0.55, ink * 0.85);

  // toon-lit like the terrain (the sphere normal IS dir), then a soft limb
  // falloff for depth — deliberately no additive atmosphere glow
  float diff = toonShade(max(dot(dir, uSunDir), 0.0));
  col *= uAmbient + diff * uSunIntensity;
  float mu = clamp(dot(viewDir, dir), 0.0, 1.0);
  col *= mix(1.0, 0.45 + 0.55 * mu, uGasLimb);

  return col;
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
${GAS_UNIFORMS_GLSL}

varying vec3 vDir;
varying vec3 vWorldPos;

${GAS_SURFACE_GLSL}

void main() {
  vec3 dir = normalize(vDir);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 col = gasSurface(dir, viewDir);
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

export function createGasSurfaceMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { OCTAVES: GAS_OCTAVES },
    vertexShader: GAS_VERTEX,
    fragmentShader: GAS_FRAGMENT,
    side: THREE.FrontSide,
  });
}

/**
 * Equirectangular bake fragment for export — same UV -> direction mapping as
 * the star baker, same gasSurface() as the viewport. viewDir = dir drops the
 * limb term; uBakeLighting optionally folds the toon sun into the texture.
 */
export function buildGasBakeFragment() {
  return /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${GAS_UNIFORMS_GLSL}

uniform bool uBakeLighting;

varying vec2 vUv;

${GAS_SURFACE_GLSL}

void main() {
  float phi = vUv.x * 6.28318530718;
  float theta = (1.0 - vUv.y) * 3.14159265359;
  vec3 dir = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
  vec3 col = gasSurface(dir, dir);
  if (!uBakeLighting) {
    // gasSurface always applies the toon sun — divide it back out so the
    // unlit bake carries pure albedo for the viewer's own lighting
    float diff = toonShade(max(dot(dir, uSunDir), 0.0));
    col /= max(uAmbient + diff * uSunIntensity, 1e-3);
  }
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;
}
