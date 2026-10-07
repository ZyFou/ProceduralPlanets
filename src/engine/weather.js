import * as THREE from 'three';

// ============================================================================
// PlanetWeather — regional, timed weather on a terrestrial planet.
//
// The global cloud field (baked weather cubemap) is the planet's background
// climate. Weather SYSTEMS are local overlays evaluated analytically by the
// cloud shaders (CLOUD_FIELD_GLSL.cloudWeather): every system is a spherical
// cap that can thicken, tower, rain, flash or clear the clouds under it.
//
//   storm      thunderstorm cluster: deep convective towers, rain, lightning
//   hurricane  tropical cyclone: clear eye, eyewall, spiral rain bands, spin
//   rain       stratiform rain: a flat grey overcast deck with steady rain
//   clear      high pressure: dissolves the clouds under it
//
// Three sources feed the same GPU slots (MAX_WEATHER_SYSTEMS, in this order):
//   runtime     planet.weather.add() — scripted, timed events
//   declared    params.weatherSystems — saved with the planet (studio)
//   procedural  stormCount / hurricaneCount — systems that form, travel and
//               dissipate on their own, deterministic from the seed
//
// Every system has a lifecycle on the weather clock (planet.weather.time,
// seconds x weatherSpeed): start, fadeIn, duration, fadeOut, optional
// period (repeats). While forming / dissipating a system grows / shrinks as
// well as fading. Systems move along great circles (heading, speed) and
// hurricanes spin. Lightning strikes are scheduled here on the CPU (Poisson
// process per system) and handed to the cloud + composite passes as a few
// point flashes and bolt polylines; each strike also fires a 'lightning'
// event on the Planet (for thunder audio, gameplay...).
// ============================================================================

export const MAX_WEATHER_SYSTEMS = 8;
export const MAX_FLASHES = 4;
export const MAX_BOLTS = 2;
export const BOLT_POINTS = 8;

export const WEATHER_TYPES = Object.freeze(['storm', 'hurricane', 'rain', 'clear']);
const KIND = { storm: 0, hurricane: 1, rain: 2, clear: 3 };

// per-type defaults (radius in degrees of arc, spin in rad / s)
const TYPE_DEFAULTS = {
  storm:     { radius: 6,  coverage: 0.95, rain: 0.9,  lightning: 1.0, tower: 1.0,  eye: 0,     spin: 0 },
  hurricane: { radius: 10, coverage: 1.0,  rain: 1.0,  lightning: 0.5, tower: 0.85, eye: 0.075, spin: 0.12 },
  rain:      { radius: 12, coverage: 0.9,  rain: 0.75, lightning: 0.0, tower: 0.1,  eye: 0,     spin: 0 },
  clear:     { radius: 10, coverage: 1.0,  rain: 0,    lightning: 0.0, tower: 0,    eye: 0,     spin: 0 },
};

const NUMERIC_FIELDS = ['lat', 'lon', 'radius', 'intensity', 'coverage', 'rain', 'lightning', 'tower', 'eye',
  'spin', 'heading', 'speed', 'start', 'duration', 'fadeIn', 'fadeOut', 'period'];

