import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { seedToOffset } from './presets.js';

// ============================================================================
// Shared uniforms + the four planet materials (terrain, water, clouds,
// atmosphere) and the starfield. Terrain chunk materials are created per chunk
// but SHARE the uniform value objects, so a slider move updates every chunk
// in the same frame — and three's program cache means one compile total.
// ============================================================================

export function createSharedUniforms(p) {
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const off = seedToOffset(p.seed);
  return {
    uTime:          { value: 0 },
    uSeedOffset:    { value: new THREE.Vector3(off[0], off[1], off[2]) },
    uRadius:        { value: p.radius },
    uHeightScale:   { value: p.heightScale },
    uSeaLevel:      { value: p.seaLevel },
    uNoiseScale:    { value: p.noiseScale },
    uPersistence:   { value: p.persistence },
    uLacunarity:    { value: p.lacunarity },
    uWarp:          { value: p.warp },
    uRidge:         { value: p.ridge },
    uMountainScale: { value: p.mountainScale },
    uCraters:       { value: p.craters },
    uCraterScale:   { value: p.craterScale },
    uContinents:    { value: p.continents },

    uSunDir:        { value: new THREE.Vector3(0.5, 0.5, 0.5).normalize() },
    uSunIntensity:  { value: p.sunIntensity },
    uAmbient:       { value: p.ambient },
    uToonEnabled:   { value: p.toonEnabled ? 1 : 0 },
    uToonBands:     { value: p.toonBands },
    uToonSoftness:  { value: p.toonSoftness },
    uBandSoftness:  { value: p.bandSoftness },
    uSnowLine:      { value: p.snowLine },
    uPolarCaps:     { value: p.polarCaps },

    uColDeep:    { value: v3(p.colDeep) },
    uColShallow: { value: v3(p.colShallow) },
    uColSand:    { value: v3(p.colSand) },
    uColGrass:   { value: v3(p.colGrass) },
    uColForest:  { value: v3(p.colForest) },
    uColRock:    { value: v3(p.colRock) },
    uColSnow:    { value: v3(p.colSnow) },
    uColFoam:    { value: v3(p.colFoam) },

    uWaterOpacity: { value: p.waterOpacity },
    uFoamWidth:    { value: p.foamWidth },
    uWaveScale:    { value: p.waveScale },
    uWaveSpeed:    { value: p.waveSpeed },
    uWaterSpec:    { value: p.waterSpec },

    uCloudCoverage: { value: p.cloudCoverage },
    uCloudSoftness: { value: p.cloudSoftness },
    uCloudDensity:  { value: p.cloudDensity },
    uCloudScale:    { value: p.cloudScale },
    uCloudDetail:   { value: p.cloudDetail },
    uCloudSpeed:    { value: p.cloudSpeed },
    uCloudColor:    { value: v3(p.cloudColor) },
    uCloudShadow:   { value: v3(p.cloudShadow) },

    uAtmoColor:    { value: v3(p.atmoColor) },
    uAtmoStrength: { value: p.atmoStrength },
  };
}

// Maps flat param keys -> uniform names (scalar or vec3-from-array).
export const UNIFORM_MAP = {
  radius: 'uRadius', heightScale: 'uHeightScale', seaLevel: 'uSeaLevel',
  noiseScale: 'uNoiseScale', persistence: 'uPersistence', lacunarity: 'uLacunarity',
  warp: 'uWarp', ridge: 'uRidge', mountainScale: 'uMountainScale',
  craters: 'uCraters', craterScale: 'uCraterScale', continents: 'uContinents',
  sunIntensity: 'uSunIntensity', ambient: 'uAmbient',
  toonBands: 'uToonBands', toonSoftness: 'uToonSoftness', bandSoftness: 'uBandSoftness',
  snowLine: 'uSnowLine', polarCaps: 'uPolarCaps',
  colDeep: 'uColDeep', colShallow: 'uColShallow', colSand: 'uColSand',
  colGrass: 'uColGrass', colForest: 'uColForest', colRock: 'uColRock',
  colSnow: 'uColSnow', colFoam: 'uColFoam',
  waterOpacity: 'uWaterOpacity', foamWidth: 'uFoamWidth',
  waveScale: 'uWaveScale', waveSpeed: 'uWaveSpeed', waterSpec: 'uWaterSpec',
  cloudCoverage: 'uCloudCoverage', cloudSoftness: 'uCloudSoftness',
  cloudDensity: 'uCloudDensity', cloudScale: 'uCloudScale',
  cloudDetail: 'uCloudDetail', cloudSpeed: 'uCloudSpeed',
  cloudColor: 'uCloudColor', cloudShadow: 'uCloudShadow',
  atmoColor: 'uAtmoColor', atmoStrength: 'uAtmoStrength',
};

const TOON_GLSL = /* glsl */ `
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
// Terrain
// ---------------------------------------------------------------------------

const TERRAIN_VERTEX = /* glsl */ `
${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}

