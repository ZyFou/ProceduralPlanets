// In-page benchmark: scenarios, GPU / CPU timing, captures, flythrough, VRAM.
// Driven by bench/run.mjs (CDP). Every function returns plain JSON.
//
// Scenes render at a fixed 1920x1080 (pixel ratio 1), fixed shader time and
// fixed cameras, so frames are reproducible across runs and checkouts. GPU
// time per pass comes from EXT_disjoint_timer_query_webgl2: each
// setRenderTarget() starts a new query labelled with the field (pipeline /
// passes / planet) that owns the target.

import * as THREE from 'three';
import { Planet, PlanetRenderer, PlanetViewer } from 'procedural-planets';

// console errors (shader compile failures...) are attached to the result of
// the scenario they happened in: a broken frame must never pass as "fast"
const errors = [];
const origError = console.error;
console.error = (...a) => {
  errors.push(a.map((x) => (typeof x === 'string' ? x : x?.message ?? String(x))).join(' ').slice(0, 400));
  origError.apply(console, a);
};
const takeErrors = () => errors.splice(0, errors.length);

export const W = 1920;
export const H = 1080;
const T_SHADER = 20;
const T_CLOUD = 12;

// yield to the event loop without timer throttling (query results and
// parallel shader compiles only progress between tasks)
const tick = () => new Promise((r) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => { c.port1.close(); r(); };
  c.port2.postMessage(0);
});
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
// GPU timings are only ever INFLATED by other work sharing the GPU (another
// tab, the compositor): a low percentile tracks the true cost more robustly
// than the median when the machine is not idle
const low = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * 0.2)] : 0; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const round = (x, d = 3) => (x == null || !Number.isFinite(x) ? x : +x.toFixed(d));

// ------------------------------------------------------------------ scenes
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  document.body.appendChild(c);
  return c;
}

function viewerScene(planetOpts, w, h) {
  const canvas = makeCanvas(w, h);
  const viewer = new PlanetViewer({ canvas, planet: planetOpts, controls: false, autoStart: false, pixelRatio: 1 });
  viewer.renderer.setPixelRatio(1);
  viewer.renderer.setSize(w, h, false);
  viewer.camera.aspect = w / h;
  viewer.camera.updateProjectionMatrix();
  return {
    kind: 'viewer',
    canvas,
    viewer,
    renderer: viewer.renderer,
    camera: viewer.camera,
    planets: [viewer.planet],
    pr: viewer.planetRenderer,
    frame: (dt = 0) => viewer._renderFrame(dt),
    resize(w2, h2) {
      canvas.style.width = `${w2}px`;
      canvas.style.height = `${h2}px`;
      viewer.renderer.setSize(w2, h2, false);
      viewer.camera.aspect = w2 / h2;
      viewer.camera.updateProjectionMatrix();
    },
    dispose() { viewer.dispose(); canvas.remove(); },
  };
}

