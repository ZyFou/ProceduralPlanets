import { pickPlanetRay } from '../paint/PlanetPaintPicker.js';
import { PlanetPaintLayerManager } from '../paint/PlanetPaintLayerManager.js';
import * as THREE from 'three';
import {
  DEFAULT_PARAMS, REBUILD_KEYS, PLANET_PRESETS,
  STAR_DEFAULTS, STAR_KEYS, STAR_PRESETS,
  GAS_DEFAULTS, GAS_KEYS, GAS_PRESETS, seedToOffset, migrateParams,
} from './presets.js';
import { createSharedUniforms, createTerrainMaterial, createTerrainUniforms, UNIFORM_MAP } from './materials.js';
import { compileGraph } from './graph/index.js';
import { ProgramWarmer } from './ProgramWarmer.js';
import {
  DEFAULT_STAR_BODY, createStarSurfaceMaterial, validateStarShaderBody,
} from './star.js';
import { createGasSurfaceMaterial, createRingMaterial, createRingGeometry, GasJetTable } from './gas.js';
import { PlanetWorld } from './PlanetWorld.js';
import { PlanetHeightSampler } from './PlanetHeightSampler.js';

// ============================================================================
// Planet — one procedural body (terrestrial planet, gas giant or star) as a
// THREE.Object3D. It owns the parameter store, the shared uniforms and the
// body meshes; almost every param maps to a uniform (live), the few
// structural keys rebuild the LOD world.
//
// The body meshes live in a PRIVATE scene centred on the origin, not as
// children of this object: every shader assumes the planet at the origin.
// PlanetRenderer draws that scene through a camera expressed in this
// object's local frame, so moving / rotating / scaling (uniformly) the
// Planet moves its render.
// ============================================================================

// params that feed derived (physically scaled) uniforms
const ATMO_KEYS = new Set(['radius', 'heightScale', 'seaLevel', 'atmoEnabled', 'atmoStrength',
  'atmoColor', 'atmoHeight', 'atmoHaze', 'cloudAltitude', 'cloudThickness', 'mode',
  'gasAtmoColor', 'gasAtmoStrength', 'gasAtmoHaze']);
// gas giants keep a thin haze layer above the cloud tops (fraction of radius)
const GAS_ATMO_HEIGHT = 0.025;
const WATER_KEYS = new Set(['radius', 'heightScale', 'seaLevel', 'colShallow', 'waterClarity']);
const WEATHER_KEYS = new Set(['seed', 'cloudScale']);

const srgbToLinear = (c) => Math.pow(Math.max(c, 0), 2.2);

/** Public body types -> internal render modes. */
export const PLANET_TYPES = Object.freeze({
  terrestrial: 'planet',
  planet: 'planet',
  gas: 'gas',
  star: 'star',
});

export const MODE_TO_TYPE = Object.freeze({ planet: 'terrestrial', gas: 'gas', star: 'star' });

const PRESET_TABLES = [
  ['planet', PLANET_PRESETS],
  ['gas', GAS_PRESETS],
  ['star', STAR_PRESETS],
];

/** Look a preset name up in the three preset tables: { mode, preset } or null. */
export function findPreset(name) {
  for (const [mode, table] of PRESET_TABLES) {
    if (Object.prototype.hasOwnProperty.call(table, name)) return { mode, preset: table[name] };
  }
  return null;
}

/** Every preset name, grouped by body type. */
export function listPresets() {
  return {
    terrestrial: Object.keys(PLANET_PRESETS),
    gas: Object.keys(GAS_PRESETS),
    star: Object.keys(STAR_PRESETS),
  };
}

