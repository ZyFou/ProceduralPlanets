// ============================================================================
// Default parameters + planet style presets. Params are a flat object; the
// engine maps them onto shader uniforms (see materials.js UNIFORM_MAP) or
// world/geometry rebuilds for the few structural keys.
// ============================================================================

// Star-mode parameters (flat, star-prefixed so the two domains never collide).
export const STAR_DEFAULTS = {
  starColorCore: [1.000, 0.930, 0.550],
  starColorMid:  [1.000, 0.550, 0.100],
  starColorEdge: [0.860, 0.220, 0.020],
  starSpotColor: [0.420, 0.100, 0.020],
  starNoiseScale: 3.0,
  starTurbulence: 0.55,    // domain warp of the granulation
  starGranules: 0.60,      // granulation contrast
  starFlowSpeed: 1.0,      // how fast the surface boils
  starSpotsEnabled: true,
  starSpots: 0.35,         // sunspot coverage
  starSpotScale: 2.4,
  starLimbDarken: 0.55,
  starBands: 5,            // posterize levels (0 = smooth)
  starGlow: 0.5,           // additive hot rim on the disc
  starPulseAmount: 0.015,  // radius breathing / surface wobble
  starPulseSpeed: 1.2,
  starCoronaEnabled: false,
  starCoronaColor: [1.000, 0.550, 0.120],
  starCoronaSize: 0.0,     // halo extent (fraction of radius)
  starCoronaStrength: 1.0,
  starFlares: 0.7,         // wispy streaks in the corona
};

export const STAR_KEYS = new Set(Object.keys(STAR_DEFAULTS));

// Gas-mode parameters (flat, gas-prefixed — own domain like the star's, so
// planet presets never clobber gas customization and vice versa).
export const GAS_DEFAULTS = {
  gasScale: 2.4,
  gasWarp: 0.9,            // swirl turbulence (two-pass domain warp)
  gasContrast: 0.65,
  gasFlowSpeed: 1.0,
  gasBands: 5,             // posterize levels (0 = smooth)
  gasStretch: 0.0,         // 0 = free swirls, >0 pulls toward latitude stripes
  gasStormsEnabled: true,
  gasStorms: 0.45,         // storm oval coverage
  gasStormScale: 1.5,
  gasLimb: 0.55,
  gasColorDeep:  [0.340, 0.160, 0.100],
  gasColorBase:  [0.760, 0.540, 0.330],
  gasColorSwirl: [0.950, 0.860, 0.660],
  gasColorStorm: [0.820, 0.300, 0.160],
};

export const GAS_KEYS = new Set(Object.keys(GAS_DEFAULTS));

