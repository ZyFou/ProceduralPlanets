import { AU, hashSeed, position, translate } from './world.js';

// km, mean spherical radii; orbital elements from NASA/JPL (sources and the
// approximation policy are listed in docs/solar-system.md). Frozen J2000
// Kepler ellipses for planets, circular mean-distance illustrations for moons.
// No textures or second renderer: every body is a package Planet preset.
export const SOLAR_PLANETS = [
  // name, radius, a (AU), e, inclination, L, perihelion longitude, node, preset
  ['Mercury', 2439.4, .38709927, .20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 'moon'],
  ['Venus', 6051.8, .72333566, .00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 'desert'],
  ['Earth', 6371.0084, 1.00000261, .01671123, -.00001531, 100.46457166, 102.93768193, 0, 'terran'],
  ['Mars', 3389.5, 1.52371034, .09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 'mars'],
  ['Jupiter', 69911, 5.202887, .04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 'gasGiant'],
  ['Saturn', 58232, 9.53667594, .05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 'ringed'],
  ['Uranus', 25362, 19.18916464, .04725744, .77263783, 313.23810451, 170.9542763, 74.01692503, 'iceGiant'],
  ['Neptune', 24622, 30.06992276, .00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 'iceGiant'],
  // Pluto uses the NASA J2000 mean elements.
  ['Pluto', 1188.3, 39.48168677, .24880766, 17.14175, 238.92881, 224.06676, 110.30347, 'ice'],
];
export const SOLAR_MOONS = [
  // parent, name, mean radius (km), mean orbital semimajor axis (km), preset
  ['Earth', 'Moon', 1737.4, 384400, 'moon'],
  ['Mars', 'Phobos', 11.08, 9375, 'moon'], ['Mars', 'Deimos', 6.2, 23457, 'moon'],
  ['Jupiter', 'Io', 1821.49, 421800, 'lava'], ['Jupiter', 'Europa', 1560.8, 671100, 'ice'],
  ['Jupiter', 'Ganymede', 2631.2, 1070400, 'moon'], ['Jupiter', 'Callisto', 2410.3, 1882700, 'moon'],
  ['Jupiter', 'Amalthea', 83.5, 181400, 'moon'],
  ['Saturn', 'Mimas', 198.2, 186000, 'ice'], ['Saturn', 'Enceladus', 252.1, 238400, 'ice'],
  ['Saturn', 'Tethys', 531.1, 295000, 'ice'], ['Saturn', 'Dione', 561.4, 377700, 'ice'],
  ['Saturn', 'Rhea', 763.5, 527200, 'ice'], ['Saturn', 'Titan', 2574.76, 1221900, 'desert'],
  ['Saturn', 'Hyperion', 135, 1481500, 'moon'], ['Saturn', 'Iapetus', 734.3, 3561700, 'moon'],
  ['Uranus', 'Miranda', 235.8, 129846, 'ice'], ['Uranus', 'Ariel', 578.9, 190929, 'ice'],
  ['Uranus', 'Umbriel', 584.7, 265986, 'moon'], ['Uranus', 'Titania', 788.9, 436298, 'ice'],
  ['Uranus', 'Oberon', 761.4, 583511, 'moon'],
  ['Neptune', 'Triton', 1352.6, 354800, 'ice'], ['Neptune', 'Proteus', 208, 117600, 'moon'],
  ['Pluto', 'Charon', 606, 19596, 'moon'],
];
const rad = degrees => degrees * Math.PI / 180;
export function keplerPosition([, , a, e, inclination, longitude, perihelion, node]) {
  const M = rad(longitude - perihelion);
  let E = M;
  for (let n = 0; n < 12; n++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const x = a * AU * (Math.cos(E) - e), z = a * AU * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = rad(perihelion - node), o = rad(node), i = rad(inclination);
  return {
    x: (Math.cos(w) * Math.cos(o) - Math.sin(w) * Math.sin(o) * Math.cos(i)) * x + (-Math.sin(w) * Math.cos(o) - Math.cos(w) * Math.sin(o) * Math.cos(i)) * z,
    y: Math.sin(w) * Math.sin(i) * x + Math.cos(w) * Math.sin(i) * z,
    z: (Math.cos(w) * Math.sin(o) + Math.sin(w) * Math.cos(o) * Math.cos(i)) * x + (-Math.sin(w) * Math.sin(o) + Math.cos(w) * Math.cos(o) * Math.cos(i)) * z,
  };
}
export function generateSolarSystem() {
  const centre = position();
  const star = { id: 'sol/Sun', name: 'Sun', type: 'star', preset: 'sun', radius: 695700, position: centre, seed: 5772, params: { starTemperature: 5772, starBloom: .25 } };
  const bodies = [star];
  const planets = new Map();
  for (const row of SOLAR_PLANETS) {
    const [name, radius, a, , , , , , preset] = row;
    const gas = ['Jupiter', 'Saturn', 'Uranus', 'Neptune'].includes(name);
    const air = ['Earth', 'Venus'].includes(name);
    const params = gas ? { gasTilt: name === 'Uranus' ? 97.77 : name === 'Saturn' ? 26.73 : 3.13 } : {
      heightScale: name === 'Earth' ? 2 : 3,
      atmoEnabled: air, cloudsEnabled: air, waterEnabled: name === 'Earth',
      cloudCoverage: name === 'Venus' ? .85 : .35,
    };
    const body = { id: `sol/${name}`, name, type: gas ? 'gas' : 'terrestrial', preset, radius, orbit: a * AU,
      position: translate(centre, keplerPosition(row)), seed: hashSeed(`sol/${name}`) % 1000000, params };
    planets.set(name, body); bodies.push(body);
  }
  for (const [parentName, name, radius, orbit, preset] of SOLAR_MOONS) {
    const parent = planets.get(parentName);
    const angle = hashSeed(name) / 0x100000000 * Math.PI * 2;
    // Illustrative orbital planes: lunar inclination, Uranian equatorial tilt,
    // Triton's retrograde inclination, otherwise an equatorial approximation.
    const tilt = rad(parentName === 'Uranus' ? 97.77 : name === 'Moon' ? 5.16 : name === 'Triton' ? 157.3 : 0);
    const params = { heightScale: Math.min(5, 2000 * 2 / radius), waterEnabled: false, atmoEnabled: name === 'Titan',
      cloudsEnabled: name === 'Titan', cloudCoverage: .8 };
    bodies.push({ id: `sol/${name}`, name, parentId: parent.id, type: 'terrestrial', preset, radius, orbit,
      position: translate(parent.position, { x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit * Math.sin(tilt), z: Math.sin(angle) * orbit * Math.cos(tilt) }),
      seed: hashSeed(`sol/${name}`) % 1000000, params });
  }
  return { id: 'sol', key: 'Solar System', sector: { ...centre.sector }, star, bodies };
}