function embedScene(build, w, h) {
  const canvas = makeCanvas(w, h);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  const camera = new THREE.PerspectiveCamera(50, w / h, 1, 1e7);
  const pr = new PlanetRenderer(renderer, { autoUpdate: false });
  const planets = build(scene, camera);
  return {
    kind: 'embed',
    canvas,
    renderer,
    camera,
    planets,
    pr,
    scene,
    frame(dt = 0) {
      renderer.info.reset();
      renderer.render(scene, camera);
      pr.render(scene, camera, { delta: dt });
    },
    resize(w2, h2) {
      canvas.style.width = `${w2}px`;
      canvas.style.height = `${h2}px`;
      renderer.setSize(w2, h2, false);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const p of planets) p.dispose();
      scene.traverse((o) => { if (o.isMesh && !o.isPlanet) { o.geometry.dispose(); o.material.dispose(); } });
      pr.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

// ---- embedded scenes ------------------------------------------------------
const EMBEDS = {
  // the solar-system example: star far away, terran planet close, ringed giant
  // mid distance, ordinary meshes occluding and occluded
  system(scene, camera) {
    const sun = new Planet({ type: 'star', preset: 'sun', radius: 2500 });
    sun.position.set(90000, 14000, 40000);
    const earth = new Planet({ preset: 'terran', seed: 2024, lightSource: sun });
    const giant = new Planet({ preset: 'ringed', radius: 4500, lightSource: sun });
    giant.position.set(-16000, 1800, -24000);
    scene.add(sun, earth, giant);
    const light = new THREE.DirectionalLight(0xfff4e0, 2.5);
    light.position.copy(sun.position);
    scene.add(light, new THREE.AmbientLight(0x223344, 0.4));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(420, 64, 32), new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.95 }));
    moon.position.set(-2600, 900, -2600);
    const ship = new THREE.Mesh(new THREE.BoxGeometry(160, 40, 60), new THREE.MeshStandardMaterial({ color: 0xd0d6de }));
    ship.position.set(2150, 700, 3450);
    scene.add(moon, ship);
    camera.position.set(3200, 1300, 5600);
    camera.lookAt(0, 0, 0);
    return [sun, earth, giant];
  },
  // many small bodies (20..160 px across): the case impostors are for
  swarm(scene, camera) {
    const sun = new Planet({ type: 'star', preset: 'sun', radius: 3000 });
    sun.position.set(0, 20000, -260000);
    scene.add(sun);
    const presets = ['terran', 'desert', 'ice', 'moon', 'lava', 'ocean', 'mars', 'gasGiant', 'ringed', 'iceGiant', 'alien', 'swamp'];
    const planets = [sun];
    presets.forEach((preset, i) => {
      const a = (i / presets.length) * Math.PI * 1.1 - Math.PI * 0.55;
      const d = 22000 + (i % 4) * 26000 + i * 3500;
      const gas = ['gasGiant', 'ringed', 'iceGiant'].includes(preset);
      const p = new Planet({ preset, seed: 100 + i, radius: gas ? 4200 : 2000, lightSource: sun });
      p.position.set(Math.sin(a) * d, ((i % 3) - 1) * d * 0.12, -Math.cos(a) * d);
      scene.add(p);
      planets.push(p);
    });
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    return planets;
  },
};

// ---- cameras for the single-planet (viewer) scenarios ---------------------
const D = new THREE.Vector3(0.3, 0.4, 0.87).normalize();

function surfaceSpot(planet) {
  // the highest terrain in a small patch around D (mountains: worst case LOD)
  const R = planet.get('radius');
  const t1 = new THREE.Vector3(0, 1, 0).cross(D).normalize();
  const t2 = D.clone().cross(t1).normalize();
  let best = D.clone(), bestR = -Infinity;
  for (let i = -6; i <= 6; i++) {
    for (let j = -6; j <= 6; j++) {
      const d = D.clone().addScaledVector(t1, i * 0.012).addScaledVector(t2, j * 0.012).normalize();
      const r = planet.getSurfaceRadius(d);
      if (r > bestR) { bestR = r; best = d; }
    }
  }
  const sea = R + planet.get('seaLevel') * planet.get('heightScale');
  return { dir: best, ground: Math.max(bestR, planet.get('waterEnabled') ? sea : 0) };
}

function placeCamera(camera, planet, kind) {
  const R = planet.get('radius');
  camera.up.set(0, 1, 0);
  const tan = new THREE.Vector3(0, 1, 0).cross(D).normalize();
  if (kind === 'orbit') {
    camera.position.set(R * 2.4, R * 1.4, R * 2.4);
    camera.lookAt(0, 0, 0);
  } else if (kind === 'near') {
    camera.position.copy(D).multiplyScalar(R * 1.4);
    camera.lookAt(0, 0, 0);
  } else if (kind === 'low') {
    const low = D.clone().multiplyScalar(R + 200);
    camera.position.copy(low);
    camera.lookAt(low.clone().addScaledVector(tan, 1000).addScaledVector(D, -170));
  } else if (kind === 'surface') {
    const { dir, ground } = surfaceSpot(planet);
    const t = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const pos = dir.clone().multiplyScalar(ground + 28);
    camera.position.copy(pos);
    camera.lookAt(pos.clone().addScaledVector(t, 600).addScaledVector(dir, -120));
  } else if (kind === 'clouds') {
    const cd = new THREE.Vector3(0.5126, 0.2014, 0.8347).normalize();
    const ct = new THREE.Vector3(0, 1, 0).cross(cd).normalize();
    const cpos = cd.clone().addScaledVector(ct, 0.12).normalize().multiplyScalar(R + 180);
    camera.position.copy(cpos);
    camera.lookAt(cd.clone().multiplyScalar(R + 45));
  }
  camera.updateMatrixWorld();
}