export const DEFAULT_PARAMS = {
  // mode: 'planet' | 'gas' | 'star' — toggles which scene set is live
  mode: 'planet',
  // bumped when the look model changes; older projects get their look keys
  // migrated (see migrateParams)
  renderVersion: 2,
  ...STAR_DEFAULTS,
  ...GAS_DEFAULTS,

  // world / shape
  seed: 1337,
  radius: 2000,
  heightScale: 80,
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

  // lighting / camera
  sunAzimuth: 100,         // degrees (3/4 light from the default camera)
  sunElevation: 18,
  sunIntensity: 1.0,
  ambient: 0.25,           // sky light strength
  exposure: 1.0,
  toonEnabled: false,      // optional cartoon banding of the sun term
  toonBands: 4,
  toonSoftness: 0.06,
  bandSoftness: 0.05,      // biome transition width
  snowLine: 0.62,          // 0..1 height above sea where snow starts (equator)
  polarCaps: 0.55,         // 0..1 extent of polar ice (land + sea ice)

  // biomes (temperature x moisture grid; grass/forest double as the
  // temperate mid/wet cells). Palette colours are sRGB albedos.
  biomeAmount: 1.0,        // 0 = plain altitude ramp, 1 = full biome map
  tempBias: 0.0,           // -1 frozen .. +1 scorching
  moistureScale: 2.0,      // frequency of the moisture field
  bioTundra:  [0.500, 0.480, 0.410],
  bioSteppe:  [0.530, 0.510, 0.350],
  bioTaiga:   [0.150, 0.220, 0.140],
  bioShrub:   [0.560, 0.500, 0.340],
  bioDesert:  [0.820, 0.680, 0.480],
  bioSavanna: [0.560, 0.500, 0.280],
  bioJungle:  [0.090, 0.190, 0.070],

  colDeep:    [0.020, 0.075, 0.170],   // deep-water body colour (scattering)
  colShallow: [0.300, 0.740, 0.740],   // tint after one clarity depth of water
  colSand:    [0.780, 0.710, 0.560],
  colGrass:   [0.330, 0.400, 0.190],
  colForest:  [0.150, 0.240, 0.110],
  colRock:    [0.420, 0.380, 0.340],
  colSnow:    [0.930, 0.950, 0.970],
  colFoam:    [0.920, 0.950, 0.960],

  // water
  waterEnabled: true,
  waterOpacity: 0.78,      // export-only (glTF ocean shell)
  waterClarity: 0.07,      // clarity depth, fraction of heightScale
  waveSize: 6.0,           // longest wavelength, world units
  waveHeight: 0.8,         // wave steepness / roughness
  waveSpeed: 1.0,
  waterSpec: 1.0,          // sun glint strength
  foamWidth: 0.25,         // shore foam band (depth-based)
  foamAmount: 1.0,
  whitecaps: 0.3,
  waterEmissive: 0.0,      // 1 = molten (lava seas)

  // clouds (volumetric)
  cloudsEnabled: true,
  cloudCoverage: 0.45,
  cloudSoftness: 0.18,     // width of the coverage falloff (wispy edges)
  cloudDensity: 0.8,       // optical thickness
  cloudScale: 3.2,         // weather-system frequency
  cloudDetail: 0.7,        // erosion strength
  cloudDetailScale: 1.0,   // size of the billows
  cloudAltitude: 0.004,    // cloud base above sea level, fraction of radius
  cloudThickness: 0.009,   // shell thickness, fraction of radius
  cloudSpeed: 0.6,
  cloudShadowStrength: 0.6,
  cloudQuality: 64,        // max raymarch steps
  cloudResolution: 0.5,    // cloud pass resolution scale
  cloudColor:  [1.0, 1.0, 1.0],
  cloudShadow: [0.78, 0.84, 0.95],   // ambient (sky-lit) tint

  // atmosphere (single scattering, scaled to the planet)
  atmoEnabled: true,
  atmoColor: [0.35, 0.60, 1.0],      // Rayleigh tint (blue = Earth)
  atmoStrength: 1.0,                 // air density
  atmoHeight: 0.045,                 // thickness, fraction of radius
  atmoHaze: 0.3,                     // aerosols / dust (Mie)

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
      tempBias: 0.75, moistureScale: 2.4, polarCaps: 0.35, snowLine: 0.9,
      bioShrub: [0.700, 0.540, 0.360], bioSavanna: [0.720, 0.580, 0.360],
      bioJungle: [0.420, 0.400, 0.230], bioDesert: [0.860, 0.660, 0.440],
      bioSteppe: [0.680, 0.580, 0.420], bioTundra: [0.700, 0.640, 0.540],
      colDeep: [0.030, 0.140, 0.220], colShallow: [0.420, 0.860, 0.780],
      colSand: [0.880, 0.720, 0.520], colGrass: [0.620, 0.500, 0.320],
      colForest: [0.420, 0.360, 0.220], colRock: [0.560, 0.380, 0.260],
      colSnow: [0.960, 0.930, 0.890],
      cloudCoverage: 0.22, atmoColor: [0.55, 0.62, 0.85], atmoHaze: 0.75,
    },
  },
  ice: {
    label: 'Ice',
    patch: {
      seaLevel: 0.38, snowLine: 0.18, polarCaps: 1.0, tempBias: -0.8,
      bioTundra: [0.720, 0.740, 0.740], bioSteppe: [0.580, 0.600, 0.560],
      bioTaiga: [0.260, 0.320, 0.290],
      colDeep: [0.020, 0.070, 0.140], colShallow: [0.300, 0.700, 0.780],
      colSand: [0.600, 0.620, 0.620], colGrass: [0.520, 0.560, 0.540],
      colForest: [0.300, 0.360, 0.340], colRock: [0.400, 0.420, 0.440],
      cloudCoverage: 0.6, atmoColor: [0.40, 0.62, 1.0],
    },
  },
  moon: {
    label: 'Moon',
    patch: {
      waterEnabled: false, cloudsEnabled: false, atmoEnabled: false,
      craters: 0.9, craterScale: 7.0, ridge: 0.25, continents: 0.2,
      heightScale: 60, seaLevel: 0.0, polarCaps: 0.0, snowLine: 1.2,
      biomeAmount: 0.0, cloudShadowStrength: 0.0, ambient: 0.05,
      colSand: [0.560, 0.550, 0.530], colGrass: [0.500, 0.490, 0.480],
      colForest: [0.420, 0.410, 0.400], colRock: [0.360, 0.350, 0.345],
      colDeep: [0.180, 0.180, 0.185], colShallow: [0.280, 0.280, 0.285],
      colSnow: [0.620, 0.615, 0.610],
    },
  },
  lava: {
    label: 'Lava',
    patch: {
      seaLevel: 0.36, cloudsEnabled: false, cloudShadowStrength: 0.0,
      waterEmissive: 1.0, waterClarity: 0.01, waveSize: 14, waveHeight: 0.35,
      waveSpeed: 0.2, waterSpec: 0.3, foamWidth: 0.35, foamAmount: 1.0, whitecaps: 0.9,
      biomeAmount: 0.0, polarCaps: 0.0, snowLine: 1.2,
      colDeep: [0.700, 0.120, 0.010], colShallow: [1.000, 0.560, 0.100],
      colFoam: [0.100, 0.080, 0.075],
      colSand: [0.200, 0.160, 0.150], colGrass: [0.180, 0.150, 0.140],
      colForest: [0.140, 0.120, 0.115], colRock: [0.110, 0.095, 0.090],
      colSnow: [0.350, 0.300, 0.280],
      atmoColor: [0.80, 0.55, 0.40], atmoHaze: 1.0, atmoStrength: 0.8,
    },
  },
  ocean: {
    label: 'Ocean',
    patch: {
      seaLevel: 0.52, continents: 0.50, noiseScale: 3.2, warp: 0.9,
      ridge: 0.45, tempBias: 0.25, moistureScale: 2.6,
      colDeep: [0.020, 0.080, 0.200], colShallow: [0.300, 0.820, 0.800],
      colSand: [0.900, 0.840, 0.660],
      cloudCoverage: 0.52, foamWidth: 0.3, whitecaps: 0.5,
      atmoStrength: 1.1,
    },
  },
  mars: {
    label: 'Mars',
    patch: {
      waterEnabled: false, cloudsEnabled: false, cloudShadowStrength: 0.0,
      atmoStrength: 0.35, atmoColor: [0.95, 0.80, 0.70], atmoHaze: 1.0,
      seaLevel: 0.0, craters: 0.45, craterScale: 9.0, ridge: 0.8,
      mountainScale: 3.0, biomeAmount: 0.0, heightScale: 100, continents: 0.4,
      colSand: [0.760, 0.480, 0.300], colGrass: [0.680, 0.400, 0.240],
      colForest: [0.560, 0.320, 0.200], colRock: [0.420, 0.260, 0.180],
      colDeep: [0.300, 0.140, 0.080], colShallow: [0.450, 0.220, 0.120],
      colSnow: [0.920, 0.890, 0.860], snowLine: 1.2, polarCaps: 0.55,
    },
  },
  swamp: {
    label: 'Swamp',
    patch: {
      seaLevel: 0.50, heightScale: 55, ridge: 0.2, warp: 1.2, continents: 0.35,
      tempBias: 0.35, moistureScale: 3.5, waterClarity: 0.04, waterSpec: 0.6,
      waveSize: 3, waveHeight: 0.4, waveSpeed: 0.4, foamWidth: 0.12, whitecaps: 0.0,
      bioJungle: [0.100, 0.200, 0.080], bioSavanna: [0.360, 0.420, 0.200],
      bioDesert: [0.520, 0.500, 0.320], bioShrub: [0.420, 0.440, 0.250],
      colDeep: [0.050, 0.080, 0.040], colShallow: [0.520, 0.600, 0.340],
      colFoam: [0.760, 0.800, 0.640], colSand: [0.460, 0.440, 0.300],
      colGrass: [0.260, 0.340, 0.150], colForest: [0.120, 0.200, 0.090],
      colRock: [0.320, 0.320, 0.260], colSnow: [0.860, 0.880, 0.840],
      snowLine: 1.0, polarCaps: 0.15,
      cloudCoverage: 0.58, cloudColor: [0.94, 0.96, 0.90], atmoHaze: 0.7,
      atmoColor: [0.45, 0.62, 0.80],
    },
  },
  alien: {
    label: 'Alien',
    patch: {
      tempBias: 0.2, moistureScale: 3.0, snowLine: 0.8,
      bioTundra: [0.560, 0.620, 0.600], bioSteppe: [0.460, 0.560, 0.520],
      bioTaiga: [0.200, 0.330, 0.400], bioShrub: [0.580, 0.500, 0.520],
      bioDesert: [0.780, 0.700, 0.560], bioSavanna: [0.520, 0.440, 0.500],
      bioJungle: [0.260, 0.100, 0.300],
      colDeep: [0.120, 0.020, 0.180], colShallow: [0.700, 0.420, 0.880],
      colFoam: [0.950, 0.880, 1.000], colSand: [0.760, 0.720, 0.600],
      colGrass: [0.420, 0.300, 0.440], colForest: [0.220, 0.120, 0.280],
      colRock: [0.360, 0.340, 0.400], colSnow: [0.920, 0.960, 0.960],
      cloudColor: [0.96, 1.00, 0.94], cloudShadow: [0.80, 0.90, 0.85],
      atmoColor: [0.55, 0.95, 0.70], atmoStrength: 1.2,
    },
  },
  ashen: {
    label: 'Ashen',
    patch: {
      seaLevel: 0.24, waterEmissive: 1.0, waterClarity: 0.01, waveSize: 10,
      waveHeight: 0.3, waveSpeed: 0.15, waterSpec: 0.2, foamWidth: 0.4, whitecaps: 0.8,
      biomeAmount: 0.0, ridge: 1.0, mountainScale: 3.2, polarCaps: 0.0,
      colDeep: [0.600, 0.100, 0.010], colShallow: [1.000, 0.450, 0.060],
      colFoam: [0.090, 0.085, 0.085],
      colSand: [0.180, 0.170, 0.170], colGrass: [0.220, 0.210, 0.210],
      colForest: [0.260, 0.250, 0.250], colRock: [0.120, 0.115, 0.115],
      colSnow: [0.550, 0.530, 0.530], snowLine: 1.2,
      cloudCoverage: 0.45, cloudColor: [0.42, 0.40, 0.42],
      cloudShadow: [0.40, 0.38, 0.42], cloudShadowStrength: 0.7,
      atmoColor: [0.75, 0.55, 0.45], atmoHaze: 1.0, atmoStrength: 0.9,
    },
  },
  candy: {
    label: 'Candy',
    patch: {
      bioTundra: [0.850, 0.800, 0.950], bioSteppe: [0.650, 0.850, 0.800],
      bioTaiga: [0.450, 0.700, 0.850], bioShrub: [0.950, 0.750, 0.600],
      bioDesert: [1.000, 0.800, 0.650], bioSavanna: [0.800, 0.900, 0.550],
      bioJungle: [0.300, 0.700, 0.550],
      colDeep: [0.300, 0.080, 0.360], colShallow: [0.950, 0.550, 0.850],
      colSand: [1.000, 0.850, 0.900], colGrass: [0.480, 0.850, 0.700],
      colForest: [0.250, 0.650, 0.600], colRock: [0.700, 0.550, 0.850],
      colSnow: [1.000, 0.970, 1.000], colFoam: [1.000, 0.900, 0.980],
      cloudColor: [1.0, 0.92, 0.97], atmoColor: [0.95, 0.60, 0.95],
      toonEnabled: true, toonBands: 3, cloudCoverage: 0.40,
    },
  },
};

