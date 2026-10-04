// Physical distances are kilometres. Sector + local offset keeps sub-metre
// navigation independent of the number of light years already travelled.
// A compensated remainder preserves fine movement even within a light-year sector.
export const AU = 149_597_870.7;
export const LIGHT_YEAR = 9_460_730_472_580.8;
export const SECTOR_SIZE = 4 * LIGHT_YEAR;
export const MAX_SYSTEMS = 4;
export const MAX_BODIES = 16;
export const MIN_SPEED = 0.001;
export const MAX_SPEED = LIGHT_YEAR * 0.25; // intentional travel acceleration, not a physics simulation
export const AXES = ['x', 'y', 'z'];

export function hashSeed(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function randomFor(key) {
  let state = hashSeed(key);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function position(sector = { x: 0, y: 0, z: 0 }, offset = { x: 0, y: 0, z: 0 }) {
  return { sector: { ...sector }, offset: { ...offset }, remainder: { x: 0, y: 0, z: 0 } };
}
function twoSum(a, b) {
  const sum = a + b;
  const bv = sum - a;
  return [sum, (a - (sum - bv)) + (b - bv)];
}
export function translate(p, delta) {
  const next = position(p.sector, p.offset);
  for (const axis of AXES) {
    const [offset, error] = twoSum(p.offset[axis], delta[axis] + (p.remainder?.[axis] ?? 0));
    next.offset[axis] = offset;
    next.remainder[axis] = error;
    const cells = Math.floor((next.offset[axis] + SECTOR_SIZE / 2) / SECTOR_SIZE);
    next.sector[axis] += cells;
    if (!Number.isSafeInteger(next.sector[axis])) throw new RangeError('Sector coordinate limit reached');
    const [local, rounding] = twoSum(next.offset[axis], -cells * SECTOR_SIZE);
    next.offset[axis] = local;
    next.remainder[axis] += rounding;
  }
  return next;
}
export function relative(p, origin) {
  return Object.fromEntries(AXES.map(a => {
    const [offset, offsetError] = twoSum(p.offset[a], -origin.offset[a]);
    const [distance, sectorError] = twoSum((p.sector[a] - origin.sector[a]) * SECTOR_SIZE, offset);
    return [a, distance + (offsetError + sectorError + (p.remainder?.[a] ?? 0) - (origin.remainder?.[a] ?? 0))];
  }));
}
export function length(v) { return Math.hypot(v.x, v.y, v.z); }
export function systemKey(sector) { return AXES.map(a => sector[a]).join(':'); }

const STARS = [
  { preset: 'ember', radius: 240_000, temperature: 3200 },
  { preset: 'sun', radius: 696_340, temperature: 5778 },
  { preset: 'blueGiant', radius: 3_000_000, temperature: 18000 },
  { preset: 'redGiant', radius: 20_000_000, temperature: 3500 },
  { preset: 'whiteDwarf', radius: 8000, temperature: 12000 },
];
const ROCKY = ['terran', 'desert', 'ice', 'moon', 'lava', 'ocean', 'mars'];
const GIANTS = ['gasGiant', 'ringed', 'iceGiant'];

export function generateSystem(seed, sector) {
  const key = systemKey(sector);
  const rng = randomFor(`${seed}/system/${key}`);
  const starClass = STARS[Math.floor(rng() * STARS.length)];
  const starRadius = starClass.radius * (0.8 + rng() * 0.4);
  const centre = position(sector, Object.fromEntries(AXES.map(a => [a, (rng() - 0.5) * SECTOR_SIZE * 0.45])));
  const id = `${seed}/${key}`;
  const star = {
    id: `${id}/star`, name: `S ${key}`, type: 'star', preset: starClass.preset,
    radius: starRadius, position: centre, seed: Math.floor(rng() * 1_000_000),
    params: { starTemperature: starClass.temperature * (0.9 + rng() * 0.2), starBloom: 0.25 },
  };
  const bodies = [star];
  const count = 4 + Math.floor(rng() * 4);
  // Even giant stars have stable, non-intersecting orbits outside their envelope.
  let orbit = Math.max(0.25 * AU, starRadius * 8);
  for (let i = 0; i < count; i++) {
    if (i) orbit *= 1.55 + rng() * 0.5;
    const gas = i >= 2 && rng() > 0.32;
    const preset = i === 0 ? 'terran' : (gas ? GIANTS : ROCKY)[Math.floor(rng() * (gas ? GIANTS.length : ROCKY.length))];
    const radius = gas ? 24_000 + rng() * 50_000 : 2400 + rng() * 6000;
    const angle = rng() * Math.PI * 2;
    const inclination = (rng() - 0.5) * 0.08;
    bodies.push({
      id: `${id}/${i}`, name: `${star.name} · ${i + 1}`, type: gas ? 'gas' : 'terrestrial', preset, radius, orbit,
      position: translate(centre, { x: Math.cos(angle) * orbit, y: Math.sin(inclination) * orbit, z: Math.sin(angle) * orbit }),
      seed: Math.floor(rng() * 1_000_000),
      params: gas ? { gasTilt: rng() * 35, gasStorms: rng() * 0.6 } : {
        heightScale: 2 + rng() * 3, tempBias: (rng() - 0.5) * 1.5,
        cloudCoverage: 0.15 + rng() * 0.5, noiseScale: 2 + rng() * 3,
      },
    });
  }
  return { id, key, sector: { ...sector }, star, bodies };
}
export function nearbySystems(seed, player) {
  const candidates = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const sector = { x: player.sector.x + x, y: player.sector.y + y, z: player.sector.z + z };
    const system = generateSystem(seed, sector);
    candidates.push({ system, distance: length(relative(system.star.position, player)) });
  }
  return candidates.sort((a, b) => a.distance - b.distance || a.system.key.localeCompare(b.system.key))
    .slice(0, MAX_SYSTEMS).map(c => c.system);
}
export function desiredBodies(systems, player, target = null) {
  return systems.flatMap(system => system.bodies.map(body => ({ body, system, distance: length(relative(body.position, player)) })))
    .filter(({ body, distance }) => body.type === 'star' || distance < LIGHT_YEAR * 0.015 || body.id === target)
    .sort((a, b) => Number(b.body.id === target) - Number(a.body.id === target) || a.distance - b.distance)
    .slice(0, MAX_BODIES);
}
export function clearanceRadius(body) {
  return body.radius * (body.type === 'terrestrial' ? 1 + body.params.heightScale / 2000 : 1) + 0.01;
}
export function formatDistance(km) {
  if (km >= LIGHT_YEAR * 0.01) return `${(km / LIGHT_YEAR).toFixed(2)} ly`;
  if (km >= AU * 0.01) return `${(km / AU).toFixed(3)} AU`;
  if (km >= 1) return `${km.toLocaleString('en-US', { maximumFractionDigits: km < 100 ? 2 : 0 })} km`;
  return `${(km * 1000).toFixed(1)} m`;
}
export function formatSpeed(km) { return `${formatDistance(km)}/s`; }