export const SCENARIOS = {
  'terran-orbit': { planet: { preset: 'terran', seed: 1337 }, cam: 'orbit' },
  'terran-near': { planet: { preset: 'terran', seed: 1337 }, cam: 'near' },
  'terran-low': { planet: { preset: 'terran', seed: 1337 }, cam: 'low' },
  'terran-surface': { planet: { preset: 'terran', seed: 1337 }, cam: 'surface' },
  'terran-clouds': { planet: { preset: 'terran', seed: 1337 }, cam: 'clouds' },
  'ocean-near': { planet: { preset: 'ocean', seed: 1337 }, cam: 'near' },
  'moon-near': { planet: { preset: 'moon', seed: 1337 }, cam: 'near' },
  'gas-orbit': { planet: { preset: 'gasGiant', seed: 1337 }, cam: 'orbit' },
  'ringed-orbit': { planet: { preset: 'ringed', seed: 1337 }, cam: 'orbit' },
  'star-orbit': { planet: { preset: 'sun', seed: 1337 }, cam: 'orbit' },
  system: { embed: 'system' },
  swarm: { embed: 'swarm' },
};

function setTimes(sc) {
  for (const p of sc.planets) {
    p.time = T_SHADER;
    p.cloudTime = T_CLOUD;
  }
}

function build(name, w = W, h = H) {
  const def = SCENARIOS[name];
  if (!def) throw new Error(`unknown scenario ${name}`);
  const sc = def.embed ? embedScene(EMBEDS[def.embed], w, h) : viewerScene(def.planet, w, h);
  if (!def.embed) placeCamera(sc.camera, sc.planets[0], def.cam);
  sc.name = name;
  setTimes(sc);
  return sc;
}

// planets / renderer still streaming or compiling (new engines expose this;
// older ones never report busy)
function busy(sc) {
  if ((sc.pr.pending ?? 0) > 0) return true;
  // (a terrestrial planet also waits for its fine terrain variant, compiled
  // in the background: measurements must not catch the switch)
  return sc.planets.some((p) => (p.world?.pendingCount ?? 0) > 0 || p.loading === true
    || (p.params?.mode === 'planet' && p.world?.useLowVarying === false));
}

function sync(renderer) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}

// ------------------------------------------------------------- GPU timing
function targetLabels(sc) {
  const map = new Map();
  const seen = new Set();
  const scan = (obj, prefix, depth) => {
    if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 3) return;
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) {
      if (!v || typeof v !== 'object') continue;
      if (v.isWebGLRenderTarget) { if (!map.has(v)) map.set(v, prefix + k); continue; }
      if (Array.isArray(v)) {
        v.forEach((x) => { if (x?.isWebGLRenderTarget && !map.has(x)) map.set(x, prefix + k); else if (x && typeof x === 'object' && !x.isObject3D) scan(x, `${prefix}${k}.`, depth + 1); });
        continue;
      }
      if (v instanceof Map) { for (const x of v.values()) if (x && typeof x === 'object' && !x.isObject3D) scan(x, `${prefix}${k}.`, depth + 1); continue; }
      if (v.isObject3D || v.isMaterial || v.isTexture || v.isBufferGeometry || v.isWebGLRenderer || v.isCamera) continue;
      if (k === 'uniforms' || k === 'params' || k === 'renderer') continue;
      scan(v, `${prefix}${k}.`, depth + 1);
    }
  };
  scan(sc.pr.pipeline, '', 0);
  scan(sc.pr, 'renderer.', 1);
  sc.planets.forEach((p) => { scan(p._passes, 'passes.', 1); scan(p, 'planet.', 1); });
  return map;
}

class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.open = null;
    this.marks = [];
  }
  begin(label) {
    if (!this.ext) return;
    this.end();
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = { q, label };
  }
  end() {
    if (!this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }
  frameEnd() { this.end(); this.marks.push(this.pending.length); }
  async collect() {
    const gl = this.gl;
    const parts = [];
    for (const f of this.pending) {
      for (let i = 0; i < 100000 && !gl.getQueryParameter(f.q, gl.QUERY_RESULT_AVAILABLE); i++) await tick();
      parts.push({ label: f.label, ms: gl.getQueryParameter(f.q, gl.QUERY_RESULT) / 1e6 });
      gl.deleteQuery(f.q);
    }
    const disjoint = this.ext ? gl.getParameter(this.ext.GPU_DISJOINT_EXT) : false;
    const frames = [];
    let from = 0;
    for (const to of this.marks) {
      const byLabel = {};
      let total = 0;
      for (const p of parts.slice(from, to)) { total += p.ms; byLabel[p.label] = (byLabel[p.label] || 0) + p.ms; }
      frames.push({ total, byLabel });
      from = to;
    }
    this.pending = [];
    this.marks = [];
    return { frames, disjoint };
  }
}