// Keys that define a planet's LOOK (palette, lighting, water, clouds, air).
// Projects saved before renderVersion 2 were tuned for the old toon shading:
// their look keys are reset to the new defaults (or their template preset's
// values) while every shape key (seed, noise, sea level…) is preserved.
const LOOK_KEY_PATTERN = /^(col|bio|water|wave|foam|whitecaps|cloud|atmo|toon)/;
const LOOK_KEYS_EXTRA = ['sunIntensity', 'ambient', 'exposure', 'bandSoftness', 'snowLine',
  'polarCaps', 'biomeAmount', 'tempBias'];

export function migrateParams(params = {}, presetKey = 'terran') {
  if ((params.renderVersion ?? 1) >= DEFAULT_PARAMS.renderVersion) return params;
  const patch = PLANET_PRESETS[presetKey]?.patch ?? {};
  const out = { ...params, renderVersion: DEFAULT_PARAMS.renderVersion };
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    if (key.endsWith('Enabled')) continue;
    if (LOOK_KEY_PATTERN.test(key) || LOOK_KEYS_EXTRA.includes(key)) {
      out[key] = key in patch ? patch[key] : DEFAULT_PARAMS[key];
    }
  }
  // the old default relief was tuned for the old height curve
  if (params.heightScale === 130) out.heightScale = patch.heightScale ?? DEFAULT_PARAMS.heightScale;
  return out;
}

