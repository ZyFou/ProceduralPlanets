// ============================================================================
// Default parameters + planet style presets. Params are a flat object; the
// engine maps them onto shader uniforms (see materials.js UNIFORM_MAP) or
// world/geometry rebuilds for the few structural keys.
// ============================================================================

// Star-mode parameters (flat, star-prefixed so the two domains never collide).
// The photosphere colour is physical: a blackbody at starTemperature, tinted.
export const STAR_DEFAULTS = {
  starTemperature: 5772,   // effective temperature (K) — the Sun
  // artistic filter over the blackbody colour: a real 5772 K disc is a pale
  // peach-white on screen; this warms it toward the familiar golden Sun
  starTint: [1.000, 0.980, 0.700],
  starBrightness: 1.0,     // emitted radiance (drives glare / bloom)
  starNoiseScale: 3.0,     // granulation scale
  starTurbulence: 0.6,     // supergranulation network / mottling
  starGranules: 0.9,       // granulation contrast
  starFlowSpeed: 1.0,      // convection + rotation speed
  starFaculae: 0.8,        // bright network toward the limb
  starSpotsEnabled: true,
  starSpots: 0.4,          // sunspot coverage
  starSpotScale: 2.4,      // active-region size (frequency)
  starLimbDarken: 1.0,     // 1 = solar limb darkening
  starBloom: 1.0,          // glare / bloom strength
  starPulseAmount: 0.0,    // radius breathing (pulsating variables)
  starPulseSpeed: 1.2,
  starCoronaEnabled: true,
  starCoronaColor: [1.000, 0.940, 0.860],
  starCoronaSize: 0.6,     // halo extent (fraction of radius)
  starCoronaStrength: 0.6,
  starFlares: 0.7,         // streamer contrast in the corona
  starProminences: 0.5,    // limb prominences
  starChromoColor: [1.000, 0.300, 0.220],  // H-alpha chromosphere / prominences
};

export const STAR_KEYS = new Set(Object.keys(STAR_DEFAULTS));

// Gas-mode parameters (flat, gas-prefixed — own domain like the star's, so
// planet presets never clobber gas customization and vice versa). Palette
// colours are sRGB albedos, like the planet's.
export const GAS_DEFAULTS = {
  gasBandCount: 18,        // belts + zones, pole to pole
  gasContrast: 0.6,        // belt / zone contrast
  gasBandWarp: 0.5,        // band edge waviness
  gasWarp: 0.75,           // eddy turbulence in the shear zones
  gasScale: 3.0,           // eddy size (frequency)
  gasFlowSpeed: 1.0,       // jet + churn speed
  gasPolarHaze: 0.55,      // polar region extent / haze
  gasLimb: 0.5,            // Minnaert limb darkening
  gasTilt: 8,              // axial tilt (degrees)
  gasStormsEnabled: true,
  gasGreatSpot: 0.65,      // great storm size (0 = none)
  gasStorms: 0.5,          // small oval count
  gasStormScale: 1.0,      // small oval size
  gasColorZone:   [0.820, 0.740, 0.600],
  gasColorBelt:   [0.560, 0.400, 0.290],
  gasColorAccent: [0.680, 0.380, 0.230],
  gasColorStorm:  [0.700, 0.330, 0.200],
  gasColorPolar:  [0.520, 0.530, 0.560],
  gasAtmoColor: [0.55, 0.68, 1.00],  // high haze Rayleigh tint
  gasAtmoStrength: 0.15,   // air above the cloud tops
  gasAtmoHaze: 0.5,        // aerosol haze (Mie)
  gasRingsEnabled: false,
  gasRingInner: 1.25,      // x radius
  gasRingOuter: 2.25,
  gasRingOpacity: 1.0,     // optical depth scale
  gasRingColor: [0.860, 0.800, 0.690],
};

export const GAS_KEYS = new Set(Object.keys(GAS_DEFAULTS));

