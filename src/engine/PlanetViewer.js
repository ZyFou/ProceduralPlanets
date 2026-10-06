import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Planet } from './Planet.js';
import { PlanetRenderer } from './PlanetRenderer.js';
import { RenderUpscaler } from './RenderUpscaler.js';

const nextFrame = () => new Promise((resolve) => {
  const t = setTimeout(resolve, 100);
  requestAnimationFrame(() => { clearTimeout(t); resolve(); });
});

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
   *   onStats     ({ fps, triangles, drawCalls, chunks, pending }) => void, ~2 Hz
   *
   * Shaders compile in the background: until they are ready the canvas
   * keeps its previous frame. await viewer.prepare() to know when the first
   * full-quality frame is up (e.g. to hide a loading screen).
   */
  constructor(options = {}) {
    const { canvas: canvasIn, container, controls = true, autoStart = true, pixelRatio = 2 } = options;
    this.cb = { ...(options.callbacks ?? {}) };
    if (options.onStats) this.cb.onStats = options.onStats;
    this._disposed = false;
    this._upscaler = null;
    this._drawingSize = new THREE.Vector2();

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

    // Resizing the WebGL drawing buffer clears it. While running, do it only
    // immediately before drawing, never in ResizeObserver after the frame.
    // A stopped viewer still redraws when its container changes size.
    this._onResize = () => {
      if (!this._disposed && !this._running) this.renderOnce();
    };
    window.addEventListener('resize', this._onResize);
    this._resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(this._onResize);
    this._resizeObserver?.observe(canvas);
    this._viewportSize = new THREE.Vector2();
    this._resize();

    // stats
    this._frames = 0;
    this._fpsTime = performance.now();
    this._fps = 0;

    this._clock = new THREE.Clock();
    this._running = false;
    this._afterFrame = [];
    if (autoStart) this.start();
  }

  /**
   * Compile the planet's shaders (in parallel, without blocking the page),
   * run its one-time GPU bakes and draw its first frame. Resolves once that
   * final-quality frame is on the canvas. options: { onProgress, modes }
   * (see PlanetRenderer.prepare).
   */
  async prepare(options = {}) {
    this._applyControlLimits();
    if (!this.walker?.active) this.controls?.update();
    await this.planetRenderer.prepare(this.planet, this.camera, options);
    for (let i = 0; i < 240 && !this._disposed; i++) {
      this._renderFrame(0);
      if (this.planetRenderer.pending === 0) break;
      await nextFrame();
    }
    return this;
  }

  /**
   * A small image of the view (data URL) taken from the next frame that draws
   * the planet — no extra render, no target resize. Resolves null when the
   * viewer is disposed first.
   */
  captureThumbnail(width = 480, height = Math.round((width * 9) / 16), type = 'image/webp', quality = 0.82) {
    return new Promise((resolve) => {
      this._afterFrame.push((ok) => {
        if (!ok) return false;   // not drawn this frame: wait for the next
        const src = this.renderer.domElement;
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        // centre crop to the thumbnail aspect
        const s = Math.min(src.width / width, src.height / height);
        const sw = width * s, sh = height * s;
        c.getContext('2d').drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
        resolve(c.toDataURL(type, quality));
        return true;
      });
      this._thumbResolvers = [...(this._thumbResolvers ?? []), resolve];
    });
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

  _renderFrame(delta, { native = false } = {}) {
    this.renderer.info.reset();
    const requested = this.planet.params.renderResolution;
    const scale = native || !Number.isFinite(requested) ? 1 : THREE.MathUtils.clamp(requested, 0.25, 1);
    if (scale < 1) {
      this._upscaler ??= new RenderUpscaler();
      this.renderer.getDrawingBufferSize(this._drawingSize);
      this._upscaler.setSize(this._drawingSize.x, this._drawingSize.y, scale);
      this.planetRenderer.render(this.planet, this.camera, { target: this._upscaler.target, delta });
      // Keep the previous canvas frame while the offscreen variant compiles.
      if (this.planetRenderer.pending === 0) this._upscaler.render(this.renderer, this.planet.params.upscaler);
    } else {
      if (!native && this._upscaler) {
        this._upscaler.dispose();
        this._upscaler = null;
      }
      this.planetRenderer.render(this.planet, this.camera, { target: null, delta });
    }
    if (this._afterFrame.length) {
      // same task as the draw: the drawing buffer is still readable
      const ok = this.planetRenderer.pending === 0 && this.planetRenderer.info.planets > 0;
      this._afterFrame = this._afterFrame.filter((fn) => !fn(ok));
    }
  }

  /** One manual frame (no clock advance) — e.g. when rAF is frozen. */
  renderOnce() {
    this._resize();
    if (!this.walker?.active) this.controls?.update();
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
    try {
      // Performance settings apply to the viewport; PNGs keep full detail.
      this._renderFrame(0, { native: true });
      return this.renderer.domElement.toDataURL('image/png');
    } finally {
      this.renderer.setPixelRatio(prevRatio);
      this.renderer.setSize(prevSize.x, prevSize.y, false);
      this.renderOnce();
    }
  }

  // ------------------------------------------------------------------- loop
  _resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Hidden containers can briefly measure zero; keep their last frame.
    if (!w || !h) return;
    this.renderer.getSize(this._viewportSize);
    if (this._viewportSize.x !== w || this._viewportSize.y !== h) {
      this.renderer.setSize(w, h, false);
    }
    const aspect = w / h;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  _tick() {
    if (this._disposed) return;
    const dt = Math.min(this._clock.getDelta(), 0.05);
    this._applyControlLimits();
    if (!this.walker?.active) this.controls?.update();
    this._resize();
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
        pending: this.planetRenderer.pending,
      });
    }
  }

  dispose() {
    this._disposed = true;
    for (const resolve of this._thumbResolvers ?? []) resolve(null);
    this._afterFrame = [];
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();
    this.controls?.dispose();
    if (this._ownsPlanet) this.planet.dispose();
    this.planetRenderer.dispose();
    this._upscaler?.dispose();
    this.renderer.dispose();
    if (this._ownsCanvas) this.canvas.remove();
  }
}
