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
  { panelId: 'style', sectionLabel: 'Toon shading', settingId: 'style.toonEnabled', label: 'Toon shading enabled', keywords: 'toon cartoon shading style' },
  { panelId: 'style', sectionLabel: 'Toon shading', settingId: 'style.toonBands', label: 'Toon bands', keywords: 'toon cartoon shading bands posterize' },
  { panelId: 'style', sectionLabel: 'Toon shading', settingId: 'style.toonSoftness', label: 'Band softness', keywords: 'toon cartoon shading softness' },
  { panelId: 'style', sectionLabel: 'Toon shading', settingId: 'style.bandSoftness', label: 'Color softness', keywords: 'toon cartoon color band softness terrain' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.sunAzimuth', label: 'Sun azimuth', keywords: 'sun lighting direction azimuth' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.sunElevation', label: 'Sun elevation', keywords: 'sun lighting direction elevation' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.sunIntensity', label: 'Sun intensity', keywords: 'sun lighting brightness intensity' },
  { panelId: 'style', sectionLabel: 'Lighting', settingId: 'style.ambient', label: 'Ambient', keywords: 'ambient lighting bounce' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colDeep', label: 'Deep water color', keywords: 'water color deep palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colShallow', label: 'Shallow water color', keywords: 'water color shallow palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colSand', label: 'Sand color', keywords: 'sand color beach palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colRock', label: 'Rock color', keywords: 'rock color cliff palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colSnow', label: 'Snow color', keywords: 'snow color palette' },
  { panelId: 'style', sectionLabel: 'Surface palette', settingId: 'style.colFoam', label: 'Foam color', keywords: 'foam color waves palette' },
  { panelId: 'style', sectionLabel: 'Snow & poles', settingId: 'style.snowLine', label: 'Snow line', keywords: 'snow altitude line poles' },
  { panelId: 'style', sectionLabel: 'Snow & poles', settingId: 'style.polarCaps', label: 'Polar caps', keywords: 'snow poles ice caps' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoEnabled', label: 'Atmosphere enabled', keywords: 'atmosphere glow enable' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoStrength', label: 'Atmosphere strength', keywords: 'atmosphere glow strength' },
  { panelId: 'style', sectionLabel: 'Atmosphere', settingId: 'style.atmoColor', label: 'Atmosphere color', keywords: 'atmosphere glow color' },

  // Water
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.waterEnabled', label: 'Water enabled', keywords: 'water ocean enable disable' },
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.waterOpacity', label: 'Opacity', keywords: 'water opacity transparency ocean' },
  { panelId: 'water', sectionLabel: 'Ocean', settingId: 'water.waterSpec', label: 'Specular', keywords: 'water specular reflection shine ocean' },
  { panelId: 'water', sectionLabel: 'Waves & foam', settingId: 'water.waveScale', label: 'Wave scale', keywords: 'water waves scale size' },
  { panelId: 'water', sectionLabel: 'Waves & foam', settingId: 'water.waveSpeed', label: 'Wave speed', keywords: 'water waves speed motion' },
  { panelId: 'water', sectionLabel: 'Waves & foam', settingId: 'water.foamWidth', label: 'Foam width', keywords: 'water foam coast shoreline cartoon' },

  // Clouds
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudsEnabled', label: 'Clouds enabled', keywords: 'cloud enable disable sky' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudCoverage', label: 'Coverage', keywords: 'cloud coverage density sky' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudSoftness', label: 'Softness', keywords: 'cloud edge softness falloff' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudDensity', label: 'Density', keywords: 'cloud density thickness opacity' },
  { panelId: 'clouds', sectionLabel: 'Clouds', settingId: 'clouds.cloudShadowStrength', label: 'Shadows', keywords: 'cloud shadow strength surface' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudScale', label: 'Scale', keywords: 'cloud scale size frequency' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudDetail', label: 'Detail', keywords: 'cloud detail texture' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudPuff', label: 'Puffiness', keywords: 'cloud puffiness cumulus bumps silhouette' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudAltitude', label: 'Altitude', keywords: 'cloud altitude height' },
  { panelId: 'clouds', sectionLabel: 'Shape & motion', settingId: 'clouds.cloudSpeed', label: 'Speed', keywords: 'cloud speed motion animation' },
  { panelId: 'clouds', sectionLabel: 'Colors', settingId: 'clouds.cloudColor', label: 'Cloud color', keywords: 'cloud color' },
  { panelId: 'clouds', sectionLabel: 'Colors', settingId: 'clouds.cloudShadow', label: 'Shadow color', keywords: 'cloud shadow color' },

  // Gas — Flow
  { panelId: 'gasFlow', sectionLabel: 'Preset', settingId: 'gasFlow.preset', label: 'Gas preset', keywords: 'gas preset giant style' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasScale', label: 'Scale', keywords: 'gas flow scale frequency noise' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasWarp', label: 'Turbulence', keywords: 'gas flow turbulence swirl warp' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasContrast', label: 'Contrast', keywords: 'gas flow contrast noise' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasFlowSpeed', label: 'Flow speed', keywords: 'gas flow speed rotation churn' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasBands', label: 'Bands', keywords: 'gas flow bands posterize gradient' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasStretch', label: 'Striping', keywords: 'gas flow striping latitude stripes swirls' },
  { panelId: 'gasFlow', sectionLabel: 'Flow', settingId: 'gasFlow.gasLimb', label: 'Limb darkening', keywords: 'gas flow limb darkening edge' },

  // Gas — Storms
  { panelId: 'gasStorms', sectionLabel: 'Storms', settingId: 'gasStorms.gasStormsEnabled', label: 'Storms enabled', keywords: 'gas storm enable disable toggle' },
  { panelId: 'gasStorms', sectionLabel: 'Storms', settingId: 'gasStorms.gasStorms', label: 'Coverage', keywords: 'gas storm coverage oval' },
  { panelId: 'gasStorms', sectionLabel: 'Storms', settingId: 'gasStorms.gasStormScale', label: 'Storm scale', keywords: 'gas storm scale size' },

  // Gas — Colors
  { panelId: 'gasColors', sectionLabel: 'Colors', settingId: 'gasColors.gasColorDeep', label: 'Deep', keywords: 'gas color deep palette' },
  { panelId: 'gasColors', sectionLabel: 'Colors', settingId: 'gasColors.gasColorBase', label: 'Base', keywords: 'gas color base palette' },
  { panelId: 'gasColors', sectionLabel: 'Colors', settingId: 'gasColors.gasColorSwirl', label: 'Swirl', keywords: 'gas color swirl palette' },
  { panelId: 'gasColors', sectionLabel: 'Colors', settingId: 'gasColors.gasColorStorm', label: 'Storm', keywords: 'gas color storm palette' },

  // Gas — Lighting
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.sunAzimuth', label: 'Sun azimuth', keywords: 'gas sun lighting direction azimuth' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.sunElevation', label: 'Sun elevation', keywords: 'gas sun lighting direction elevation' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.sunIntensity', label: 'Sun intensity', keywords: 'gas sun lighting brightness' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.ambient', label: 'Ambient', keywords: 'gas ambient lighting bounce' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.toonEnabled', label: 'Toon shading', keywords: 'gas toon cartoon shading' },
  { panelId: 'gasLighting', sectionLabel: 'Lighting', settingId: 'gasLighting.toonBands', label: 'Toon bands', keywords: 'gas toon cartoon bands posterize' },

  // Star — Surface
  { panelId: 'starSurface', sectionLabel: 'Preset', settingId: 'starSurface.preset', label: 'Star preset', keywords: 'star preset sun style' },
  { panelId: 'starSurface', sectionLabel: 'Surface', settingId: 'starSurface.starNoiseScale', label: 'Scale', keywords: 'star surface scale granulation frequency' },
  { panelId: 'starSurface', sectionLabel: 'Surface', settingId: 'starSurface.starTurbulence', label: 'Turbulence', keywords: 'star surface turbulence warp boiling' },
  { panelId: 'starSurface', sectionLabel: 'Surface', settingId: 'starSurface.starGranules', label: 'Granules', keywords: 'star surface granules contrast' },
  { panelId: 'starSurface', sectionLabel: 'Surface', settingId: 'starSurface.starFlowSpeed', label: 'Flow speed', keywords: 'star surface flow speed boiling' },
  { panelId: 'starSurface', sectionLabel: 'Surface', settingId: 'starSurface.starBands', label: 'Bands', keywords: 'star surface bands posterize gradient' },
  { panelId: 'starSurface', sectionLabel: 'Surface', settingId: 'starSurface.starLimbDarken', label: 'Limb darkening', keywords: 'star surface limb darkening edge' },
  { panelId: 'starSurface', sectionLabel: 'Surface', settingId: 'starSurface.starGlow', label: 'Rim glow', keywords: 'star surface rim glow hot edge disc' },

  // Star — Colors
  { panelId: 'starColors', sectionLabel: 'Colors', settingId: 'starColors.starColorCore', label: 'Core (hot)', keywords: 'star color core hot palette' },
  { panelId: 'starColors', sectionLabel: 'Colors', settingId: 'starColors.starColorMid', label: 'Mid', keywords: 'star color mid palette' },
  { panelId: 'starColors', sectionLabel: 'Colors', settingId: 'starColors.starColorEdge', label: 'Edge (cool)', keywords: 'star color edge cool palette' },
  { panelId: 'starColors', sectionLabel: 'Colors', settingId: 'starColors.starSpotColor', label: 'Sunspots color', keywords: 'star color sunspots palette' },

  // Star — Sunspots
  { panelId: 'starSunspots', sectionLabel: 'Sunspots', settingId: 'starSunspots.starSpotsEnabled', label: 'Sunspots enabled', keywords: 'star sunspots enable disable toggle' },
  { panelId: 'starSunspots', sectionLabel: 'Sunspots', settingId: 'starSunspots.starSpots', label: 'Amount', keywords: 'star sunspots amount coverage' },
  { panelId: 'starSunspots', sectionLabel: 'Sunspots', settingId: 'starSunspots.starSpotScale', label: 'Spot scale', keywords: 'star sunspots scale size' },

  // Star — Corona
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starCoronaEnabled', label: 'Corona enabled', keywords: 'star corona enable disable toggle halo' },
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starCoronaColor', label: 'Color', keywords: 'star corona color halo' },
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starCoronaSize', label: 'Size', keywords: 'star corona size halo extent' },
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starCoronaStrength', label: 'Strength', keywords: 'star corona strength halo' },
  { panelId: 'starCorona', sectionLabel: 'Corona', settingId: 'starCorona.starFlares', label: 'Flares', keywords: 'star corona flares streaks halo' },

  // Star — Motion
  { panelId: 'starMotion', sectionLabel: 'Motion', settingId: 'starMotion.starPulseAmount', label: 'Pulse amount', keywords: 'star motion pulse breathing simmer' },
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