// strikes per second of a full-strength system at lightningAmount 1
const STRIKE_RATE = 1.4;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// deterministic hash -> [0, 1) (integers in, mulberry32-style mixing)
function hash(...ints) {
  let h = 0x9e3779b9;
  for (const v of ints) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Planet-local unit direction for a latitude / longitude in degrees (y = north pole). */
export function latLonToDirection(lat, lon, target = new THREE.Vector3()) {
  const la = lat * DEG, lo = lon * DEG;
  return target.set(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
}

/** { lat, lon } in degrees of a planet-local direction. */
export function directionToLatLon(dir) {
  const d = _t1.copy(dir).normalize();
  return { lat: Math.asin(clamp(d.y, -1, 1)) / DEG, lon: Math.atan2(d.z, d.x) / DEG };
}

/**
 * Validate / complete one weather system definition. Returns a new plain
 * object (JSON-safe: duration 0 = permanent) or null when it is unusable.
 */
export function normalizeWeatherSystem(input) {
  if (!input || typeof input !== 'object') return null;
  const type = WEATHER_TYPES.includes(input.type) ? input.type : null;
  if (!type) return null;
  const def = TYPE_DEFAULTS[type];
  let lat = input.lat, lon = input.lon;
  if (input.direction && Number.isFinite(input.direction.x)) {
    ({ lat, lon } = directionToLatLon(input.direction));
  }
  const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const out = {
    type,
    lat: clamp(num(lat, 0), -90, 90),
    lon: num(lon, 0),
    radius: clamp(num(input.radius, def.radius), 0.5, 60),
    intensity: clamp(num(input.intensity, 1), 0, 1),
    coverage: clamp(num(input.coverage, def.coverage), 0, 1),
    rain: clamp(num(input.rain, def.rain), 0, 1),
    lightning: clamp(num(input.lightning, def.lightning), 0, 2),
    tower: clamp(num(input.tower, def.tower), 0, 1),
    eye: clamp(num(input.eye, def.eye), 0, 0.3),
    // hurricanes turn counter-clockwise (seen from above) in the north
    spin: num(input.spin, def.spin * (num(lat, 0) < 0 ? -1 : 1)),
    heading: num(input.heading, 0),
    speed: num(input.speed, 0),
    start: num(input.start, 0),
    duration: Math.max(0, num(input.duration, 0) === Infinity ? 0 : num(input.duration, 0)),
    fadeIn: Math.max(0, num(input.fadeIn, 0)),
    fadeOut: Math.max(0, num(input.fadeOut, 0)),
    period: Math.max(0, num(input.period, 0)),
  };
  if (typeof input.id === 'string' || typeof input.id === 'number') out.id = input.id;
  if (typeof input.name === 'string') out.name = input.name;
  return out;
}

/** Normalise the `weatherSystems` parameter: an array of definitions. */
export function normalizeWeatherSystems(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value) {
    const s = normalizeWeatherSystem(item);
    if (s) out.push(s);
  }
  return out;
}

// local time of a system on its own cycle (-1 = not alive now)
function localTime(sys, t) {
  let lt = t - sys.start;
  if (lt < 0) return -1;
  if (sys.period > 0) lt %= sys.period;
  if (sys.duration > 0 && lt > sys.duration) return -1;
  return lt;
}

// fade envelope 0..1 at local time lt
function envelope(sys, lt) {
  const fin = sys.fadeIn > 0 ? smooth(lt / sys.fadeIn) : 1;
  const fout = sys.duration > 0 && sys.fadeOut > 0 ? smooth((sys.duration - lt) / sys.fadeOut) : 1;
  return Math.min(fin, fout);
}

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);

// orthonormal tangent frame (east, north) at a unit direction
function tangentFrame(d, east, north) {
  east.crossVectors(d, Math.abs(d.y) > 0.999 ? _X : _Y).normalize();
  north.crossVectors(east, d).normalize();
}

/**
 * Evaluate a definition at weather time t into `out` (reused objects):
 * centre direction (moved along its track), strength (intensity x fades),
 * effective radius (systems grow while they form), spin angle. false when
 * the system is not alive.
 */
function evaluate(sys, t, out) {
  const lt = localTime(sys, t);
  if (lt < 0) return false;
  const env = envelope(sys, lt);
  const strength = sys.intensity * env;
  if (strength <= 0.002) return false;
  const c = latLonToDirection(sys.lat, sys.lon, out.center);
  if (sys.speed) {
    // great-circle track: c(s) = c0 cos s + v0 sin s
    tangentFrame(c, _t1, _t2);
    const h = sys.heading * DEG;
    const v = _t3.copy(_t2).multiplyScalar(Math.cos(h)).addScaledVector(_t1, Math.sin(h));
    const s = sys.speed * lt * DEG;
    c.multiplyScalar(Math.cos(s)).addScaledVector(v, Math.sin(s)).normalize();
  }
  out.def = sys;
  out.kind = KIND[sys.type];
  out.strength = strength;
  out.radius = sys.radius * (0.55 + 0.45 * env) * DEG;
  out.spinAngle = sys.spin * lt;
  out.localTime = lt;
  return true;
}

