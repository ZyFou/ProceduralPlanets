import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  DEFAULT_PARAMS, REBUILD_KEYS, PLANET_PRESETS,
  STAR_DEFAULTS, STAR_KEYS, STAR_PRESETS,
  GAS_DEFAULTS, GAS_KEYS, GAS_PRESETS, seedToOffset,
} from './presets.js';
import { createSharedUniforms, UNIFORM_MAP } from './materials.js';
import { PlanetPipeline } from './PlanetPipeline.js';
import {
  DEFAULT_STAR_BODY, createStarSurfaceMaterial, validateStarShaderBody,
} from './star.js';
import { createGasSurfaceMaterial, createRingMaterial, createRingGeometry, GasJetTable } from './gas.js';
import { PlanetWorld } from './PlanetWorld.js';
import { PlanetExporter } from './PlanetExporter.js';

// ============================================================================
// Engine — owns renderer / scene / camera / loop and the parameter store.
// Framework-agnostic: React talks to it via setParam/applyPreset/randomize and
// receives stats through the onStats callback. Almost every param maps to a
// shared uniform (live); the few structural keys rebuild the world.
// Rendering goes through PlanetPipeline (HDR scene -> volumetric clouds ->
// ocean / atmosphere / tone-map composite).
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

export class Engine {
  constructor({ canvas, callbacks = {} }) {
    this.cb = callbacks;
    this.params = { ...DEFAULT_PARAMS };
    this._disposed = false;

    // no MSAA on the default framebuffer: every frame is composited from
    // the pipeline's HDR targets
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    // a frame is several passes: count them all, reset once per frame
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 1e6);

    const R = this.params.radius;
    this.camera.position.set(R * 2.4, R * 1.4, R * 2.4);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this._applyControlLimits();

    this.uniforms = createSharedUniforms(this.params);
    this._applySunDir();
    this.pipeline = new PlanetPipeline(this.renderer, this.uniforms);
    this.pipeline.setCloudResolution(this.params.cloudResolution);
    this._syncAtmosphere();
    this._syncWater();

    // world + shells
    this.world = new PlanetWorld(this.scene, this.uniforms, {
      chunkRes: this.params.chunkRes,
      maxDepth: this.params.maxDepth,
      splitFactor: this.params.splitFactor,
      octaves: this.params.octaves,
    });

    this._buildStar();
    this._buildGas();
    this._syncMode();

