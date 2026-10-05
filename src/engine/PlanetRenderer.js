import * as THREE from 'three';
import { PlanetPipeline, setEmbedBlending, EMBED_GLSL, TONEMAP_GLSL } from './PlanetPipeline.js';
import { ProgramWarmer } from './ProgramWarmer.js';
import { ImpostorAtlas, impostorFragment } from './Impostors.js';
import { fitPlanetCamera } from './planetCamera.js';

// ============================================================================
// PlanetRenderer — draws Planet objects with an existing THREE.WebGLRenderer.
//
// Per planet, per frame:
//   1. a proxy camera is built in the planet's LOCAL frame
//      (planet.matrixWorld^-1 * camera.matrixWorld, the host projection with
//      near / far refitted to the planet for depth precision), so every
//      origin-centred shader works wherever the Planet object is;
//   2. the planet's passes (HDR scene -> volumetric clouds -> ocean /
//      atmosphere composite) run on shared targets, scissored to the
//      planet's screen rectangle;
//   3. the composite is blended over the host frame (premultiplied alpha)
//      and depth-tested against the host's depth buffer; a second tiny pass
//      writes the planet's solid surface into that depth buffer.
// Planets are drawn far to near. background: 'stars' makes the first
// (farthest) planet own the frame instead — opaque, with a starfield (the
// studio / PlanetViewer look).
//
// Shader programs never compile on the draw path (ProgramWarmer): a planet
// whose programs are still compiling in the background is skipped
// (info.pending) instead of freezing the page. prepare() gets planets ready
// ahead — the loading-screen entry point.
//
// Distant planets (screen radius under impostorPixels) are drawn as impostors
// (Impostors.js): the same pipeline renders them into a shared atlas now and
// then, and a billboard shows that picture every frame.
// ============================================================================

const DEFAULTS = {
  background: 'transparent',   // 'transparent' (composite over the host frame) | 'stars'
  // 'display' (ACES + sRGB) | 'linear' (premultiplied linear HDR) | 'auto':
  // display for the canvas and sRGB render targets, linear for linear ones
  // (HalfFloat / EffectComposer targets, NoColorSpace)
  output: 'auto',
  depthTest: true,             // occlude planets behind host geometry
  depthWrite: true,            // write planet surfaces into the host depth buffer
  scissor: true,               // only shade each planet's screen rectangle
  autoUpdate: true,            // advance planet clocks from an internal clock
  maxDelta: 0.05,              // clamp for the internal clock (s)
  // impostors: planets whose screen radius is under impostorPixels are
  // rendered into an atlas when their picture goes stale and drawn as a
  // billboard in between (stars and the opaque background planet never are)
  impostors: true,
  impostorPixels: 90,          // screen radius (px) below which a planet becomes an impostor
  impostorUpdates: 2,          // captures per frame at most
  impostorAngle: 0.6,          // view / sun change (degrees) that makes a capture stale
  impostorRefresh: 0.5,        // planet-clock seconds between refreshes (clouds, waves)
  impostorAtlasSize: 2048,     // largest atlas edge (px); starts at 512 (2 MB) and doubles when full
};

const MODES = ['planet', 'gas', 'star'];

// loading stages, in order, with their share of the progress bar
const STAGES = [
  ['shaders', 0.72],
  ['noise', 0.1],
  ['weather', 0.12],
  ['prime', 0.06],
];

