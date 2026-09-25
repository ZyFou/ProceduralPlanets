import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL, ATMOSPHERE_GLSL, CLOUD_FIELD_GLSL, SURFACE_GLSL } from './surfaceGLSL.js';
import { seedToOffset } from './presets.js';

// ============================================================================
// Shared uniforms + the terrain chunk material. Terrain chunk materials are
// created per chunk but SHARE the uniform value objects, so a slider move
// updates every chunk in the same frame — and three's program cache means one
// compile total. Ocean, clouds, atmosphere and the starfield are screen-space
// passes in PlanetPipeline.js that read the same uniforms.
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
    uExposure:      { value: p.exposure },
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

    // ocean (composite pass) — radii / absorption derived in Engine
    uSeaRadius:     { value: p.radius + p.seaLevel * p.heightScale },
    uWaterAbsorb:   { value: new THREE.Vector3(0.1, 0.02, 0.02) },
    uWaveSize:      { value: p.waveSize },
    uWaveHeight:    { value: p.waveHeight },
    uWaveSpeed:     { value: p.waveSpeed },
    uWaterSpec:     { value: p.waterSpec },
    uFoamWidth:     { value: p.foamWidth },
    uFoamAmount:    { value: p.foamAmount },
    uWhitecaps:     { value: p.whitecaps },
    uWaterEmissive: { value: p.waterEmissive },

    // clouds — weather cubemap + noise volume are baked by PlanetPipeline
    uWeatherMap:    { value: null },
    uCloudNoise:    { value: null },
    uCloudErosion:  { value: null },
    uCloudCoverage: { value: p.cloudCoverage },
    uCloudSoftness: { value: p.cloudSoftness },
    uCloudDensity:  { value: p.cloudDensity },
    uCloudScale:    { value: p.cloudScale },
    uCloudDetail:   { value: p.cloudDetail },
    uCloudSpeed:    { value: p.cloudSpeed },
    uCloudColor:    { value: v3(p.cloudColor) },
    uCloudShadow:   { value: v3(p.cloudShadow) },
    uCloudBottom:   { value: p.radius * 1.01 },
    uCloudTop:      { value: p.radius * 1.02 },
    uCloudRotation: { value: 0 },
    uCloudShadowStr:{ value: p.cloudsEnabled ? p.cloudShadowStrength : 0 },
    uCloudShapeFreq:  { value: 0.02 },   // world-space, set per frame by Engine
    uCloudDetailFreq: { value: 0.1 },
    uCloudWind:       { value: new THREE.Vector3() },

    // atmosphere — physical coefficients derived in Engine._syncAtmosphere
    uTransmittanceLUT: { value: null },
    uAtmoOn:        { value: 1 },
    uAtmoGround:    { value: p.radius },
    uAtmoTop:       { value: p.radius * 1.05 },
    uAtmoRayleigh:  { value: new THREE.Vector3() },
    uAtmoMie:       { value: 0 },
    uAtmoOzone:     { value: new THREE.Vector3() },
    uAtmoHR:        { value: 1 },
    uAtmoHM:        { value: 1 },
    uSkyTint:       { value: new THREE.Vector3(0.4, 0.6, 1.0) },
    uAtmoColor:     { value: v3(p.atmoColor) },
    uAtmoStrength:  { value: p.atmoStrength },

    // gas giant surface + rings
    uGasBandCount:  { value: p.gasBandCount },
    uGasContrast:   { value: p.gasContrast },
    uGasBandWarp:   { value: p.gasBandWarp },
    uGasTurb:       { value: p.gasWarp },
    uGasScale:      { value: p.gasScale },
    uGasFlow:       { value: p.gasFlowSpeed },
    uGasPolarHaze:  { value: p.gasPolarHaze },
    uGasStorms:     { value: p.gasStormsEnabled ? p.gasStorms : 0 },
    uGasStormScale: { value: p.gasStormScale },
    uGasGreatSpot:  { value: p.gasStormsEnabled ? p.gasGreatSpot : 0 },
    uGasLimb:       { value: p.gasLimb },
    uGasZone:       { value: v3(p.gasColorZone) },
    uGasBelt:       { value: v3(p.gasColorBelt) },
    uGasAccent:     { value: v3(p.gasColorAccent) },
    uGasStorm:      { value: v3(p.gasColorStorm) },
    uGasPolar:      { value: v3(p.gasColorPolar) },
    uGasRingOn:     { value: p.gasRingsEnabled ? 1 : 0 },
    uGasRingInner:  { value: p.gasRingInner },
    uGasRingOuter:  { value: p.gasRingOuter },
    uGasRingOpacity:{ value: p.gasRingOpacity },
    uGasRingColor:  { value: v3(p.gasRingColor) },
    uGasAxis:       { value: new THREE.Vector3(0, 1, 0) },   // set by Engine (tilt)
    uGasJets:       { value: null },                         // GasJetTable (gas.js)

    // star mode — surface (star.js) + halo (composite pass)
    uStarTemp:       { value: p.starTemperature },
    uStarTint:       { value: v3(p.starTint) },
    uStarBright:     { value: p.starBrightness },
    uStarScale:      { value: p.starNoiseScale },
    uStarWarp:       { value: p.starTurbulence },
    uStarGranules:   { value: p.starGranules },
    uStarFlow:       { value: p.starFlowSpeed },
    uStarFaculae:    { value: p.starFaculae },
    uStarSpots:      { value: p.starSpotsEnabled ? p.starSpots : 0 },
    uStarSpotScale:  { value: p.starSpotScale },
    uStarLimb:       { value: p.starLimbDarken },
    uStarPulseAmt:   { value: p.starPulseAmount },
    uStarPulseSpeed: { value: p.starPulseSpeed },
    uStarCoronaOn:   { value: p.starCoronaEnabled ? 1 : 0 },
    uStarCoronaCol:  { value: v3(p.starCoronaColor) },
    uStarCoronaSize: { value: p.starCoronaSize },
    uStarCoronaStr:  { value: p.starCoronaStrength },
    uStarFlares:     { value: p.starFlares },
    uStarProm:       { value: p.starProminences },
    uStarChromo:     { value: v3(p.starChromoColor) },
  };
}

