import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_PARAMS, REBUILD_KEYS, PLANET_PRESETS, seedToOffset } from './presets.js';
import {
  createSharedUniforms, UNIFORM_MAP,
  createWaterMaterial, createCloudMaterial, createAtmosphereMaterial, createStarMaterial,
} from './materials.js';
import { PlanetWorld } from './PlanetWorld.js';

// ============================================================================
// Engine — owns renderer / scene / camera / loop and the parameter store.
// Framework-agnostic: React talks to it via setParam/applyPreset/randomize and
// receives stats through the onStats callback. Almost every param maps to a
// shared uniform (live); the few structural keys rebuild the world.
// ============================================================================

export class Engine {
  constructor({ canvas, callbacks = {} }) {
    this.cb = callbacks;
    this.params = { ...DEFAULT_PARAMS };
    this._disposed = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);

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

    // world + shells
    this.world = new PlanetWorld(this.scene, this.uniforms, {
      chunkRes: this.params.chunkRes,
      maxDepth: this.params.maxDepth,
      splitFactor: this.params.splitFactor,
      octaves: this.params.octaves,
    });

    this._buildShells();

    const stars = new THREE.Mesh(new THREE.SphereGeometry(1e5, 16, 12), createStarMaterial());
    stars.frustumCulled = false;
    this.scene.add(stars);
    this.stars = stars;

    // resize handling
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resize();

    // stats
    this._frames = 0;
    this._fpsTime = performance.now();
    this._fps = 0;

    this._clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  // ------------------------------------------------------------------ shells
  _buildShells() {
    const R = this.params.radius;
    const p = this.params;
    const oct = p.octaves;

    this.waterMat = createWaterMaterial(this.uniforms, oct);
    this.water = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.waterMat);
    this.water.renderOrder = 10;
    this.water.frustumCulled = false;
    this.scene.add(this.water);

    this.cloudMat = createCloudMaterial(this.uniforms, oct);
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), this.cloudMat);
    this.clouds.renderOrder = 20;
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);

    this.atmoMat = createAtmosphereMaterial(this.uniforms);
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.atmoMat);
    this.atmo.renderOrder = 30;
    this.atmo.frustumCulled = false;
    this.scene.add(this.atmo);

    this._syncShellScales();
    this._syncShellVisibility();
  }

  _syncShellScales() {
    const R = this.params.radius;
    const hs = this.params.heightScale;
    const seaR = R + this.params.seaLevel * hs;
    this.water.scale.setScalar(seaR);
    this.clouds.scale.setScalar(R * (1 + this.params.cloudAltitude) + hs);
    this.atmo.scale.setScalar(R * 1.045 + hs);
  }

  _syncShellVisibility() {
    this.water.visible = !!this.params.waterEnabled;
    this.clouds.visible = !!this.params.cloudsEnabled;
    this.atmo.visible = !!this.params.atmoEnabled && this.params.atmoStrength > 0.01;
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

    switch (key) {
      case 'seed': {
        const off = seedToOffset(value);
        this.uniforms.uSeedOffset.value.set(off[0], off[1], off[2]);
        return;
      }
      case 'radius':
      case 'heightScale':
      case 'seaLevel':
      case 'cloudAltitude': {
        const u = UNIFORM_MAP[key];
        if (u) this._setUniform(u, value);
        this._syncShellScales();
        if (key === 'radius' || key === 'heightScale') this._applyControlLimits();
        return;
      }
      case 'sunAzimuth':
      case 'sunElevation':
        this._applySunDir();
        return;
      case 'toonEnabled':
        this.uniforms.uToonEnabled.value = value ? 1 : 0;
        return;
      case 'waterEnabled':
      case 'cloudsEnabled':
      case 'atmoEnabled':
        this._syncShellVisibility();
        return;
      case 'atmoStrength':
        this._setUniform('uAtmoStrength', value);
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
    // shells share the OCTAVES define — rebuild their materials too
    this.water.material.dispose();
    this.clouds.material.dispose();
    this.waterMat = createWaterMaterial(this.uniforms, p.octaves);
    this.cloudMat = createCloudMaterial(this.uniforms, p.octaves);
    this.water.material = this.waterMat;
    this.clouds.material = this.cloudMat;
  }

  /** Apply a preset patch; returns the merged params for the UI to mirror. */
  applyPreset(key) {
    const preset = PLANET_PRESETS[key];
    if (!preset) return this.params;
    const patch = { ...preset.patch };
    // reset every param a previous preset may have touched
    const base = { ...DEFAULT_PARAMS, seed: this.params.seed };
    for (const [k, v] of Object.entries(base)) {
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this._resize();
    return url;
  }

  /** One manual frame — used by automated verification when rAF is frozen. */
  renderOnce() {
    this.controls.update();
    this.world.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------- loop
  _resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    if (this._disposed) return;
    const dt = Math.min(this._clock.getDelta(), 0.05);
    this.uniforms.uTime.value += dt;

    this.controls.update();
    this.world.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);

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
    this.controls.dispose();
    this.world.dispose();
    for (const m of [this.waterMat, this.cloudMat, this.atmoMat, this.stars.material]) m?.dispose();
    this.renderer.dispose();
  }
}