    // resize handling
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (!this._disposed) this._resize();
        });
    this._resizeObserver?.observe(canvas);
    this._resize();

    // stats
    this._frames = 0;
    this._fpsTime = performance.now();
    this._fps = 0;

    this._clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._tick());
  }

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
    const HM = H * 0.022;
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
    this.pipeline.lutDirty = true;
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

  _syncShellScales() {
    this.gasMesh?.scale.setScalar(this.params.radius);
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

    this.scene.add(this.gasGroup);
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
  _buildStar() {
    this.starShaderBody = DEFAULT_STAR_BODY;
    this.starGroup = new THREE.Group();

    this.starSurfaceMat = createStarSurfaceMaterial(this.uniforms, this.starShaderBody);
    this.starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.starSurfaceMat);
    this.starMesh.frustumCulled = false;
    this.starGroup.add(this.starMesh);
    // chromosphere, prominences and corona are drawn around the disc by the
    // composite pass (STAR_CORONA_GLSL) — no halo geometry

    this.scene.add(this.starGroup);
    this._syncStarScales();
  }

  _syncStarScales() {
    this.starMesh.scale.setScalar(this.params.radius);
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
   * Swap the editable starSurface() body. Compile-checks against the real GL
   * context first; on error the current material stays and {ok:false, error}
   * comes back for the Shader panel to display.
   */
  setStarShader(body) {
    const error = validateStarShaderBody(this.renderer.getContext(), body);
    if (error) return { ok: false, error };
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

  _applyControlLimits() {
    const R = this.params.radius;
    this.controls.minDistance = R + this.params.heightScale * 2.2;
    this.controls.maxDistance = R * 12;
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
  setParam(key, value) {
    this.params[key] = value;

    if (REBUILD_KEYS.has(key)) {
      this._rebuildStructural();
      return;
    }
    if (ATMO_KEYS.has(key)) this._syncAtmosphere();
    if (WATER_KEYS.has(key)) this._syncWater();
    if (WEATHER_KEYS.has(key)) this.pipeline.weatherDirty = true;

    switch (key) {
      case 'seed': {
        const off = seedToOffset(value);
        this.uniforms.uSeedOffset.value.set(off[0], off[1], off[2]);
        return;
      }
      case 'cloudResolution':
        this.pipeline.setCloudResolution(value);
        return;
      case 'radius':
      case 'heightScale':
      case 'seaLevel': {
        const u = UNIFORM_MAP[key];
        if (u) this._setUniform(u, value);
        this._syncShellScales();
        if (key === 'radius') this._syncStarScales();
        if (key === 'radius' || key === 'heightScale') this._applyControlLimits();
        return;
      }
      case 'mode':
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
    const p = this.params;
    this.world.rebuild({ chunkRes: p.chunkRes, maxDepth: p.maxDepth, octaves: p.octaves });
  }

  /** Apply a preset patch; returns the merged params for the UI to mirror. */
  applyPreset(key) {
    const preset = PLANET_PRESETS[key];
    if (!preset) return this.params;
    const patch = { ...preset.patch };
    // reset every planet param a previous preset may have touched — but leave
    // the star and gas domains and the mode alone
    const base = { ...DEFAULT_PARAMS, seed: this.params.seed };
    for (const [k, v] of Object.entries(base)) {
      if (STAR_KEYS.has(k) || GAS_KEYS.has(k) || k === 'mode') continue;
      if (!(k in patch)) patch[k] = v;
    }
    let structural = false;
    for (const [k, v] of Object.entries(patch)) {
      if (REBUILD_KEYS.has(k)) { this.params[k] = v; structural = true; }
      else this.setParam(k, v);
    }
    if (structural) this._rebuildStructural();
    return { ...this.params };
  }

  /** Apply a gas preset patch (gas keys only — planet params untouched). */
  applyGasPreset(key) {
    const preset = GAS_PRESETS[key];
    if (!preset) return { ...this.params };
    const patch = { ...GAS_DEFAULTS, ...preset.patch };
    for (const [k, v] of Object.entries(patch)) this.setParam(k, v);
    return { ...this.params };
  }

  /** Apply a star preset patch (star keys only — planet params untouched). */
  applyStarPreset(key) {
    const preset = STAR_PRESETS[key];
    if (!preset) return { ...this.params };
    const patch = { ...STAR_DEFAULTS, ...preset.patch };
    for (const [k, v] of Object.entries(patch)) this.setParam(k, v);
    return { ...this.params };
  }

  randomize() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.setParam('seed', seed);
    return seed;
  }

  screenshotDataURL(w = 1920, h = 1080) {
    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // LOD may be stale (e.g. right after a structural rebuild, or when the
    // loop is paused in a background tab)
    if (this.world.group.visible) this.world.update(this.camera.position, this.camera);
    this._renderFrame();
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this._resize();
    return url;
  }

  async exportPlanet(options = {}, onProgress = () => {}) {
    const wasRunning = !this._disposed;
    if (wasRunning) this.renderer.setAnimationLoop(null);
    try {
      this.renderOnce();
      await PlanetExporter.export(
        this.renderer, this.params, this.uniforms,
        { ...options, starShaderBody: this.starShaderBody },
        onProgress
      );
    } finally {
      if (wasRunning && !this._disposed) this.renderer.setAnimationLoop(() => this._tick());
      this._resize();
    }
  }

  /** One manual frame — used by automated verification when rAF is frozen. */
  renderOnce() {
    this.controls.update();
    if (this.world.group.visible) this.world.update(this.camera.position, this.camera);
    this._renderFrame();
  }

  // near/far hug the planet: nothing can be closer than the camera's height
  // above the highest possible terrain, so the depth buffer keeps enough
  // precision for the ocean/cloud passes to reconstruct seabed depths
  _updateClipPlanes() {
    const p = this.params;
    const R = p.radius;
    const dist = this.camera.position.length();
    let near = 1, far = 1e6;
    if (p.mode === 'planet') {
      const alt = dist - (R + p.heightScale);
      near = Math.max(0.05, alt * 0.8);
      far = dist + R + p.heightScale + 10;
    } else {
      const shell = p.mode === 'star'
        ? R * (1.02 + p.starPulseAmount * 3)
        : R * (p.gasRingsEnabled ? Math.max(p.gasRingOuter, 1.05) : 1.05);
      near = Math.max(0.5, (dist - shell) * 0.5);
      far = dist + shell * 1.2 + 10;
    }
    if (Math.abs(near - this.camera.near) > 1e-6 || Math.abs(far - this.camera.far) > 1e-3) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  _renderFrame() {
    const p = this.params;
    const t = this.uniforms.uTime.value;
    const R = p.radius;
    this.renderer.info.reset();
    this._updateClipPlanes();
    this.uniforms.uCloudRotation.value = t * p.cloudSpeed * 0.004;
    // cloud noise frequencies in WORLD units, tied to the shell thickness
    const thick = Math.max(R * p.cloudThickness, 1e-3);
    const shapeFreq = 1 / (thick * 1.6 * p.cloudDetailScale);
    const wind = t * p.cloudSpeed * 0.004;
    this.uniforms.uCloudShapeFreq.value = shapeFreq;
    this.uniforms.uCloudDetailFreq.value = shapeFreq * 4.1;
    this.uniforms.uCloudWind.value.set(wind, wind * 0.3, -wind * 0.6);
    if (p.mode === 'gas') this.gasJets.update(this.renderer);
    this.pipeline.render(this.scene, this.camera, {
      mode: p.mode,
      bloom: p.mode === 'star' ? p.starBloom : 0,
      water: !!p.waterEnabled,
      clouds: !!p.cloudsEnabled,
      cloudSteps: p.cloudQuality,
      weatherTime: t * p.cloudSpeed * 0.0035,
    });
  }

  // ------------------------------------------------------------------- loop
  _resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.pipeline.setSize(db.x, db.y);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    if (this._disposed) return;
    const dt = Math.min(this._clock.getDelta(), 0.05);
    this.uniforms.uTime.value += dt;

    this.controls.update();
    if (this.world.group.visible) this.world.update(this.camera.position, this.camera);
    this._renderFrame();

    // stats at ~2 Hz
    this._frames++;
    const now = performance.now();
    if (now - this._fpsTime > 500) {
      this._fps = Math.round((this._frames * 1000) / (now - this._fpsTime));
      this._frames = 0;
      this._fpsTime = now;
      this.cb.onStats?.({
        fps: this._fps,
        triangles: this.renderer.info.render.triangles,
        drawCalls: this.renderer.info.render.calls,
        chunks: this.world.chunkCount,
      });
    }
  }

  dispose() {
    this._disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();
    this.controls.dispose();
    this.world.dispose();
    this.ringMesh.geometry.dispose();
    this.gasMesh.geometry.dispose();
    this.starMesh.geometry.dispose();
    for (const m of [this.gasMat, this.ringMat, this.starSurfaceMat]) m?.dispose();
    this.gasJets.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
  }
}