// Maps flat param keys -> uniform names (scalar or vec3-from-array).
export const UNIFORM_MAP = {
  radius: 'uRadius', heightScale: 'uHeightScale', seaLevel: 'uSeaLevel',
  noiseScale: 'uNoiseScale', persistence: 'uPersistence', lacunarity: 'uLacunarity',
  warp: 'uWarp', ridge: 'uRidge', mountainScale: 'uMountainScale',
  craters: 'uCraters', craterScale: 'uCraterScale', continents: 'uContinents',
  sunIntensity: 'uSunIntensity', ambient: 'uAmbient', exposure: 'uExposure',
  toonBands: 'uToonBands', toonSoftness: 'uToonSoftness', bandSoftness: 'uBandSoftness',
  snowLine: 'uSnowLine', polarCaps: 'uPolarCaps',
  biomeAmount: 'uBiomeAmount', tempBias: 'uTempBias', moistureScale: 'uMoistScale',
  bioTundra: 'uBioTundra', bioSteppe: 'uBioSteppe', bioTaiga: 'uBioTaiga',
  bioShrub: 'uBioShrub', bioDesert: 'uBioDesert', bioSavanna: 'uBioSavanna',
  bioJungle: 'uBioJungle',
  colDeep: 'uColDeep', colShallow: 'uColShallow', colSand: 'uColSand',
  colGrass: 'uColGrass', colForest: 'uColForest', colRock: 'uColRock',
  colSnow: 'uColSnow', colFoam: 'uColFoam',
  waveSize: 'uWaveSize', waveHeight: 'uWaveHeight', waveSpeed: 'uWaveSpeed',
  waterSpec: 'uWaterSpec', foamWidth: 'uFoamWidth', foamAmount: 'uFoamAmount',
  whitecaps: 'uWhitecaps', waterEmissive: 'uWaterEmissive',
  cloudCoverage: 'uCloudCoverage', cloudSoftness: 'uCloudSoftness',
  cloudDensity: 'uCloudDensity', cloudScale: 'uCloudScale',
  cloudDetail: 'uCloudDetail', cloudSpeed: 'uCloudSpeed',
  cloudColor: 'uCloudColor', cloudShadow: 'uCloudShadow',
  // cloudShadowStrength is gated by cloudsEnabled — handled in Engine.setParam
  atmoColor: 'uAtmoColor', atmoStrength: 'uAtmoStrength',
  // gas giant (mode toggles visibility; gasStorms / gasGreatSpot are gated
  // by gasStormsEnabled, gasTilt / rings / gasAtmo* — Engine.setParam)
  gasBandCount: 'uGasBandCount', gasContrast: 'uGasContrast', gasBandWarp: 'uGasBandWarp',
  gasWarp: 'uGasTurb', gasScale: 'uGasScale', gasFlowSpeed: 'uGasFlow',
  gasPolarHaze: 'uGasPolarHaze', gasStormScale: 'uGasStormScale', gasLimb: 'uGasLimb',
  gasColorZone: 'uGasZone', gasColorBelt: 'uGasBelt', gasColorAccent: 'uGasAccent',
  gasColorStorm: 'uGasStorm', gasColorPolar: 'uGasPolar',
  gasRingInner: 'uGasRingInner', gasRingOuter: 'uGasRingOuter',
  gasRingOpacity: 'uGasRingOpacity', gasRingColor: 'uGasRingColor',
  // star mode (starSpots is gated by starSpotsEnabled — Engine.setParam)
  starTemperature: 'uStarTemp', starTint: 'uStarTint', starBrightness: 'uStarBright',
  starNoiseScale: 'uStarScale', starTurbulence: 'uStarWarp', starGranules: 'uStarGranules',
  starFlowSpeed: 'uStarFlow', starFaculae: 'uStarFaculae',
  starSpotScale: 'uStarSpotScale', starLimbDarken: 'uStarLimb',
  starPulseAmount: 'uStarPulseAmt', starPulseSpeed: 'uStarPulseSpeed',
  starCoronaColor: 'uStarCoronaCol', starCoronaSize: 'uStarCoronaSize',
  starCoronaStrength: 'uStarCoronaStr', starFlares: 'uStarFlares',
  starProminences: 'uStarProm', starChromoColor: 'uStarChromo',
};

