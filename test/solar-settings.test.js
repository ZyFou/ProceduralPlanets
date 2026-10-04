import { describe, it, expect, vi } from 'vitest';
import { Planet } from '../src/lib/index.js';
import { AU, MAX_BODIES, desiredBodies, nearbySystems, position, relative, length, translate } from '../src/exploration/world.js';
import { generateSolarSystem, SOLAR_PLANETS, SOLAR_MOONS } from '../src/exploration/solarSystem.js';
import { SystemStream } from '../src/exploration/streaming.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY, readSettings, writeSettings, normalizeSettings, bodySettings } from '../src/exploration/settings.js';

describe('real Solar System catalogue', () => {
  it('has the Sun, eight planets, Pluto and the documented 24 moons, seed-independent', () => {
    const solar = generateSolarSystem();
    expect(solar.bodies).toHaveLength(34); expect(SOLAR_MOONS).toHaveLength(24);
    expect(generateSolarSystem()).toEqual(solar);
    for (const row of SOLAR_PLANETS) {
      const body = solar.bodies.find(b => b.name === row[0]);
      expect(body.radius).toBe(row[1]);
      const distance = length(relative(body.position, solar.star.position));
      expect(distance).toBeGreaterThanOrEqual(row[2] * AU * (1-row[3]) - .001);
      expect(distance).toBeLessThanOrEqual(row[2] * AU * (1+row[3]) + .001);
    }
    for (const body of solar.bodies.filter(b => b.parentId)) {
      const parent = solar.bodies.find(b => b.id === body.parentId);
      expect(length(relative(body.position, parent.position))).toBeCloseTo(body.orbit, 6);
    }
    expect(nearbySystems('42', position()).find(s=>s.id==='sol')).toEqual(solar);
    expect(nearbySystems('99', position()).find(s=>s.id==='sol')).toEqual(solar);
  });
  it('uses supported package presets and physical scale, with relief bounded on tiny moons', () => {
    for (const body of generateSolarSystem().bodies) {
      const p = new Planet({ type:body.type, preset:body.preset, radius:2000, ...body.params });
      p.scale.setScalar(body.radius/2000);
      expect(p.params.radius * p.scale.x).toBeCloseTo(body.radius, 6);
      if (body.type==='terrestrial') expect(p.params.heightScale / 2000).toBeLessThanOrEqual(.0025);
      p.dispose();
    }
  });
  it('prioritizes a tiny targeted moon and its parent while remaining bounded through streaming', () => {
    const solar = generateSolarSystem(), moon=solar.bodies.find(b=>b.name==='Deimos');
    const player=translate(moon.position,{x:moon.radius*3,y:0,z:0});
    const desired=desiredBodies([solar],player,moon.id);
    expect(desired.length).toBe(MAX_BODIES);
    expect(desired[0].body).toBe(moon); expect(desired[1].body.id).toBe(moon.parentId);
    const release=vi.fn(), stream=new SystemStream('42',{create:b=>b.id,release});
    stream.discover(player,moon.id); for(let i=0;i<100;i++)stream.tick();
    expect(stream.entries.size).toBeLessThanOrEqual(MAX_BODIES);
    expect(stream.entries.has(moon.id)).toBe(true);
    stream.discover(position({x:1200,y:0,z:0}));
    expect(stream.systems.some(s=>s.id==='sol')).toBe(false);
    stream.dispose(); expect(stream.entries.size).toBe(0);
    expect(release).toHaveBeenCalled();
  });
});
describe('persistent render settings', () => {
  it('validates corrupt storage, finite bounds and supported keyboard layouts', () => {
    expect(readSettings({ getItem:()=>'{bad' })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({renderScale:NaN,cloudSteps:999,maxDepth:-20,layout:'unknown'})).toMatchObject({renderScale:1,cloudSteps:96,maxDepth:6,layout:'wasd'});
    const storage={getItem:vi.fn(),setItem:vi.fn()};
    expect(writeSettings(storage,{...DEFAULT_SETTINGS,layout:'azerty'})).toBe(true);
    const [key,value]=storage.setItem.mock.calls[0]; expect(key).toBe(SETTINGS_KEY);
    storage.getItem.mockReturnValue(value); expect(readSettings(storage).layout).toBe('azerty');
    expect(writeSettings({setItem:()=>{throw new Error('denied')}},DEFAULT_SETTINGS)).toBe(false);
  });
  it('maps actual package parameters without adding air or clouds to airless bodies', () => {
    const intrinsic={cloudsEnabled:false,atmoEnabled:false,gasAtmoStrength:1,starBloom:.25};
    const params=bodySettings({...DEFAULT_SETTINGS,clouds:false,atmosphere:false,bloom:false,cloudSteps:48,maxDepth:10},intrinsic);
    expect(params).toMatchObject({cloudsEnabled:false,atmoEnabled:false,gasAtmoStrength:0,starBloom:0,cloudQuality:48,maxDepth:10});
    const p=new Planet({preset:'moon',radius:2000}); p.set(params);
    expect(p.world.opts.maxDepth).toBe(10); expect(p.params.cloudQuality).toBe(48);
    p.dispose();
  });
});