// run fn() with every setRenderTarget() starting a labelled GPU query
async function timePasses(sc, nFrames, fn) {
  const r = sc.renderer;
  const labels = targetLabels(sc);
  const timer = new GpuTimer(r);
  const orig = r.setRenderTarget;
  r.setRenderTarget = function (t, ...a) {
    timer.begin(t ? labels.get(t) ?? 'other' : 'screen');
    return orig.call(this, t, ...a);
  };
  try {
    for (let i = 0; i < nFrames; i++) {
      timer.begin('frame-start');
      fn(i);
      timer.frameEnd();
    }
  } finally {
    r.setRenderTarget = orig;
  }
  return timer.collect();
}

// whole-frame GPU time per frame (no per-pass split)
async function timeFrames(sc, nFrames, fn, { yieldEvery = 30 } = {}) {
  const timer = new GpuTimer(sc.renderer);
  const cpu = [];
  for (let i = 0; i < nFrames; i++) {
    timer.begin('frame');
    const t0 = performance.now();
    fn(i);
    cpu.push(performance.now() - t0);
    timer.frameEnd();
    if (i % yieldEvery === yieldEvery - 1) await tick();
  }
  const { frames, disjoint } = await timer.collect();
  return { gpu: frames.map((f) => f.total), cpu, disjoint };
}

function vram(sc) {
  const t = window.__ppTrace;
  if (!t) return null;
  const v = t.vram(sc.renderer.getContext());
  return {
    totalMB: round(v.total / 1048576, 2),
    textureMB: round(v.texture / 1048576, 2),
    renderbufferMB: round(v.renderbuffer / 1048576, 2),
    bufferMB: round(v.buffer / 1048576, 2),
    top: t.ledger(sc.renderer.getContext()).slice(0, 12),
  };
}

function stats(sc) {
  const info = sc.renderer.info;
  const chunks = sc.planets.reduce((a, p) => a + (p.world?.chunkCount ?? 0), 0);
  return {
    draws: info.render.calls,
    triangles: info.render.triangles,
    chunks,
    impostors: sc.pr.info?.impostors ?? 0,
    planetsDrawn: sc.pr.info?.planets ?? 0,
    programs: info.programs?.length ?? 0,
    textures: info.memory.textures,
    geometries: info.memory.geometries,
  };
}

// ---------------------------------------------------------------- warm-up
// Frames at ~120 Hz until nothing is compiling / streaming any more (or the
// deadline). maxFrameMs = the worst main-thread stall of a frame (a blocking
// compile shows up here), readyMs = until the first frame that drew
// everything (background compiles show up here).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function warm(sc, { minFrames = 12, deadline = 60000 } = {}) {
  // the host's own materials (embed scenes) are the host app's business:
  // compiled up front like an app would, so first-show stalls measure planets
  if (sc.scene) await sc.renderer.compileAsync(sc.scene, sc.camera);
  const t0 = performance.now();
  let maxFrame = 0;
  let readyMs = null;
  let n = 0;
  for (;; n++) {
    const f0 = performance.now();
    sc.frame(0);
    sync(sc.renderer);
    maxFrame = Math.max(maxFrame, performance.now() - f0);
    if (n === 0) sc.firstFrameMs = performance.now() - t0;
    const b = busy(sc);
    if (!b && readyMs === null) readyMs = performance.now() - t0;
    if (n >= minFrames && !b) break;
    if (performance.now() - t0 > deadline) break;
    await wait(8);
  }
  return { frames: n + 1, ms: performance.now() - t0, maxFrameMs: maxFrame, firstFrameMs: sc.firstFrameMs, readyMs };
}

// Sustained load before timing: GPU clocks ramp up over a few hundred ms of
// continuous work (short bursts measure a half-asleep GPU).
async function gpuLoad(sc, ms = 700) {
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < ms) {
    sc.frame(0);
    if (++n % 4 === 0) { sync(sc.renderer); await tick(); }
  }
  sync(sc.renderer);
}

