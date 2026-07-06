// ============================================================================
// Default parameters + planet style presets. Params are a flat object; the
// engine maps them onto shader uniforms (see materials.js UNIFORM_MAP) or
// world/geometry rebuilds for the few structural keys.
// ============================================================================

export const DEFAULT_PARAMS = {
  // world / shape
  seed: 1337,
  radius: 2000,
  heightScale: 130,
  seaLevel: 0.42,          // fraction of heightScale

  // noise
  noiseScale: 2.6,
  octaves: 6,              // compile-time define (material rebuild)
  persistence: 0.52,
  lacunarity: 2.05,
  warp: 0.65,
  ridge: 0.55,
  mountainScale: 2.4,
  craters: 0.0,
  craterScale: 6.0,
  continents: 0.75,

  // lighting / toon style
  sunAzimuth: 35,          // degrees
  sunElevation: 24,
  sunIntensity: 1.15,
  ambient: 0.34,
  toonEnabled: true,
  toonBands: 4,
  toonSoftness: 0.06,
  bandSoftness: 0.035,     // color band transition width (terrain palette)
  snowLine: 0.72,          // 0..1 height fraction where snow starts
  polarCaps: 0.55,         // 0..1 strength of latitude snow

  // palette (RGB 0..1)
  colDeep:    [0.030, 0.135, 0.330],
  colShallow: [0.070, 0.560, 0.680],
  colSand:    [0.870, 0.780, 0.540],
  colGrass:   [0.330, 0.620, 0.270],
  colForest:  [0.130, 0.400, 0.190],
  colRock:    [0.480, 0.420, 0.370],
  colSnow:    [0.950, 0.960, 0.980],
  colFoam:    [0.900, 0.985, 0.970],

  // water
  waterEnabled: true,
  waterOpacity: 0.78,
  foamWidth: 0.13,         // fraction of heightScale near the shore
  waveScale: 32.0,
  waveSpeed: 0.7,
  waterSpec: 0.75,

  // clouds
  cloudsEnabled: true,
  cloudCoverage: 0.48,
  cloudSoftness: 0.05,     // low = hard cartoon edges
  cloudDensity: 0.95,
  cloudScale: 3.2,
  cloudDetail: 0.45,
  cloudAltitude: 0.055,    // fraction of radius
  cloudSpeed: 0.6,
  cloudColor:  [1.0, 1.0, 1.0],
  cloudShadow: [0.52, 0.58, 0.72],

  // atmosphere
  atmoEnabled: true,
  atmoColor: [0.35, 0.60, 1.0],
  atmoStrength: 0.85,

  // performance / render
  chunkRes: 32,            // grid quads per chunk side (rebuild)
  maxDepth: 5,             // quadtree depth (rebuild)
  splitFactor: 2.4,        // split when camDist < size * factor
  wireframe: false,
};

// Structural keys that need a world/material rebuild rather than a uniform set.
export const REBUILD_KEYS = new Set(['octaves', 'chunkRes', 'maxDepth']);

// Planet style presets — param patches over DEFAULT_PARAMS.
export const PLANET_PRESETS = {
  terran: {
    label: 'Terran',
    patch: {}, // the defaults ARE terran
  },
  desert: {
    label: 'Desert',
    patch: {
      seaLevel: 0.30, ridge: 0.72, warp: 0.85, continents: 0.55,
      colDeep: [0.045, 0.230, 0.420], colShallow: [0.110, 0.700, 0.680],
      colSand: [0.900, 0.560, 0.330], colGrass: [0.800, 0.420, 0.240],
      colForest: [0.620, 0.300, 0.180], colRock: [0.560, 0.280, 0.190],
      colSnow: [0.960, 0.930, 0.890], snowLine: 0.85, polarCaps: 0.75,
      cloudCoverage: 0.30, atmoColor: [0.95, 0.55, 0.30],
    },
  },
  ice: {
    label: 'Ice',
    patch: {
      seaLevel: 0.38, snowLine: 0.30, polarCaps: 1.0,
      colDeep: [0.070, 0.190, 0.330], colShallow: [0.280, 0.640, 0.720],
      colSand: [0.740, 0.820, 0.860], colGrass: [0.560, 0.700, 0.740],
      colForest: [0.420, 0.560, 0.620], colRock: [0.580, 0.640, 0.700],
      cloudCoverage: 0.55, atmoColor: [0.55, 0.75, 1.0],
    },
  },
  moon: {
    label: 'Moon',
    patch: {
      waterEnabled: false, cloudsEnabled: false, atmoStrength: 0.15,
      craters: 0.9, craterScale: 7.0, ridge: 0.25, continents: 0.2,
      heightScale: 90, seaLevel: 0.0, polarCaps: 0.0, snowLine: 1.1,
      colSand: [0.520, 0.510, 0.500], colGrass: [0.430, 0.420, 0.415],
      colForest: [0.360, 0.355, 0.350], colRock: [0.300, 0.295, 0.290],
      colDeep: [0.180, 0.180, 0.185], colShallow: [0.280, 0.280, 0.285],
      colSnow: [0.620, 0.615, 0.610],
    },
  },
  lava: {
    label: 'Lava',
    patch: {
      seaLevel: 0.34, waterOpacity: 0.95, cloudsEnabled: false,
      colDeep: [0.750, 0.150, 0.020], colShallow: [1.000, 0.520, 0.050],
      colFoam: [1.000, 0.820, 0.300],
      colSand: [0.240, 0.150, 0.130], colGrass: [0.300, 0.180, 0.140],
      colForest: [0.200, 0.120, 0.100], colRock: [0.140, 0.100, 0.100],
      colSnow: [0.350, 0.280, 0.260], snowLine: 0.90, polarCaps: 0.0,
      atmoColor: [1.0, 0.42, 0.10], waterSpec: 0.2, foamWidth: 0.10,
      waveSpeed: 0.25,
    },
  },
  candy: {
    label: 'Candy',
    patch: {
      colDeep: [0.360, 0.100, 0.420], colShallow: [0.850, 0.350, 0.750],
      colSand: [1.000, 0.850, 0.900], colGrass: [0.480, 0.850, 0.700],
      colForest: [0.250, 0.650, 0.600], colRock: [0.700, 0.550, 0.850],
      colSnow: [1.000, 0.970, 1.000], colFoam: [1.000, 0.900, 0.980],
      cloudColor: [1.0, 0.92, 0.97], atmoColor: [0.95, 0.50, 0.90],
      toonBands: 3, cloudCoverage: 0.40,
    },
  },
};

// Deterministic seed -> domain offset (mulberry32).
export function seedToOffset(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [next() * 512 - 256, next() * 512 - 256, next() * 512 - 256];
}