uniform vec3 uFaceOrigin;
uniform vec3 uFaceU;
uniform vec3 uFaceV;
uniform vec2 uUV0;
uniform float uUVSize;
uniform float uSkirtDepth;

attribute float aSkirt;

varying vec3 vDir;
varying vec3 vWorldPos;

void main() {
  vec2 uv2 = uUV0 + position.xy * uUVSize;
  vec3 cube = uFaceOrigin + uv2.x * uFaceU + uv2.y * uFaceV;
  vec3 dir = normalize(cube);
  float h = terrainHeight(dir);
  vec3 wp = dir * (uRadius + h - aSkirt * uSkirtDepth);
  vDir = dir;
  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const TERRAIN_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}

uniform float uBandSoftness;
uniform float uSnowLine;
uniform float uPolarCaps;
uniform vec3 uColDeep;
uniform vec3 uColShallow;
uniform vec3 uColSand;
uniform vec3 uColGrass;
uniform vec3 uColForest;
uniform vec3 uColRock;
uniform vec3 uColSnow;

varying vec3 vDir;
varying vec3 vWorldPos;

// hard-ish band helper: cartoon transitions with a controllable soft width
float band(float edge, float v) {
  return smoothstep(edge - uBandSoftness, edge + uBandSoftness, v);
}

void main() {
  vec3 dir = normalize(vDir);

  // analytic normal from finite differences on the height field
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, dir));
  vec3 t2 = cross(dir, t1);
  float eps = 0.0012;
  float hC = height01(dir);
  float hA = height01(normalize(dir + t1 * eps));
  float hB = height01(normalize(dir + t2 * eps));
  vec3 pC = dir * (uRadius + hC * uHeightScale);
  vec3 pA = normalize(dir + t1 * eps) * (uRadius + hA * uHeightScale);
  vec3 pB = normalize(dir + t2 * eps) * (uRadius + hB * uHeightScale);
  vec3 n = normalize(cross(pA - pC, pB - pC));
  if (dot(n, dir) < 0.0) n = -n;

  float slope = 1.0 - clamp(dot(n, dir), 0.0, 1.0);
  float h = hC;

  // latitude "temperature": poles get caps, with a wobble so the cap edge
  // isn't a perfect circle
  float lat = abs(dir.y) + (vnoise3(dir * 6.0 + uSeedOffset) - 0.5) * 0.14;
  float polar = smoothstep(0.78, 0.92, lat) * uPolarCaps;

  // palette bands from height (cartoon: hard transitions)
  float sea = uSeaLevel;
  vec3 col;
  if (h < sea) {
    // seabed: sand near shore -> deep floor
    float depth = clamp((sea - h) / max(sea, 1e-4), 0.0, 1.0);
    vec3 floorCol = mix(uColSand * 0.72, uColDeep * 0.55, band(0.28, depth));
    col = floorCol;
  } else {
    float rel = (h - sea) / max(1.0 - sea, 1e-4);   // 0..1 above sea
    col = uColSand;
    col = mix(col, uColGrass,  band(0.05, rel));
    col = mix(col, uColForest, band(0.32, rel));
    col = mix(col, uColRock,   band(0.62, rel));
    col = mix(col, uColSnow,   band(uSnowLine, rel + (1.0 - slope) * 0.02));
    // steep slopes read as rock regardless of altitude
    col = mix(col, uColRock, band(0.42, slope) * (1.0 - band(uSnowLine, rel)));
  }
  // polar caps override everything above water
  col = mix(col, uColSnow, polar * step(sea, h));

  // toon lighting
  float diff = toonShade(max(dot(n, uSunDir), 0.0));
  float light = uAmbient + diff * uSunIntensity;
  col *= light;

  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

export function createTerrainMaterial(shared, octaves, chunkUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uSkirtDepth: { value: 0 }, ...chunkUniforms },
    defines: { OCTAVES: octaves },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    side: THREE.FrontSide,
  });
}

// ---------------------------------------------------------------------------
// Water — stylized ocean shell. Discards where terrain pokes above the sea so
// oceans fill only the basins; coastlines line up exactly (same height field).
// ---------------------------------------------------------------------------

const WATER_VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(position);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}

uniform float uWaterOpacity;
uniform float uFoamWidth;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uWaterSpec;
uniform float uBandSoftness;
uniform vec3 uColDeep;
uniform vec3 uColShallow;
uniform vec3 uColFoam;