// Gas giant style presets — patches over GAS_DEFAULTS (gas keys only).
export const GAS_PRESETS = {
  gasGiant: {
    label: 'Gas Giant',
    patch: {}, // the defaults ARE a warm marbled amber giant
  },
  iceGiant: {
    label: 'Ice Giant',
    patch: {
      gasScale: 2.0, gasWarp: 1.25, gasContrast: 0.55, gasFlowSpeed: 0.7,
      gasBands: 4, gasStorms: 0.22, gasStormScale: 1.2, gasLimb: 0.65,
      gasColorDeep: [0.030, 0.090, 0.240], gasColorBase: [0.130, 0.340, 0.600],
      gasColorSwirl: [0.550, 0.880, 0.920], gasColorStorm: [0.880, 0.960, 1.000],
    },
  },
  toxic: {
    label: 'Toxic',
    patch: {
      gasScale: 2.8, gasWarp: 1.1, gasContrast: 0.75, gasFlowSpeed: 1.3,
      gasBands: 5, gasStorms: 0.55, gasStormScale: 2.0, gasLimb: 0.5,
      gasColorDeep: [0.070, 0.120, 0.040], gasColorBase: [0.330, 0.460, 0.130],
      gasColorSwirl: [0.780, 0.870, 0.340], gasColorStorm: [0.850, 0.640, 0.120],
    },
  },
  nebular: {
    label: 'Nebular',
    patch: {
      gasScale: 2.2, gasWarp: 1.4, gasContrast: 0.6, gasFlowSpeed: 0.9,
      gasBands: 6, gasStorms: 0.35, gasStormScale: 1.1, gasLimb: 0.7,
      gasColorDeep: [0.130, 0.030, 0.220], gasColorBase: [0.380, 0.150, 0.520],
      gasColorSwirl: [0.850, 0.550, 0.950], gasColorStorm: [1.000, 0.750, 0.400],
    },
  },
};