// ------------------------------------------------------------ calibration
// A fixed fragment workload (1920x1080, a few hundred ALU ops per pixel):
// how fast this GPU is right now. Recorded with every run so a contended or
// throttled run shows up in the report instead of passing as a regression.
export async function calibrate({ frames = 40 } = {}) {
  const canvas = makeCanvas(W, H);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vUv;
      void main() {
        vec2 p = vUv * 7.0; float a = 0.0;
        for (int i = 0; i < 48; i++) { p = vec2(p.x * p.x - p.y * p.y, 2.0 * p.x * p.y) * 0.5 + vUv; a += fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        gl_FragColor = vec4(vec3(a / 48.0), 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sc = { renderer, frame: () => renderer.render(scene, cam) };
  await gpuLoad(sc, 400);
  const t = await timeFrames(sc, frames, () => sc.frame());
  mat.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  canvas.remove();
  return { lowMs: round(low(t.gpu)), medianMs: round(median(t.gpu)) };
}

// ------------------------------------------------------------------ public
export function info() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const out = {
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile'),
    scenarios: Object.keys(SCENARIOS),
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}

/**
 * Steady-state measurement of one scenario: setup cost, CPU submit time,
 * pipelined wall time, GPU time per pass, stats, VRAM and a PNG capture.
 */
export async function run(name, { rounds = 3, gpuFrames = 40, wallFrames = 40, capture = true } = {}) {
  takeErrors();
  const tBuild = performance.now();
  const sc = build(name);
  const constructMs = performance.now() - tBuild;
  try {
    const warmup = await warm(sc);
    await gpuLoad(sc);
    const rs = [];
    for (let k = 0; k < rounds; k++) {
      // CPU submission time (sync every 4th frame so the queue stays short)
      const cpu = [];
      for (let i = 0; i < 16; i++) {
        const t0 = performance.now();
        sc.frame(0);
        cpu.push(performance.now() - t0);
        if (i % 4 === 3) sync(sc.renderer);
      }
      sync(sc.renderer);
      // pipelined wall time
      const w0 = performance.now();
      for (let i = 0; i < wallFrames; i++) sc.frame(0);
      sync(sc.renderer);
      const wall = (performance.now() - w0) / wallFrames;
      // GPU per pass
      const g = await timePasses(sc, gpuFrames, () => sc.frame(0));
      const passes = {};
      for (const f of g.frames) for (const [l, ms] of Object.entries(f.byLabel)) (passes[l] ||= []).push(ms);
      rs.push({
        cpu: median(cpu), wall, gpu: low(g.frames.map((f) => f.total)), gpuMedian: median(g.frames.map((f) => f.total)),
        passes: Object.fromEntries(Object.entries(passes).map(([l, a]) => [l, low(a)])),
        disjoint: g.disjoint,
      });
      await tick();
    }
    const passes = {};
    for (const r of rs) for (const [l, v] of Object.entries(r.passes)) (passes[l] ||= []).push(v);
    sc.frame(0);
    const st = stats(sc);
    const res = {
      name,
      constructMs: round(constructMs, 1),
      warmup: { frames: warmup.frames, ms: round(warmup.ms, 1), maxFrameMs: round(warmup.maxFrameMs, 1), firstFrameMs: round(warmup.firstFrameMs, 1), readyMs: round(warmup.readyMs, 1) },
      cpuMs: round(median(rs.map((r) => r.cpu))),
      wallMs: round(median(rs.map((r) => r.wall))),
      gpuMs: round(median(rs.map((r) => r.gpu))),
      gpuMedianMs: round(median(rs.map((r) => r.gpuMedian))),
      gpuRounds: rs.map((r) => round(r.gpu)),
      passes: Object.fromEntries(Object.entries(passes).map(([l, a]) => [l, round(median(a))]).sort((a, b) => b[1] - a[1])),
      disjoint: rs.some((r) => r.disjoint),
      stats: st,
      vram: vram(sc),
    };
    res.errors = takeErrors();
    if (capture) {
      setTimes(sc);
      for (let i = 0; i < 3; i++) sc.frame(0);
      sc.frame(0);
      res.png = sc.renderer.domElement.toDataURL('image/png');
    }
    return res;
  } finally {
    sc.dispose();
  }
}

/**
 * Time advancing at 60 Hz (weather keyframes re-bake, clouds drift): per-frame
 * GPU time -> mean / p50 / p95 / p99 / max and the spikes over the median.
 */
export async function animated(name, { frames = 360 } = {}) {
  const sc = build(name);
  try {
    await warm(sc);
    await gpuLoad(sc);
    const t = await timeFrames(sc, frames, () => sc.frame(1 / 60));
    const p50 = median(t.gpu);
    return {
      name,
      frames,
      gpu: {
        mean: round(t.gpu.reduce((a, b) => a + b, 0) / frames),
        p50: round(p50), p95: round(pct(t.gpu, 0.95)), p99: round(pct(t.gpu, 0.99)), max: round(Math.max(...t.gpu)),
        spikes: t.gpu.filter((x) => x > p50 * 1.5 + 0.5).length,
      },
      cpu: { p50: round(median(t.cpu)), p99: round(pct(t.cpu, 0.99)), max: round(Math.max(...t.cpu)) },
      series: t.gpu.map((x) => round(x, 2)),
      disjoint: t.disjoint,
    };
  } finally {
    sc.dispose();
  }
}

// ------------------------------------------------------------- flythrough
// Orbit -> mountain top -> skim along the surface. Time advances 1/60 s per
// frame. Pass 1 times every frame (GPU / CPU / LOD churn); pass 2 (lower
// resolution, clouds off, time frozen) measures LOD POPS: every frame is drawn
// twice at the same camera, first with the previous frame's LOD (world.update
// frozen) then with the updated one; the pixels that change are the pop.
function flyPath(planet, n) {
  const R = planet.get('radius');
  const { dir, ground } = surfaceSpot(planet);
  const up0 = new THREE.Vector3(R * 2.4, R * 1.4, R * 2.4).normalize();
  const tan = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
  const descend = Math.floor(n * 0.62);
  const out = [];
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    let pos, look;
    if (i < descend) {
      const s = i / (descend - 1);
      const e = s * s * (3 - 2 * s);
      // altitude falls exponentially: from 2.67 R above ground to 40 units
      const alt = Math.exp(Math.log(R * 2.67) * (1 - e) + Math.log(40) * e);
      q.setFromUnitVectors(up0, dir);
      const d = up0.clone().applyQuaternion(new THREE.Quaternion().slerp(q, Math.min(1, e * 1.15)));
      pos = d.clone().multiplyScalar(ground + alt);
      // look at the planet centre far away, at the horizon close in
      const horizon = pos.clone().addScaledVector(tan, 800).addScaledVector(d, -160);
      look = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, 0, 0), horizon, Math.pow(e, 3));
    } else {
      const s = (i - descend) / Math.max(1, n - descend - 1);
      const ang = s * 0.06;   // radians along the surface (~120 units at R=2000)
      const d = dir.clone().applyAxisAngle(new THREE.Vector3().crossVectors(dir, tan).normalize(), ang);
      const t2 = new THREE.Vector3(0, 1, 0).cross(d).normalize();
      pos = d.clone().multiplyScalar(Math.max(planet.getSurfaceRadius(d), ground - 10) + 40);
      look = pos.clone().addScaledVector(t2, 800).addScaledVector(d, -160);
    }
    out.push({ pos, look });
  }
  return out;
}

