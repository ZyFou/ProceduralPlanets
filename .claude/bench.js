// Render benchmark + image-diff harness (dev only, not part of the app build).
// Load from the running dev server page:
//   const b = await import('/.claude/bench.js?' + Date.now());
//   b.start({ tag: 'iterN', compare: 'baseline' });   // app engine only
//   b.startPaired({ snaps: ['baseline', 'iter3'], tag: 'iterN' });
//   b.poll();                                         // null while running
// Needs the artefact receiver on 127.0.0.1:5198 (POST save / GET load).
//
// Every scenario renders at a fixed 1920x1080, fixed time, fixed camera, so
// frames are reproducible. GPU time per pass comes from
// EXT_disjoint_timer_query_webgl2: each setRenderTarget() call starts a new
// query labelled with the pipeline field that owns the target.
//
// Paired mode loads engine snapshots (.claude/snap/<name>/Engine.js) next to
// the app's live engine, each on its own canvas / GL context, and alternates
// them (A B B A ...) per round, so GPU clock and background-load drift hit
// every version alike.

import * as THREE from 'three';
import { DEFAULT_PARAMS } from '/src/engine/presets.js';

export { THREE };

const STORE = 'http://127.0.0.1:5198';
const W = 1920, H = 1080;
const T = 20.0;

function scenarios(R) {
  const d = new THREE.Vector3(0.3, 0.4, 0.87).normalize();
  const tan = new THREE.Vector3(0, 1, 0).cross(d).normalize();
  const low = d.clone().multiplyScalar(R + 200);
  // close over a cumulus field (seen from orbit at pixel 870,610)
  const cd = new THREE.Vector3(0.5126, 0.2014, 0.8347).normalize();
  const ct = new THREE.Vector3(0, 1, 0).cross(cd).normalize();
  const cpos = cd.clone().addScaledVector(ct, 0.12).normalize().multiplyScalar(R + 180);
  return [
    { name: 'orbit', mode: 'planet', pos: [R * 2.4, R * 1.4, R * 2.4], look: [0, 0, 0] },
    { name: 'near', mode: 'planet', pos: d.clone().multiplyScalar(R * 1.4).toArray(), look: [0, 0, 0] },
    { name: 'horizon', mode: 'planet', pos: low.toArray(),
      look: low.clone().addScaledVector(tan, 1000).addScaledVector(d, -170).toArray() },
    { name: 'clouds', mode: 'planet', pos: cpos.toArray(), look: cd.clone().multiplyScalar(R + 45).toArray() },
    { name: 'gas', mode: 'gas', pos: [R * 2.4, R * 1.4, R * 2.4], look: [0, 0, 0] },
    { name: 'star', mode: 'star', pos: [R * 2.4, R * 1.4, R * 2.4], look: [0, 0, 0] },
  ];
}
export const SCENARIOS = scenarios(DEFAULT_PARAMS.radius).map((s) => s.name);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// yield to the event loop (GPU query results only land between tasks).
// MessageChannel, not setTimeout: timers get throttled to ~1/s while the
// preview pane is hidden.
const sleep = () => new Promise((r) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => { c.port1.close(); r(); };
  c.port2.postMessage(0);
});

// ---------------------------------------------------------------- engines
const snapEngines = {};
export async function snapEngine(name) {
  if (snapEngines[name]) return snapEngines[name];
  const { Engine } = await import(`/.claude/snap/${name}/Engine.js`);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;opacity:0;pointer-events:none;';
  document.body.appendChild(canvas);
  const e = new Engine({ canvas });
  snapEngines[name] = e;
  return e;
}

function setup(e) {
  const r = e.renderer;
  r.setAnimationLoop(null);
  for (const [k, v] of Object.entries(DEFAULT_PARAMS)) e.setParam(k, Array.isArray(v) ? [...v] : v);
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  e.pipeline.setSize(W, H);
  e.camera.aspect = W / H;
  e.camera.updateProjectionMatrix();
}