function makeSlot() {
  return { center: new THREE.Vector3(), def: null, kind: 0, strength: 0, radius: 0, spinAngle: 0, localTime: 0, id: null };
}

export class PlanetWeather {
  constructor(planet) {
    this.planet = planet;
    /** Weather clock in seconds (advanced by Planet.update x weatherSpeed). */
    this.time = 0;
    this._runtime = [];          // { id, def, tweens: [] }
    this._declared = [];         // normalised params.weatherSystems
    this._nextId = 1;
    this._slots = Array.from({ length: MAX_WEATHER_SYSTEMS }, makeSlot);
    this._active = 0;            // slots filled by the last _evaluate
    this._evalTime = NaN;
    this._flashes = [];
    this._random = rng(0x5eed);
    this._procCache = new Map();
  }

  get params() { return this.planet.params; }

  /** True when weather systems, rain and lightning are rendered. */
  get enabled() {
    const p = this.params;
    return p.mode === 'planet' && !!p.weatherEnabled && !!p.cloudsEnabled;
  }

  // ------------------------------------------------------------ scripting
  /**
   * Add a runtime weather system; returns its id. Times are on the weather
   * clock: `start` (default: now) or `delay` (seconds from now), `duration`
   * (0 / Infinity = until removed), `fadeIn`, `fadeOut`, `period` (repeat).
   */
  add(definition = {}) {
    const input = { fadeIn: 4, fadeOut: 6, ...definition };
    if (input.start === undefined) input.start = this.time + (Number(input.delay) || 0);
    const def = normalizeWeatherSystem(input);
    if (!def) throw new Error(`[procedural-planets] invalid weather system (type: ${WEATHER_TYPES.join(' | ')})`);
    const id = def.id ?? `wx${this._nextId++}`;
    def.id = id;
    this._runtime = this._runtime.filter((r) => r.id !== id);
    this._runtime.push({ id, def, tweens: [] });
    this._evalTime = NaN;
    return id;
  }

  /**
   * Change a runtime system. With { duration } numeric fields (radius,
   * intensity, lat, lon...) glide to their new values over that many
   * seconds of weather time. Returns false for an unknown id.
   */
  update(id, patch = {}, { duration = 0 } = {}) {
    const r = this._runtime.find((x) => x.id === id);
    if (!r) return false;
    const next = normalizeWeatherSystem({ ...r.def, ...patch });
    if (!next) return false;
    next.id = id;
    if (duration > 0) {
      for (const key of NUMERIC_FIELDS) {
        if (!(key in patch) || ['start', 'duration', 'fadeIn', 'fadeOut', 'period'].includes(key)) continue;
        r.tweens = r.tweens.filter((tw) => tw.key !== key);
        r.tweens.push({ key, from: r.def[key], to: next[key], t0: this.time, dur: duration });
        next[key] = r.def[key];
      }
    }
    r.def = next;
    this._evalTime = NaN;
    return true;
  }

  /** Fade a runtime system out (default over its own fadeOut) and drop it. */
  remove(id, { fadeOut } = {}) {
    const r = this._runtime.find((x) => x.id === id);
    if (!r) return false;
    const d = r.def;
    const fo = Math.max(0, fadeOut ?? d.fadeOut);
    const lt = localTime(d, this.time);
    if (fo <= 0 || lt < 0) {
      this._runtime = this._runtime.filter((x) => x !== r);
    } else {
      // end the current cycle fo seconds from now, at the strength it has
      const env = envelope(d, lt);
      d.intensity *= env;
      d.start = this.time;
      d.fadeIn = 0;
      d.period = 0;
      d.duration = fo;
      d.fadeOut = fo;
    }
    this._evalTime = NaN;
    return true;
  }

  /** Fade every runtime system out (fadeOut seconds, default 4). */
  clear({ fadeOut = 4 } = {}) {
    for (const r of [...this._runtime]) this.remove(r.id, { fadeOut });
  }

