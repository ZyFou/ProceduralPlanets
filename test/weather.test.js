import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  Planet, normalizeWeatherSystem, latLonToDirection, directionToLatLon, MAX_WEATHER_SYSTEMS, PARAM_DOCS,
} from '../src/lib/index.js';

afterEach(() => vi.restoreAllMocks());

// a planet with no procedural systems unless asked
const calm = (extra = {}) => new Planet({ stormCount: 0, hurricaneCount: 0, ...extra });
const step = (planet, seconds, dt = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += dt) planet.update(dt); };

describe('weather system definitions', () => {
  it('fills per-type defaults and clamps', () => {
    const h = normalizeWeatherSystem({ type: 'hurricane', lat: 15, lon: -40 });
    expect(h).toMatchObject({ type: 'hurricane', radius: 10, intensity: 1, duration: 0 });
    expect(h.eye).toBeGreaterThan(0);
    expect(h.spin).toBeGreaterThan(0);   // counter-clockwise in the north
    expect(normalizeWeatherSystem({ type: 'hurricane', lat: -15 }).spin).toBeLessThan(0);
    expect(normalizeWeatherSystem({ type: 'storm', radius: 500, intensity: 4 })).toMatchObject({ radius: 60, intensity: 1 });
    expect(normalizeWeatherSystem({ type: 'tornado' })).toBeNull();
    expect(normalizeWeatherSystem(null)).toBeNull();
  });

  it('accepts a direction instead of lat / lon', () => {
    const s = normalizeWeatherSystem({ type: 'rain', direction: latLonToDirection(30, 120) });
    expect(s.lat).toBeCloseTo(30, 6);
    expect(s.lon).toBeCloseTo(120, 6);
    const { lat, lon } = directionToLatLon(new THREE.Vector3(0, 1, 0));
    expect(lat).toBeCloseTo(90, 6);
    expect(Number.isFinite(lon)).toBe(true);
  });

  it('weatherSystems is a validated, documented parameter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const planet = calm({ weatherSystems: [{ type: 'storm', lat: 10 }, { type: 'nope' }] });
    expect(planet.get('weatherSystems')).toHaveLength(1);
    planet.set('weatherSystems', 'not an array');
    expect(warn).toHaveBeenCalled();
    expect(planet.get('weatherSystems')).toHaveLength(1);
    expect(PARAM_DOCS.weatherSystems.type).toBe('array');
    planet.dispose();
  });
});

describe('timed systems', () => {
  it('fade in, last, fade out and expire on the weather clock', () => {
    const planet = calm();
    const id = planet.weather.add({ type: 'storm', lat: 0, lon: 0, fadeIn: 2, duration: 10, fadeOut: 2 });
    const strength = () => planet.weather.list().find((s) => s.id === id)?.strength ?? 0;
    step(planet, 1);
    expect(strength()).toBeGreaterThan(0);
    expect(strength()).toBeLessThan(1);
    step(planet, 4);
    expect(strength()).toBeCloseTo(1, 5);
    step(planet, 4.5);
    expect(strength()).toBeLessThan(1);
    step(planet, 1);
    expect(planet.weather.get(id)).toBeNull();
    planet.dispose();
  });

  it('starts after a delay and follows weatherSpeed', () => {
    const planet = calm({ weatherSpeed: 2 });
    planet.weather.add({ type: 'rain', delay: 4, fadeIn: 0 });
    step(planet, 1.5);
    expect(planet.weather.list()).toHaveLength(0);   // weather time 3 < 4
    step(planet, 1);
    expect(planet.weather.list()).toHaveLength(1);
    expect(planet.weather.time).toBeCloseTo(5, 5);
    planet.dispose();
  });

  it('glides numeric fields with update(..., { duration })', () => {
    const planet = calm();
    const id = planet.weather.add({ type: 'hurricane', lat: 15, lon: 0, radius: 8, fadeIn: 0 });
    planet.weather.update(id, { radius: 16, lat: 25 }, { duration: 10 });
    step(planet, 5);
    const mid = planet.weather.get(id);
    expect(mid.radius).toBeGreaterThan(8);
    expect(mid.radius).toBeLessThan(16);
    step(planet, 6);
    expect(planet.weather.get(id)).toMatchObject({ radius: 16, lat: 25 });
    planet.dispose();
  });

  it('remove() fades a system out from its current strength', () => {
    const planet = calm();
    const id = planet.weather.add({ type: 'storm', fadeIn: 0 });
    planet.weather.remove(id, { fadeOut: 2 });
    step(planet, 1);
    const s = planet.weather.list()[0];
    expect(s.strength).toBeGreaterThan(0);
    expect(s.strength).toBeLessThan(1);
    step(planet, 1.5);
    expect(planet.weather.list()).toHaveLength(0);
    planet.dispose();
  });

  it('repeats declared systems with a period', () => {
    const planet = calm({ weatherSystems: [{ type: 'storm', start: 0, duration: 5, period: 20 }] });
    const alive = () => planet.weather.list().length;
    expect(alive()).toBe(1);
    step(planet, 8);
    expect(alive()).toBe(0);
    step(planet, 14);   // t = 22: second cycle
    expect(alive()).toBe(1);
    planet.dispose();
  });

  it('moves systems along their heading', () => {
    const planet = calm();
    planet.weather.add({ type: 'hurricane', lat: 10, lon: 0, heading: 0, speed: 1, fadeIn: 0 });
    step(planet, 10);
    const s = planet.weather.list()[0];
    expect(s.lat).toBeCloseTo(20, 1);   // heading 0 = north
    expect(s.lon).toBeCloseTo(0, 3);
    planet.dispose();
  });
});