function setCam(camera, { pos, look }) {
  camera.up.set(0, 1, 0);
  camera.position.copy(pos);
  camera.lookAt(look);
  camera.updateMatrixWorld();
}

function chunkKeys(sc) {
  const s = new Set();
  sc.planets.forEach((p, i) => { for (const k of p.world?.chunks?.keys?.() ?? []) s.add(`${i}|${k}`); });
  return s;
}

export async function flythrough({ frames = 360, name = 'terran-orbit', popFrames = 360, popW = 960, popH = 540, worldSetup = null } = {}) {
  const setup = (sc) => { if (worldSetup) for (const p of sc.planets) if (p.world) worldSetup(p.world); };
  // ---- pass 1: timing
  let sc = build(name);
  setup(sc);
  const path = flyPath(sc.planets[0], frames);
  const perFrame = [];
  let disjoint = false;
  try {
    setCam(sc.camera, path[0]);
    await warm(sc);
    const timer = new GpuTimer(sc.renderer);
    let prev = chunkKeys(sc);
    for (let i = 0; i < frames; i++) {
      setCam(sc.camera, path[i]);
      timer.begin('frame');
      const t0 = performance.now();
      sc.frame(1 / 60);
      const cpu = performance.now() - t0;
      timer.frameEnd();
      const cur = chunkKeys(sc);
      let churn = 0;
      for (const k of cur) if (!prev.has(k)) churn++;
      for (const k of prev) if (!cur.has(k)) churn++;
      prev = cur;
      const pending = sc.planets.reduce((a, p) => a + (p.world?.pendingCount ?? 0), 0);
      perFrame.push({ cpu, churn, chunks: cur.size, pending });
      if (i % 20 === 19) await tick();
    }
    const res = await timer.collect();
    res.frames.forEach((f, i) => { perFrame[i].gpu = f.total; });
    disjoint = res.disjoint;
  } finally {
    sc.dispose();
  }
  const gpu = perFrame.map((f) => f.gpu);
  const cpu = perFrame.map((f) => f.cpu);
  const p50 = median(gpu);

  // ---- pass 2: pops
  sc = build(name, popW, popH);
  setup(sc);
  const pops = [];
  try {
    for (const p of sc.planets) p.set?.({ cloudsEnabled: false });
    const pp = flyPath(sc.planets[0], popFrames);
    setCam(sc.camera, pp[0]);
    await warm(sc);
    const gl = sc.renderer.getContext();
    const a = new Uint8Array(popW * popH * 4);
    const b = new Uint8Array(popW * popH * 4);
    const worlds = sc.planets.map((p) => p.world).filter(Boolean);
    for (let i = 0; i < popFrames; i++) {
      setCam(sc.camera, pp[i]);
      // A: previous LOD
      const saved = worlds.map((w) => w.update);
      worlds.forEach((w) => { w.update = () => {}; });
      sc.frame(0);
      gl.readPixels(0, 0, popW, popH, gl.RGBA, gl.UNSIGNED_BYTE, a);
      worlds.forEach((w, k) => { w.update = saved[k]; });
      // B: updated LOD (same camera)
      sc.frame(0);
      gl.readPixels(0, 0, popW, popH, gl.RGBA, gl.UNSIGNED_BYTE, b);
      let sum = 0, big = 0;
      for (let k = 0; k < a.length; k += 8) {
        const la = 0.299 * a[k] + 0.587 * a[k + 1] + 0.114 * a[k + 2];
        const lb = 0.299 * b[k] + 0.587 * b[k + 1] + 0.114 * b[k + 2];
        const d = Math.abs(la - lb);
        sum += d;
        if (d > 10) big++;
      }
      const n = a.length / 8;
      pops.push({ mean: sum / n, bigPct: (big / n) * 100 });
      // settle any streaming this camera triggered (not a pop: same LOD)
      if (i % 10 === 9) await tick();
    }
  } finally {
    sc.dispose();
  }
  const popPct = pops.map((p) => p.bigPct);
  return {
    frames,
    gpu: {
      p50: round(p50), p95: round(pct(gpu, 0.95)), p99: round(pct(gpu, 0.99)), max: round(Math.max(...gpu)),
      hitches: gpu.filter((x) => x > Math.max(p50 * 2, p50 + 4)).length,
    },
    cpu: { p50: round(median(cpu)), p99: round(pct(cpu, 0.99)), max: round(Math.max(...cpu)) },
    lod: {
      churnTotal: perFrame.reduce((a, f) => a + f.churn, 0),
      churnMax: Math.max(...perFrame.map((f) => f.churn)),
      chunksMax: Math.max(...perFrame.map((f) => f.chunks)),
      pendingMax: Math.max(...perFrame.map((f) => f.pending)),
    },
    pops: {
      framesWithPops: popPct.filter((x) => x > 0.05).length,
      maxPct: round(Math.max(...popPct), 3),
      sumPct: round(popPct.reduce((a, b) => a + b, 0), 3),
      meanLuma: round(pops.reduce((a, p) => a + p.mean, 0) / pops.length, 4),
    },
    series: {
      gpu: gpu.map((x) => round(x, 2)),
      cpu: cpu.map((x) => round(x, 2)),
      churn: perFrame.map((f) => f.churn),
      chunks: perFrame.map((f) => f.chunks),
      popPct: popPct.map((x) => round(x, 3)),
    },
    disjoint,
  };
}

// ---- experiments (bench/exp.mjs) -------------------------------------------
export { build, warm, gpuLoad, timePasses, timeFrames, sync, tick, median, THREE };