  /** A copy of a runtime system's definition (null if unknown). */
  get(id) {
    const r = this._runtime.find((x) => x.id === id);
    return r ? { ...r.def } : null;
  }

  /**
   * Every system alive at the current weather time (runtime, declared and
   * procedural, in GPU priority order) with its live state: { id, source,
   * type, lat, lon, strength, radius (deg), definition }.
   */
  list() {
    this._evaluate();
    const out = [];
    for (let i = 0; i < this._active; i++) {
      const s = this._slots[i];
      const { lat, lon } = directionToLatLon(s.center);
      out.push({ id: s.id, source: s.source, type: s.def.type, lat, lon, strength: s.strength,
        radius: s.radius / DEG, definition: { ...s.def } });
    }
    return out;
  }

  /**
   * Weather the systems put at a planet-local direction (CPU, analytic: the
   * background cloud field is not included): { rain, storm, hurricane,
   * clear, lightning } each 0..1.
   */
  sample(direction) {
    this._evaluate();
    const d = _t1.copy(direction).normalize();
    const res = { rain: 0, storm: 0, hurricane: 0, clear: 0, lightning: 0 };
    for (let i = 0; i < this._active; i++) {
      const s = this._slots[i];
      const ang = Math.acos(clamp(d.dot(s.center), -1, 1));
      if (ang >= s.radius) continue;
      const rr = ang / s.radius;
      const k = s.strength * (1 - smooth((rr - 0.6) / 0.4));
      const def = s.def;
      if (def.type === 'hurricane') {
        const eye = rr < def.eye * 1.1 ? 0 : 1;
        res.hurricane = Math.max(res.hurricane, k);
        res.rain = Math.max(res.rain, k * def.rain * eye * (1 - smooth((rr - 0.3) / 0.6) * 0.5));
      } else if (def.type === 'clear') {
        res.clear = Math.max(res.clear, k * def.coverage);
      } else {
        if (def.type === 'storm') res.storm = Math.max(res.storm, k);
        res.rain = Math.max(res.rain, k * def.rain);
      }
      res.lightning = Math.max(res.lightning, k * def.lightning * (this.params.lightningAmount ?? 0));
    }
    res.rain *= (1 - res.clear) * (this.enabled ? 1 : 0);
    return res;
  }

  /**
   * Fire a lightning strike now. options: { direction (planet-local) | system
   * (id), intensity (default 1), ground (cloud-to-ground bolt, default true) }.
   */
  strike(options = {}) {
    if (!this.enabled) return false;
    let dir = options.direction ? _t2.copy(options.direction).normalize() : null;
    if (!dir) {
      this._evaluate();
      const slot = this._slots.slice(0, this._active).find((s) => options.system == null || s.id === options.system);
      if (!slot) return false;
      dir = this._strikePoint(slot, _t2);
    }
    this._spawnFlash(dir, options.intensity ?? 1, options.ground ?? true, options.system ?? null);
    return true;
  }

  // ------------------------------------------------------------ internals
  /** Advance the weather clock and the lightning (Planet.update). */
  _advance(dt) {
    const p = this.params;
    const wdt = dt * Math.max(p.weatherSpeed ?? 1, 0);
    this.time += wdt;
    // runtime systems: tweens, expiry
    if (this._runtime.length) {
      let changed = false;
      for (const r of this._runtime) {
        if (!r.tweens.length) continue;
        r.tweens = r.tweens.filter((tw) => {
          const k = tw.dur > 0 ? smooth((this.time - tw.t0) / tw.dur) : 1;
          r.def[tw.key] = tw.from + (tw.to - tw.from) * k;
          return k < 1;
        });
        changed = true;
      }
      const alive = this._runtime.filter((r) => {
        const d = r.def;
        return d.duration <= 0 || d.period > 0 || this.time - d.start <= d.duration;
      });
      if (alive.length !== this._runtime.length) { this._runtime = alive; changed = true; }
      if (changed) this._evalTime = NaN;
    }
    // lightning
    for (const f of this._flashes) f.age += dt;
    this._flashes = this._flashes.filter((f) => f.age < f.life);
    if (wdt > 0 && this.enabled && p.lightningAmount > 0) {
      this._evaluate();
      for (let i = 0; i < this._active; i++) {
        const s = this._slots[i];
        const l = s.def.lightning;
        if (l <= 0 || s.strength < 0.15) continue;
        // bigger systems carry more active cells
        const rate = STRIKE_RATE * p.lightningAmount * l * s.strength * Math.sqrt(s.radius / (6 * DEG));
        if (this._random() < 1 - Math.exp(-rate * wdt)) {
          const dir = this._strikePoint(s, _t2);
          this._spawnFlash(dir, 0.6 + 0.6 * this._random(), this._random() < 0.4, s.id);
        }
      }
    }
  }

