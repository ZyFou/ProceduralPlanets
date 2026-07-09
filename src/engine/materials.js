import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL, SURFACE_GLSL, CLOUD_FIELD_GLSL, CLOUD_SHADOW_GLSL } from './surfaceGLSL.js';
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

    uBiomeAmount:   { value: p.biomeAmount },
    uTempBias:      { value: p.tempBias },
    uMoistScale:    { value: p.moistureScale },
    uBioTundra:     { value: v3(p.bioTundra) },
    uBioSteppe:     { value: v3(p.bioSteppe) },
    uBioTaiga:      { value: v3(p.bioTaiga) },
    uBioShrub:      { value: v3(p.bioShrub) },
    uBioDesert:     { value: v3(p.bioDesert) },
    uBioSavanna:    { value: v3(p.bioSavanna) },
    uBioJungle:     { value: v3(p.bioJungle) },

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
    uCloudPuff:     { value: p.cloudPuff },
    uCloudShadowStr:{ value: p.cloudsEnabled ? p.cloudShadowStrength : 0 },

    uAtmoColor:    { value: v3(p.atmoColor) },
    uAtmoStrength: { value: p.atmoStrength },

    // gas giant surface
    uGasScale:      { value: p.gasScale },
    uGasWarp:       { value: p.gasWarp },
    uGasContrast:   { value: p.gasContrast },
    uGasFlow:       { value: p.gasFlowSpeed },
    uGasBands:      { value: p.gasBands },
    uGasStretch:    { value: p.gasStretch },
    uGasStorms:     { value: p.gasStormsEnabled ? p.gasStorms : 0 },
    uGasStormScale: { value: p.gasStormScale },
    uGasLimb:       { value: p.gasLimb },
    uGasDeep:       { value: v3(p.gasColorDeep) },
    uGasBase:       { value: v3(p.gasColorBase) },
    uGasSwirl:      { value: v3(p.gasColorSwirl) },
    uGasStorm:      { value: v3(p.gasColorStorm) },

    // star mode
    uStarCore:       { value: v3(p.starColorCore) },
    uStarMid:        { value: v3(p.starColorMid) },
    uStarEdge:       { value: v3(p.starColorEdge) },
    uStarSpotCol:    { value: v3(p.starSpotColor) },
    uStarScale:      { value: p.starNoiseScale },
    uStarWarp:       { value: p.starTurbulence },
    uStarGranules:   { value: p.starGranules },
    uStarFlow:       { value: p.starFlowSpeed },
    uStarSpots:      { value: p.starSpotsEnabled ? p.starSpots : 0 },
    uStarSpotScale:  { value: p.starSpotScale },
    uStarLimb:       { value: p.starLimbDarken },
    uStarBands:      { value: p.starBands },
    uStarGlow:       { value: p.starGlow },
    uStarPulseAmt:   { value: p.starPulseAmount },
    uStarPulseSpeed: { value: p.starPulseSpeed },
    uStarCoronaCol:  { value: v3(p.starCoronaColor) },
    uStarCoronaStr:  { value: p.starCoronaStrength },
    uStarFlares:     { value: p.starFlares },
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
  biomeAmount: 'uBiomeAmount', tempBias: 'uTempBias', moistureScale: 'uMoistScale',
  bioTundra: 'uBioTundra', bioSteppe: 'uBioSteppe', bioTaiga: 'uBioTaiga',
  bioShrub: 'uBioShrub', bioDesert: 'uBioDesert', bioSavanna: 'uBioSavanna',
  bioJungle: 'uBioJungle',
  colDeep: 'uColDeep', colShallow: 'uColShallow', colSand: 'uColSand',
  colGrass: 'uColGrass', colForest: 'uColForest', colRock: 'uColRock',
  colSnow: 'uColSnow', colFoam: 'uColFoam',
  waterOpacity: 'uWaterOpacity', foamWidth: 'uFoamWidth',
  waveScale: 'uWaveScale', waveSpeed: 'uWaveSpeed', waterSpec: 'uWaterSpec',
  cloudCoverage: 'uCloudCoverage', cloudSoftness: 'uCloudSoftness',
  cloudDensity: 'uCloudDensity', cloudScale: 'uCloudScale',
  cloudDetail: 'uCloudDetail', cloudSpeed: 'uCloudSpeed',
  cloudColor: 'uCloudColor', cloudShadow: 'uCloudShadow',
  cloudPuff: 'uCloudPuff',
  // cloudShadowStrength is gated by cloudsEnabled — handled in Engine.setParam
  atmoColor: 'uAtmoColor', atmoStrength: 'uAtmoStrength',
  // gas giant surface (mode toggles visibility — Engine.setParam)
  gasScale: 'uGasScale', gasWarp: 'uGasWarp', gasContrast: 'uGasContrast',
  gasFlowSpeed: 'uGasFlow', gasBands: 'uGasBands', gasStretch: 'uGasStretch',
  // gasStorms is gated by gasStormsEnabled — handled in Engine.setParam
  gasStormScale: 'uGasStormScale', gasLimb: 'uGasLimb',
  gasColorDeep: 'uGasDeep', gasColorBase: 'uGasBase',
  gasColorSwirl: 'uGasSwirl', gasColorStorm: 'uGasStorm',
  // star mode (starCoronaSize scales the corona shell — Engine.setParam)
  starColorCore: 'uStarCore', starColorMid: 'uStarMid', starColorEdge: 'uStarEdge',
  starSpotColor: 'uStarSpotCol', starNoiseScale: 'uStarScale',
  starTurbulence: 'uStarWarp', starGranules: 'uStarGranules',
  starFlowSpeed: 'uStarFlow',
  // starSpots is gated by starSpotsEnabled — handled in Engine.setParam
  starSpotScale: 'uStarSpotScale', starLimbDarken: 'uStarLimb',
  starBands: 'uStarBands', starGlow: 'uStarGlow',
  starPulseAmount: 'uStarPulseAmt', starPulseSpeed: 'uStarPulseSpeed',
  starCoronaColor: 'uStarCoronaCol', starCoronaStrength: 'uStarCoronaStr',
  starFlares: 'uStarFlares',
};

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
${SURFACE_GLSL}
${CLOUD_FIELD_GLSL}
${CLOUD_SHADOW_GLSL}

