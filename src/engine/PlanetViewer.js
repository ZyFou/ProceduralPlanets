import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Planet } from './Planet.js';
import { PlanetRenderer } from './PlanetRenderer.js';

// ============================================================================
// PlanetViewer — a self-contained planet view: its own WebGLRenderer, camera,
// orbit controls and render loop around ONE Planet, drawn opaque over a
// starfield. This is the studio's viewport; use it to drop a planet onto a
// page. To put planets inside an existing three.js scene use Planet +
// PlanetRenderer instead.
// ============================================================================

export class PlanetViewer {
  /**
   * @param {object} options
   *   canvas      HTMLCanvasElement to render into, or
   *   container   element to create a full-size canvas in
   *   planet      a Planet, or Planet constructor options (default: terran)
   *   controls    enable OrbitControls (default true)
   *   autoStart   start the render loop (default true)
   *   pixelRatio  max device pixel ratio (default 2)
   *   onStats     ({ fps, triangles, drawCalls, chunks }) => void, ~2 Hz
   */
  constructor(options = {}) {
    const { canvas: canvasIn, container, controls = true, autoStart = true, pixelRatio = 2 } = options;
    this.cb = { ...(options.callbacks ?? {}) };
    if (options.onStats) this.cb.onStats = options.onStats;
    this._disposed = false;

    let canvas = canvasIn;
    if (!canvas) {
      if (!container) throw new Error('[procedural-planets] PlanetViewer needs a canvas or a container');
      canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      container.appendChild(canvas);
      this._ownsCanvas = true;
    }
    this.canvas = canvas;

    // no MSAA on the default framebuffer: every frame is composited from
    // the pipeline's HDR targets
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatio));
    this.renderer.setClearColor(0x000000, 1);
    // a frame is several passes: count them all, reset once per frame
    this.renderer.info.autoReset = false;

    this.planetRenderer = new PlanetRenderer(this.renderer, {
      background: 'stars',
      scissor: false,
      depthTest: false,
      depthWrite: false,
      autoUpdate: false,
    });

    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 1e6);
    this._ownsPlanet = !(options.planet?.isPlanet);
    this.planet = options.planet?.isPlanet ? options.planet : new Planet(options.planet ?? {});

    if (controls) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
    } else {
      this.controls = null;
    }
    this.frame();

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
    this._running = false;
    if (autoStart) this.start();
  }

  /** Put the camera back at the default 3/4 view of the planet. */
  frame() {
    const R = this.planet.params.radius;
    this.camera.position.set(R * 2.4, R * 1.4, R * 2.4);
    this.camera.lookAt(0, 0, 0);
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this._applyControlLimits();
      this.controls.update();
    }
    return this;
  }

  /** Replace the planet (a Planet or constructor options). Returns the new planet. */
  setPlanet(planet) {
    if (this._ownsPlanet) this.planet.dispose();
    this._ownsPlanet = !planet?.isPlanet;
    this.planet = planet?.isPlanet ? planet : new Planet(planet ?? {});
    this.frame();
    return this.planet;
  }

  _applyControlLimits() {
    if (!this.controls) return;
    const p = this.planet.params;
    this.controls.minDistance = p.radius + p.heightScale * 2.2;
    this.controls.maxDistance = p.radius * 12;
  }

  start() {
    if (this._running || this._disposed) return this;
    this._running = true;
    this._clock.getDelta();
    this.renderer.setAnimationLoop(() => this._tick());
    return this;
  }

  stop() {
    this._running = false;
    this.renderer.setAnimationLoop(null);
    return this;
  }

  get running() { return this._running; }

  _renderFrame(delta) {
    this.renderer.info.reset();
    this.planetRenderer.render(this.planet, this.camera, { target: null, delta });
  }

  /** One manual frame (no clock advance) — e.g. when rAF is frozen. */
  renderOnce() {
    this.controls?.update();
    this._renderFrame(0);
  }

  /** PNG data URL of one frame rendered at w x h. */
  screenshot(w = 1920, h = 1080) {
    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._renderFrame(0);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this._resize();
    return url;
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
    this._applyControlLimits();
    this.controls?.update();
    this._renderFrame(dt);

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
        chunks: this.planet.world.chunkCount,
      });
    }
  }

  dispose() {
    this._disposed = true;
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();
    this.controls?.dispose();
    if (this._ownsPlanet) this.planet.dispose();
    this.planetRenderer.dispose();
    this.renderer.dispose();
    if (this._ownsCanvas) this.canvas.remove();
  }
}