  // a random point where a system's convection is strongest
  _strikePoint(s, out) {
    const r = this._random;
    const ang = r() * Math.PI * 2;
    let rr;
    if (s.def.type === 'hurricane') rr = s.def.eye * 1.9 + (r() < 0.6 ? (r() - 0.5) * 0.08 : r() * 0.45);
    else rr = Math.sqrt(r()) * 0.65;
    tangentFrame(s.center, _t1, _t3);
    const a = rr * s.radius;
    const v = _t1.multiplyScalar(Math.cos(ang)).addScaledVector(_t3, Math.sin(ang));
    return out.copy(s.center).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).normalize();
  }

  _spawnFlash(dir, intensity, ground, systemId) {
    const u = this.planet.uniforms;
    const bottom = u.uCloudBottom.value;
    const thick = u.uCloudTop.value - bottom;
    const r = this._random;
    const pos = dir.clone().multiplyScalar(bottom + thick * (0.25 + 0.35 * r()));
    const flash = {
      pos, dir: dir.clone(), age: 0, life: 0.25 + 0.35 * r(), intensity, systemId,
      radius: thick * (0.55 + 0.6 * r()),
      // return strokes: the flicker of a real flash
      pulses: [0, 0.05 + 0.08 * r(), 0.13 + 0.12 * r()].slice(0, 1 + Math.floor(r() * 3)),
      bolt: null,
    };
    if (ground) flash.bolt = this._boltPath(dir, bottom);
    if (this._flashes.length >= MAX_FLASHES) this._flashes.shift();
    this._flashes.push(flash);
    const world = this.planet.localToWorld(flash.bolt ? flash.bolt[BOLT_POINTS - 1].clone() : pos.clone());
    this.planet.dispatchEvent({ type: 'lightning', position: world, direction: dir.clone(), intensity,
      ground: !!flash.bolt, system: systemId });
  }

  // jagged polyline from the cloud base down to the ground
  _boltPath(dir, bottom) {
    const p = this.params;
    const r = this._random;
    let ground = p.radius;
    try { ground = this.planet.getSurfaceRadius(dir); } catch { /* sampler unavailable */ }
    if (p.waterEnabled) ground = Math.max(ground, this.planet.uniforms.uSeaRadius.value);
    const top = Math.max(bottom, ground + 0.5);
    const h = top - ground;
    tangentFrame(dir, _t1, _t3);
    const pts = [];
    let ox = 0, oy = 0;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const f = i / (BOLT_POINTS - 1);
      if (i > 0) { ox += (r() - 0.5) * h * 0.22; oy += (r() - 0.5) * h * 0.22; }
      pts.push(dir.clone().multiplyScalar(top - h * f).addScaledVector(_t1, ox).addScaledVector(_t3, oy));
    }
    return pts;
  }

  // flash brightness now: a burst per return stroke on a faint glow
  _flashLevel(f) {
    let v = 0;
    for (const tp of f.pulses) {
      const a = f.age - tp;
      if (a >= 0) v += Math.exp(-a / 0.035);
    }
    v += 0.25 * (1 - f.age / f.life);
    return v * f.intensity;
  }

  // procedural storms: each slot spawns a new system every cycle
  _procedural(t, emit) {
    const p = this.params;
    const life = Math.max(p.stormLifetime ?? 120, 5);
    const size = Math.max(p.stormSize ?? 1, 0.1);
    const seed = p.seed >>> 0;
    const make = (kindTag, index) => {
      const h = hash(seed, kindTag, index);
      const period = life * (0.85 + 0.4 * h);
      const phase = hash(seed, kindTag, index, 7) * period;
      const tt = t + phase;
      const n = Math.floor(tt / period);
      const r = rng(Math.floor(hash(seed, kindTag, index, n) * 4294967296));
      const def = this._procDef(kindTag, index, n, r, size);
      def.start = n * period - phase;
      def.duration = period * 0.82;
      def.fadeIn = def.duration * 0.22;
      def.fadeOut = def.duration * 0.28;
      emit(def, `auto-${kindTag === 1 ? 'hurricane' : 'storm'}-${index}`);
    };
    for (let i = 0; i < Math.min(p.hurricaneCount ?? 0, MAX_WEATHER_SYSTEMS); i++) make(1, i);
    for (let i = 0; i < Math.min(p.stormCount ?? 0, MAX_WEATHER_SYSTEMS); i++) make(0, i);
  }

  // one procedural system definition (cached: the same cycle -> the same storm)
  _procDef(kindTag, index, n, r, size) {
    const key = `${kindTag}:${index}:${n}:${size}:${this.params.seed}`;
    const hit = this._procCache.get(key);
    if (hit) return { ...hit };
    let def;
    const sign = r() < 0.5 ? -1 : 1;
    if (kindTag === 1) {
      // tropical cyclone: forms at 8-22 deg, drifts west and poleward
      const lat = sign * (8 + 14 * r());
      def = normalizeWeatherSystem({
        type: 'hurricane', lat, lon: r() * 360 - 180,
        radius: (8 + 5 * r()) * size, intensity: 0.85 + 0.15 * r(),
        heading: sign > 0 ? 285 + 25 * r() : 230 + 25 * r(), speed: 0,
      });
      def.speed = 0.025 + 0.02 * r();
    } else {
      const front = r() < 0.35;
      const lat = front ? sign * (32 + 26 * r()) : sign * (r() * r() * 45);
      def = normalizeWeatherSystem({
        type: front ? 'rain' : 'storm', lat, lon: r() * 360 - 180,
        radius: (front ? 10 + 8 * r() : 4.5 + 4 * r()) * size, intensity: 0.75 + 0.25 * r(),
        // tropics drift west, mid latitudes east
        heading: Math.abs(lat) > 30 ? 60 + 60 * r() : 240 + 60 * r(),
        speed: 0.01 + 0.025 * r(),
        lightning: front ? 0.08 : 1,
      });
    }
    if (this._procCache.size > 64) this._procCache.clear();
    this._procCache.set(key, def);
    return { ...def };
  }

  // fill the GPU slots for the current time (cached per time value)
  _evaluate() {
    if (this._evalTime === this.time && this._evalVersion === this.planet._version) return;
    this._evalTime = this.time;
    this._evalVersion = this.planet._version;
    let n = 0;
    if (!this.enabled) { this._active = 0; return; }
    const t = this.time;
    const push = (def, id, source) => {
      if (n >= MAX_WEATHER_SYSTEMS) return;
      const slot = this._slots[n];
      if (!evaluate(def, t, slot)) return;
      slot.id = id;
      slot.source = source;
      n++;
    };
    for (const r of this._runtime) push(r.def, r.id, 'runtime');
    this._declared.forEach((d, i) => push(d, d.id ?? `system-${i}`, 'declared'));
    this._procedural(t, (def, id) => push(def, id, 'procedural'));
    this._active = n;
  }

  /** Pack systems, flashes and bolts into the shared uniforms (per frame). */
  _writeUniforms(u, { lightning = true } = {}) {
    const p = this.params;
    this._evaluate();
    const on = this.enabled;
    const n = this._active;
    u.uWxCount.value = n;
    for (let i = 0; i < n; i++) {
      const s = this._slots[i];
      const d = s.def;
      const c = s.center;
      u.uWxA.value[i].set(c.x, c.y, c.z, Math.cos(s.radius));
      // sign of the spin sense rides on the kind; spin angle is signed
      const sense = d.spin < 0 || (d.spin === 0 && d.lat < 0) ? -1 : 1;
      u.uWxB.value[i].set(1 / Math.sin(s.radius), s.strength, s.kind, s.spinAngle);
      u.uWxC.value[i].set(d.coverage, d.rain, d.tower, Math.max(d.eye, 0.02) * sense);
    }
    u.uRainAmount.value = on ? p.rainAmount : 0;
    let rainy = on && p.rainAmount > 0;
    for (let i = 0; i < n && !rainy; i++) rainy = this._slots[i].def.rain > 0;
    u.uRainOn.value = rainy ? 1 : 0;

    // lightning
    let nf = 0, nb = 0;
    if (lightning && on) {
      const col = p.lightningColor ?? [0.75, 0.82, 1];
      const bright = (p.lightningBrightness ?? 1) * 7;
      for (const f of this._flashes) {
        if (nf >= MAX_FLASHES) break;
        const lvl = this._flashLevel(f) * bright;
        u.uFlashPos.value[nf].set(f.pos.x, f.pos.y, f.pos.z, f.radius);
        u.uFlashCol.value[nf].set(col[0] * lvl, col[1] * lvl, col[2] * lvl, f.bolt ? 1 : 0);
        nf++;
        if (f.bolt && nb < MAX_BOLTS) {
          for (let k = 0; k < BOLT_POINTS; k++) {
            const q = f.bolt[k];
            u.uBoltPts.value[nb * BOLT_POINTS + k].set(q.x, q.y, q.z, 0);
          }
          const h = f.bolt[0].distanceTo(f.bolt[BOLT_POINTS - 1]);
          // the channel only shows on the strokes, not the afterglow
          const stroke = Math.max(0, this._flashLevel(f) - 0.25 * f.intensity) * bright * 6;
          u.uBoltCol.value[nb].set(col[0] * stroke, col[1] * stroke, col[2] * stroke, h * 0.004);
          nb++;
        }
      }
    }
    u.uFlashCount.value = nf;
    u.uBoltCount.value = nb;
  }

  /**
   * Rain at the camera (planet-local position), for the close-up streaks and
   * the rain-shaft trigger: one CPU evaluation per frame instead of a
   * weather lookup per pixel.
   */
  _setCamera(u, camLocal) {
    const below = camLocal.length() < u.uCloudBottom.value;
    u.uRainCam.value = below && this.enabled && u.uRainOn.value > 0 ? this.sample(camLocal).rain : 0;
  }

  /** Whether this frame needs the composite's weather effects. */
  _fxActive(u) {
    return u.uFlashCount.value > 0 || u.uBoltCount.value > 0 || u.uRainCam.value > 0.01;
  }

  /** Declared systems (params.weatherSystems) changed. */
  _setDeclared(list) {
    this._declared = (list ?? []).map((d, i) => ({ ...d, id: d.id ?? `system-${i}` }));
    this._evalTime = NaN;
  }
}

/** GPU uniforms for the weather systems / lightning (merged into the shared set). */
export function createWeatherUniforms(p) {
  const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4());
  return {
    uWxCount:     { value: 0 },
    uWxA:         { value: v4(MAX_WEATHER_SYSTEMS) },
    uWxB:         { value: v4(MAX_WEATHER_SYSTEMS) },
    uWxC:         { value: v4(MAX_WEATHER_SYSTEMS) },
    uRainAmount:  { value: p.rainAmount ?? 0 },
    uRainOn:      { value: 0 },
    uRainColor:   { value: new THREE.Vector3(...(p.rainColor ?? [0.6, 0.64, 0.7])) },
    uRainCam:     { value: 0 },
    uFlashCount:  { value: 0 },
    uFlashPos:    { value: v4(MAX_FLASHES) },
    uFlashCol:    { value: v4(MAX_FLASHES) },
    uBoltCount:   { value: 0 },
    uBoltPts:     { value: v4(MAX_BOLTS * BOLT_POINTS) },
    uBoltCol:     { value: v4(MAX_BOLTS) },
  };
}