function place(e, sc) {
  e.setParam('mode', sc.mode);
  e.camera.position.set(...sc.pos);
  e.camera.up.set(0, 1, 0);
  e.camera.lookAt(...sc.look);
  e.camera.updateMatrixWorld();
  e.uniforms.uTime.value = T;
  e.pipeline.weatherDirty = true;
}

const frame = (e) => {
  if (e.world.group.visible) e.world.update(e.camera.position, e.camera);
  e._renderFrame();
};
const sync = (gl) => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };

// One measurement of engine e on scenario sc (camera already placed).
async function measure(e, sc, { frames = 40, gpuFrames = 20 } = {}) {
  const r = e.renderer;
  const gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pipe = e.pipeline;
  place(e, sc);
  for (let i = 0; i < 10; i++) frame(e);   // LOD settles, bakes happen
  sync(gl);

  // CPU submission time (no sync inside the loop)
  const cpu = [];
  for (let i = 0; i < 16; i++) {
    const t0 = performance.now();
    frame(e);
    cpu.push(performance.now() - t0);
    if (i % 4 === 3) sync(gl);
  }
  sync(gl);

  // wall time per frame, pipelined (sync once per batch)
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) frame(e);
  sync(gl);
  const wall = (performance.now() - t0) / frames;

  // GPU per pass; queries read back after the batch (waiting per frame idles
  // the GPU and lets its clocks drop)
  const origSRT = r.setRenderTarget;
  const label = (t) => {
    if (!t) return 'screen';
    for (const [k, v] of Object.entries(pipe)) if (v === t) return k;
    if (pipe.bloomRTs?.includes(t)) return 'bloom';
    return 'other';
  };
  let open = false;
  const pending = [];
  const endQ = () => { if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); open = false; } };
  r.setRenderTarget = function (t, ...a) {
    endQ();
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    open = true;
    pending.push({ q, label: label(t) });
    return origSRT.call(this, t, ...a);
  };
  const marks = [];
  try {
    for (let i = 0; i < gpuFrames; i++) {
      frame(e);
      endQ();
      marks.push(pending.length);
    }
  } finally {
    r.setRenderTarget = origSRT;
  }
  const parts = [];
  for (const f of pending) {
    for (let i = 0; i < 200000 && !gl.getQueryParameter(f.q, gl.QUERY_RESULT_AVAILABLE); i++) await sleep();
    parts.push({ label: f.label, ms: gl.getQueryParameter(f.q, gl.QUERY_RESULT) / 1e6 });
    gl.deleteQuery(f.q);
  }
  const gpu = [];
  const passes = {};
  let from = 0;
  for (const to of marks) {
    let tot = 0;
    const byLabel = {};
    for (const p of parts.slice(from, to)) { tot += p.ms; byLabel[p.label] = (byLabel[p.label] || 0) + p.ms; }
    from = to;
    gpu.push(tot);
    for (const [l, ms] of Object.entries(byLabel)) (passes[l] ||= []).push(ms);
  }
  return {
    wall, cpu: median(cpu), gpu: median(gpu),
    passes: Object.fromEntries(Object.entries(passes).map(([l, a]) => [l, median(a)])),
    chunks: e.world.chunkCount, draws: r.info.render.calls,
    disjoint: gl.getParameter(ext.GPU_DISJOINT_EXT),
  };
}

async function bakeCost(e) {
  const gl = e.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const q = gl.createQuery();
  gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
  e.pipeline._bakeWeather(e.pipeline._weatherClock);
  gl.endQuery(ext.TIME_ELAPSED_EXT);
  while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await sleep();
  const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
  gl.deleteQuery(q);
  return ms;
}