varying vec3 vDir;
varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize(vDir);

  float h, slope;
  vec3 n = terrainNormal(dir, h, slope);
  vec3 col = surfaceColor(dir, h, slope);

  // toon lighting, dimmed under the drifting cloud shadows
  float diff = toonShade(max(dot(n, uSunDir), 0.0));
  float light = uAmbient + diff * uSunIntensity * (1.0 - cloudShadow(dir));
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
${SURFACE_GLSL}
${CLOUD_FIELD_GLSL}
${CLOUD_SHADOW_GLSL}

uniform float uWaterOpacity;
uniform float uFoamWidth;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uWaterSpec;

varying vec3 vDir;
varying vec3 vWorldPos;

float sat(float x) {
  return clamp(x, 0.0, 1.0);
}

void main() {
  vec3 dir = normalize(vDir);

  float terrainH = height01(dir);
  float sea = uSeaLevel;
  float depth = sea - terrainH;               // in height01 fraction units
  if (depth <= 0.001) discard;

  float t = uTime * uWaveSpeed;
  vec3 up = dir;
  vec3 ref = abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, up));
  vec3 t2 = cross(up, t1);
  vec3 wp = dir * uWaveScale + uSeedOffset * 0.23;

  // ---- hard depth bands: flat color steps with noise-wobbled borders, the
  // cartoon equivalent of a bathymetric map
  float grade = sat(depth / max(sea * 0.85, 1e-4));
  float wob = (vnoise3(dir * uWaveScale * 0.4 + uSeedOffset) - 0.5) * 0.10;
  float g = grade + wob;
  vec3 shallowCol = mix(uColShallow, uColFoam, 0.08);
  vec3 midCol = mix(uColShallow, uColDeep, 0.55);
  vec3 abyssCol = uColDeep * vec3(0.55, 0.68, 0.85);
  vec3 col = shallowCol;
  col = mix(col, midCol, band(0.14, g));
  col = mix(col, uColDeep, band(0.42, g));
  col = mix(col, abyssCol, band(0.75, g));

  // ---- stylized wave pattern: thin bright contours drifting on the surface,
  // strongest over the shelves, calm over the deep basins
  float n1 = vnoise3(wp * 0.9 + vec3(t * 0.45, t * 0.31, -t * 0.38));
  float n2 = vnoise3(wp * 1.7 - vec3(t * 0.36, t * 0.44, t * 0.27));
  float pat = n1 * 0.62 + n2 * 0.38;
  float contour = smoothstep(0.55, 0.57, pat) * (1.0 - smoothstep(0.60, 0.62, pat));
  float patFade = 1.0 - band(0.55, g) * 0.85;
  col = mix(col, uColFoam, contour * 0.22 * patFade);

  // ---- coast foam: a solid rim hugging the shore plus broken surf lines
  // that keep rolling in toward the coast
  float coast = depth / max(sea, 1e-4);
  float fw = max(uFoamWidth, 0.001);
  float fn = vnoise3(dir * uWaveScale * 2.6 + uSeedOffset * 0.31 + t * 0.5);
  float rim = 1.0 - smoothstep(fw * 0.08, fw * 0.30, coast + (fn - 0.5) * fw * 0.35);
  float surfPhase = fract(coast / fw * 1.25 - t * 0.22 + (fn - 0.5) * 0.30);
  float surfLine = smoothstep(0.82, 0.90, surfPhase) * (1.0 - smoothstep(0.94, 1.0, surfPhase));
  float surfFade = (1.0 - smoothstep(fw * 0.35, fw * 1.15, coast)) *
                   smoothstep(fw * 0.05, fw * 0.25, coast);
  float surfMask = smoothstep(0.35, 0.55, fn);
  float foam = sat(rim + surfLine * surfFade * surfMask);
  col = mix(col, uColFoam, foam * 0.95);

  // ---- ripple normal for lighting and glints
  float r0 = vnoise3(wp * 0.72 + t * 0.18);
  float rX = vnoise3(wp * 0.72 + t1 * 0.45 + t * 0.18);
  float rZ = vnoise3(wp * 0.72 + t2 * 0.45 + t * 0.18);
  vec3 n = normalize(up - (t1 * (rX - r0) + t2 * (rZ - r0)) * 0.8);

  // ---- toon lighting, dimmed under cloud shadows
  float shadow = cloudShadow(dir);
  float diff = toonShade(max(dot(n, uSunDir), 0.0));
  col *= uAmbient + diff * uSunIntensity * (1.0 - shadow * 0.8);

  // ---- hard toon glints + sparse sun sparkles
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 halfDir = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 110.0);
  float glint = smoothstep(0.28, 0.34, spec);
  float sunAmt = smoothstep(0.15, 0.6, max(dot(up, uSunDir), 0.0));
  float sparkle = smoothstep(0.90, 0.94, vnoise3(wp * 7.0 + t * 1.4)) * sunAmt * (1.0 - foam);
  col += uColFoam * (glint * 0.7 + sparkle * 0.5) * uWaterSpec * (1.0 - shadow);

  // ---- fresnel horizon lift keeps the limb bright and readable
  float fres = pow(1.0 - max(dot(viewDir, up), 0.0), 3.0);
  col = mix(col, uColShallow * 1.15, fres * 0.18);

  float alpha = sat(uWaterOpacity * mix(0.50, 0.95, band(0.20, g)) +
                    fres * 0.12 + foam * 0.30);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), min(alpha, 0.97));
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
// Clouds — realistic weather-system look on a single shell, no raymarch. The
// vertex shader still puffs dense cells slightly for a soft silhouette. The
// fragment layers billow + wisp detail over the warped coverage field: soft
// graded alpha (thin translucent edges, opaque cores), fractal erosion so
// borders break into wisps, smooth non-toon shading with darker cores and a
// forward-scatter silver lining on thin backlit edges.
// ---------------------------------------------------------------------------