describe('procedural weather', () => {
  it('spawns deterministic systems from the seed and the clock', () => {
    const a = new Planet({ seed: 7, stormCount: 3, hurricaneCount: 2 });
    const b = new Planet({ seed: 7, stormCount: 3, hurricaneCount: 2 });
    a.weather.time = b.weather.time = 432;
    const la = a.weather.list(), lb = b.weather.list();
    expect(la.length).toBeGreaterThan(0);
    expect(la.length).toBeLessThanOrEqual(5);
    expect(la.map((s) => [s.type, s.lat, s.lon])).toEqual(lb.map((s) => [s.type, s.lat, s.lon]));
    expect(la.every((s) => s.source === 'procedural')).toBe(true);
    for (const s of la.filter((x) => x.type === 'hurricane')) expect(Math.abs(s.lat)).toBeLessThan(30);
    a.dispose(); b.dispose();
  });

  it('is off without clouds, when disabled, and on gas giants', () => {
    const planet = new Planet({ stormCount: 4, hurricaneCount: 2 });
    planet.weather.add({ type: 'storm' });
    expect(planet.weather.list().length).toBeGreaterThan(0);
    planet.set('weatherEnabled', false);
    expect(planet.weather.list()).toHaveLength(0);
    planet.set({ weatherEnabled: true, cloudsEnabled: false });
    expect(planet.weather.list()).toHaveLength(0);
    planet.set({ cloudsEnabled: true, mode: 'gas' });
    expect(planet.weather.list()).toHaveLength(0);
    planet.dispose();
  });

  it('never exceeds the GPU slots (runtime systems first)', () => {
    const planet = new Planet({ stormCount: 6, hurricaneCount: 3 });
    const ids = Array.from({ length: 3 }, () => planet.weather.add({ type: 'clear', fadeIn: 0 }));
    const list = planet.weather.list();
    expect(list.length).toBeLessThanOrEqual(MAX_WEATHER_SYSTEMS);
    expect(list.slice(0, 3).map((s) => s.id)).toEqual(ids);
    planet.dispose();
  });
});