const warned = new Set();
function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[procedural-planets] ${msg}`);
}

// wait for the next frame; falls back to a timer where rAF is paused
// (hidden tab) so a prepare() never hangs
function nextFrame() {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(t); resolve(); });
  });
}

const _size = new THREE.Vector2();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _c = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _pv = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _clear = new THREE.Color();
const _clearTmp = new THREE.Color();
const _scissor = new THREE.Vector4();
const _m4 = new THREE.Matrix4();
const _origin = new THREE.Vector3();

export class PlanetRenderer {
  /**
   * @param {THREE.WebGLRenderer} renderer  the host renderer (WebGL2)
   * @param {object} [options]  see DEFAULTS
   */
  constructor(renderer, options = {}) {
    if (!renderer?.isWebGLRenderer) throw new Error('[procedural-planets] PlanetRenderer needs a THREE.WebGLRenderer');
    if (renderer.capabilities && renderer.capabilities.isWebGL2 === false) {
      throw new Error('[procedural-planets] WebGL2 is required');
    }
    this.renderer = renderer;
    this.options = { ...DEFAULTS, ...options };
    this.pipeline = new PlanetPipeline(renderer);
    this.warmer = new ProgramWarmer(renderer);
    this._clock = new THREE.Clock(false);
    this._proxy = new THREE.PerspectiveCamera();
    this._proxy.matrixAutoUpdate = false;
    this._proxy.matrixWorldAutoUpdate = false;
    this._rect = new THREE.Vector4();
    this._list = [];
    this._entries = [];
    this._impostors = null;     // ImpostorAtlas, created with the first impostor
    this._frame = 0;
    this._capture = new THREE.PerspectiveCamera();
    this._capture.matrixAutoUpdate = false;
    this._capture.matrixWorldAutoUpdate = false;
    /**
     * Stats of the last render(): planets drawn / culled / pending (skipped
     * while their shaders compile in the background) / impostors (drawn as
     * billboards) / captures (impostor pictures rendered this frame).
     */
    this.info = { planets: 0, culled: 0, pending: 0, impostors: 0, captures: 0 };
  }

  /** Planets skipped by the last render() because their shaders are still compiling. */
  get pending() { return this.info.pending; }

  /** Change options at runtime (same keys as the constructor). */
  setOptions(options) {
    Object.assign(this.options, options);
    return this;
  }

  /** Release a removed body's cached impostor immediately. The caller owns the Planet. */
  release(planet) {
    this._impostors?.release(planet);
    this._list = this._list.filter(p => p !== planet);
  }

  _collect(input, list = this._list) {
    list.length = 0;
    if (!input) return list;
    if (Array.isArray(input)) {
      for (const p of input) if (p?.isPlanet && p.visible) list.push(p);
    } else if (input.isPlanet) {
      if (input.visible) list.push(input);
    } else if (input.isObject3D) {
      input.traverseVisible((o) => { if (o.isPlanet) list.push(o); });
    }
    return list;
  }

  /**
   * Draw every visible Planet found in `planets` (a scene / object to
   * traverse, a Planet, or an array of Planets) as seen by `camera`.
   * Call it after rendering your own opaque scene into the same target.
   * options: { target (default: the renderer's current target), delta (s) }
   */
  render(planets, camera, { target, delta } = {}) {
    const r = this.renderer;
    this.info.pending = 0;
    this.info.impostors = 0;
    this.info.captures = 0;
    this._frame++;
    if (!camera?.isPerspectiveCamera) {
      warnOnce('PlanetRenderer.render needs a THREE.PerspectiveCamera');
      return;
    }
    if (r.xr?.isPresenting) {
      warnOnce('PlanetRenderer does not support WebXR sessions yet; planets are skipped');
      return;
    }
    const opt = this.options;
    const list = this._collect(planets);

    let dt = delta;
    if (dt === undefined) {
      if (opt.autoUpdate) {
        if (!this._clock.running) this._clock.start();
        dt = Math.min(this._clock.getDelta(), opt.maxDelta);
      } else {
        dt = 0;
      }
    }
    if (dt) for (const p of list) p.update(dt);

    const out = target !== undefined ? target : r.getRenderTarget();
    if (out) _size.set(out.width, out.height);
    else r.getDrawingBufferSize(_size);
    this.pipeline.setSize(_size.x, _size.y);

    camera.updateWorldMatrix(true, false);
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);

    // visible, far to near; screen radius (px) of each bounding sphere
    const drawn = [];
    let culled = 0;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const camPos = _c.setFromMatrixPosition(camera.matrixWorld);
    for (const p of list) {
      p.updateWorldMatrix(true, false);
      _sphere.center.setFromMatrixPosition(p.matrixWorld);
      _sphere.radius = p.boundingRadius * p.matrixWorld.getMaxScaleOnAxis();
      if (!_frustum.intersectsSphere(_sphere)) { culled++; continue; }
      const d = _sphere.center.distanceToSquared(camPos);
      const ratio = _sphere.radius / Math.sqrt(d);
      const px = ratio >= 1 ? Infinity : (Math.tan(Math.asin(ratio)) / tanHalf) * (_size.y / 2);
      drawn.push({ p, d, px });
    }
    drawn.sort((a, b) => b.d - a.d);
    this.info.planets = drawn.length;
    this.info.culled = culled;
    if (!drawn.length) { this._impostors?.sweep(this._frame - 120); return; }

    // host state
    const prevTarget = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace();
    const prevMip = r.getActiveMipmapLevel();
    const prevAutoClear = r.autoClear;
    // count the planet passes into the host's frame stats instead of
    // resetting them on every internal draw
    const prevAutoReset = r.info.autoReset;
    r.info.autoReset = false;
    r.getClearColor(_clear);
    const prevClearAlpha = r.getClearAlpha();
    const prevScissorTest = out ? out.scissorTest : r.getScissorTest();
    if (out) _scissor.copy(out.scissor);
    else r.getScissor(_scissor);

    r.setClearColor(0x000000, 1);
    try {
      const impostors = this._pickImpostors(drawn, camera, out);
      drawn.forEach(({ p, px }, i) => {
        if (impostors.has(p)) this._drawImpostor(p, camera, out);
        else this._renderPlanet(p, camera, out, i === 0 && opt.background === 'stars', px);
      });
      this._impostors?.sweep(this._frame - 120);
    } finally {
      if (out) { out.scissor.copy(_scissor); out.scissorTest = prevScissorTest; }
      else { r.setScissor(_scissor); r.setScissorTest(prevScissorTest); }
      r.setClearColor(_clear, prevClearAlpha);
      r.autoClear = prevAutoClear;
      r.info.autoReset = prevAutoReset;
      r.setRenderTarget(prevTarget, prevFace, prevMip);
    }
  }

  // The fine terrain variant (LOW_VARYING) is the slowest program to compile
  // and only an optimisation: it compiles in the background while its chunks
  // use the exact one, so it never delays a first frame.
  _fitTerrainVariants(planet) {
    if (planet.params.mode !== 'planet') return;
    const low = planet.world.templateMaterials[1];
    planet.world.useLowVarying = this.warmer.ensure([{ material: low, offscreen: true }]).ready;
  }

  // Every (material, offscreen?) pair a frame of `planet` draws with — or,
  // with `all`, with any body type, optional layer and bloom setting, so a
  // later switch never waits on a compile. Sets the composite's embed
  // variant first: it is part of the program.
  _programEntries(planet, passes, frame, embed, target, all = false) {
    const pipe = this.pipeline;
    const out = all ? [] : this._entries;
    out.length = 0;
    const add = (material, offscreen) => out.push({ material, offscreen });
    const depthTest = this.options.depthTest;
    for (const mode of all ? MODES : [frame.mode]) {
      for (const m of planet._sceneMaterials(mode, all)) add(m, true);
      if (mode === 'gas') add(planet.gasJets.material, true);
      if (mode !== 'star') add(passes.lutMat, true);
      if (mode === 'planet') {
        const clouds = all || frame.clouds;
        if (clouds || planet.uniforms.uCloudShadowStr.value > 0) {
          add(passes.weatherMat, true);
          if (!pipe._noiseBaked) add(pipe.noiseMat, true);
        }
        if (clouds) add(passes.cloudMat, true);
      }
    }
    const bloom = all || frame.bloom > 0.001;
    for (const mode of all ? ['planet', 'star'] : [frame.mode]) {
      const composite = passes.compositeFor(mode);
      setEmbedBlending(composite, embed, depthTest);
      // a star with bloom composites into an HDR target, otherwise the output
      const starBloom = mode === 'star' && bloom;
      if (!starBloom || all) add(composite, !!target);
      if (starBloom) add(composite, true);
    }
    if (bloom) {
      add(pipe.bloomDownMat, true);
      add(pipe.bloomUpMat, true);
      setEmbedBlending(pipe.finalMat, embed, depthTest);
      add(pipe.finalMat, !!target);
    }
    if (embed && this.options.depthWrite) add(pipe.depthMat, !!target);
    return out;
  }

  _renderPlanet(planet, camera, target, opaque, screenPx = Infinity) {
    const r = this.renderer;
    const pipe = this.pipeline;
    const opt = this.options;
    const passes = planet._getPasses(pipe);
    passes.fitWeatherSize(screenPx);
    planet._updateSunDirection();
    const frame = planet._prepareFrame();
    const embed = !opaque;
    this._fitTerrainVariants(planet);

    // never draw with a program that is still compiling: three would wait
    // for the driver on the main thread (seconds for the terrain shader)
    const entries = this._programEntries(planet, passes, frame, embed, target);
    if (!this.warmer.ensure(entries).ready) {
      this.info.pending++;
      return;
    }
    planet._bakeFrame(r);

    // ---- proxy camera in the planet's local frame
    const px = this._proxy;
    const camDist = fitPlanetCamera(planet, camera, px);
    const camLocal = _v.setFromMatrixPosition(px.matrixWorld);

    if (planet.world.group.visible) planet.world.update(camLocal, px);

    // ---- embed uniforms
    const e = pipe.embed;
    e.uViewMat.value.multiplyMatrices(camera.matrixWorldInverse, planet.matrixWorld);
    e.uHostProj.value.copy(camera.projectionMatrix);
    e.uLogDepthFC.value = r.capabilities.logarithmicDepthBuffer ? 2 / (Math.log(camera.far + 1) / Math.LN2) : 0;
    e.uBoundRadius.value = planet.boundingRadius;
    const p = planet.params;
    if (p.mode === 'gas' && p.gasRingsEnabled) {
      e.uRingAxis.value.copy(planet.uniforms.uGasAxis.value);
      e.uRingRange.value.set(p.radius * p.gasRingInner, p.radius * p.gasRingOuter);
    } else {
      e.uRingRange.value.set(0, 0);
    }

    // ---- screen rectangle of the bounding sphere
    let rect = null;
    if (embed && opt.scissor) {
      rect = pipe.screenRect(px, planet.boundingRadius, this._rect);
      if (rect === false) return;   // off screen
    }

    pipe.render(passes, planet._scene, px, {
      ...frame,
      camDist,
      embed,
      depthTest: opt.depthTest,
      depthWrite: embed && opt.depthWrite,
      output: embed ? this._outputMode(target) : 0,
      rect,
      setHostScissor: (rc) => this._setHostScissor(target, rc),
    }, target);
  }

  // ---------------------------------------------------------------- impostors
  // Decide which planets are drawn as impostors this frame and refresh the
  // stalest captures within the budget. Returns the set drawn as impostors;
  // a planet without a usable capture yet goes through the full path.
  _pickImpostors(drawn, camera, target) {
    const opt = this.options;
    const set = new Set();
    if (!opt.impostors) return set;
    const want = [];
    drawn.forEach((it, i) => {
      const { p, px } = it;
      const opaque = i === 0 && opt.background === 'stars';
      // hysteresis: a planet leaves impostor mode 25% above the entry size
      const limit = opt.impostorPixels * (p._impostorMode ? 1.25 : 1);
      p._impostorMode = !opaque && p.params.mode !== 'star' && px < limit;
      if (p._impostorMode) want.push(it);
    });
    if (!want.length) return set;
    this._impostors ??= new ImpostorAtlas(this.renderer, opt.impostorAtlasSize, impostorFragment(EMBED_GLSL, TONEMAP_GLSL));
    const atlas = this._impostors;
    // the billboard shaders compile in the background like everything else;
    // until they are ready every planet takes the full path
    const ready = this.warmer.ensure([
      { material: atlas.material, offscreen: !!target },
      { material: atlas.depthMaterial, offscreen: !!target },
    ]).ready;
    if (!ready) {
      for (const it of want) it.p._impostorMode = false;
      return set;
    }

    // staleness of each capture (>= 1: refresh); stalest x biggest first
    const todo = [];
    for (const it of want) {
      const e = atlas.entry(it.p);
      it.slot = atlas.slotSize(it.px);
      it.stale = this._staleness(it.p, e, camera, it.slot);
      if (e) e.seen = this._frame;
      if (it.stale >= 1) todo.push(it);
      else set.add(it.p);
    }
    todo.sort((a, b) => b.stale * b.px - a.stale * a.px);
    let budget = opt.impostorUpdates;
    for (const it of todo) {
      if (budget > 0) {
        budget--;
        const entry = atlas.ensureSlot(it.p, it.slot);
        if (entry && this._captureImpostor(it.p, entry, camera)) {
          entry.seen = this._frame;
          set.add(it.p);
          continue;
        }
      }
      // over budget: a capture that is merely aging keeps being shown
      const e = atlas.entry(it.p);
      if (e?.valid && e.slot.s === it.slot && it.stale < 4) set.add(it.p);
    }
    this.info.impostors = set.size;
    return set;
  }

  // 0 = fresh ... >= 1 needs a new capture
  _staleness(planet, e, camera, slot) {
    if (!e?.valid || e.slot.s !== slot || e.version !== planet._version) return Infinity;
    const opt = this.options;
    const dir = this._cameraLocal(planet, camera, _v2);
    const d = dir.length();
    dir.divideScalar(d);
    const ang = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, dir.dot(e.dir))));
    planet._updateSunDirection();
    const sun = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, planet.uniforms.uSunDir.value.dot(e.sun))));
    return Math.max(
      ang / opt.impostorAngle,
      sun / opt.impostorAngle,
      Math.abs(d - e.d) / (e.d * 0.08),
      Math.abs(planet.time - e.time) / opt.impostorRefresh,
    );
  }

  _cameraLocal(planet, camera, out) {
    _inv.copy(planet.matrixWorld).invert();
    return out.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
  }

  // Render the planet into its atlas slot as seen from the camera now: a
  // square view that frames the bounding sphere exactly, rolled like the host
  // camera.
  _captureImpostor(planet, entry, camera) {
    const r = this.renderer;
    const pipe = this.pipeline;
    const atlas = this._impostors;
    const passes = planet._getPasses(pipe);
    passes.fitWeatherSize(entry.slot.s / 2);
    this._fitTerrainVariants(planet);
    planet._updateSunDirection();
    const frame = planet._prepareFrame();
    const entries = this._programEntries(planet, passes, frame, true, atlas.target);
    if (!this.warmer.ensure(entries).ready) {
      this.info.pending++;
      return false;
    }

    const local = this._cameraLocal(planet, camera, new THREE.Vector3());
    const d = local.length();
    const rb = planet.boundingRadius;
    if (d <= rb * 1.001) return false;
    planet._bakeFrame(r);

    const cam = this._capture;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.asin(rb / d));
    cam.aspect = 1;
    cam.zoom = 1;
    cam.view = null;
    const [near, far] = planet._clipPlanes(d);
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
    _q.setFromRotationMatrix(_m4.extractRotation(_inv.copy(planet.matrixWorld).invert()));
    camera.getWorldQuaternion(_q2);
    cam.up.set(0, 1, 0).applyQuaternion(_q2).applyQuaternion(_q);
    // (not Object3D.lookAt: it reads the position from the stale world matrix)
    cam.matrixWorld.lookAt(local, _origin, cam.up).setPosition(local);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    if (planet.world.group.visible) planet.world.update(local, cam);

    const e = pipe.embed;
    e.uViewMat.value.copy(cam.matrixWorldInverse);
    e.uHostProj.value.copy(cam.projectionMatrix);
    e.uLogDepthFC.value = 0;
    e.uBoundRadius.value = rb;
    const p = planet.params;
    if (p.mode === 'gas' && p.gasRingsEnabled) {
      e.uRingAxis.value.copy(planet.uniforms.uGasAxis.value);
      e.uRingRange.value.set(p.radius * p.gasRingInner, p.radius * p.gasRingOuter);
    } else {
      e.uRingRange.value.set(0, 0);
    }

    // clear the slot, run the pipeline into it (linear HDR, premultiplied)
    const { x, y, s } = entry.slot;
    const rt = atlas.target;
    rt.viewport.set(x, y, s, s);
    rt.scissor.set(x, y, s, s);
    rt.scissorTest = true;
    r.setRenderTarget(rt);
    const alpha = r.getClearAlpha();
    r.getClearColor(_clearTmp);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(_clearTmp, alpha);
    const fullW = pipe.width;
    const fullH = pipe.height;
    pipe.setViewSize(s, s);
    try {
      pipe.render(passes, planet._scene, cam, {
        ...frame,
        camDist: d,
        embed: true,
        depthTest: false,
        depthWrite: false,
        output: 1,
        rect: null,
        setHostScissor: () => { rt.scissor.set(x, y, s, s); rt.scissorTest = true; },
      }, rt);
    } finally {
      pipe.setSize(fullW, fullH);
      rt.viewport.set(0, 0, rt.width, rt.height);
      rt.scissor.set(0, 0, rt.width, rt.height);
      rt.scissorTest = false;
    }

    // the capture's image plane (planet-local): the camera's right / up
    entry.valid = true;
    entry.version = planet._version;
    entry.dir = (entry.dir ?? new THREE.Vector3()).copy(local).divideScalar(d);
    entry.sun = (entry.sun ?? new THREE.Vector3()).copy(planet.uniforms.uSunDir.value);
    entry.d = d;
    entry.time = planet.time;
    entry.half = rb / Math.sqrt(1 - (rb / d) ** 2);
    entry.right = (entry.right ?? new THREE.Vector3()).setFromMatrixColumn(cam.matrixWorld, 0);
    entry.up = (entry.up ?? new THREE.Vector3()).setFromMatrixColumn(cam.matrixWorld, 1);
    this.info.captures++;
    return true;
  }

  _drawImpostor(planet, camera, target) {
    const r = this.renderer;
    const atlas = this._impostors;
    const e = atlas.entry(planet);
    const u = atlas.material.uniforms;
    const m = planet.matrixWorld;
    const scale = m.getMaxScaleOnAxis();
    u.uCenter.value.setFromMatrixPosition(m);
    // image plane axes to world (rotation + uniform scale of the planet)
    u.uRight.value.copy(e.right).transformDirection(m).multiplyScalar(e.half * scale);
    u.uUp.value.copy(e.up).transformDirection(m).multiplyScalar(e.half * scale);
    u.uWorldToLocal.value.copy(m).invert();
    this._cameraLocal(planet, camera, u.uCamLocal.value);
    const { x, y, s } = e.slot;
    u.uSlot.value.set(x / atlas.size, y / atlas.size, s / atlas.size, s / atlas.size);
    u.uLinearOut.value = this._outputMode(target);
    u.uSolidRadius.value = planet.params.mode === 'gas' ? planet.params.radius : planet.surfaceRadius;
    // depth in the HOST camera
    u.uViewMat.value.multiplyMatrices(camera.matrixWorldInverse, m);
    u.uHostProj.value.copy(camera.projectionMatrix);
    u.uLogDepthFC.value = r.capabilities.logarithmicDepthBuffer ? 2 / (Math.log(camera.far + 1) / Math.LN2) : 0;
    u.uBoundRadius.value = planet.boundingRadius;
    const p = planet.params;
    if (p.mode === 'gas' && p.gasRingsEnabled) {
      u.uRingAxis.value.copy(planet.uniforms.uGasAxis.value);
      u.uRingRange.value.set(p.radius * p.gasRingInner, p.radius * p.gasRingOuter);
    } else {
      u.uRingRange.value.set(0, 0);
    }
    this._setHostScissor(target, null);
    r.setRenderTarget(target);
    r.autoClear = false;
    atlas.material.depthTest = this.options.depthTest;
    atlas.quad.material = atlas.material;
    u.uDepthOnly.value = 0;
    r.render(atlas.scene, camera);
    if (this.options.depthWrite) {
      atlas.depthMaterial.depthTest = this.options.depthTest;
      atlas.quad.material = atlas.depthMaterial;
      u.uDepthOnly.value = 1;
      r.render(atlas.scene, camera);
    }
  }

  // 0: tone map + sRGB encode (canvas, 8-bit linear targets with 'display')
  // 1: premultiplied linear HDR ('linear', or 'auto' into a linear target)
  // 2: tone map, no encode: sRGB render targets encode on write
  _outputMode(target) {
    const o = this.options.output;
    if (o === 'linear') return 1;
    const srgbTarget = !!target && target.texture?.colorSpace === THREE.SRGBColorSpace;
    if (srgbTarget) return 2;
    if (o === 'auto' && target) return 1;
    return 0;
  }

  _setHostScissor(target, rect) {
    if (target) {
      target.scissorTest = !!rect;
      if (rect) target.scissor.copy(rect);
      return;
    }
    const r = this.renderer;
    if (rect) {
      const pr = r.getPixelRatio();
      r.setScissor(rect.x / pr, rect.y / pr, rect.z / pr, rect.w / pr);
      r.setScissorTest(true);
    } else {
      r.setScissorTest(false);
    }
  }

  /**
   * Get planets ready to draw without ever stalling the page: every shader
   * program they need compiles in parallel (KHR_parallel_shader_compile), the
   * one-time GPU bakes (noise volumes, transmittance LUT, first weather state)
   * run a slice per frame, and each program gets a primed first draw. When it
   * resolves, the next render() draws the planets at full quality.
   *
   * options:
   *   modes       true: also compile the other body types (and optional
   *               layers), so switching type / enabling clouds or rings later
   *               never waits; false (default): what the planets draw now
   *   bake        run the one-time bakes too (default true)
   *   target      the render target the planets will be drawn into
   *               (default: the renderer's current one)
   *   onProgress  ({ stage, progress, stageEnd, done, total }) => void;
   *               stage: 'shaders' | 'noise' | 'weather' | 'prime', progress
   *               and stageEnd (where this stage ends) in 0..1
   */
  async prepare(planets, camera = null, options = {}) {
    const { modes = false, bake = true, onProgress = null } = options;
    const r = this.renderer;
    const pipe = this.pipeline;
    const list = this._collect(planets, []);
    const target = options.target !== undefined ? options.target : r.getRenderTarget();
    const bg = this.options.background === 'stars';
    let stageBase = 0;
    const report = (stage, done, total) => {
      if (!onProgress) return;
      const w = STAGES.find((s) => s[0] === stage)?.[1] ?? 0;
      onProgress({
        stage, done, total,
        progress: Math.min(1, stageBase + w * (total ? done / total : 1)),
        stageEnd: Math.min(1, stageBase + w),
      });
    };
    const finish = (stage) => {
      stageBase += STAGES.find((s) => s[0] === stage)?.[1] ?? 0;
      report(stage, 1, 1);
      performance.mark?.(`pp:prepare:${stage}`);
    };

    // planet state the entries depend on (passes, derived uniforms)
    const items = list.map((planet, i) => {
      const passes = planet._getPasses(pipe);
      this._fitTerrainVariants(planet);
      planet._updateSunDirection();
      const frame = planet._prepareFrame();
      // with a starfield background the farthest planet is drawn opaque,
      // the others embedded: several planets may need both variants
      const variants = bg ? (list.length > 1 ? [false, true] : [false]) : [true];
      return { planet, passes, frame, variants, index: i };
    });
    const entriesOf = () => {
      const all = [];
      for (const it of items) {
        for (const embed of it.variants) {
          all.push(...this._programEntries(it.planet, it.passes, it.frame, embed, target, modes).slice());
        }
      }
      return all;
    };

    // 1. programs, compiled in parallel threads; poll once per frame
    let entries = entriesOf();
    for (;;) {
      const st = this.warmer.ensure(entries);
      report('shaders', st.done, st.total);
      if (st.ready) break;
      await nextFrame();
      entries = entriesOf();
    }
    finish('shaders');

    // GPU work between frames must leave the host's render target as it was
    // (its own loop may render while we wait)
    const gpu = (fn) => {
      const prev = r.getRenderTarget();
      const face = r.getActiveCubeFace();
      const mip = r.getActiveMipmapLevel();
      try { return fn(); } finally { r.setRenderTarget(prev, face, mip); }
    };

    if (bake) {
      // 2. noise volumes (shared by every planet with clouds)
      const needsNoise = items.some(({ planet }) => planet.params.mode === 'planet'
        && (planet.params.cloudsEnabled || planet.uniforms.uCloudShadowStr.value > 0));
      if (needsNoise) {
        const total = pipe.noiseRT.depth + pipe.erosionRT.depth;
        while (!gpu(() => pipe.bakeNoiseSlice(32))) {
          report('noise', pipe._noiseVol * pipe.noiseRT.depth + pipe._noiseLayer, total);
          await nextFrame();
        }
      }
      finish('noise');

      // 3. per planet: transmittance LUT at once (tiny), weather a face per frame
      for (const it of items) {
        const { planet, passes, frame } = it;
        const p = planet.params;
        if (p.mode !== 'star' && passes.lutDirty) {
          gpu(() => pipe._blit(passes.lutMat, passes.lutRT));
          passes.lutDirty = false;
        }
        if (p.mode === 'planet' && (p.cloudsEnabled || planet.uniforms.uCloudShadowStr.value > 0)) {
          while (!gpu(() => passes.bakeWeatherSlice(frame.weatherTime, 1))) {
            report('weather', passes._initFace, 6);
            await nextFrame();
          }
        }
        if (p.mode === 'gas') gpu(() => planet._bakeFrame(r));
      }
      finish('weather');
    }

    // 4. first draw of every program (lazily built driver state) while the
    // loading screen is still up
    this.warmer.prime(entries);
    await nextFrame();
    finish('prime');
  }

  /**
   * Compile a planet's shaders ahead of its first frame without blocking.
   * Resolves when they are ready (prepare() without the bakes).
   */
  async compile(planets, camera = null) {
    await this.prepare(planets, camera, { bake: false });
  }

  dispose() {
    this.pipeline.dispose();
    this.warmer.dispose();
    this._impostors?.dispose();
  }
}