// Star style presets — patches over STAR_DEFAULTS (star keys only, so a star
// preset never clobbers planet customization and vice versa).
export const STAR_PRESETS = {
  sun: {
    label: 'Sun',
    patch: {}, // the defaults ARE a G-type toon sun
  },
  redGiant: {
    label: 'Red Giant',
    patch: {
      starColorCore: [1.000, 0.600, 0.250], starColorMid: [0.950, 0.300, 0.050],
      starColorEdge: [0.550, 0.080, 0.020], starSpotColor: [0.250, 0.040, 0.010],
      starNoiseScale: 2.0, starGranules: 0.50, starSpots: 0.55, starSpotScale: 1.6,
      starFlowSpeed: 0.5, starPulseAmount: 0.035, starPulseSpeed: 0.6,
      starCoronaEnabled: true, starCoronaColor: [1.000, 0.350, 0.080], starCoronaSize: 0.9,
      starCoronaStrength: 1.2, starFlares: 1.0, starLimbDarken: 0.7,
    },
  },
  blueGiant: {
    label: 'Blue Giant',
    patch: {
      starColorCore: [0.880, 0.960, 1.000], starColorMid: [0.450, 0.650, 1.000],
      starColorEdge: [0.130, 0.240, 0.850], starSpotColor: [0.060, 0.100, 0.450],
      starNoiseScale: 3.6, starFlowSpeed: 1.5, starGranules: 0.7,
      starSpots: 0.15, starLimbDarken: 0.4, starGlow: 0.8,
      starCoronaEnabled: true, starCoronaColor: [0.500, 0.700, 1.000], starCoronaSize: 0.6,
      starCoronaStrength: 1.1, starFlares: 0.8,
    },
  },
  whiteDwarf: {
    label: 'White Dwarf',
    patch: {
      starColorCore: [1.000, 1.000, 1.000], starColorMid: [0.850, 0.920, 1.000],
      starColorEdge: [0.600, 0.720, 0.950], starSpotColor: [0.400, 0.480, 0.700],
      starNoiseScale: 5.0, starGranules: 0.30, starSpots: 0.08,
      starFlowSpeed: 0.7, starGlow: 0.9, starBands: 3,
      starPulseAmount: 0.006, starPulseSpeed: 2.5,
      starCoronaEnabled: true, starCoronaColor: [0.750, 0.850, 1.000], starCoronaSize: 0.25,
      starCoronaStrength: 0.9, starFlares: 0.4, starLimbDarken: 0.35,
    },
  },
  ember: {
    label: 'Ember',
    patch: {
      starColorCore: [1.000, 0.450, 0.150], starColorMid: [0.500, 0.120, 0.040],
      starColorEdge: [0.120, 0.030, 0.020], starSpotColor: [0.040, 0.015, 0.010],
      starNoiseScale: 2.6, starGranules: 0.85, starSpots: 0.75, starSpotScale: 1.8,
      starFlowSpeed: 0.3, starGlow: 0.25, starLimbDarken: 0.85,
      starCoronaEnabled: true, starCoronaColor: [0.900, 0.250, 0.060], starCoronaSize: 0.3,
      starCoronaStrength: 0.5, starFlares: 0.5,
      starPulseAmount: 0.02, starPulseSpeed: 0.4,
    },
  },
  eldritch: {
    label: 'Eldritch',
    patch: {
      starColorCore: [0.750, 1.000, 0.550], starColorMid: [0.200, 0.850, 0.450],
      starColorEdge: [0.050, 0.300, 0.350], starSpotColor: [0.300, 0.050, 0.450],
      starNoiseScale: 3.4, starTurbulence: 1.3, starGranules: 0.8,
      starFlowSpeed: 1.6, starSpots: 0.45, starSpotScale: 3.2,
      starCoronaEnabled: true, starCoronaColor: [0.450, 1.000, 0.500], starCoronaSize: 0.8,
      starCoronaStrength: 1.4, starFlares: 1.3, starBands: 4,
      starPulseAmount: 0.03, starPulseSpeed: 1.8,
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
