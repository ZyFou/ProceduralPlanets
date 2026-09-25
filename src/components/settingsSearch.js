// Ctrl+K quick-search index — mirrors the ThreeTerrain settings search but
// mapped onto this app's PANELS ids (see panels.jsx).

const SETTINGS_INDEX = [
  // Terrain
  { panelId: 'terrain', sectionLabel: 'Planet', settingId: 'terrain.radius', label: 'Radius', keywords: 'planet size radius sphere' },
  { panelId: 'terrain', sectionLabel: 'Planet', settingId: 'terrain.heightScale', label: 'Height scale', keywords: 'height elevation mountain amplitude terrain' },
  { panelId: 'terrain', sectionLabel: 'Planet', settingId: 'terrain.seaLevel', label: 'Sea level', keywords: 'water ocean coast shoreline sea' },
  { panelId: 'terrain', sectionLabel: 'Noise', settingId: 'terrain.noiseScale', label: 'Noise scale', keywords: 'height noise detail fractal terrain frequency' },
  { panelId: 'terrain', sectionLabel: 'Noise', settingId: 'terrain.octaves', label: 'Octaves', keywords: 'height noise detail fbm terrain' },
  { panelId: 'terrain', sectionLabel: 'Noise', settingId: 'terrain.persistence', label: 'Persistence', keywords: 'height noise roughness fbm' },
  { panelId: 'terrain', sectionLabel: 'Noise', settingId: 'terrain.lacunarity', label: 'Lacunarity', keywords: 'height noise frequency fbm' },
  { panelId: 'terrain', sectionLabel: 'Noise', settingId: 'terrain.warp', label: 'Warp', keywords: 'height noise warp fold distortion domain' },
  { panelId: 'terrain', sectionLabel: 'Noise', settingId: 'terrain.continents', label: 'Continents', keywords: 'ocean basins landmasses continents shape' },
  { panelId: 'terrain', sectionLabel: 'Mountains & craters', settingId: 'terrain.ridge', label: 'Ridge', keywords: 'mountain ridge alpine terrain' },
  { panelId: 'terrain', sectionLabel: 'Mountains & craters', settingId: 'terrain.mountainScale', label: 'Ridge scale', keywords: 'mountain ridge scale frequency' },
  { panelId: 'terrain', sectionLabel: 'Mountains & craters', settingId: 'terrain.craters', label: 'Craters', keywords: 'craters impact moon terrain' },
  { panelId: 'terrain', sectionLabel: 'Mountains & craters', settingId: 'terrain.craterScale', label: 'Crater scale', keywords: 'craters scale size frequency' },

  // Biomes
  { panelId: 'biomes', sectionLabel: 'Climate', settingId: 'biomes.biomeAmount', label: 'Biome amount', keywords: 'biome climate map amount altitude' },
  { panelId: 'biomes', sectionLabel: 'Climate', settingId: 'biomes.tempBias', label: 'Temperature', keywords: 'biome climate heat cold temperature' },
  { panelId: 'biomes', sectionLabel: 'Climate', settingId: 'biomes.moistureScale', label: 'Moisture scale', keywords: 'biome climate humidity wet dry moisture' },
  { panelId: 'biomes', sectionLabel: 'Cold biomes', settingId: 'biomes.bioTundra', label: 'Tundra (dry)', keywords: 'biome cold tundra color' },
  { panelId: 'biomes', sectionLabel: 'Cold biomes', settingId: 'biomes.bioSteppe', label: 'Steppe (mid)', keywords: 'biome cold steppe color' },
  { panelId: 'biomes', sectionLabel: 'Cold biomes', settingId: 'biomes.bioTaiga', label: 'Taiga (wet)', keywords: 'biome cold taiga color forest' },
  { panelId: 'biomes', sectionLabel: 'Temperate biomes', settingId: 'biomes.bioShrub', label: 'Shrubland (dry)', keywords: 'biome temperate shrubland color' },
  { panelId: 'biomes', sectionLabel: 'Temperate biomes', settingId: 'biomes.colGrass', label: 'Grassland (mid)', keywords: 'biome temperate grassland color grass' },
  { panelId: 'biomes', sectionLabel: 'Temperate biomes', settingId: 'biomes.colForest', label: 'Forest (wet)', keywords: 'biome temperate forest color' },
  { panelId: 'biomes', sectionLabel: 'Hot biomes', settingId: 'biomes.bioDesert', label: 'Desert (dry)', keywords: 'biome hot desert color' },
  { panelId: 'biomes', sectionLabel: 'Hot biomes', settingId: 'biomes.bioSavanna', label: 'Savanna (mid)', keywords: 'biome hot savanna color' },
  { panelId: 'biomes', sectionLabel: 'Hot biomes', settingId: 'biomes.bioJungle', label: 'Jungle (wet)', keywords: 'biome hot jungle color' },

  // Style
  { panelId: 'style', sectionLabel: 'Preset', settingId: 'style.preset', label: 'Planet preset', keywords: 'preset style theme planet' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.sunAzimuth', label: 'Sun azimuth', keywords: 'sun lighting direction azimuth' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.sunElevation', label: 'Sun elevation', keywords: 'sun lighting direction elevation' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.sunIntensity', label: 'Sun intensity', keywords: 'sun lighting brightness intensity' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.ambient', label: 'Sky light', keywords: 'ambient sky light bounce fill' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.exposure', label: 'Exposure', keywords: 'exposure brightness tone map camera hdr' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoEnabled', label: 'Atmosphere enabled', keywords: 'atmosphere air sky enable' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoStrength', label: 'Atmosphere density', keywords: 'atmosphere air density rayleigh scattering thickness' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoHeight', label: 'Atmosphere height', keywords: 'atmosphere height thickness limb glow' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoHaze', label: 'Haze', keywords: 'atmosphere haze dust aerosol mie fog' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoColor', label: 'Scattering tint', keywords: 'atmosphere sky color tint rayleigh' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colSand', label: 'Sand color', keywords: 'sand color beach palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colRock', label: 'Rock color', keywords: 'rock color cliff palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colSnow', label: 'Snow & ice color', keywords: 'snow ice color palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.bandSoftness', label: 'Biome blend', keywords: 'biome blend transition softness' },
  { panelId: 'style', sectionLabel: 'Snow & poles', settingId: 'style.snowLine', label: 'Snow line', keywords: 'snow altitude line mountains' },
  { panelId: 'style', sectionLabel: 'Snow & poles', settingId: 'style.polarCaps', label: 'Polar ice', keywords: 'snow poles ice caps sea ice' },
  { panelId: 'style', sectionLabel: 'Stylized shading', settingId: 'style.toonEnabled', label: 'Toon bands', keywords: 'toon cartoon shading style stylized' },
  { panelId: 'style', sectionLabel: 'Stylized shading', settingId: 'style.toonBands', label: 'Bands', keywords: 'toon cartoon shading bands posterize' },
  { panelId: 'style', sectionLabel: 'Stylized shading', settingId: 'style.toonSoftness', label: 'Band softness', keywords: 'toon cartoon shading softness' },

  // Water
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.waterEnabled', label: 'Water enabled', keywords: 'water ocean enable disable' },
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.waterClarity', label: 'Clarity', keywords: 'water clarity transparency depth absorption ocean' },
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.colDeep', label: 'Deep water color', keywords: 'water color deep ocean' },
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.colShallow', label: 'Shallow tint', keywords: 'water color shallow turquoise lagoon' },
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.waterSpec', label: 'Sun glint', keywords: 'water specular reflection glint shine ocean' },
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.waterEmissive', label: 'Molten', keywords: 'lava magma emissive glow molten sea' },
  { panelId: 'water', sectionLabel: 'Waves', settingId: 'water.waveSize', label: 'Wave size', keywords: 'water waves size wavelength scale' },
  { panelId: 'water', sectionLabel: 'Waves', settingId: 'water.waveHeight', label: 'Wave height', keywords: 'water waves height steepness rough calm' },
  { panelId: 'water', sectionLabel: 'Waves', settingId: 'water.waveSpeed', label: 'Wave speed', keywords: 'water waves speed motion' },
  { panelId: 'water', sectionLabel: 'Foam', settingId: 'water.foamWidth', label: 'Shore foam width', keywords: 'water foam coast shoreline surf' },
  { panelId: 'water', sectionLabel: 'Foam', settingId: 'water.foamAmount', label: 'Foam amount', keywords: 'water foam amount' },
  { panelId: 'water', sectionLabel: 'Foam', settingId: 'water.whitecaps', label: 'Whitecaps', keywords: 'water whitecaps foam waves open sea' },
  { panelId: 'water', sectionLabel: 'Foam', settingId: 'water.colFoam', label: 'Foam color', keywords: 'foam color crust' },

  // Clouds
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudsEnabled', label: 'Clouds enabled', keywords: 'cloud enable disable sky volumetric' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudCoverage', label: 'Coverage', keywords: 'cloud coverage amount sky' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudDensity', label: 'Density', keywords: 'cloud density thickness opacity optical' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudSoftness', label: 'Softness', keywords: 'cloud edge softness falloff broken' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudShadowStrength', label: 'Shadows', keywords: 'cloud shadow strength surface' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudScale', label: 'System scale', keywords: 'cloud scale size frequency weather systems' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudDetail', label: 'Erosion', keywords: 'cloud detail erosion wispy billow' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudDetailScale', label: 'Billow size', keywords: 'cloud billow size cumulus detail scale' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudAltitude', label: 'Altitude', keywords: 'cloud altitude height base' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudThickness', label: 'Thickness', keywords: 'cloud thickness layer depth' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudSpeed', label: 'Speed', keywords: 'cloud speed motion animation wind' },
  { panelId: 'clouds', sectionLabel: 'Quality', settingId: 'clouds.cloudQuality', label: 'Ray steps', keywords: 'cloud quality steps raymarch performance' },
  { panelId: 'clouds', sectionLabel: 'Quality', settingId: 'clouds.cloudResolution', label: 'Cloud resolution', keywords: 'cloud resolution performance quality' },
  { panelId: 'clouds', sectionLabel: 'Colors', settingId: 'clouds.cloudColor', label: 'Cloud color', keywords: 'cloud color' },
  { panelId: 'clouds', sectionLabel: 'Colors', settingId: 'clouds.cloudShadow', label: 'Sky-lit tint', keywords: 'cloud shadow ambient color tint' },

  // Gas — Flow
  { panelId: 'gasFlow', sectionLabel: 'Preset', settingId: 'gasFlow.preset', label: 'Gas preset', keywords: 'gas preset giant style jupiter saturn neptune' },
  { panelId: 'gasFlow', sectionLabel: 'Bands', settingId: 'gasFlow.gasBandCount', label: 'Band count', keywords: 'gas bands belts zones stripes count latitude' },
  { panelId: 'gasFlow', sectionLabel: 'Bands', settingId: 'gasFlow.gasContrast', label: 'Contrast', keywords: 'gas bands belts zones contrast' },
  { panelId: 'gasFlow', sectionLabel: 'Bands', settingId: 'gasFlow.gasBandWarp', label: 'Waviness', keywords: 'gas bands edges waviness meander warp' },
  { panelId: 'gasFlow', sectionLabel: 'Bands', settingId: 'gasFlow.gasPolarHaze', label: 'Polar haze', keywords: 'gas poles polar haze cyclones' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasWarp', label: 'Turbulence', keywords: 'gas flow turbulence eddies swirl shear' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasScale', label: 'Eddy scale', keywords: 'gas flow eddy scale frequency noise' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasFlowSpeed', label: 'Flow speed', keywords: 'gas flow speed jets rotation churn' },
  { panelId: 'gasFlow', sectionLabel: 'Body', settingId: 'gasFlow.gasTilt', label: 'Axial tilt', keywords: 'gas axial tilt obliquity axis rings' },
  { panelId: 'gasFlow', sectionLabel: 'Body', settingId: 'gasFlow.gasLimb', label: 'Limb darkening', keywords: 'gas limb darkening edge minnaert' },

  // Gas — Storms
  { panelId: 'gasStorms', sectionLabel: 'Storms', settingId: 'gasStorms.gasStormsEnabled', label: 'Storms enabled', keywords: 'gas storm enable disable toggle' },
  { panelId: 'gasStorms', sectionLabel: 'Storms', settingId: 'gasStorms.gasGreatSpot', label: 'Great spot', keywords: 'gas storm great red spot vortex anticyclone size' },
  { panelId: 'gasStorms', sectionLabel: 'Storms', settingId: 'gasStorms.gasStorms', label: 'Oval count', keywords: 'gas storm ovals count vortices' },
  { panelId: 'gasStorms', sectionLabel: 'Storms', settingId: 'gasStorms.gasStormScale', label: 'Oval size', keywords: 'gas storm ovals scale size' },

  // Gas — Colors
  { panelId: 'gasColors', sectionLabel: 'Cloud colors', settingId: 'gasColors.gasColorZone', label: 'Zones', keywords: 'gas color zones bright palette' },
  { panelId: 'gasColors', sectionLabel: 'Cloud colors', settingId: 'gasColors.gasColorBelt', label: 'Belts', keywords: 'gas color belts dark palette' },
  { panelId: 'gasColors', sectionLabel: 'Cloud colors', settingId: 'gasColors.gasColorAccent', label: 'Accent', keywords: 'gas color accent chromophore palette' },
  { panelId: 'gasColors', sectionLabel: 'Cloud colors', settingId: 'gasColors.gasColorStorm', label: 'Great spot', keywords: 'gas color storm great spot palette' },
  { panelId: 'gasColors', sectionLabel: 'Cloud colors', settingId: 'gasColors.gasColorPolar', label: 'Polar haze', keywords: 'gas color polar haze palette' },
  { panelId: 'gasColors', sectionLabel: 'Atmosphere', settingId: 'gasColors.gasAtmoColor', label: 'Scattering tint', keywords: 'gas atmosphere scattering tint rayleigh limb' },
  { panelId: 'gasColors', sectionLabel: 'Atmosphere', settingId: 'gasColors.gasAtmoStrength', label: 'Density', keywords: 'gas atmosphere density haze limb glow' },
  { panelId: 'gasColors', sectionLabel: 'Atmosphere', settingId: 'gasColors.gasAtmoHaze', label: 'Haze', keywords: 'gas atmosphere haze aerosol mie' },

  // Gas — Rings
  { panelId: 'gasRings', sectionLabel: 'Rings', settingId: 'gasRings.gasRingsEnabled', label: 'Rings enabled', keywords: 'gas rings enable disable toggle saturn' },
  { panelId: 'gasRings', sectionLabel: 'Rings', settingId: 'gasRings.gasRingInner', label: 'Inner radius', keywords: 'gas rings inner radius' },
  { panelId: 'gasRings', sectionLabel: 'Rings', settingId: 'gasRings.gasRingOuter', label: 'Outer radius', keywords: 'gas rings outer radius' },
  { panelId: 'gasRings', sectionLabel: 'Rings', settingId: 'gasRings.gasRingOpacity', label: 'Opacity', keywords: 'gas rings opacity optical depth' },
  { panelId: 'gasRings', sectionLabel: 'Rings', settingId: 'gasRings.gasRingColor', label: 'Ring color', keywords: 'gas rings color' },

  // Gas — Lighting
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.sunAzimuth', label: 'Sun azimuth', keywords: 'gas sun lighting direction azimuth' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.sunElevation', label: 'Sun elevation', keywords: 'gas sun lighting direction elevation' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.sunIntensity', label: 'Sun intensity', keywords: 'gas sun lighting brightness' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.ambient', label: 'Ambient', keywords: 'gas ambient lighting bounce' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.exposure', label: 'Exposure', keywords: 'gas exposure brightness tone' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.toonEnabled', label: 'Toon shading', keywords: 'gas toon cartoon shading' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.toonBands', label: 'Toon bands', keywords: 'gas toon cartoon bands posterize' },

  // Star — Surface
  { panelId: 'starSurface', sectionLabel: 'Preset', settingId: 'starSurface.preset', label: 'Star preset', keywords: 'star preset sun style' },
  { panelId: 'starSurface', sectionLabel: 'Photosphere', settingId: 'starSurface.starTemperature', label: 'Temperature', keywords: 'star temperature kelvin blackbody color spectral' },
  { panelId: 'starSurface', sectionLabel: 'Photosphere', settingId: 'starSurface.starBrightness', label: 'Brightness', keywords: 'star brightness emission glow' },
  { panelId: 'starSurface', sectionLabel: 'Photosphere', settingId: 'starSurface.starLimbDarken', label: 'Limb darkening', keywords: 'star surface limb darkening edge' },
  { panelId: 'starSurface', sectionLabel: 'Convection', settingId: 'starSurface.starNoiseScale', label: 'Granule scale', keywords: 'star surface scale granulation cells frequency' },
  { panelId: 'starSurface', sectionLabel: 'Convection', settingId: 'starSurface.starGranules', label: 'Granulation', keywords: 'star surface granules contrast convection' },
  { panelId: 'starSurface', sectionLabel: 'Convection', settingId: 'starSurface.starTurbulence', label: 'Network', keywords: 'star supergranulation network mottling turbulence' },
  { panelId: 'starSurface', sectionLabel: 'Convection', settingId: 'starSurface.starFaculae', label: 'Faculae', keywords: 'star faculae bright limb network plage' },
  { panelId: 'starSurface', sectionLabel: 'Convection', settingId: 'starSurface.starFlowSpeed', label: 'Flow speed', keywords: 'star surface flow speed boiling convection' },

  // Star — Colors
  { panelId: 'starColors', sectionLabel: 'Colors', settingId: 'starColors.starTint', label: 'Tint', keywords: 'star color tint palette' },
  { panelId: 'starColors', sectionLabel: 'Colors', settingId: 'starColors.starChromoColor', label: 'Chromosphere', keywords: 'star color chromosphere prominences h-alpha' },
  { panelId: 'starColors', sectionLabel: 'Colors', settingId: 'starColors.starCoronaColor', label: 'Corona color', keywords: 'star color corona halo' },

  // Star — Sunspots
  { panelId: 'starSunspots', sectionLabel: 'Sunspots', settingId: 'starSunspots.starSpotsEnabled', label: 'Sunspots enabled', keywords: 'star sunspots enable disable toggle' },
  { panelId: 'starSunspots', sectionLabel: 'Sunspots', settingId: 'starSunspots.starSpots', label: 'Amount', keywords: 'star sunspots amount coverage activity' },
  { panelId: 'starSunspots', sectionLabel: 'Sunspots', settingId: 'starSunspots.starSpotScale', label: 'Region size', keywords: 'star sunspots scale size active region' },

  // Star — Corona
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starCoronaEnabled', label: 'Corona enabled', keywords: 'star corona enable disable toggle halo' },
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starCoronaSize', label: 'Size', keywords: 'star corona size halo extent' },
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starCoronaStrength', label: 'Strength', keywords: 'star corona strength halo' },
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starFlares', label: 'Streamers', keywords: 'star corona streamers flares streaks halo' },
  { panelId: 'starCorona', sectionLabel: 'Limb', settingId: 'starCorona.starProminences', label: 'Prominences', keywords: 'star prominences loops limb plasma' },
  { panelId: 'starCorona', sectionLabel: 'Glare', settingId: 'starCorona.starBloom', label: 'Bloom', keywords: 'star bloom glare glow' },
  { panelId: 'starCorona', sectionLabel: 'Glare', settingId: 'starCorona.exposure', label: 'Exposure', keywords: 'star exposure brightness tone' },

  // Star — Motion
  { panelId: 'starMotion', sectionLabel: 'Motion', settingId: 'starMotion.starPulseAmount', label: 'Pulse amount', keywords: 'star motion pulse breathing variable' },
  { panelId: 'starMotion', sectionLabel: 'Motion', settingId: 'starMotion.starPulseSpeed', label: 'Pulse speed', keywords: 'star motion pulse speed' },

  // Performance
  { panelId: 'perf', sectionLabel: 'LOD', settingId: 'perf.maxDepth', label: 'Max depth', keywords: 'lod quadtree subdivision performance' },
  { panelId: 'perf', sectionLabel: 'LOD', settingId: 'perf.splitFactor', label: 'Split factor', keywords: 'lod quadtree subdivision performance detail' },
  { panelId: 'perf', sectionLabel: 'LOD', settingId: 'perf.chunkRes', label: 'Chunk res', keywords: 'lod chunk resolution grid performance' },
  { panelId: 'perf', sectionLabel: 'Debug', settingId: 'perf.wireframe', label: 'Wireframe', keywords: 'debug wireframe mesh' },

  // Export
  { panelId: 'export', sectionLabel: 'Format & resolution', settingId: 'export.format', label: 'Format', keywords: 'export file glb obj format' },
  { panelId: 'export', sectionLabel: 'Format & resolution', settingId: 'export.meshRes', label: 'Mesh resolution', keywords: 'export mesh resolution' },
  { panelId: 'export', sectionLabel: 'Texture baking', settingId: 'export.bakeColor', label: 'Bake color texture', keywords: 'export texture bake color' },
  { panelId: 'export', sectionLabel: 'Texture baking', settingId: 'export.texRes', label: 'Texture size', keywords: 'export texture resolution size' },
];

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function scoreEntry(entry, q, tokens) {
  const haystack = normalizeText([
    entry.label,
    entry.sectionLabel,
    entry.panelId,
    entry.keywords,
  ].filter(Boolean).join(' '));
  if (!haystack || !haystack.includes(q)) {
    if (!tokens.every((token) => haystack.includes(token))) return 0;
  }

  let score = 0;
  const label = normalizeText(entry.label);
  const section = normalizeText(entry.sectionLabel);

  if (label === q) score += 1200;
  if (label.startsWith(q)) score += 600;
  if (label.includes(q)) score += 300;
  if (section && section === q) score += 500;
  if (section && section.includes(q)) score += 120;
  if (haystack.startsWith(q)) score += 80;
  score += Math.max(0, 60 - haystack.indexOf(q));
  for (const token of tokens) {
    if (label.includes(token)) score += 40;
    if (section.includes(token)) score += 20;
  }

  return score;
}

export function searchSettings(query, isPanelAvailable = () => true) {
  const q = normalizeText(query);
  if (!q) return [];

  const tokens = q.split(/\s+/).filter(Boolean);
  return SETTINGS_INDEX
    .map((entry) => {
      if (!isPanelAvailable(entry.panelId)) return null;
      const score = scoreEntry(entry, q, tokens);
      if (!score) return null;
      return { ...entry, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

export { SETTINGS_INDEX };