export const DEFAULT_PARAMS = {
  // mode: 'planet' | 'gas' | 'star' — toggles which scene set is live
  mode: 'planet',
  // bumped when the look model changes; older projects get their look keys
  // migrated (see migrateParams)
  renderVersion: 3,
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

export function migrateParams(params = {}, presetKey = 'terran', modePreset = {}) {
  const version = params.renderVersion ?? 1;
  if (version >= DEFAULT_PARAMS.renderVersion) return params;
  const out = { ...params, renderVersion: DEFAULT_PARAMS.renderVersion };
  if (version < 2) {
    const patch = PLANET_PRESETS[presetKey]?.patch ?? {};
    for (const key of Object.keys(DEFAULT_PARAMS)) {
      if (key.endsWith('Enabled')) continue;
      if (LOOK_KEY_PATTERN.test(key) || LOOK_KEYS_EXTRA.includes(key)) {
        out[key] = key in patch ? patch[key] : DEFAULT_PARAMS[key];
      }
    }
    // the old default relief was tuned for the old height curve
    if (params.heightScale === 130) out.heightScale = patch.heightScale ?? DEFAULT_PARAMS.heightScale;
  }
  if (version < 3) {
    // gas + star moved from posterized toon shaders to physically based ones:
    // their whole domains are reset (to the project's template preset if any)
    // and the retired keys dropped
    for (const key of Object.keys(out)) {
      if ((key.startsWith('gas') || key.startsWith('star')) && !(key in DEFAULT_PARAMS)) delete out[key];
    }
    const gasPatch = GAS_PRESETS[modePreset.gas]?.patch ?? {};
    const starPatch = STAR_PRESETS[modePreset.star]?.patch ?? {};
    Object.assign(out, GAS_DEFAULTS, gasPatch, STAR_DEFAULTS, starPatch);
  }
  return out;
}

// Gas giant style presets — patches over GAS_DEFAULTS (gas keys only).
export const GAS_PRESETS = {
  gasGiant: {
    label: 'Jovian',
    patch: {}, // the defaults ARE a banded Jupiter-like giant with a great spot
  },
  ringed: {
    label: 'Ringed',
    patch: {
      gasBandCount: 20, gasContrast: 0.3, gasBandWarp: 0.3, gasWarp: 0.35, gasScale: 2.6,
      gasGreatSpot: 0.0, gasStorms: 0.15, gasPolarHaze: 0.7, gasLimb: 0.65, gasTilt: 26.7,
      gasColorZone: [0.930, 0.860, 0.700], gasColorBelt: [0.780, 0.660, 0.480],
      gasColorAccent: [0.800, 0.620, 0.420], gasColorStorm: [0.950, 0.920, 0.840],
      gasColorPolar: [0.620, 0.660, 0.680],
      gasAtmoColor: [0.80, 0.78, 0.70], gasAtmoStrength: 0.3, gasAtmoHaze: 0.85,
      gasRingsEnabled: true, gasRingInner: 1.24, gasRingOuter: 2.3, gasRingOpacity: 1.0,
      gasRingColor: [0.880, 0.820, 0.700],
    },
  },
  iceGiant: {
    label: 'Ice Giant',
    patch: {
      gasBandCount: 7, gasContrast: 0.22, gasBandWarp: 0.6, gasWarp: 0.35, gasScale: 2.2,
      gasFlowSpeed: 0.7, gasGreatSpot: 0.4, gasStorms: 0.25, gasStormScale: 1.2,
      gasPolarHaze: 0.4, gasLimb: 0.8, gasTilt: 28,
      gasColorZone: [0.500, 0.680, 0.940], gasColorBelt: [0.260, 0.430, 0.820],
      gasColorAccent: [0.200, 0.320, 0.700], gasColorStorm: [0.100, 0.150, 0.400],
      gasColorPolar: [0.560, 0.720, 0.920],
      gasAtmoColor: [0.30, 0.55, 1.00], gasAtmoStrength: 1.1, gasAtmoHaze: 0.35,
      gasRingsEnabled: true, gasRingInner: 1.7, gasRingOuter: 2.0, gasRingOpacity: 0.05,
      gasRingColor: [0.500, 0.500, 0.520],
    },
  },
  toxic: {
    label: 'Toxic',
    patch: {
      gasBandCount: 11, gasContrast: 0.55, gasWarp: 0.9, gasScale: 3.4, gasFlowSpeed: 1.3,
      gasGreatSpot: 0.5, gasStorms: 0.6, gasPolarHaze: 0.6,
      gasColorZone: [0.780, 0.820, 0.480], gasColorBelt: [0.380, 0.460, 0.200],
      gasColorAccent: [0.600, 0.520, 0.140], gasColorStorm: [0.860, 0.680, 0.220],
      gasColorPolar: [0.420, 0.480, 0.380],
      gasAtmoColor: [0.60, 0.85, 0.45], gasAtmoStrength: 0.5, gasAtmoHaze: 0.9,
    },
  },
  nebular: {
    label: 'Nebular',
    patch: {
      gasBandCount: 16, gasContrast: 0.5, gasWarp: 1.0, gasScale: 2.8, gasFlowSpeed: 0.9,
      gasGreatSpot: 0.55, gasStorms: 0.45, gasTilt: 18,
      gasColorZone: [0.820, 0.700, 0.900], gasColorBelt: [0.420, 0.250, 0.560],
      gasColorAccent: [0.700, 0.300, 0.520], gasColorStorm: [0.950, 0.720, 0.460],
      gasColorPolar: [0.360, 0.300, 0.520],
      gasAtmoColor: [0.70, 0.55, 1.00], gasAtmoStrength: 0.45, gasAtmoHaze: 0.5,
      gasRingsEnabled: true, gasRingInner: 1.35, gasRingOuter: 2.0, gasRingOpacity: 0.55,
      gasRingColor: [0.780, 0.700, 0.820],
    },
  },
};

// Star style presets — patches over STAR_DEFAULTS (star keys only, so a star
// preset never clobbers planet customization and vice versa).
export const STAR_PRESETS = {
  sun: {
    label: 'Sun',
    patch: {}, // the defaults ARE a G2V star
  },
  redGiant: {
    label: 'Red Giant',
    patch: {
      starTint: [1.000, 1.000, 1.000],
      starTemperature: 3500, starBrightness: 1.4, starNoiseScale: 1.1, starTurbulence: 1.2,
      starGranules: 1.0, starFlowSpeed: 0.4, starFaculae: 0.4, starSpots: 0.3, starSpotScale: 1.4,
      starLimbDarken: 1.3, starPulseAmount: 0.01, starPulseSpeed: 0.3,
      starCoronaColor: [1.000, 0.700, 0.500], starCoronaSize: 1.0, starCoronaStrength: 0.45,
      starFlares: 0.5, starProminences: 0.2, starChromoColor: [1.000, 0.350, 0.200],
    },
  },
  blueGiant: {
    label: 'Blue Giant',
    patch: {
      starTint: [1.000, 1.000, 1.000],
      starTemperature: 22000, starBrightness: 2.4, starNoiseScale: 4.5, starGranules: 0.35,
      starTurbulence: 0.4, starFlowSpeed: 1.6, starSpots: 0.0, starFaculae: 0.3,
      starLimbDarken: 0.7, starBloom: 1.4,
      starCoronaColor: [0.780, 0.860, 1.000], starCoronaSize: 1.0, starCoronaStrength: 0.8,
      starFlares: 0.9, starProminences: 0.15, starChromoColor: [0.700, 0.550, 1.000],
    },
  },
  whiteDwarf: {
    label: 'White Dwarf',
    patch: {
      starTint: [1.000, 1.000, 1.000],
      starTemperature: 12000, starBrightness: 3.0, starNoiseScale: 7.0, starGranules: 0.15,
      starTurbulence: 0.15, starSpots: 0.0, starFaculae: 0.1, starLimbDarken: 0.55,
      starBloom: 1.6,
      starCoronaColor: [0.850, 0.900, 1.000], starCoronaSize: 0.25, starCoronaStrength: 0.35,
      starFlares: 0.3, starProminences: 0.0,
    },
  },
  ember: {
    label: 'Red Dwarf',
    patch: {
      starTint: [1.000, 1.000, 1.000],
      starTemperature: 3000, starBrightness: 0.75, starNoiseScale: 2.4, starGranules: 0.8,
      starTurbulence: 0.8, starFlowSpeed: 0.6, starSpots: 0.75, starSpotScale: 1.8,
      starFaculae: 1.0, starLimbDarken: 1.2,
      starCoronaColor: [1.000, 0.600, 0.420], starCoronaSize: 0.35, starCoronaStrength: 0.4,
      starFlares: 1.0, starProminences: 1.0, starChromoColor: [1.000, 0.300, 0.180],
    },
  },
  eldritch: {
    label: 'Eldritch',
    patch: {
      starTemperature: 7000, starTint: [0.550, 1.000, 0.600], starBrightness: 1.8,
      starNoiseScale: 2.6, starTurbulence: 1.3, starGranules: 1.0, starFlowSpeed: 1.6,
      starSpots: 0.55, starSpotScale: 3.2, starPulseAmount: 0.015, starPulseSpeed: 1.8,
      starCoronaColor: [0.500, 1.000, 0.550], starCoronaSize: 1.2, starCoronaStrength: 1.0,
      starFlares: 1.3, starProminences: 0.8, starChromoColor: [0.450, 1.000, 0.300],
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