describe('GPU packing, rain and lightning', () => {
  it('packs live systems into the shared uniforms', () => {
    const planet = calm({ rainAmount: 0.4 });
    planet.weather.add({ type: 'hurricane', lat: 20, lon: 30, radius: 10, fadeIn: 0 });
    planet._prepareFrame();
    const u = planet.uniforms;
    expect(u.uWxCount.value).toBe(1);
    const c = latLonToDirection(20, 30);
    expect(u.uWxA.value[0].x).toBeCloseTo(c.x, 6);
    expect(u.uWxA.value[0].w).toBeCloseTo(Math.cos(10 * Math.PI / 180), 6);
    expect(u.uWxB.value[0].z).toBe(1);        // kind: hurricane
    expect(u.uWxC.value[0].w).toBeGreaterThan(0);   // eye, northern spin sense
    expect(u.uRainOn.value).toBe(1);
    expect(u.uRainAmount.value).toBe(0.4);
    planet.set('weatherEnabled', false);
    planet._prepareFrame();
    expect(u.uWxCount.value).toBe(0);
    expect(u.uRainAmount.value).toBe(0);
    planet.dispose();
  });

  it('samples rain from the systems on the CPU', () => {
    const planet = calm();
    planet.weather.add({ type: 'rain', lat: 0, lon: 0, radius: 10, rain: 0.8, fadeIn: 0 });
    expect(planet.weather.sample(latLonToDirection(0, 0)).rain).toBeCloseTo(0.8, 5);
    expect(planet.weather.sample(latLonToDirection(0, 40)).rain).toBe(0);
    planet.dispose();
  });

  it('strikes fire events and light the passes, but never impostor captures', () => {
    const planet = calm();
    planet.weather.add({ type: 'storm', lat: 5, lon: 5, fadeIn: 0 });
    const seen = [];
    planet.addEventListener('lightning', (e) => seen.push(e));
    expect(planet.weather.strike({ ground: true })).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].ground).toBe(true);
    expect(seen[0].position.isVector3).toBe(true);
    planet._prepareFrame();
    expect(planet.uniforms.uFlashCount.value).toBe(1);
    expect(planet.uniforms.uBoltCount.value).toBe(1);
    planet._prepareFrame({ impostor: true });
    expect(planet.uniforms.uFlashCount.value).toBe(0);
    step(planet, 1);   // flashes die within a second
    planet._prepareFrame();
    expect(planet.uniforms.uFlashCount.value).toBe(0);
    planet.dispose();
  });

  it('schedules strikes in storms at the lightningAmount rate', () => {
    const quiet = calm({ lightningAmount: 0 });
    const busy = calm({ lightningAmount: 1 });
    for (const p of [quiet, busy]) p.weather.add({ type: 'storm', radius: 8, fadeIn: 0 });
    let n0 = 0, n1 = 0;
    quiet.addEventListener('lightning', () => n0++);
    busy.addEventListener('lightning', () => n1++);
    step(quiet, 20, 0.05);
    step(busy, 20, 0.05);
    expect(n0).toBe(0);
    expect(n1).toBeGreaterThan(5);
    quiet.dispose(); busy.dispose();
  });
});

describe('Planet.transition', () => {
  it('glides numbers and colours over planet time', () => {
    const planet = calm({ cloudCoverage: 0.2, rainColor: [0, 0, 0] });
    planet.transition({ cloudCoverage: 0.8, rainColor: [1, 1, 1] }, { duration: 4 });
    expect(planet.transitioning).toEqual(['cloudCoverage', 'rainColor']);
    step(planet, 2);
    expect(planet.get('cloudCoverage')).toBeGreaterThan(0.3);
    expect(planet.get('cloudCoverage')).toBeLessThan(0.7);
    expect(planet.uniforms.uCloudCoverage.value).toBe(planet.get('cloudCoverage'));
    step(planet, 2.5);
    expect(planet.get('cloudCoverage')).toBeCloseTo(0.8, 6);
    expect(planet.get('rainColor')).toEqual([1, 1, 1]);
    expect(planet.transitioning).toEqual([]);
    planet.dispose();
  });

  it('switches structural / counted keys at once and yields to set()', () => {
    const planet = calm({ cloudCoverage: 0.2 });
    planet.transition({ stormCount: 3, cloudCoverage: 0.9 }, { duration: 10 });
    expect(planet.get('stormCount')).toBe(3);
    planet.set('cloudCoverage', 0.5);
    step(planet, 11);
    expect(planet.get('cloudCoverage')).toBe(0.5);
    planet.dispose();
  });
});

describe('serialisation', () => {
  it('round-trips pinned systems', () => {
    const planet = calm({ weatherSystems: [{ type: 'hurricane', lat: 12, lon: -50, duration: 60, period: 120 }] });
    const copy = Planet.fromJSON(JSON.parse(JSON.stringify(planet.serialize())));
    expect(copy.get('weatherSystems')).toEqual(planet.get('weatherSystems'));
    expect(copy.weather.list()).toHaveLength(1);
    planet.dispose(); copy.dispose();
  });
});
