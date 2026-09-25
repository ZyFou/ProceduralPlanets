import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  Planet, PlanetRenderer, resolvePlanetParams, normalizeParam, validateParams,
  listPresets, findPreset, DEFAULT_PARAMS, PLANET_PRESETS, GAS_PRESETS, STAR_PRESETS, PARAM_DOCS,
} from '../src/lib/index.js';

afterEach(() => vi.restoreAllMocks());

describe('resolvePlanetParams', () => {
  it('defaults to a terrestrial planet with the default params', () => {
    const p = resolvePlanetParams();
    expect(p.mode).toBe('planet');
    expect(p.radius).toBe(DEFAULT_PARAMS.radius);
  });

  it('infers the body type from the preset', () => {
    expect(resolvePlanetParams({ preset: 'ringed' }).mode).toBe('gas');
    expect(resolvePlanetParams({ preset: 'sun' }).mode).toBe('star');
    expect(resolvePlanetParams({ preset: 'desert' }).seaLevel).toBe(PLANET_PRESETS.desert.patch.seaLevel);
  });

  it('applies params, then flat keys, over the preset', () => {
    const p = resolvePlanetParams({ preset: 'desert', params: { seaLevel: 0.1, radius: 900 }, seaLevel: 0.2 });
    expect(p.seaLevel).toBe(0.2);
    expect(p.radius).toBe(900);
  });

  it('rejects unknown types / presets and mismatched type + preset', () => {
    expect(() => resolvePlanetParams({ type: 'comet' })).toThrow(/unknown planet type/);
    expect(() => resolvePlanetParams({ preset: 'nope' })).toThrow(/unknown preset/);
    expect(() => resolvePlanetParams({ type: 'star', preset: 'terran' })).toThrow(/terrestrial preset/);
  });

  it('warns about and skips unknown keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = resolvePlanetParams({ radiusss: 5 });
    expect(p.radiusss).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('normalizeParam', () => {
  it('accepts every colour form as sRGB 0..1', () => {
    expect(normalizeParam('colSand', '#ff8000').value).toEqual([1, 128 / 255, 0]);
    expect(normalizeParam('colSand', 0x0080ff).value).toEqual([0, 128 / 255, 1]);
    expect(normalizeParam('colSand', [0.1, 0.2, 0.3]).value).toEqual([0.1, 0.2, 0.3]);
    const c = normalizeParam('colSand', new THREE.Color('#336699')).value;
    expect(c[0]).toBeCloseTo(0x33 / 255, 4);   // three's sRGB round trip
    expect(c[2]).toBeCloseTo(0x99 / 255, 4);
  });

  it('coerces seeds to uint32 and maps type names to modes', () => {
    expect(normalizeParam('seed', -1).value).toBe(0xffffffff);
    expect(normalizeParam('mode', 'terrestrial').value).toBe('planet');
    expect(normalizeParam('mode', 'gas').value).toBe('gas');
  });

  it('flags wrong types and unknown keys', () => {
    expect(normalizeParam('radius', 'big')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(normalizeParam('colSand', { nope: 1 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(normalizeParam('bogus', 1)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(validateParams({ radius: 10, bogus: 1, seaLevel: NaN })).toEqual({
      params: { radius: 10 }, unknown: ['bogus'], invalid: ['seaLevel'],
    });
  });
});

describe('Planet', () => {
  it('is an Object3D that draws nothing through the host scene', () => {
    const planet = new Planet();
    expect(planet.isObject3D).toBe(true);
    expect(planet.isPlanet).toBe(true);
    expect(planet.children).toHaveLength(0);
    expect(planet.planetType).toBe('terrestrial');
    planet.dispose();
  });

  it('set() updates params and the derived uniforms live', () => {
    const planet = new Planet({ radius: 1000, heightScale: 50 });
    planet.set({ seaLevel: 0.5, colSand: '#ffffff' });
    expect(planet.get('seaLevel')).toBe(0.5);
    expect(planet.uniforms.uSeaRadius.value).toBeCloseTo(1025);
    expect(planet.uniforms.uColSand.value.toArray()).toEqual([1, 1, 1]);
    planet.set('radius', 3000);
    expect(planet.uniforms.uRadius.value).toBe(3000);
    expect(planet.uniforms.uAtmoTop.value).toBeGreaterThan(3000);
    planet.dispose();
  });

  it('marks structural rebuilds', () => {
    const planet = new Planet();
    planet._needsWarmup = false;
    planet.set({ octaves: 5 });
    expect(planet.world.opts.octaves).toBe(5);
    expect(planet._needsWarmup).toBe(true);
    planet.dispose();
  });

  it('applyPreset switches the body type unless told otherwise', () => {
    const planet = new Planet();
    planet.applyPreset('ringed');
    expect(planet.planetType).toBe('gas');
    expect(planet.get('gasRingsEnabled')).toBe(GAS_PRESETS.ringed.patch.gasRingsEnabled ?? true);
    planet.applyPreset('redGiant', { setType: false });
    expect(planet.planetType).toBe('gas');
    expect(planet.get('starTemperature')).toBe(STAR_PRESETS.redGiant.patch.starTemperature);
    expect(() => planet.applyPreset('nope')).toThrow();
    planet.dispose();
  });

  it('round-trips through serialize / fromJSON', () => {
    const a = new Planet({ preset: 'mars', seed: 77, radius: 1500 });
    const json = JSON.stringify(a.serialize());
    const b = Planet.fromJSON(json);
    expect(b.params).toEqual(a.params);
    const c = Planet.fromJSON({ params: a.params }, { radius: 999 });
    expect(c.get('radius')).toBe(999);
    for (const p of [a, b, c]) p.dispose();
  });

  it('migrates old studio parameter sets', () => {
    const old = { ...DEFAULT_PARAMS, renderVersion: 1, heightScale: 130, colSand: [1, 0, 0], seed: 5 };
    const planet = Planet.fromJSON({ app: 'procedural-planets', version: 1, mode: 'planet', params: old });
    expect(planet.get('renderVersion')).toBe(DEFAULT_PARAMS.renderVersion);
    expect(planet.get('seed')).toBe(5);                           // shape kept
    expect(planet.get('colSand')).toEqual(DEFAULT_PARAMS.colSand); // look reset
    planet.dispose();
  });

  it('clone() copies params and transform', () => {
    const a = new Planet({ preset: 'ice', seed: 9 });
    a.position.set(1, 2, 3);
    const b = a.clone();
    expect(b.params).toEqual(a.params);
    expect(b.position.toArray()).toEqual([1, 2, 3]);
    a.dispose(); b.dispose();
  });

  it('samples the terrain deterministically per seed', () => {
    const planet = new Planet({ seed: 1, radius: 1000, heightScale: 100 });
    const dir = new THREE.Vector3(0.3, 0.8, -0.5);
    const r1 = planet.getSurfaceRadius(dir);
    expect(r1).toBeGreaterThanOrEqual(1000);
    expect(r1).toBeLessThanOrEqual(1100);
    expect(planet.getSurfaceRadius(dir)).toBe(r1);
    planet.set({ seed: 2 });
    expect(planet.getSurfaceRadius(dir)).not.toBe(r1);
    planet.position.set(10, 0, 0);
    planet.updateMatrixWorld();
    const p = planet.getSurfacePoint(dir);
    expect(p.clone().sub(planet.position).length()).toBeGreaterThanOrEqual(planet.uniforms.uSeaRadius.value - 1e-6);
    planet.dispose();
  });

  it('bounding radius covers atmosphere, rings and corona', () => {
    const t = new Planet();
    expect(t.boundingRadius).toBeGreaterThanOrEqual(t.uniforms.uAtmoTop.value);
    const g = new Planet({ preset: 'ringed' });
    expect(g.boundingRadius).toBeGreaterThanOrEqual(g.get('radius') * g.get('gasRingOuter'));
    const s = new Planet({ preset: 'sun' });
    expect(s.boundingRadius).toBeGreaterThan(s.get('radius'));
    for (const p of [t, g, s]) p.dispose();
  });

  it('supports THREE.Raycaster picking', () => {
    const planet = new Planet({ radius: 100, heightScale: 10 });
    planet.position.set(0, 0, -500);
    planet.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(planet);
    expect(hits).toHaveLength(1);
    expect(hits[0].object).toBe(planet);
    expect(hits[0].distance).toBeCloseTo(500 - planet.surfaceRadius, 3);
    planet.dispose();
  });

  it('turns a light source into a planet-local sun direction', () => {
    const planet = new Planet({ lightSource: new THREE.Vector3(1, 0, 0) });
    planet.rotation.y = Math.PI / 2;   // local +x now points to world -z
    planet.updateMatrixWorld();
    planet._updateSunDirection();
    expect(planet.uniforms.uSunDir.value.x).toBeCloseTo(0, 5);
    expect(planet.uniforms.uSunDir.value.z).toBeCloseTo(1, 5);

    const star = new Planet({ type: 'star' });
    star.position.set(0, 100, 0);
    const lit = new Planet({ lightSource: star });
    lit.updateMatrixWorld();
    lit._updateSunDirection();
    expect(lit.uniforms.uSunDir.value.toArray().map((v) => +v.toFixed(5))).toEqual([0, 1, 0]);
    for (const p of [planet, star, lit]) p.dispose();
  });

  it('advances its clocks', () => {
    const planet = new Planet({ cloudSpeed: 2 });
    planet.update(0.5);
    expect(planet.time).toBeCloseTo(0.5);
    expect(planet.cloudTime).toBeCloseTo(1);
    planet.dispose();
  });

  it('fits near / far planes around the body', () => {
    const planet = new Planet({ radius: 1000, heightScale: 50 });
    const [near, far] = planet._clipPlanes(3000);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(3000 - 1050);
    expect(far).toBeGreaterThan(3000 + 1000);
    planet.dispose();
  });
});

describe('presets and metadata', () => {
  it('lists every preset under its type', () => {
    const all = listPresets();
    expect(all.terrestrial).toEqual(Object.keys(PLANET_PRESETS));
    expect(all.gas).toEqual(Object.keys(GAS_PRESETS));
    expect(all.star).toEqual(Object.keys(STAR_PRESETS));
    expect(findPreset('iceGiant').mode).toBe('gas');
    expect(findPreset('missing')).toBeNull();
  });

  it('every preset builds a planet', () => {
    for (const names of Object.values(listPresets())) {
      for (const name of names) {
        const planet = new Planet({ preset: name });
        expect(planet.params.mode).toBe(findPreset(name).mode);
        planet.dispose();
      }
    }
  });

  it('documents every parameter', () => {
    for (const [key, value] of Object.entries(DEFAULT_PARAMS)) {
      expect(PARAM_DOCS[key], key).toBeDefined();
      expect(PARAM_DOCS[key].default).toEqual(value);
      expect(PARAM_DOCS[key].description.length, key).toBeGreaterThan(3);
    }
    expect(Object.keys(PARAM_DOCS).sort()).toEqual(Object.keys(DEFAULT_PARAMS).sort());
  });
});

describe('PlanetRenderer', () => {
  it('needs a WebGLRenderer', () => {
    expect(() => new PlanetRenderer({})).toThrow(/WebGLRenderer/);
  });
});
