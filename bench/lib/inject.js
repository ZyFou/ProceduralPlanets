// Instrumentation injected before any page script (Page.addScriptToEvaluateOnNewDocument).
// Exposes window.__ppTrace.snapshot():
//   frames     rAF timestamps from navigation start (frame gaps = main-thread stalls)
//   loaf       long animation frames (Chrome's attribution of slow frames)
//   gl         VRAM ledger (bytes live / peak per kind, from the allocation calls),
//              program links, time blocked in synchronous status queries / readbacks,
//              draw calls per rAF frame
//   loaders    visibility transitions of loading overlays (#boot-splash, [data-pp-loader])
//   marks      performance.mark() entries (the app marks its own milestones: pp:*)
(() => {
  if (window.__ppTrace) return;
  const now = () => performance.now();
  const frames = [];
  const drawsPerFrame = [];
  let drawsThisFrame = 0;
  const loaf = [];
  const loaders = [];
  const loaderState = new Map();

  // ------------------------------------------------------------- frames
  const rafLoop = (t) => {
    frames.push(t);
    drawsPerFrame.push(drawsThisFrame);
    drawsThisFrame = 0;
    pollLoaders(t);
    if (frames.length < 60000) requestAnimationFrame(rafLoop);
  };
  requestAnimationFrame(rafLoop);

  function visible(el) {
    if (!el || !el.isConnected) return 0;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    let o = parseFloat(cs.opacity);
    for (let p = el.parentElement; p && o > 0; p = p.parentElement) o *= parseFloat(getComputedStyle(p).opacity);
    return o;
  }

  function pollLoaders(t) {
    if (!document.body) return;
    const els = document.querySelectorAll('#boot-splash, [data-pp-loader]');
    const seen = new Set();
    for (const el of els) {
      const id = el.id || el.getAttribute('data-pp-loader') || 'loader';
      seen.add(id);
      const o = visible(el);
      const prev = loaderState.get(id) ?? -1;
      const on = o > 0.02;
      if (prev === -1 || (prev > 0.02) !== on || (on && Math.abs(prev - o) > 0.25)) {
        loaders.push({ t, id, opacity: +o.toFixed(3) });
        loaderState.set(id, o);
      } else {
        loaderState.set(id, o);
      }
    }
    for (const [id, o] of loaderState) {
      if (!seen.has(id) && o > 0.02) {
        loaders.push({ t, id, opacity: 0, removed: true });
        loaderState.set(id, 0);
      }
    }
  }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        loaf.push({
          start: e.startTime, duration: e.duration, blocking: e.blockingDuration,
          scripts: (e.scripts || []).slice(0, 4).map((s) => ({
            fn: s.sourceFunctionName, url: (s.sourceURL || '').split('/').slice(-2).join('/'),
            invoker: s.invoker, duration: s.duration,
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* not supported */ }

  // ---------------------------------------------------------- GL ledger
  const G = window.WebGL2RenderingContext;
  const gl = {
    live: { texture: 0, renderbuffer: 0, buffer: 0 },
    peak: 0,
    peakByKind: { texture: 0, renderbuffer: 0, buffer: 0 },
    allocs: 0,
    links: 0,
    shaderSourceBytes: 0,
    syncWaits: [],        // { what, ms, t }
    readPixels: 0,
    textures: new Map(),  // WebGLTexture -> { bytes, desc }
  };
  const objBytes = new Map();   // object -> { kind, bytes, desc, ctx }
  const ctxIds = new WeakMap();
  let nextCtx = 1;
  let curCtx = 0;
  const ctxOf = (c) => { let id = ctxIds.get(c); if (!id) { id = nextCtx++; ctxIds.set(c, id); } return id; };
  let activeUnit = 0;
  const boundTex = new Map();   // `${unit}:${target}` -> tex
  const boundBuf = new Map();   // target -> buffer
  let boundRB = null;

  const BPT = {
    0x8058: 4, 0x8C43: 4, 0x8051: 4, 0x8C41: 4, 0x881A: 8, 0x881B: 8, 0x8814: 16, 0x8815: 16,
    0x822F: 4, 0x8230: 8, 0x822D: 2, 0x822E: 4, 0x822B: 2, 0x8229: 1, 0x8C3A: 4, 0x8059: 4,
    0x81A5: 2, 0x81A6: 4, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8D62: 2, 0x8056: 2, 0x8057: 2,
    0x8232: 1, 0x8231: 1, 0x8238: 2, 0x8234: 2, 0x823A: 4, 0x8236: 4, 0x8235: 4,
    0x823B: 2, 0x8239: 4, 0x823C: 8, 0x8D7C: 4, 0x8D8E: 4, 0x8D76: 8, 0x8D88: 8, 0x8D70: 16, 0x8D82: 16,
  };
  const TYPE_BYTES = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2, 0x84FA: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2 };
  const FORMAT_CH = { 0x1908: 4, 0x1907: 4, 0x8227: 2, 0x1903: 1, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x1902: 1, 0x84F9: 1 };

  function texelBytes(internalformat, format, type) {
    if (BPT[internalformat]) return BPT[internalformat];
    const ch = FORMAT_CH[internalformat] ?? FORMAT_CH[format] ?? 4;
    const tb = TYPE_BYTES[type] ?? 1;
    if (type === 0x84FA) return 4;   // UNSIGNED_INT_24_8
    return ch * tb;
  }

  function setBytes(obj, kind, bytes, desc) {
    const prev = objBytes.get(obj);
    if (prev) gl.live[prev.kind] -= prev.bytes;
    objBytes.set(obj, { kind, bytes, desc, ctx: curCtx });
    gl.live[kind] += bytes;
    gl.allocs++;
    const total = gl.live.texture + gl.live.renderbuffer + gl.live.buffer;
    gl.peak = Math.max(gl.peak, total);
    gl.peakByKind[kind] = Math.max(gl.peakByKind[kind], gl.live[kind]);
  }
  function addBytes(obj, kind, bytes, desc) {
    const prev = objBytes.get(obj);
    setBytes(obj, kind, (prev ? prev.bytes : 0) + bytes, prev?.desc ?? desc);
  }
  function free(obj) {
    const prev = objBytes.get(obj);
    if (!prev) return;
    gl.live[prev.kind] -= prev.bytes;
    objBytes.delete(obj);
  }
  const texTarget = (t) => (t >= 0x8515 && t <= 0x851A ? 0x8513 : t);   // cube faces -> TEXTURE_CUBE_MAP
  const bound = (target) => boundTex.get(`${activeUnit}:${texTarget(target)}`);

  function wrap(name, fn) {
    const orig = G.prototype[name];
    if (!orig) return;
    G.prototype[name] = function (...a) { curCtx = ctxOf(this); return fn.call(this, orig, a); };
  }

  if (G) {
    wrap('activeTexture', function (orig, a) { activeUnit = a[0] - 0x84C0; return orig.apply(this, a); });
    wrap('bindTexture', function (orig, a) { boundTex.set(`${activeUnit}:${a[0]}`, a[1]); return orig.apply(this, a); });
    wrap('texStorage2D', function (orig, a) {
      const [target, levels, ifmt, w, h] = a;
      const faces = target === 0x8513 ? 6 : 1;
      let b = 0;
      for (let l = 0, lw = w, lh = h; l < levels; l++, lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) b += lw * lh;
      const tex = bound(target);
      if (tex) setBytes(tex, 'texture', b * faces * texelBytes(ifmt), `2D ${w}x${h}${faces > 1 ? 'x6' : ''} fmt 0x${ifmt.toString(16)} L${levels}`);
      return orig.apply(this, a);
    });
    wrap('texStorage3D', function (orig, a) {
      const [target, levels, ifmt, w, h, d] = a;
      let b = 0;
      for (let l = 0, lw = w, lh = h, ld = d; l < levels; l++) {
        b += lw * lh * ld;
        lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
        if (target === 0x806F) ld = Math.max(1, ld >> 1);   // TEXTURE_3D (arrays keep their layers)
      }
      const tex = bound(target);
      if (tex) setBytes(tex, 'texture', b * texelBytes(ifmt), `3D ${w}x${h}x${d} fmt 0x${ifmt.toString(16)}`);
      return orig.apply(this, a);
    });
    wrap('texImage2D', function (orig, a) {
      const [target, level, ifmt] = a;
      let w, h, format, type;
      if (a.length >= 8) { w = a[3]; h = a[4]; format = a[6]; type = a[7]; }
      else { const src = a[5]; format = a[3]; type = a[4]; w = src?.width ?? src?.videoWidth ?? 0; h = src?.height ?? src?.videoHeight ?? 0; }
      const tex = bound(target);
      if (tex) {
        const b = w * h * texelBytes(ifmt, format, type);
        // level 0 (re)defines the texture; further levels / cube faces add
        if (level === 0 && target === 0x0DE1) setBytes(tex, 'texture', b, `2D ${w}x${h} fmt 0x${ifmt.toString(16)}`);
        else addBytes(tex, 'texture', b, `cube/mip ${w}x${h}`);
      }
      return orig.apply(this, a);
    });
    wrap('texImage3D', function (orig, a) {
      const [target, level, ifmt, w, h, d, , format, type] = a;
      const tex = bound(target);
      if (tex) {
        const b = w * h * d * texelBytes(ifmt, format, type);
        if (level === 0) setBytes(tex, 'texture', b, `3D ${w}x${h}x${d} fmt 0x${ifmt.toString(16)}`);
        else addBytes(tex, 'texture', b);
      }
      return orig.apply(this, a);
    });
    wrap('compressedTexImage2D', function (orig, a) {
      const tex = bound(a[0]);
      const data = a[6];
      if (tex && data) addBytes(tex, 'texture', data.byteLength ?? 0, 'compressed');
      return orig.apply(this, a);
    });
    wrap('deleteTexture', function (orig, a) { free(a[0]); return orig.apply(this, a); });
    wrap('bindRenderbuffer', function (orig, a) { boundRB = a[1]; return orig.apply(this, a); });
    wrap('renderbufferStorage', function (orig, a) {
      if (boundRB) setBytes(boundRB, 'renderbuffer', a[2] * a[3] * texelBytes(a[1]), `RB ${a[2]}x${a[3]}`);
      return orig.apply(this, a);
    });
    wrap('renderbufferStorageMultisample', function (orig, a) {
      if (boundRB) setBytes(boundRB, 'renderbuffer', a[3] * a[4] * texelBytes(a[2]) * Math.max(1, a[1]), `RB ${a[3]}x${a[4]} x${a[1]}`);
      return orig.apply(this, a);
    });
    wrap('deleteRenderbuffer', function (orig, a) { free(a[0]); return orig.apply(this, a); });
    wrap('bindBuffer', function (orig, a) { boundBuf.set(a[0], a[1]); return orig.apply(this, a); });
    wrap('bufferData', function (orig, a) {
      const buf = boundBuf.get(a[0]);
      const size = typeof a[1] === 'number' ? a[1] : a[1]?.byteLength ?? 0;
      if (buf) setBytes(buf, 'buffer', size, `buffer 0x${a[0].toString(16)}`);
      return orig.apply(this, a);
    });
    wrap('deleteBuffer', function (orig, a) { free(a[0]); return orig.apply(this, a); });

    wrap('shaderSource', function (orig, a) { gl.shaderSourceBytes += a[1]?.length ?? 0; return orig.apply(this, a); });
    wrap('linkProgram', function (orig, a) { gl.links++; return orig.apply(this, a); });
    const timed = (what) => function (orig, a) {
      const t0 = now();
      const r = orig.apply(this, a);
      const ms = now() - t0;
      if (ms > 2) gl.syncWaits.push({ what: typeof what === 'function' ? what(a) : what, ms: +ms.toFixed(2), t: +t0.toFixed(1) });
      return r;
    };
    wrap('getProgramParameter', timed((a) => `getProgramParameter 0x${a[1].toString(16)}`));
    wrap('getShaderParameter', timed((a) => `getShaderParameter 0x${a[1].toString(16)}`));
    wrap('getProgramInfoLog', timed('getProgramInfoLog'));
    wrap('getUniformLocation', timed('getUniformLocation'));
    wrap('getActiveUniform', timed('getActiveUniform'));
    wrap('readPixels', function (orig, a) { gl.readPixels++; return timed('readPixels').call(this, orig, a); });
    wrap('finish', timed('finish'));
    wrap('clientWaitSync', timed('clientWaitSync'));
    for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      wrap(n, function (orig, a) { drawsThisFrame++; return timed(n).call(this, orig, a); });
    }
    // diagnosis: every other call that can wait on the GPU process
    for (const n of ['linkProgram', 'compileShader', 'useProgram', 'bindFramebuffer', 'clear', 'texStorage2D', 'texStorage3D',
      'texImage2D', 'texImage3D', 'createProgram', 'attachShader', 'getExtension', 'getParameter', 'getSupportedExtensions',
      'getContextAttributes', 'getActiveAttrib', 'getAttribLocation', 'getShaderInfoLog', 'uniformMatrix4fv', 'framebufferTexture2D',
      'framebufferTextureLayer', 'checkFramebufferStatus', 'getError', 'flush']) {
      const o = G.prototype[n];
      if (!o) continue;
      G.prototype[n] = function (...a) {
        const t0 = now();
        const r = o.apply(this, a);
        const ms = now() - t0;
        if (ms > 2) gl.syncWaits.push({ what: n, ms: +ms.toFixed(2), t: +t0.toFixed(1) });
        return r;
      };
    }
  }

  window.__ppTrace = {
    t0: 0,
    snapshot() {
      return {
        now: now(),
        frames: frames.slice(),
        drawsPerFrame: drawsPerFrame.slice(),
        loaf: loaf.slice(),
        loaders: loaders.slice(),
        marks: performance.getEntriesByType('mark').map((m) => ({ name: m.name, t: m.startTime, detail: m.detail ?? null })),
        gl: {
          live: { ...gl.live },
          liveTotal: gl.live.texture + gl.live.renderbuffer + gl.live.buffer,
          peak: gl.peak,
          peakByKind: { ...gl.peakByKind },
          allocs: gl.allocs,
          links: gl.links,
          shaderSourceBytes: gl.shaderSourceBytes,
          readPixels: gl.readPixels,
          syncWaits: gl.syncWaits.slice(),
        },
      };
    },
    /** Live allocations of one context (or all), largest first. */
    ledger(context = null) {
      const id = context ? ctxOf(context) : 0;
      return [...objBytes.values()].filter((o) => !id || o.ctx === id).sort((a, b) => b.bytes - a.bytes)
        .map((o) => ({ kind: o.kind, mb: +(o.bytes / 1048576).toFixed(3), desc: o.desc }));
    },
    /** Live bytes of one GL context by kind. */
    vram(context) {
      const id = ctxOf(context);
      const out = { texture: 0, renderbuffer: 0, buffer: 0, total: 0 };
      for (const o of objBytes.values()) if (o.ctx === id) { out[o.kind] += o.bytes; out.total += o.bytes; }
      return out;
    },
  };
})();