async function capture(e, sc, name, compare) {
  place(e, sc);
  for (let i = 0; i < 4; i++) frame(e);
  frame(e);
  const url = e.renderer.domElement.toDataURL('image/png');
  await fetch(STORE, { method: 'POST', body: JSON.stringify({ name, dataUrl: url }) });
  return compare ? diffImages(`${STORE}/${compare}_${sc.name}.png`, url) : null;
}

const agg = (ms) => {
  const passes = {};
  for (const m of ms) for (const [l, v] of Object.entries(m.passes)) (passes[l] ||= []).push(v);
  return {
    wallMs: median(ms.map((m) => m.wall)),
    gpuMs: median(ms.map((m) => m.gpu)),
    cpuMs: median(ms.map((m) => m.cpu)),
    passes: Object.fromEntries(Object.entries(passes).map(([l, a]) => [l, median(a)])),
    chunks: ms[0].chunks, draws: ms[0].draws,
    wallRounds: ms.map((m) => +m.wall.toFixed(2)),
  };
};

const gpuName = (e) => {
  const gl = e.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
};

// ------------------------------------------------------------ single engine
export async function run({ tag = 'run', compare = null, frames = 40, only = null, rounds = 3, engine = null } = {}) {
  const e = engine || window.planetStudio;
  setup(e);
  const results = { tag, gpu: gpuName(e), scenarios: {} };
  for (const sc of scenarios(e.params.radius)) {
    if (only && !only.includes(sc.name)) continue;
    const ms = [];
    for (let k = 0; k < rounds; k++) ms.push(await measure(e, sc, { frames }));
    const res = agg(ms);
    if (sc.mode === 'planet') res.bakeMs = await bakeCost(e);
    res.quality = await capture(e, sc, `${tag}_${sc.name}`, compare);
    results.scenarios[sc.name] = res;
  }
  e.setParam('mode', 'planet');
  await fetch(STORE, { method: 'POST', body: JSON.stringify({ name: tag, json: results }) });
  return results;
}

// ------------------------------------------------------------------ paired
// versions: names of snapshots, or 'live' for the app's engine. Results are
// saved per version as `${tag}__${version}`.
export async function paired({ versions = ['baseline', 'live'], tag = 'paired', compare = 'baseline',
  frames = 40, only = null, rounds = 4 } = {}) {
  const engines = {};
  for (const v of versions) engines[v] = v === 'live' ? window.planetStudio : await snapEngine(v);
  for (const e of Object.values(engines)) setup(e);
  const out = {};
  for (const v of versions) out[v] = { tag: `${tag}__${v}`, gpu: gpuName(engines[v]), scenarios: {} };
  for (const sc of scenarios(DEFAULT_PARAMS.radius)) {
    if (only && !only.includes(sc.name)) continue;
    const ms = Object.fromEntries(versions.map((v) => [v, []]));
    for (let k = 0; k < rounds; k++) {
      const order = k % 2 ? [...versions].reverse() : versions;
      for (const v of order) ms[v].push(await measure(engines[v], sc, { frames }));
    }
    for (const v of versions) {
      const res = agg(ms[v]);
      // compare 'first': against the first version's image from this run
      const ref = compare === 'first' ? `${tag}__${versions[0]}` : compare;
      res.quality = await capture(engines[v], sc, `${tag}__${v}_${sc.name}`, ref);
      out[v].scenarios[sc.name] = res;
    }
  }
  for (const v of versions) {
    engines[v].setParam('mode', 'planet');
    await fetch(STORE, { method: 'POST', body: JSON.stringify({ name: `${tag}__${v}`, json: out[v] }) });
  }
  return out;
}

