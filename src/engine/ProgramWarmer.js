import * as THREE from 'three';

// ============================================================================
// ProgramWarmer — shader programs without main-thread stalls.
//
// three.js compiles a program on its first draw and then reads the link
// status, which waits for the driver: seconds for the terrain shader on
// ANGLE / D3D11, during which the page is frozen. Here every material a frame
// needs is compiled ahead with renderer.compile(), which only ISSUES compile
// + link, and polled through KHR_parallel_shader_compile's non-blocking
// COMPLETION_STATUS query. PlanetRenderer draws a planet only once ensure()
// reports all of its programs ready; until then the previous frame stays up.
//
// Requests are spread over frames: three assembles a program's source on the
// main thread (tens of ms for the terrain shader), so each ensure() call
// issues new compiles for at most `budgetMs` and leaves the rest for the next
// call. The driver still compiles everything issued in parallel.
//
// Without the extension a program cannot be polled: ensure() then links ONE
// program per call (a short stall per frame instead of one long freeze).
//
// prime() draws each ready material once into a 1x1 scissor of a target of
// its kind: drivers finish some per-format state lazily on first draw, and
// that first draw should happen behind a loading screen, not in the app.
// ============================================================================

export class ProgramWarmer {
  constructor(renderer) {
    this.renderer = renderer;
    this.parallel = renderer.extensions.has('KHR_parallel_shader_compile');
    this.requested = 0;               // programs requested so far (stats)
    this._records = new WeakMap();    // material -> Map(kind -> { version, done, primed })
    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera();
    this._geometry = new THREE.PlaneGeometry(2, 2);
    this._mesh = new THREE.Mesh(this._geometry);
    this._mesh.frustumCulled = false;
    this._scene.add(this._mesh);
    this._rt = null;                  // 1x1 stand-in for "an offscreen target"
    this._linkedThisCall = false;
    this.budgetMs = 6;                // main-thread time for new requests per ensure()
  }

  // three picks a program variant by output colour space + tone mapping: the
  // same for every render target, specific for the canvas
  _kind(offscreen) {
    if (offscreen) return 'rt';
    const r = this.renderer;
    return `screen:${r.outputColorSpace}:${r.toneMapping}`;
  }

  _target(offscreen) {
    if (!offscreen) return null;
    this._rt ??= new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    return this._rt;
  }

  _record(material, kind) {
    let rec = this._records.get(material);
    if (!rec) {
      rec = new Map();
      this._records.set(material, rec);
    }
    return { rec, r: rec.get(kind) };
  }

  _programs(material) {
    return this.renderer.properties.get(material).programs;
  }

  _request(material, offscreen) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const face = r.getActiveCubeFace();
    const mip = r.getActiveMipmapLevel();
    this._mesh.material = material;
    r.setRenderTarget(this._target(offscreen));
    r.compile(this._scene, this._camera);
    r.setRenderTarget(prev, face, mip);
    this._mesh.material = null;
    this.requested++;
  }

  _ready(material) {
    const progs = this._programs(material);
    if (!progs || progs.size === 0) return false;
    for (const p of progs.values()) {
      if (!p.isReady()) return false;
    }
    if (!this.parallel) {
      // no status to poll: link now, one program per call
      for (const p of progs.values()) {
        if (p.__ppLinked) continue;
        if (this._linkedThisCall) return false;
        p.getUniforms();   // first use: waits for this program's link
        p.__ppLinked = true;
        this._linkedThisCall = true;
      }
    }
    return true;
  }

  /**
   * entries: [{ material, offscreen }]. Requests what was never compiled
   * (or changed since), never blocks. Returns { ready, done, total }.
   */
  ensure(entries) {
    this._linkedThisCall = false;
    const t0 = performance.now();
    let done = 0;
    for (const e of entries) {
      const kind = this._kind(e.offscreen);
      const { rec, r } = this._record(e.material, kind);
      let cur = r;
      if (!cur || cur.version !== e.material.version) {
        if (performance.now() - t0 > this.budgetMs) continue;   // next call
        this._request(e.material, e.offscreen);
        // compile() can bump the version (two-sided transparent materials)
        cur = { version: e.material.version, done: false, primed: false };
        rec.set(kind, cur);
      }
      if (!cur.done) {
        cur.done = this._ready(e.material);
        if (cur.done) performance.mark?.(`pp:program:${e.material.name || e.material.type}`);
      }
      if (cur.done) done++;
    }
    return { ready: done === entries.length, done, total: entries.length };
  }

  /** Draw every ready, not yet primed entry once into a 1x1 scissor. */
  prime(entries) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const face = r.getActiveCubeFace();
    const mip = r.getActiveMipmapLevel();
    const autoClear = r.autoClear;
    const scissorTest = r.getScissorTest();
    const scissor = new THREE.Vector4();
    r.getScissor(scissor);
    r.autoClear = false;
    let n = 0;
    for (const e of entries) {
      const { r: cur } = this._record(e.material, this._kind(e.offscreen));
      if (!cur?.done || cur.primed) continue;
      if (e.offscreen) {
        // a 1x1 stand-in: never a real target (it would overwrite a texel of a
        // LUT or noise volume)
        this._draw(e.material, this._target(true));
      } else {
        r.setScissor(0, 0, 1, 1);
        r.setScissorTest(true);
        this._draw(e.material, null);
        r.setScissorTest(scissorTest);
        r.setScissor(scissor);
      }
      cur.primed = true;
      n++;
    }
    r.autoClear = autoClear;
    r.setRenderTarget(prev, face, mip);
    return n;
  }

  _draw(material, target) {
    const r = this.renderer;
    this._mesh.material = material;
    r.setRenderTarget(target);
    r.render(this._scene, this._camera);
    this._mesh.material = null;
  }

  dispose() {
    this._geometry.dispose();
    this._rt?.dispose();
  }
}