const warned = new Set();
function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[procedural-planets] ${msg}`);
}

const _color = new THREE.Color();
const _rgb = { r: 0, g: 0, b: 0 };

// Colours are sRGB albedos in [0, 1]. Accepts [r, g, b], '#rrggbb' / '#rgb'
// (or any CSS colour three understands), 0xrrggbb and THREE.Color.
function toColorArray(value) {
  if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) {
    return [value[0], value[1], value[2]];
  }
  if (value && value.isColor) {
    value.getRGB(_rgb, THREE.SRGBColorSpace);
    return [_rgb.r, _rgb.g, _rgb.b];
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }
  if (typeof value === 'string') {
    const hex = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
      return toColorArray(parseInt(h, 16));
    }
    // any other CSS colour (names, rgb(), hsl()) through three's parser
    _color.setStyle(value, THREE.SRGBColorSpace);
    _color.getRGB(_rgb, THREE.SRGBColorSpace);
    return [_rgb.r, _rgb.g, _rgb.b];
  }
  return null;
}

/**
 * Normalise one parameter value to the engine's representation. Returns
 * { ok, value } — ok false for unknown keys or values of the wrong type.
 */
export function normalizeParam(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PARAMS, key)) return { ok: false, reason: 'unknown' };
  const def = DEFAULT_PARAMS[key];
  if (key === 'mode') {
    const mode = PLANET_TYPES[value] ?? (['planet', 'gas', 'star'].includes(value) ? value : null);
    return mode ? { ok: true, value: mode } : { ok: false, reason: 'invalid' };
  }
  if (key === 'seed') {
    const n = Number(value);
    return Number.isFinite(n) ? { ok: true, value: n >>> 0 } : { ok: false, reason: 'invalid' };
  }
  if (key === 'renderResolution') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0.25 && value <= 1
      ? { ok: true, value } : { ok: false, reason: 'invalid' };
  }
  if (key === 'upscaler') {
    return ['bilinear', 'spatial'].includes(value) ? { ok: true, value } : { ok: false, reason: 'invalid' };
  }
  if (Array.isArray(def)) {
    const c = toColorArray(value);
    return c ? { ok: true, value: c } : { ok: false, reason: 'invalid' };
  }
  if (typeof def === 'boolean') return { ok: true, value: !!value };
  if (typeof def === 'number') {
    const n = typeof value === 'boolean' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: 'invalid' };
  }
  return { ok: true, value };
}

/**
 * Validate / normalise a parameter patch. Returns
 * { params, unknown: string[], invalid: string[] } — params holds only the
 * accepted, normalised entries.
 */
export function validateParams(patch = {}) {
  const params = {};
  const unknown = [];
  const invalid = [];
  for (const [key, value] of Object.entries(patch)) {
    const r = normalizeParam(key, value);
    if (r.ok) params[key] = r.value;
    else if (r.reason === 'unknown') unknown.push(key);
    else invalid.push(key);
  }
  return { params, unknown, invalid };
}

function acceptParams(patch, where) {
  const { params, unknown, invalid } = validateParams(patch);
  if (unknown.length) warnOnce(`${where}: unknown parameter(s) ignored: ${unknown.join(', ')}`);
  if (invalid.length) warnOnce(`${where}: invalid value(s) ignored for: ${invalid.join(', ')}`);
  return params;
}

const OPTION_KEYS = new Set(['type', 'preset', 'params', 'lightSource', 'starShader', 'name', 'terrain', 'paint']);

/**
 * Resolve Planet constructor options into a full parameter object:
 * DEFAULT_PARAMS <- preset patch <- options.params <- flat param options.
 */
export function resolvePlanetParams(options = {}) {
  const flat = {};
  for (const [k, v] of Object.entries(options)) if (!OPTION_KEYS.has(k)) flat[k] = v;
  const explicit = { ...(options.params ?? {}), ...flat };

  let mode = options.type != null ? PLANET_TYPES[options.type] : null;
  if (options.type != null && !mode) throw new Error(`[procedural-planets] unknown planet type "${options.type}" (terrestrial | gas | star)`);

  let patch = {};
  if (options.preset != null) {
    const found = findPreset(options.preset);
    if (!found) throw new Error(`[procedural-planets] unknown preset "${options.preset}"`);
    if (mode && found.mode !== mode) {
      throw new Error(`[procedural-planets] preset "${options.preset}" is a ${MODE_TO_TYPE[found.mode]} preset, not ${MODE_TO_TYPE[mode]}`);
    }
    mode = found.mode;
    patch = found.preset.patch ?? {};
  }
  if (!mode) mode = explicit.mode != null ? normalizeParam('mode', explicit.mode).value ?? 'planet' : 'planet';

  const accepted = acceptParams(explicit, 'Planet');
  return { ...DEFAULT_PARAMS, ...patch, ...accepted, mode };
}

// ============================================================================

export class Planet extends THREE.Object3D {
  /**
   * @param {object} [options]
   *   type        'terrestrial' | 'gas' | 'star'   (default: from preset, else terrestrial)
   *   preset      preset name (see listPresets())
   *   seed        any integer
   *   lightSource THREE.Object3D (light / star / any object) or Vector3 world direction toward the sun
   *   params      a parameter object (e.g. from the studio); flat keys override it
   *   starShader  custom starSurface() GLSL body
   *   ...         any other key is a parameter (radius, seaLevel, cloudCoverage, ...)
   */
  constructor(options = {}) {
    super();
    this.type = 'Planet';
    this.isPlanet = true;
    if (options.name) this.name = options.name;

    this.params = resolvePlanetParams(options);
    /** Object3D, Vector3 (world direction toward the sun) or null (use sunAzimuth / sunElevation). */
    this.lightSource = options.lightSource ?? null;

    this.cloudTime = 0;     // integrated cloud clock (cloudSpeed-scaled)

    this.uniforms = createSharedUniforms(this.params);
    this._scene = new THREE.Scene();
    this._scene.matrixWorldAutoUpdate = true;

    this._passes = null;
    this._passesOwner = null;
    this._lutDirty = true;
    this._weatherDirty = true;
    this._version = 0;

    this.paintLayers = new PlanetPaintLayerManager({ uniforms: this.uniforms, onChange: () => {
      this._version++;
      this.uniforms.uPaintExtent.value = this.paintLayers?.maxHeight ?? 0;
    } });
    if (options.paint) this.paintLayers.load(options.paint);
    this.world = new PlanetWorld(this._scene, this.uniforms, {
      chunkRes: this.params.chunkRes,
      maxDepth: this.params.maxDepth,
      splitFactor: this.params.splitFactor,
      octaves: this.params.octaves,
      analyticTerrainDepth: this.params.analyticTerrainDepth,
    });
    if (this.params.wireframe) this.world.setWireframe(true);
    this._terrainRevision = 0;
    this._terrainProgram = null;
    this._terrain = { mode: 'procedural', graph: null };
    this._disposed = false;
    const terrain = options.terrain;
    if (terrain) {
      const program = this._compileTerrain(terrain);
      this._installTerrain(terrain, program, this._terrainMaterials(program));
    }
    this._buildStar(options.starShader);
    this._buildGas();

    this._applySunDir();
    this._syncAtmosphere();
    this._syncWater();
    this._syncShellVisibility();
    this._syncMode();
    this.uniforms.uStarCoronaOn.value = this.params.starCoronaEnabled ? 1 : 0;
  }

  /** 'terrestrial' | 'gas' | 'star' */
  get planetType() { return MODE_TO_TYPE[this.params.mode]; }

  /** Detached canonical generation data; the editor draft never enters the runtime. */
  get terrain() { return JSON.parse(JSON.stringify(this._terrain)); }

  _compileTerrain(terrain) {
    if (!terrain || !['procedural', 'nodes'].includes(terrain.mode)) throw new Error('Unsupported terrain mode.');
    if (terrain.mode === 'nodes' && !terrain.graph) throw new Error('Nodes terrain requires a valid height graph.');
    return terrain.mode === 'nodes' ? compileGraph(terrain.graph, this.params) : null;
  }

  _terrainMaterials(program) {
    const shared = createTerrainUniforms(this.uniforms, program);
    const octaves = program?.identityParams?.octaves ?? this.params.octaves;
    const shaderProgram = program?.identityParams ? null : program;
    return [false, true].map((low) => {
      const material = createTerrainMaterial(shared, octaves, low, this.params.chunkRes, shaderProgram, this.params.analyticTerrainDepth);
      material.wireframe = this.params.wireframe;
      return material;
    });
  }

  _createHeightSampler(params = this.params, uniforms = this.uniforms) {
    return new PlanetHeightSampler(params, uniforms, this._terrainProgram);
  }

  _installTerrain(terrain, program, materials) {
    this._terrain = JSON.parse(JSON.stringify(terrain));
    this._terrainProgram = program;
    this.world.installTerrainMaterials(materials, {
      program: program?.identityParams ? null : program,
      uniforms: program ? createTerrainUniforms(this.uniforms, program) : null,
      octaves: program?.identityParams?.octaves ?? null,
    });
    this._sampler = this._createHeightSampler();
    this._version++;
  }

  /** Validate and warm a candidate before swapping GPU and CPU generation together. */
  async setTerrain(terrain, { renderer } = {}) {
    const revision = ++this._terrainRevision;
    let materials;
    let warmer;
    try {
      const program = this._compileTerrain(terrain);
      if (this._terrain.mode === terrain.mode && this._terrainProgram?.signature === program?.signature) {
        this._terrain = JSON.parse(JSON.stringify(terrain));
        return { ok: true, revision, compiled: false };
      }
      if (this._terrain.mode === terrain.mode && this._terrainProgram?.structureSignature === program?.structureSignature && !!this._terrainProgram === !!program) {
        // An unchanged program only needs its uniform values and CPU evaluator swapped.
        const shared = createTerrainUniforms(this.uniforms, program);
        this.world.templateMaterials.forEach((material) => {
          Object.entries(shared).forEach(([name, uniform]) => { if (name in material.uniforms) material.uniforms[name] = uniform; });
        });
        this._terrain = JSON.parse(JSON.stringify(terrain));
        this._terrainProgram = program;
        this.world.terrainProgram = program?.identityParams ? null : program;
        this.world.terrainUniforms = program ? shared : null;
        this._sampler = this._createHeightSampler();
        this._version++;
        return { ok: true, revision, compiled: false };
      }
      materials = this._terrainMaterials(program);
      if (renderer) {
        warmer = new ProgramWarmer(renderer);
        const entries = materials.map((material) => ({ material, offscreen: true }));
        while (!warmer.ensure(entries).ready) {
          if (revision !== this._terrainRevision || this._disposed) return { ok: false, obsolete: true, revision };
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
      }
      if (revision !== this._terrainRevision || this._disposed) return { ok: false, obsolete: true, revision };
      this._installTerrain(terrain, program, materials);
      materials = null;
      return { ok: true, revision, compiled: true };
    } catch (error) {
      return { ok: false, revision, error: error.message, diagnostics: error.diagnostics ?? [{ code: 'shader', message: error.message }] };
    } finally {
      materials?.forEach((material) => material.dispose());
      warmer?.dispose();
    }
  }

  setTerrainGraph(graph, options) { return this.setTerrain({ mode: 'nodes', graph }, options); }

  /** Cancel pending GPU work on document changes or a newer draft. */
  cancelTerrainCompilation() { this._terrainRevision++; }

  /** Shader clock in seconds (waves, star surface, gas flow). */
  get time() { return this.uniforms.uTime.value; }
  set time(v) { this.uniforms.uTime.value = v; }

  // ------------------------------------------------ derived render uniforms
  // Atmosphere + cloud shell, scaled to the planet: optical depths match
  // Earth's whatever the radius, so the sky reads the same at any size.
  // Gas mode swaps in the giant's own haze layer, grounded on the cloud tops.
  _syncAtmosphere() {
    const p = this.params;
    const u = this.uniforms;
    const R = p.radius;
    const gas = p.mode === 'gas';
    const ground = gas ? R : R + p.seaLevel * p.heightScale;
    const top = ground + R * (gas ? GAS_ATMO_HEIGHT : p.atmoHeight);
    const H = top - ground;
    const HR = H * 0.11;
    const HM = HR / 5;   // exactly 1/5: the composite's view ray uses dMie = dRayleigh^5
    const s = gas ? p.gasAtmoStrength : p.atmoEnabled ? p.atmoStrength : 0;
    const haze = gas ? p.gasAtmoHaze : p.atmoHaze;

    // Rayleigh colour from the tint: squared so the default blue tint lands on
    // Earth's lambda^-4 ratios (~0.17 : 0.41 : 1)
    const tint = (gas ? p.gasAtmoColor : p.atmoColor).map((c) => Math.max(c, 0.001) ** 2);
    const tMax = Math.max(...tint);
    const rel = tint.map((c) => c / tMax);
    u.uAtmoGround.value = ground;
    u.uAtmoTop.value = top;
    u.uAtmoHR.value = HR;
    u.uAtmoHM.value = HM;
    u.uAtmoRayleigh.value.set(...rel.map((c) => (c * 0.2 * s) / HR));
    u.uAtmoMie.value = ((0.004 + 0.14 * haze) * s) / HM;
    const oz = (0.03 * s) / (0.15 * H);
    u.uAtmoOzone.value.set(0.35 * oz, 1.0 * oz, 0.045 * oz);
    u.uSkyTint.value.set(...rel);
    u.uAtmoOn.value = s > 0.001 ? 1 : 0;

    // cloud shell sits in the lower air, relative to sea level: high ranges
    // can pierce it
    u.uCloudBottom.value = ground + R * p.cloudAltitude;
    u.uCloudTop.value = u.uCloudBottom.value + R * Math.max(p.cloudThickness, 0.0005);
    this._lutDirty = true;
  }

  // ocean sphere + absorption: the shallow colour is what one "clarity depth"
  // of water does to light, so absorption scales with the terrain relief
  _syncWater() {
    const p = this.params;
    const u = this.uniforms;
    u.uSeaRadius.value = p.radius + p.seaLevel * p.heightScale;
    const depth = Math.max(p.waterClarity * p.heightScale, 1e-3);
    u.uWaterAbsorb.value.set(...p.colShallow.map((c) => {
      const t = Math.min(Math.max(srgbToLinear(c), 0.004), 0.999);
      return -Math.log(t) / depth;
    }));
  }

  // -------------------------------------------------------------------- gas
  // Planet sphere + ring disc share a group tilted by the axial tilt; the
  // shaders read the planet-local direction for the bands and uGasAxis for
  // the ring plane.
  _buildGas() {
    this.gasGroup = new THREE.Group();
    this.gasJets = new GasJetTable(this.uniforms);
    this.gasMat = createGasSurfaceMaterial(this.uniforms);
    this.gasMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 128), this.gasMat);
    this.gasMesh.frustumCulled = false;
    this.gasMesh.scale.setScalar(this.params.radius);
    this.gasGroup.add(this.gasMesh);

    this.ringMat = createRingMaterial(this.uniforms);
    this.ringMesh = new THREE.Mesh(createRingGeometry(), this.ringMat);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 10;
    this.gasGroup.add(this.ringMesh);

    this._scene.add(this.gasGroup);
    this._syncGasTilt();
  }

  _syncGasTilt() {
    // tilt the spin axis toward the default camera's side so rings open up
    this.gasGroup.rotation.set(0, 0, 0);
    this.gasGroup.rotateY(THREE.MathUtils.degToRad(45));
    this.gasGroup.rotateX(THREE.MathUtils.degToRad(this.params.gasTilt));
    this.gasGroup.updateMatrixWorld(true);
    this.uniforms.uGasAxis.value.set(0, 1, 0).applyQuaternion(this.gasGroup.quaternion).normalize();
  }

  _syncGasVisibility() {
    const on = !!this.params.gasRingsEnabled;
    this.uniforms.uGasRingOn.value = on ? 1 : 0;
    this.ringMesh.visible = on;
  }

  // ------------------------------------------------------------------- star
  _buildStar(body) {
    this.starShaderBody = body ?? DEFAULT_STAR_BODY;
    this.starGroup = new THREE.Group();
    this.starSurfaceMat = createStarSurfaceMaterial(this.uniforms, this.starShaderBody);
    this.starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.starSurfaceMat);
    this.starMesh.frustumCulled = false;
    this.starGroup.add(this.starMesh);
    // chromosphere, prominences and corona are drawn around the disc by the
    // composite pass (STAR_CORONA_GLSL) — no halo geometry
    this._scene.add(this.starGroup);
    this._syncShellScales();
  }

  _syncShellScales() {
    this.gasMesh?.scale.setScalar(this.params.radius);
    this.starMesh?.scale.setScalar(this.params.radius);
  }

  _syncMode() {
    const mode = this.params.mode;
    this.world.group.visible = mode === 'planet';
    this.gasGroup.visible = mode === 'gas';
    this.starGroup.visible = mode === 'star';
    this._syncShellVisibility();
    this._syncGasVisibility();
  }

  /**
   * Swap the editable starSurface() body. With a renderer (or once the planet
   * has been rendered) it is compile-checked against the real GL context
   * first; on error the current material stays and { ok: false, error } comes
   * back.
   */
  setStarShader(body, renderer = this._passesOwner?.renderer) {
    if (renderer) {
      const error = validateStarShaderBody(renderer.getContext(), body);
      if (error) return { ok: false, error };
    }
    this.starShaderBody = body;
    const old = this.starMesh.material;
    this.starSurfaceMat = createStarSurfaceMaterial(this.uniforms, body);
    this.starMesh.material = this.starSurfaceMat;
    old.dispose();
    return { ok: true };
  }

  _syncShellVisibility() {
    // terrain/water sample the cloud field for cast shadows — kill them too
    // when the cloud layer is off
    this.uniforms.uCloudShadowStr.value =
      this.params.cloudsEnabled ? this.params.cloudShadowStrength : 0;
  }

  _applySunDir() {
    const az = THREE.MathUtils.degToRad(this.params.sunAzimuth);
    const el = THREE.MathUtils.degToRad(this.params.sunElevation);
    this.uniforms.uSunDir.value.set(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).normalize();
  }

  // ------------------------------------------------------------------ params
  /** Current value of one parameter. */
  get(key) {
    const v = this.params[key];
    return Array.isArray(v) ? [...v] : v;
  }

  /**
   * Set parameters live: set('seaLevel', 0.5) or set({ seaLevel: 0.5, ... }).
   * Values are validated (unknown keys / wrong types are warned about and
   * skipped). Colours accept [r, g, b] (sRGB 0..1), '#rrggbb', 0xrrggbb or
   * THREE.Color. Returns this.
   */
  set(keyOrPatch, value) {
    const patch = typeof keyOrPatch === 'string' ? { [keyOrPatch]: value } : keyOrPatch ?? {};
    const accepted = acceptParams(patch, 'Planet.set');
    let structural = false;
    for (const [k, v] of Object.entries(accepted)) {
      if (REBUILD_KEYS.has(k)) {
        if (this.params[k] !== v) structural = true;
        this.params[k] = v;
      } else {
        this.setParam(k, v);
      }
    }
    if (structural) this._rebuildStructural();
    return this;
  }

  /** Low-level single-key setter (no validation) — used by the studio UI. */
  setParam(key, value) {
    this._version++;   // anything cached from the params (impostors) is stale
    if (REBUILD_KEYS.has(key)) {
      // a rebuild drops every chunk: only when the structure really changes
      if (this.params[key] === value) return;
      this.params[key] = value;
      this._rebuildStructural();
      return;
    }
    this.params[key] = value;
    if (ATMO_KEYS.has(key)) this._syncAtmosphere();
    if (WATER_KEYS.has(key)) this._syncWater();
    if (WEATHER_KEYS.has(key)) this._weatherDirty = true;

    switch (key) {
      case 'seed': {
        this.cancelTerrainCompilation();
        const off = seedToOffset(value);
        this.uniforms.uSeedOffset.value.set(off[0], off[1], off[2]);
        if (this._terrain?.mode === 'nodes') {
          const program = this._compileTerrain(this._terrain);
          const shared = createTerrainUniforms(this.uniforms, program);
          this.world.templateMaterials.forEach((material) => {
            Object.entries(shared).forEach(([name, uniform]) => { if (name in material.uniforms) material.uniforms[name] = uniform; });
          });
          this._terrainProgram = program;
          this.world.terrainProgram = program.identityParams ? null : program;
          this.world.terrainUniforms = shared;
          this._sampler = this._createHeightSampler();
        }
        return;
      }
      case 'cloudResolution':
        return;   // applied per frame (PlanetPasses.setCloudResolution)
      case 'radius':
      case 'heightScale':
      case 'seaLevel': {
        const u = UNIFORM_MAP[key];
        if (u) this._setUniform(u, value);
        this._syncShellScales();
        return;
      }
      case 'mode':
        this.cancelTerrainCompilation();
        this._syncMode();
        return;
      case 'starCoronaEnabled':
        this.uniforms.uStarCoronaOn.value = value ? 1 : 0;
        return;
      case 'starSpots':
      case 'starSpotsEnabled':
        this.uniforms.uStarSpots.value = this.params.starSpotsEnabled ? this.params.starSpots : 0;
        return;
      case 'gasStorms':
      case 'gasGreatSpot':
      case 'gasStormsEnabled': {
        const on = !!this.params.gasStormsEnabled;
        this.uniforms.uGasStorms.value = on ? this.params.gasStorms : 0;
        this.uniforms.uGasGreatSpot.value = on ? this.params.gasGreatSpot : 0;
        return;
      }
      case 'gasTilt':
        this._syncGasTilt();
        return;
      case 'gasRingsEnabled':
        this._syncGasVisibility();
        return;
      case 'sunAzimuth':
      case 'sunElevation':
        this._applySunDir();
        return;
      case 'toonEnabled':
        this.uniforms.uToonEnabled.value = value ? 1 : 0;
        return;
      case 'waterEnabled':
      case 'cloudsEnabled':
      case 'cloudShadowStrength':
        this._syncShellVisibility();
        return;
      case 'wireframe':
        this.world.setWireframe(!!value);
        return;
      case 'splitFactor':
        this.world.opts.splitFactor = value;
        return;
      default: {
        const u = UNIFORM_MAP[key];
        if (u) this._setUniform(u, value);
      }
    }
  }

  _setUniform(name, value) {
    const u = this.uniforms[name];
    if (!u) return;
    if (Array.isArray(value)) u.value.set(value[0], value[1], value[2]);
    else u.value = value;
  }

  _rebuildStructural() {
    this._version++;
    const p = this.params;
    this.world.rebuild({ chunkRes: p.chunkRes, maxDepth: p.maxDepth, octaves: p.octaves, analyticTerrainDepth: p.analyticTerrainDepth });
  }

  /**
   * Apply a named preset. Terrestrial presets reset every planet (non-gas,
   * non-star) parameter to its default before applying the patch (the seed
   * stays); gas / star presets reset their own domain. Unless
   * { setType: false }, the body type switches to the preset's.
   */
  applyPreset(name, { setType = true } = {}) {
    const found = findPreset(name);
    if (!found) throw new Error(`[procedural-planets] unknown preset "${name}"`);
    if (found.mode === 'planet') this._applyPlanetPreset(name);
    else if (found.mode === 'gas') this._applyDomainPreset(GAS_PRESETS, GAS_DEFAULTS, name);
    else this._applyDomainPreset(STAR_PRESETS, STAR_DEFAULTS, name);
    if (setType && this.params.mode !== found.mode) this.setParam('mode', found.mode);
    return this;
  }

  _applyPlanetPreset(key) {
    const preset = PLANET_PRESETS[key];
    if (!preset) return;
    const patch = { ...preset.patch };
    // reset every planet param a previous preset may have touched — but leave
    // the star and gas domains, mode and viewer performance settings alone
    const base = { ...DEFAULT_PARAMS, seed: this.params.seed };
    for (const [k, v] of Object.entries(base)) {
      if (STAR_KEYS.has(k) || GAS_KEYS.has(k) || k === 'mode' || k === 'renderResolution' || k === 'upscaler') continue;
      if (!(k in patch)) patch[k] = v;
    }
    let structural = false;
    for (const [k, v] of Object.entries(patch)) {
      if (REBUILD_KEYS.has(k)) {
        if (this.params[k] !== v) structural = true;
        this.params[k] = v;
      } else {
        this.setParam(k, v);
      }
    }
    if (structural) this._rebuildStructural();
  }

  _applyDomainPreset(table, defaults, key) {
    const preset = table[key];
    if (!preset) return;
    const patch = { ...defaults, ...preset.patch };
    for (const [k, v] of Object.entries(patch)) this.setParam(k, v);
  }

  /** Pick a new random seed; returns it. */
  randomizeSeed() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.setParam('seed', seed);
    return seed;
  }

  // ---------------------------------------------------------------- queries
  /** Radius (local units) of a sphere containing everything the planet draws. */
  get boundingRadius() {
    const p = this.params;
    const R = p.radius;
    if (p.mode === 'gas') {
      return Math.max(R * (1 + GAS_ATMO_HEIGHT), p.gasRingsEnabled ? R * p.gasRingOuter : 0) * 1.01;
    }
    if (p.mode === 'star') {
      const disc = R * (1.02 + p.starPulseAmount * 3);
      return Math.max(disc, R * (p.starCoronaEnabled ? 2 + 2 * p.starCoronaSize : 1.3));
    }
    const u = this.uniforms;
    return Math.max(R + p.heightScale + this.paintLayers.maxHeight, u.uCloudTop.value, u.uAtmoTop.value) * 1.001;
  }

  /** Radius (local units) of the solid / liquid surface used for picking. */
  get surfaceRadius() {
    const p = this.params;
    if (p.mode !== 'planet') return p.radius;
    return p.radius + (p.waterEnabled ? Math.max(p.seaLevel, 0) : 0) * p.heightScale;
  }

  /**
   * Terrain radius (local units) along a local direction — CPU mirror of the
   * GPU height field (base octaves). Gas giants / stars return their radius.
   */
  getSurfaceRadius(direction) {
    const p = this.params;
    if (p.mode !== 'planet') return p.radius;
    this._sampler ??= this._createHeightSampler();
    const d = _v1.copy(direction).normalize();
    return p.radius + this._sampler.heightAtDirection(d) + this.paintLayers.sampleHeightOffset(d);
  }

  /** Base elevation in local units, before the separate paint layer. */
  getBaseElevation(direction) {
    this._sampler ??= this._createHeightSampler();
    return this._sampler.heightAtDirection(_v1.copy(direction).normalize());
  }

  /** Restore runtime layers without changing generation settings or editor state. */
  setPaint(data) { this.paintLayers.load(data); return this; }
  get paint() { return this.paintLayers.serialize(); }

  /**
   * World-space point on the surface (terrain or sea, whichever is higher)
   * along a LOCAL direction, e.g. to place objects on the planet.
   */
  getSurfacePoint(direction, target = new THREE.Vector3()) {
    const p = this.params;
    let r = this.getSurfaceRadius(direction);
    if (p.mode === 'planet' && p.waterEnabled) r = Math.max(r, this.uniforms.uSeaRadius.value);
    target.copy(direction).normalize().multiplyScalar(r);
    return this.localToWorld(target);
  }

  /** Ray-sphere picking against surfaceRadius (THREE.Raycaster support). */
  raycast(raycaster, intersects) {
    if (this.params.mode === 'planet' && !this.paintLayers.isEmpty()) {
      const hit = pickPlanetRay(this, raycaster.ray);
      if (hit && hit.distance >= raycaster.near && hit.distance <= raycaster.far) {
        intersects.push({ distance: hit.distance, point: hit.worldPosition,
          normal: hit.normal.clone().transformDirection(this.matrixWorld), object: this });
      }
      return;
    }
    _inv.copy(this.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inv);
    _sphere.set(_v1.set(0, 0, 0), this.surfaceRadius);
    if (!_ray.intersectSphere(_sphere, _v2)) return;
    const point = _v2.applyMatrix4(this.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({
      distance,
      point: point.clone(),
      normal: _v1.copy(point).sub(_v3.setFromMatrixPosition(this.matrixWorld)).normalize().clone(),
      object: this,
    });
  }

  // ------------------------------------------------------------------ time
  /** Advance the planet's clocks (seconds). PlanetRenderer calls this. */
  update(delta) {
    this.uniforms.uTime.value += delta;
    this.cloudTime += delta * this.params.cloudSpeed;
  }

  // ----------------------------------------------------- renderer interface
  /** @internal per-pipeline GPU passes (created on first render). */
  _getPasses(pipeline) {
    if (this._passesOwner !== pipeline) {
      this._passes?.dispose();
      this._passes = pipeline.createPasses(this.uniforms);
      this._passesOwner = pipeline;
      this._lutDirty = this._weatherDirty = true;
    }
    const passes = this._passes;
    if (this._lutDirty) { passes.lutDirty = true; this._lutDirty = false; }
    if (this._weatherDirty) {
      passes.weatherDirty = true;
      passes._initFace = 0;   // a half-done initial bake restarts with the new seed
      this._weatherDirty = false;
    }
    passes.setCloudResolution(this.params.cloudResolution);
    return passes;
  }

  /**
   * @internal materials the planet's own scene draws in `mode` (the current
   * one by default); `all` includes the optional ones (rings) so they can be
   * compiled before they are switched on.
   */
  _sceneMaterials(mode = this.params.mode, all = false) {
    if (mode === 'planet') {
      const [exact, low] = this.world.templateMaterials;
      return all || this.world.useLowVarying ? [exact, low] : [exact];
    }
    if (mode === 'gas') return all || this.params.gasRingsEnabled ? [this.gasMat, this.ringMat] : [this.gasMat];
    return [this.starSurfaceMat];
  }

  /** @internal near / far (local units) that hug the planet for depth precision. */
  _clipPlanes(dist) {
    const p = this.params;
    const R = p.radius;
    if (p.mode === 'planet') {
      const relief = p.heightScale + this.paintLayers.maxHeight;
      const alt = dist - (R + relief);
      return [Math.max(0.05, alt * 0.8), dist + R + relief + 10];
    }
    const shell = p.mode === 'star'
      ? R * (1.02 + p.starPulseAmount * 3)
      : R * (p.gasRingsEnabled ? Math.max(p.gasRingOuter, 1.05) : 1.05);
    return [Math.max(0.5, (dist - shell) * 0.5), dist + shell * 1.2 + 10];
  }

  /** @internal sun direction in the planet's local frame from lightSource. */
  _updateSunDirection() {
    const src = this.lightSource;
    if (!src) return;
    const dir = this.uniforms.uSunDir.value;
    if (src.isVector3) {
      dir.copy(src);
    } else if (src.isObject3D) {
      src.updateWorldMatrix(true, false);
      _v1.setFromMatrixPosition(src.matrixWorld);
      if (src.isDirectionalLight || src.isSpotLight) {
        // three lights shine from their position toward their target
        src.target.updateWorldMatrix(true, false);
        dir.copy(_v1).sub(_v2.setFromMatrixPosition(src.target.matrixWorld));
      } else {
        dir.copy(_v1).sub(_v2.setFromMatrixPosition(this.matrixWorld));
      }
    } else {
      return;
    }
    if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0);
    // world direction -> local (rotation only)
    _q.setFromRotationMatrix(_m.extractRotation(this.matrixWorld)).invert();
    dir.applyQuaternion(_q).normalize();
  }

  /** @internal per-frame uniforms + render options for PlanetPipeline. */
  _prepareFrame() {
    const p = this.params;
    const u = this.uniforms;
    const ct = this.cloudTime;
    const R = p.radius;
    u.uCloudRotation.value = (ct * 0.004) % (Math.PI * 2);
    // cloud noise frequencies in WORLD units, tied to the shell thickness
    const thick = Math.max(R * p.cloudThickness, 1e-3);
    const shapeFreq = 1 / (thick * 1.6 * p.cloudDetailScale);
    const wind = ct * 0.004;
    u.uCloudShapeFreq.value = shapeFreq;
    u.uCloudDetailFreq.value = shapeFreq * 4.1;
    u.uCloudWind.value.set(wind, wind * 0.3, -wind * 0.6);
    return {
      mode: p.mode,
      bloom: p.mode === 'star' ? p.starBloom : 0,
      water: !!p.waterEnabled,
      clouds: !!p.cloudsEnabled,
      cloudSteps: p.cloudQuality,
      weatherTime: ct * 0.0035,
    };
  }

  /** @internal per-frame GPU bakes (the gas giant's jet table), once its programs are ready. */
  _bakeFrame(renderer) {
    this.paintLayers.flushUploads(renderer);
    if (this.params.mode === 'gas') this.gasJets.update(renderer);
  }

  // ---------------------------------------------------------- serialisation
  /** Plain JSON (same shape as the studio's planet_preset.json export). */
  serialize() {
    return {
      app: 'procedural-planets',
      version: 2,
      mode: this.params.mode,
      params: JSON.parse(JSON.stringify(this.params)),
      terrain: this.terrain,
      paint: this.paint,
      ...(this.starShaderBody !== DEFAULT_STAR_BODY ? { starShader: this.starShaderBody } : {}),
    };
  }

  /**
   * Build a Planet from studio data: an exported planet_preset.json /
   * star_preset.json (its custom starShader included), a saved studio
   * project ({ params }), or a bare parameter object. Older studio
   * parameter sets are migrated. `options` are extra constructor options
   * (lightSource, overrides, ...).
   */
  static fromJSON(json, options = {}) {
    const data = typeof json === 'string' ? JSON.parse(json) : json ?? {};
    const raw = data.params ?? data;
    const mode = normalizeParam('mode', raw.mode ?? data.mode ?? 'planet').value ?? 'planet';
    const migrated = migrateParams({ ...raw }, 'terran', {});
    const known = {};
    for (const [k, v] of Object.entries(migrated)) if (k in DEFAULT_PARAMS) known[k] = v;
    const starShader = options.starShader ?? (typeof data.starShader === 'string' ? data.starShader : undefined);
    return new Planet({ ...options, terrain: options.terrain ?? data.terrain, paint: Object.hasOwn(options, 'paint') ? options.paint : data.paint, starShader, params: { ...known, mode, ...(options.params ?? {}) } });
  }

  copy(source, recursive) {
    super.copy(source, recursive);
    if (source.isPlanet) {
      this.set(JSON.parse(JSON.stringify(source.params)));
      this.cancelTerrainCompilation();
      const terrain = source.terrain;
      const program = this._compileTerrain(terrain);
      this._installTerrain(terrain, program, this._terrainMaterials(program));
      this.setPaint(source.paint);
      this.lightSource = source.lightSource;
      if (source.starShaderBody !== this.starShaderBody) this.setStarShader(source.starShaderBody, null);
    }
    return this;
  }

  /** Free every GPU resource owned by this planet. */
  dispose() {
    this._disposed = true;
    this.cancelTerrainCompilation();
    this.world.dispose();
    this.paintLayers.dispose();
    this.ringMesh.geometry.dispose();
    this.gasMesh.geometry.dispose();
    this.starMesh.geometry.dispose();
    for (const m of [this.gasMat, this.ringMat, this.starSurfaceMat]) m?.dispose();
    this.gasJets.dispose();
    this._passes?.dispose();
    this._passes = null;
    this._passesOwner = null;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _ray = new THREE.Ray();
const _sphere = new THREE.Sphere();