// quick experiment helper: set up a scenario, then GPU-time `fn` (median ms)
export async function timeFn(fn, { scenario = 'orbit', n = 20, engine = null } = {}) {
  const e = engine || window.planetStudio;
  const r = e.renderer;
  const gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  r.setAnimationLoop(null);
  if (r.domElement.width !== W) {
    r.setPixelRatio(1); r.setSize(W, H, false); e.pipeline.setSize(W, H);
    e.camera.aspect = W / H; e.camera.updateProjectionMatrix();
  }
  const sc = scenarios(e.params.radius).find((s) => s.name === scenario);
  place(e, sc);
  for (let i = 0; i < 4; i++) frame(e);
  const qs = [];
  for (let i = 0; i < n; i++) {
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    fn(e);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    qs.push(q);
  }
  const ms = [];
  for (const q of qs) {
    while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await sleep();
    ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  return +median(ms).toFixed(3);
}

// ------------------------------------------------- fire-and-poll wrappers
// (tool calls time out long before a full run ends)
let job = null;
function launch(p) {
  if (job?.running) return 'busy';
  job = { running: true, res: null, err: null };
  p.then((r) => { job.res = r; }, (e) => { job.err = String(e.stack || e); })
    .finally(() => { job.running = false; });
  return 'started';
}
export const start = (opts) => launch(run(opts));
export const startPaired = (opts) => launch(paired(opts));

const overall = (r) => {
  const s = Object.values(r.scenarios);
  return +(s.reduce((a, v) => a + v.wallMs, 0) / s.length).toFixed(2);
};
export function poll() {
  if (!job || job.running) return null;
  if (job.err) return { err: job.err };
  const r = job.res;
  if (r.scenarios) return { overallWallMs: overall(r), ...fmt(r) };
  return Object.fromEntries(Object.entries(r).map(([v, rv]) => [v, { overallWallMs: overall(rv), ...fmt(rv) }]));
}
export function fmt(r) {
  const n = (x, d = 2) => (x == null ? x : +x.toFixed(d));
  return Object.fromEntries(Object.entries(r.scenarios).map(([k, v]) => [k, {
    wall: n(v.wallMs), gpu: n(v.gpuMs), cpu: n(v.cpuMs),
    passes: Object.fromEntries(Object.entries(v.passes).map(([a, m]) => [a, n(m)])),
    bake: n(v.bakeMs), chunks: v.chunks, draws: v.draws, rounds: v.wallRounds,
    q: v.quality && { mae: n(v.quality.maePct, 4), ssim: n(v.quality.ssim, 5),
      bad: n(v.quality.badPct, 3), psnr: n(v.quality.psnr, 1) },
  }]));
}

// ------------------------------------------------------------ image diff
async function loadPixels(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

// MAE (% of full scale), PSNR (dB), % of pixels off by > 8/255 in any
// channel, and block SSIM on luma (8x8 windows)
export async function diffImages(refUrl, curUrl) {
  const a = await loadPixels(refUrl);
  const b = await loadPixels(curUrl);
  let abs = 0, sq = 0, bad = 0;
  const n = W * H;
  const la = new Float32Array(n), lb = new Float32Array(n);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    let big = false;
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c];
      abs += Math.abs(d); sq += d * d;
      if (Math.abs(d) > 8) big = true;
    }
    if (big) bad++;
    la[p] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    lb[p] = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
  }
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ssim = 0, blocks = 0;
  for (let by = 0; by + 8 <= H; by += 8) {
    for (let bx = 0; bx + 8 <= W; bx += 8) {
      let ma = 0, mb = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = (by + y) * W + bx + x; ma += la[p]; mb += lb[p]; }
      ma /= 64; mb /= 64;
      let va = 0, vb = 0, cov = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = (by + y) * W + bx + x;
        const da = la[p] - ma, db = lb[p] - mb;
        va += da * da; vb += db * db; cov += da * db;
      }
      va /= 63; vb /= 63; cov /= 63;
      ssim += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks++;
    }
  }
  const mse = sq / (n * 3);
  return {
    maePct: (abs / (n * 3) / 255) * 100,
    psnr: mse > 0 ? 10 * Math.log10((255 * 255) / mse) : Infinity,
    badPct: (bad / n) * 100,
    ssim: ssim / blocks,
  };
}