const CLOUD_VERTEX = /* glsl */ `
${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${CLOUD_FIELD_GLSL}

uniform float uCloudPuff;

varying vec3 vDir;
varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize(position);
  // gentle outward swell where the field is dense — enough to soften the
  // silhouette against space without reading as cartoon bumps
  float base = cloudBase(dir);
  float cut = 1.0 - uCloudCoverage;
  float puff = smoothstep(cut - 0.05, cut + 0.45, base);
  vec4 wp = modelMatrix * vec4(position * (1.0 + puff * uCloudPuff * 0.03), 1.0);
  vDir = dir;
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${CLOUD_FIELD_GLSL}

uniform float uCloudSoftness;
uniform float uCloudDensity;
uniform float uCloudDetail;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;

varying vec3 vDir;
varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize(vDir);
  vec3 p = cloudDomain(dir);
  // swirl warp (cloud shell only — too costly for the shared shadow path):
  // fronts curl instead of sitting as static blobs
  vec3 w = vec3(
    vnoise3(p * 0.5 + 3.1),
    vnoise3(p * 0.5 + 17.7),
    vnoise3(p * 0.5 + 51.3)
  ) - 0.5;
  p += w * uCloudScale * 0.45;
  float base = fbm(p);
  float t = uTime * uCloudSpeed * 0.08;

  // detail layers: mid-frequency billows shape the body, high-frequency
  // wisps erode the thin edges into streaks (cheap 2-tap layers — ANGLE
  // fully unrolls every noise call, so instruction count is compile time)
  float bil = vnoise3(p * 2.6 + t) * 0.6 + vnoise3(p * 5.1 - t) * 0.4;
  float wisp = vnoise3(p * 6.5 - t * 1.3) * 0.6 + vnoise3(p * 12.0 + t) * 0.4;

  float cut = 1.0 - uCloudCoverage;
  float soft = max(uCloudSoftness, 0.02);

  // graded density: soft coverage ramp + billow detail
  float dens = base + (bil - 0.5) * uCloudDetail * 0.35;
  float cov = smoothstep(cut, cut + soft + 0.20, dens);
  // fractal erosion: cores always pass, thin edges break into wisps
  cov *= smoothstep(0.30, 0.60, wisp + cov * 0.9);
  float alpha = cov * uCloudDensity;
  if (alpha < 0.01) discard;

  // smooth shading from the density-gradient bent normal (no toon bands —
  // clouds read realistic against the stylized terrain). Gradient sampled in
  // the already-warped domain: skips recomputing the warp, visually identical
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, dir));
  vec3 t2 = cross(dir, t1);
  float e = 0.02 * uCloudScale;
  float gx = fbm(p + t1 * e) - base;
  float gy = fbm(p + t2 * e) - base;
  vec3 n = normalize(dir - (t1 * gx + t2 * gy) * 5.0);

  // soft-wrapped diffuse so the terminator on each system stays gentle
  float diff = max(dot(n, uSunDir), 0.0);
  diff = diff * 0.85 + max(dot(dir, uSunDir), 0.0) * 0.15;

  // thick cores pick up the grey-blue shadow tone on their unlit side
  float thick = smoothstep(cut + 0.12, cut + 0.45, dens);
  vec3 col = mix(uCloudColor, uCloudShadow, thick * (1.0 - diff) * 0.55);
  col *= clamp(uAmbient * 0.6 + diff * uSunIntensity * 0.95, 0.0, 1.2);

  // forward-scatter silver lining where thin cloud is backlit by the sun
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float back = pow(max(dot(-viewDir, uSunDir), 0.0), 4.0);
  col += uCloudColor * back * (1.0 - thick) * cov * 0.5;

  // thin edges stay translucent, cores go nearly opaque
  alpha *= mix(0.55, 1.0, thick);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createCloudMaterial(shared, octaves) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    // 4 octaves keep the cloud program small enough for ANGLE's D3D compiler
    // (detail comes from the billow/wisp taps, not deep fbm)
    defines: { OCTAVES: Math.min(octaves, 4) },
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
