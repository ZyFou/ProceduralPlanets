import * as THREE from 'three';
import { PlanetPipeline, setEmbedBlending } from './PlanetPipeline.js';

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
};

const warned = new Set();
function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[procedural-planets] ${msg}`);
}

const _size = new THREE.Vector2();
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _pv = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _clear = new THREE.Color();
const _scissor = new THREE.Vector4();

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
    this._clock = new THREE.Clock(false);
    this._proxy = new THREE.PerspectiveCamera();
    this._proxy.matrixAutoUpdate = false;
    this._proxy.matrixWorldAutoUpdate = false;
    this._rect = new THREE.Vector4();
    this._list = [];
    /** Stats of the last render(): planets drawn / culled. */
    this.info = { planets: 0, culled: 0 };
  }

  /** Change options at runtime (same keys as the constructor). */
  setOptions(options) {
    Object.assign(this.options, options);
    return this;
  }

  _collect(input) {
    const list = this._list;
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
    if (!camera?.isPerspectiveCamera) {
      warnOnce('PlanetRenderer.render needs a THREE.PerspectiveCamera');
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

    // visible, far to near
    const drawn = [];
    let culled = 0;
    for (const p of list) {
      p.updateWorldMatrix(true, false);
      _sphere.center.setFromMatrixPosition(p.matrixWorld);
      _sphere.radius = p.boundingRadius * p.matrixWorld.getMaxScaleOnAxis();
      if (!_frustum.intersectsSphere(_sphere)) { culled++; continue; }
      drawn.push({ p, d: _sphere.center.distanceToSquared(_c.setFromMatrixPosition(camera.matrixWorld)) });
    }
    drawn.sort((a, b) => b.d - a.d);
    this.info.planets = drawn.length;
    this.info.culled = culled;
    if (!drawn.length) return;

    // host state
    const prevTarget = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace();
    const prevMip = r.getActiveMipmapLevel();
    const prevAutoClear = r.autoClear;
    r.getClearColor(_clear);
    const prevClearAlpha = r.getClearAlpha();
    const prevScissorTest = out ? out.scissorTest : r.getScissorTest();
    if (out) _scissor.copy(out.scissor);
    else r.getScissor(_scissor);

    r.setClearColor(0x000000, 1);
    try {
      drawn.forEach(({ p }, i) => this._renderPlanet(p, camera, out, i === 0 && opt.background === 'stars'));
    } finally {
      if (out) { out.scissor.copy(_scissor); out.scissorTest = prevScissorTest; }
      else { r.setScissor(_scissor); r.setScissorTest(prevScissorTest); }
      r.setClearColor(_clear, prevClearAlpha);
      r.autoClear = prevAutoClear;
      r.setRenderTarget(prevTarget, prevFace, prevMip);
    }
  }

  _renderPlanet(planet, camera, target, opaque) {
    const r = this.renderer;
    const pipe = this.pipeline;
    const opt = this.options;
    const passes = planet._getPasses(pipe);
    planet._updateSunDirection();
    const frame = planet._prepareFrame(r);

    // ---- proxy camera in the planet's local frame
    const px = this._proxy;
    px.fov = camera.fov;
    px.aspect = camera.aspect;
    px.zoom = camera.zoom;
    px.filmGauge = camera.filmGauge;
    px.filmOffset = camera.filmOffset;
    px.view = camera.view;
    _inv.copy(planet.matrixWorld).invert();
    px.matrixWorld.multiplyMatrices(_inv, camera.matrixWorld);
    px.matrixWorldInverse.copy(px.matrixWorld).invert();
    const camLocal = _v.setFromMatrixPosition(px.matrixWorld);
    const camDist = camLocal.length();
    const scale = planet.matrixWorld.getMaxScaleOnAxis();
    const [near, far] = planet._clipPlanes(camDist);
    px.near = near * scale;
    px.far = far * scale;
    px.updateProjectionMatrix();

    if (planet._needsWarmup) {
      planet.world.warmup(r, px, pipe.sceneRT);
      planet._needsWarmup = false;
    }
    if (planet.world.group.visible) planet.world.update(camLocal, px);

    // ---- embed uniforms
    const embed = !opaque;
    const e = pipe.embed;
    e.uViewMat.value.copy(px.matrixWorldInverse);
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
      rect = this._screenRect(px, planet.boundingRadius * scale);
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

  // conservative pixel rectangle of a view-space sphere; null = whole frame,
  // false = nothing visible
  _screenRect(cam, radius) {
    const center = _c.set(0, 0, 0).applyMatrix4(cam.matrixWorldInverse);
    const w = this.pipeline.width;
    const h = this.pipeline.height;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _v.set(
        center.x + (i & 1 ? radius : -radius),
        center.y + (i & 2 ? radius : -radius),
        center.z + (i & 4 ? radius : -radius)
      );
      if (_v.z > -cam.near) return null;   // straddles the camera: full frame
      _v.applyMatrix4(cam.projectionMatrix);
      x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x);
      y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
    }
    const px0 = Math.max(0, Math.floor((x0 * 0.5 + 0.5) * w) - 2);
    const py0 = Math.max(0, Math.floor((y0 * 0.5 + 0.5) * h) - 2);
    const px1 = Math.min(w, Math.ceil((x1 * 0.5 + 0.5) * w) + 2);
    const py1 = Math.min(h, Math.ceil((y1 * 0.5 + 0.5) * h) + 2);
    if (px1 <= px0 || py1 <= py0) return false;
    return this._rect.set(px0, py0, px1 - px0, py1 - py0);
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
   * Compile a planet's shaders ahead of its first frame (the terrain program
   * is large: first use can stall for seconds otherwise). Resolves when the
   * driver reports the programs ready (KHR_parallel_shader_compile).
   */
  async compile(planets, camera = null) {
    const r = this.renderer;
    const list = Array.isArray(planets) ? planets : [planets];
    const cam = camera ?? new THREE.PerspectiveCamera();
    const prev = r.getRenderTarget();
    const jobs = [];
    const quadScene = (materials) => {
      const quads = new THREE.Scene();
      for (const m of materials) {
        const q = new THREE.Mesh(this.pipeline.quad.geometry, m);
        q.frustumCulled = false;
        quads.add(q);
      }
      return quads;
    };
    for (const planet of list) {
      const passes = planet._getPasses(this.pipeline);
      planet._prepareFrame(r);
      r.setRenderTarget(this.pipeline.sceneRT);
      planet.world.warmup(r, cam, this.pipeline.sceneRT);
      planet._needsWarmup = false;
      jobs.push(r.compileAsync(planet._scene, cam));
      jobs.push(r.compileAsync(quadScene([passes.lutMat, passes.weatherMat, passes.cloudMat]), this.pipeline.quadCamera));
      // the composite program depends on the output target and embed mode
      setEmbedBlending(passes.compositeMat, this.options.background !== 'stars', this.options.depthTest);
      r.setRenderTarget(prev);
      jobs.push(r.compileAsync(quadScene([passes.compositeMat]), this.pipeline.quadCamera));
    }
    r.setRenderTarget(prev);
    await Promise.all(jobs);
  }

  dispose() {
    this.pipeline.dispose();
  }
}