// ---------------------------------------------------------------------------
// Terrain — writes LINEAR HDR radiance into the pipeline's scene target; the
// composite pass adds ocean, clouds, atmosphere and tone mapping on top.
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
#ifdef WARP_VARYING
varying vec3 vWarp;               // warp displacement pw - p
varying vec3 vJw0, vJw1, vJw2;    // its Jacobian (JwT columns)
varying vec3 vQJ;                 // q * JwT, q = dir * uNoiseScale
#endif

void main() {
  vec2 uv2 = uUV0 + position.xy * uUVSize;
  vec3 cube = uFaceOrigin + uv2.x * uFaceU + uv2.y * uFaceV;
  vec3 dir = normalize(cube);
#ifdef WARP_VARYING
  mat3 JwT;
  vec3 pw = warpDomain(dir, JwT);
  vec3 g;
  float cl, mt;
  float h = heightFieldWarped(dir, pw, JwT, g, cl, mt) * uHeightScale;
  vec3 q = dir * uNoiseScale;
  vWarp = pw - (q + uSeedOffset);
  vJw0 = JwT[0]; vJw1 = JwT[1]; vJw2 = JwT[2];
  vQJ = q * JwT;
#else
  float h = terrainHeight(dir);
#endif
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
${ATMOSPHERE_GLSL}
${CLOUD_FIELD_GLSL}
${SURFACE_GLSL}

varying vec3 vDir;
varying vec3 vWorldPos;
#ifdef WARP_VARYING
varying vec3 vWarp;               // warp displacement pw - p
varying vec3 vJw0, vJw1, vJw2;    // its Jacobian (JwT columns)
varying vec3 vQJ;                 // q * JwT, q = dir * uNoiseScale
#endif

void main() {
  vec3 dir = normalize(vDir);

  // exact normal from the analytic height gradient (one evaluation)
  vec3 grad;
  float cLow, mtn;
#ifdef WARP_VARYING
  // The domain warp is smooth at the vertex spacing: interpolated from the
  // vertices instead of 6 noise evaluations per pixel. Linear interpolation
  // and the average of the vertices' first-order Taylor expansions err by
  // the same second-order term with opposite signs, so their mean is exact
  // to third order. Interpolated in seed-free coordinates (the seed offset
  // is up to 256) to keep float precision.
  mat3 JwT = mat3(vJw0, vJw1, vJw2);
  vec3 q = dir * uNoiseScale;
  vec3 warp = vWarp + 0.5 * ((q * JwT - q) - (vQJ - vDir * uNoiseScale));
  float h = heightFieldWarped(dir, q + uSeedOffset + warp, JwT, grad, cLow, mtn);
#else
  float h = heightField(dir, grad, cLow, mtn);
#endif
  float r = uRadius + h * uHeightScale;
  vec3 gt = grad - dir * dot(grad, dir);
  vec3 n = normalize(dir - gt * (uHeightScale / r));
  float slope = 1.0 - clamp(dot(n, dir), 0.0, 1.0);

  // to-scale procedural detail: octaves fade with the pixel footprint
  float fp = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));
  vec3 dSlope;
  float det = surfaceDetail(vWorldPos, fp, dSlope);

  float rock, snow;
  vec3 albedo = surfaceAlbedo(dir, h, slope, cLow, mtn, det, rock, snow);

  // detail bump: rough rock, softer vegetation, smooth snow
  float bump = h < uSeaLevel ? 0.12 : mix(0.22, 0.55, rock) * (1.0 - snow * 0.65);
  vec3 ds = dSlope - n * dot(dSlope, n);
  vec3 nd = normalize(n - ds * bump);

  // sun: atmospheric transmittance (reddens at the terminator, planet
  // shadow on the night side), cloud shadows; sky light from above
  vec3 sun = sunIrradiance(vWorldPos) * (1.0 - cloudShadow(vWorldPos));
  float ndl = max(dot(nd, uSunDir), 0.0) * smoothstep(-0.05, 0.12, dot(n, uSunDir) + 0.1);
  float diff = toonShade(ndl);
  vec3 col = albedo * (sun * diff + skyIrradiance(vWorldPos, nd)) / PI;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrainMaterial(shared, octaves, chunkUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uSkirtDepth: { value: 0 }, ...chunkUniforms },
    defines: { OCTAVES: octaves, WARP_VARYING: 1 },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    side: THREE.FrontSide,
  });
}