varying vec3 vDir;
varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize(vDir);

  float terrainH = height01(dir);
  float sea = uSeaLevel;
  float depth = sea - terrainH;               // in height01 fraction units
  if (depth <= 0.001) discard;

  // animated ripple normal (triplanar value noise on the shell)
  vec3 up = dir;
  vec3 ref = abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, up));
  vec3 t2 = cross(up, t1);
  float t = uTime * uWaveSpeed;
  vec3 wp = dir * uWaveScale + uSeedOffset;
  float r0 = vnoise3(wp + t * 0.31);
  float rX = vnoise3(wp + t1 * 0.35 + t * 0.31);
  float rZ = vnoise3(wp + t2 * 0.35 + t * 0.31);
  vec3 n = normalize(up - t1 * (rX - r0) * 1.6 - t2 * (rZ - r0) * 1.6);

  // depth bands (cartoon): shallow teal ring -> deep blue, hard steps
  float grade = clamp(depth / max(sea * 0.85, 1e-4), 0.0, 1.0);
  vec3 col = uColShallow;
  col = mix(col, mix(uColShallow, uColDeep, 0.55), smoothstep(0.10, 0.16, grade));
  col = mix(col, uColDeep, smoothstep(0.30, 0.40, grade));

  // hard foam ring at the shoreline, wobbled so it dashes like a drawing
  float foamJit = (vnoise3(dir * uWaveScale * 3.1 + t * 0.6) - 0.5) * 0.35;
  float foamEdge = uFoamWidth * (0.55 + foamJit);
  float foam = 1.0 - smoothstep(foamEdge * 0.6, foamEdge, depth / max(sea, 1e-4));
  col = mix(col, uColFoam, clamp(foam, 0.0, 1.0) * 0.9);

  // toon lighting + hard specular blob
  float diff = toonShade(max(dot(n, uSunDir), 0.0));
  col *= uAmbient + diff * uSunIntensity;
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 60.0);
  col += vec3(1.0) * smoothstep(0.35, 0.45, spec) * uWaterSpec;

  float fres = pow(1.0 - max(dot(viewDir, up), 0.0), 3.0);
  float alpha = clamp(uWaterOpacity * (0.75 + grade * 0.35) + fres * 0.12 + foam * 0.2, 0.0, 0.97);

  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), alpha);
}
`;

export function createWaterMaterial(shared, octaves) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { OCTAVES: octaves },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

// ---------------------------------------------------------------------------
// Clouds — cartoon shell. One noise evaluation per pixel with a HARD coverage
// threshold: solid puffy shapes, no wispy raymarch. Two frequencies give the
// silhouettes their billows; lighting is toon-banded like the terrain.
// ---------------------------------------------------------------------------

const CLOUD_VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(position);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}

uniform float uCloudCoverage;
uniform float uCloudSoftness;
uniform float uCloudDensity;
uniform float uCloudScale;
uniform float uCloudDetail;
uniform float uCloudSpeed;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;

varying vec3 vDir;
varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize(vDir);
  float t = uTime * uCloudSpeed * 0.02;

  // slow rotation drift around the poles axis
  float ca = cos(t), sa = sin(t);
  vec3 d = vec3(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);

  vec3 p = d * uCloudScale + uSeedOffset * 0.37;
  float base = fbm(p + vec3(0.0, t * 2.1, 0.0));
  float detail = vnoise3(p * 3.7 + t * 4.0);
  float shape = base + (detail - 0.5) * uCloudDetail * 0.4;

  // HARD threshold: this is the cartoon look. Coverage moves the cut line,
  // softness controls the (thin) edge gradient.
  float cut = 1.0 - uCloudCoverage;
  float alpha = smoothstep(cut, cut + max(uCloudSoftness, 0.005), shape);
  if (alpha < 0.01) discard;

  // toon lighting on the shell normal, plus a fake "puff" gradient: thicker
  // cloud (shape >> cut) reads brighter in its core
  float diff = toonShade(max(dot(dir, uSunDir), 0.0));
  float core = smoothstep(cut, cut + 0.35, shape);
  vec3 col = mix(uCloudShadow, uCloudColor, clamp(diff * (0.55 + core * 0.45) + 0.25, 0.0, 1.0));

  gl_FragColor = vec4(col, alpha * uCloudDensity);
}
`;

export function createCloudMaterial(shared, octaves) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { OCTAVES: Math.min(octaves, 5) },
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Atmosphere rim + starfield
// ---------------------------------------------------------------------------

const ATMO_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vNormal = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMO_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uAtmoColor;
uniform float uAtmoStrength;
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.6);
  float sunSide = 0.45 + 0.55 * max(dot(normalize(vNormal), uSunDir), 0.0);
  gl_FragColor = vec4(uAtmoColor * sunSide, rim * uAtmoStrength);
}
`;

export function createAtmosphereMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { uAtmoColor: shared.uAtmoColor, uAtmoStrength: shared.uAtmoStrength, uSunDir: shared.uSunDir },
    vertexShader: ATMO_VERTEX,
    fragmentShader: ATMO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
}

const STAR_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 cell = floor(d * 220.0);
  float star = step(0.997, hash13(cell));
  float tw = 0.6 + 0.4 * hash13(cell + 7.0);
  vec3 col = vec3(star * tw);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createStarMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
      }
    `,
    fragmentShader: STAR_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
}
