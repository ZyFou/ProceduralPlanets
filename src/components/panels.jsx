import { useState } from 'react';
import { Slider, Toggle, ColorRow, Section, SelectRow } from './controls.jsx';
import { PLANET_PRESETS, STAR_PRESETS } from '../engine/presets.js';
import { DEFAULT_STAR_BODY } from '../engine/star.js';

// One component per side-panel tab. Each receives (params, onParam) and, for
// the style panel, onPreset. Pure declarative mappings — no engine access.

export function TerrainPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Planet">
        <Slider label="Radius" value={p.radius} min={600} max={6000} step={50} digits={0} onChange={(v) => onParam('radius', v)} />
        <Slider label="Height scale" value={p.heightScale} min={20} max={400} step={5} digits={0} onChange={(v) => onParam('heightScale', v)} />
        <Slider label="Sea level" value={p.seaLevel} min={0} max={0.9} step={0.01} onChange={(v) => onParam('seaLevel', v)} />
      </Section>
      <Section title="Noise">
        <Slider label="Scale" value={p.noiseScale} min={0.5} max={8} step={0.1} digits={1} onChange={(v) => onParam('noiseScale', v)} />
        <Slider label="Octaves" value={p.octaves} min={3} max={8} step={1} digits={0} onChange={(v) => onParam('octaves', v)} title="Rebuilds the shaders" />
        <Slider label="Persistence" value={p.persistence} min={0.3} max={0.7} step={0.01} onChange={(v) => onParam('persistence', v)} />
        <Slider label="Lacunarity" value={p.lacunarity} min={1.5} max={3} step={0.05} onChange={(v) => onParam('lacunarity', v)} />
        <Slider label="Warp" value={p.warp} min={0} max={2} step={0.05} onChange={(v) => onParam('warp', v)} />
        <Slider label="Continents" value={p.continents} min={0} max={1} step={0.05} onChange={(v) => onParam('continents', v)} title="Shapes broad ocean basins and coherent landmasses" />
      </Section>
      <Section title="Mountains & craters">
        <Slider label="Ridge" value={p.ridge} min={0} max={1.5} step={0.05} onChange={(v) => onParam('ridge', v)} />
        <Slider label="Ridge scale" value={p.mountainScale} min={1} max={6} step={0.1} digits={1} onChange={(v) => onParam('mountainScale', v)} />
        <Slider label="Craters" value={p.craters} min={0} max={1} step={0.05} onChange={(v) => onParam('craters', v)} />
        <Slider label="Crater scale" value={p.craterScale} min={2} max={16} step={0.5} digits={1} onChange={(v) => onParam('craterScale', v)} />
      </Section>
    </>
  );
}

export function BiomesPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Climate">
        <Slider label="Biome amount" value={p.biomeAmount} min={0} max={1} step={0.05} onChange={(v) => onParam('biomeAmount', v)} title="0 = plain altitude bands, 1 = full temperature/moisture biome map" />
        <Slider label="Temperature" value={p.tempBias} min={-1} max={1} step={0.05} onChange={(v) => onParam('tempBias', v)} title="Shifts the whole planet colder or hotter" />
        <Slider label="Moisture scale" value={p.moistureScale} min={0.5} max={5} step={0.1} digits={1} onChange={(v) => onParam('moistureScale', v)} title="Frequency of the wet/dry regions" />
      </Section>
      <Section title="Cold biomes">
        <ColorRow label="Tundra (dry)" value={p.bioTundra} onChange={(v) => onParam('bioTundra', v)} />
        <ColorRow label="Steppe (mid)" value={p.bioSteppe} onChange={(v) => onParam('bioSteppe', v)} />
        <ColorRow label="Taiga (wet)" value={p.bioTaiga} onChange={(v) => onParam('bioTaiga', v)} />
      </Section>
      <Section title="Temperate biomes">
        <ColorRow label="Shrubland (dry)" value={p.bioShrub} onChange={(v) => onParam('bioShrub', v)} />
        <ColorRow label="Grassland (mid)" value={p.colGrass} onChange={(v) => onParam('colGrass', v)} />
        <ColorRow label="Forest (wet)" value={p.colForest} onChange={(v) => onParam('colForest', v)} />
      </Section>
      <Section title="Hot biomes">
        <ColorRow label="Desert (dry)" value={p.bioDesert} onChange={(v) => onParam('bioDesert', v)} />
        <ColorRow label="Savanna (mid)" value={p.bioSavanna} onChange={(v) => onParam('bioSavanna', v)} />
        <ColorRow label="Jungle (wet)" value={p.bioJungle} onChange={(v) => onParam('bioJungle', v)} />
      </Section>
    </>
  );
}

export function StylePanel({ params: p, onParam, onPreset }) {
  return (
    <>
      <Section title="Preset">
        <div className="preset-grid">
          {Object.entries(PLANET_PRESETS).map(([key, def]) => (
            <button key={key} type="button" className="preset-btn" onClick={() => onPreset(key)}>
              {def.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Toon shading">
        <Toggle label="Enabled" value={p.toonEnabled} onChange={(v) => onParam('toonEnabled', v)} />
        <Slider label="Bands" value={p.toonBands} min={2} max={8} step={1} digits={0} onChange={(v) => onParam('toonBands', v)} />
        <Slider label="Band softness" value={p.toonSoftness} min={0} max={0.3} step={0.005} digits={3} onChange={(v) => onParam('toonSoftness', v)} />
        <Slider label="Color softness" value={p.bandSoftness} min={0.005} max={0.15} step={0.005} digits={3} onChange={(v) => onParam('bandSoftness', v)} title="Width of the terrain color band transitions" />
      </Section>
      <Section title="Lighting">
        <Slider label="Sun azimuth" value={p.sunAzimuth} min={0} max={360} step={1} digits={0} onChange={(v) => onParam('sunAzimuth', v)} />
        <Slider label="Sun elevation" value={p.sunElevation} min={-30} max={90} step={1} digits={0} onChange={(v) => onParam('sunElevation', v)} />
        <Slider label="Sun intensity" value={p.sunIntensity} min={0.2} max={2.5} step={0.05} onChange={(v) => onParam('sunIntensity', v)} />
        <Slider label="Ambient" value={p.ambient} min={0} max={0.8} step={0.02} onChange={(v) => onParam('ambient', v)} />
      </Section>
      <Section title="Surface palette">
        <ColorRow label="Deep water" value={p.colDeep} onChange={(v) => onParam('colDeep', v)} />
        <ColorRow label="Shallow water" value={p.colShallow} onChange={(v) => onParam('colShallow', v)} />
        <ColorRow label="Sand" value={p.colSand} onChange={(v) => onParam('colSand', v)} />
        <ColorRow label="Rock" value={p.colRock} onChange={(v) => onParam('colRock', v)} />
        <ColorRow label="Snow" value={p.colSnow} onChange={(v) => onParam('colSnow', v)} />
        <ColorRow label="Foam" value={p.colFoam} onChange={(v) => onParam('colFoam', v)} />
      </Section>
      <Section title="Snow & poles">
        <Slider label="Snow line" value={p.snowLine} min={0.2} max={1.1} step={0.02} onChange={(v) => onParam('snowLine', v)} />
        <Slider label="Polar caps" value={p.polarCaps} min={0} max={1} step={0.05} onChange={(v) => onParam('polarCaps', v)} />
      </Section>
      <Section title="Atmosphere">
        <Toggle label="Enabled" value={p.atmoEnabled} onChange={(v) => onParam('atmoEnabled', v)} />
        <Slider label="Strength" value={p.atmoStrength} min={0} max={2} step={0.05} onChange={(v) => onParam('atmoStrength', v)} />
        <ColorRow label="Color" value={p.atmoColor} onChange={(v) => onParam('atmoColor', v)} />
      </Section>
    </>
  );
}

export function WaterPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Ocean">
        <Toggle label="Enabled" value={p.waterEnabled} onChange={(v) => onParam('waterEnabled', v)} />
        <Slider label="Opacity" value={p.waterOpacity} min={0.3} max={1} step={0.02} onChange={(v) => onParam('waterOpacity', v)} />
        <Slider label="Specular" value={p.waterSpec} min={0} max={1.5} step={0.05} onChange={(v) => onParam('waterSpec', v)} />
      </Section>
      <Section title="Waves & foam">
        <Slider label="Wave scale" value={p.waveScale} min={5} max={80} step={1} digits={0} onChange={(v) => onParam('waveScale', v)} />
        <Slider label="Wave speed" value={p.waveSpeed} min={0} max={3} step={0.05} onChange={(v) => onParam('waveSpeed', v)} />
        <Slider label="Foam width" value={p.foamWidth} min={0} max={0.5} step={0.01} onChange={(v) => onParam('foamWidth', v)} title="Hard cartoon foam ring along the coast" />
      </Section>
    </>
  );
}

export function CloudsPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Clouds">
        <Toggle label="Enabled" value={p.cloudsEnabled} onChange={(v) => onParam('cloudsEnabled', v)} />
        <Slider label="Coverage" value={p.cloudCoverage} min={0} max={1} step={0.02} onChange={(v) => onParam('cloudCoverage', v)} />
        <Slider label="Softness" value={p.cloudSoftness} min={0.005} max={0.4} step={0.005} digits={3} onChange={(v) => onParam('cloudSoftness', v)} title="Low = hard cartoon edges" />
        <Slider label="Density" value={p.cloudDensity} min={0.2} max={1} step={0.02} onChange={(v) => onParam('cloudDensity', v)} />
        <Slider label="Shadows" value={p.cloudShadowStrength} min={0} max={1} step={0.05} onChange={(v) => onParam('cloudShadowStrength', v)} title="Hard shadows the clouds cast on the surface" />
      </Section>
      <Section title="Shape & motion">
        <Slider label="Scale" value={p.cloudScale} min={1} max={10} step={0.1} digits={1} onChange={(v) => onParam('cloudScale', v)} />
        <Slider label="Detail" value={p.cloudDetail} min={0} max={1} step={0.05} onChange={(v) => onParam('cloudDetail', v)} />
        <Slider label="Puffiness" value={p.cloudPuff} min={0} max={1} step={0.05} onChange={(v) => onParam('cloudPuff', v)} title="Vertex-displaced cumulus bumps on the silhouette" />
        <Slider label="Altitude" value={p.cloudAltitude} min={0.01} max={0.15} step={0.005} digits={3} onChange={(v) => onParam('cloudAltitude', v)} />
        <Slider label="Speed" value={p.cloudSpeed} min={0} max={3} step={0.05} onChange={(v) => onParam('cloudSpeed', v)} />
      </Section>
      <Section title="Colors">
        <ColorRow label="Cloud" value={p.cloudColor} onChange={(v) => onParam('cloudColor', v)} />
        <ColorRow label="Shadow" value={p.cloudShadow} onChange={(v) => onParam('cloudShadow', v)} />
      </Section>
    </>
  );
}

export function StarPanel({ params: p, onParam, onStarPreset }) {
  return (
    <>
      <Section title="Preset">
        <div className="preset-grid">
          {Object.entries(STAR_PRESETS).map(([key, def]) => (
            <button key={key} type="button" className="preset-btn" onClick={() => onStarPreset(key)}>
              {def.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Surface">
        <Slider label="Scale" value={p.starNoiseScale} min={1} max={8} step={0.1} digits={1} onChange={(v) => onParam('starNoiseScale', v)} title="Granulation frequency" />
        <Slider label="Turbulence" value={p.starTurbulence} min={0} max={2} step={0.05} onChange={(v) => onParam('starTurbulence', v)} title="Domain warp of the boiling surface" />
        <Slider label="Granules" value={p.starGranules} min={0} max={1} step={0.05} onChange={(v) => onParam('starGranules', v)} title="Granulation contrast" />
        <Slider label="Flow speed" value={p.starFlowSpeed} min={0} max={3} step={0.05} onChange={(v) => onParam('starFlowSpeed', v)} title="How fast the surface boils" />
        <Slider label="Bands" value={p.starBands} min={0} max={8} step={1} digits={0} onChange={(v) => onParam('starBands', v)} title="Posterize levels — 0 = smooth gradient" />
        <Slider label="Limb darkening" value={p.starLimbDarken} min={0} max={1} step={0.05} onChange={(v) => onParam('starLimbDarken', v)} />
        <Slider label="Rim glow" value={p.starGlow} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starGlow', v)} title="Additive hot rim on the disc edge" />
      </Section>
      <Section title="Colors">
        <ColorRow label="Core (hot)" value={p.starColorCore} onChange={(v) => onParam('starColorCore', v)} />
        <ColorRow label="Mid" value={p.starColorMid} onChange={(v) => onParam('starColorMid', v)} />
        <ColorRow label="Edge (cool)" value={p.starColorEdge} onChange={(v) => onParam('starColorEdge', v)} />
        <ColorRow label="Sunspots" value={p.starSpotColor} onChange={(v) => onParam('starSpotColor', v)} />
      </Section>
      <Section title="Sunspots">
        <Slider label="Amount" value={p.starSpots} min={0} max={1} step={0.05} onChange={(v) => onParam('starSpots', v)} />
        <Slider label="Spot scale" value={p.starSpotScale} min={0.5} max={8} step={0.1} digits={1} onChange={(v) => onParam('starSpotScale', v)} />
      </Section>
      <Section title="Corona">
        <ColorRow label="Color" value={p.starCoronaColor} onChange={(v) => onParam('starCoronaColor', v)} />
        <Slider label="Size" value={p.starCoronaSize} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starCoronaSize', v)} title="Halo extent beyond the disc" />
        <Slider label="Strength" value={p.starCoronaStrength} min={0} max={2} step={0.05} onChange={(v) => onParam('starCoronaStrength', v)} />
        <Slider label="Flares" value={p.starFlares} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starFlares', v)} title="Wispy streaks drifting through the halo" />
      </Section>
      <Section title="Motion">
        <Slider label="Pulse amount" value={p.starPulseAmount} min={0} max={0.08} step={0.002} digits={3} onChange={(v) => onParam('starPulseAmount', v)} title="Radius breathing / silhouette simmer" />
        <Slider label="Pulse speed" value={p.starPulseSpeed} min={0} max={4} step={0.1} digits={1} onChange={(v) => onParam('starPulseSpeed', v)} />
      </Section>
    </>
  );
}

export function ShaderPanel({ starShader, onStarShaderChange, onStarShaderApply, starShaderStatus }) {
  return (
    <>
      <Section title="Custom star shader">
        <p className="shader-hint">
          The full <code>starSurface()</code> function of the sun — edit it and hit
          Apply. Compile errors show up below without touching the running shader.
          All <code>uStar*</code> uniforms stay bound to the Star panel sliders.
        </p>
        <textarea
          className="shader-editor"
          spellCheck={false}
          value={starShader}
          onChange={(e) => onStarShaderChange(e.target.value)}
        />
        <div className="export-actions">
          <button type="button" className="action-btn primary" onClick={() => onStarShaderApply(starShader)}>
            Apply
          </button>
          <button
            type="button"
            className="action-btn"
            onClick={() => {
              onStarShaderChange(DEFAULT_STAR_BODY);
              onStarShaderApply(DEFAULT_STAR_BODY);
            }}
          >
            Reset to default
          </button>
        </div>
        {starShaderStatus && (
          <div className={`shader-status ${starShaderStatus.ok ? 'ok' : 'err'}`}>
            {starShaderStatus.ok ? 'Compiled — shader applied.' : starShaderStatus.error}
          </div>
        )}
      </Section>
    </>
  );
}

export function PerformancePanel({ params: p, onParam }) {
  return (
    <>
      <Section title="LOD">
        <Slider label="Max depth" value={p.maxDepth} min={2} max={7} step={1} digits={0} onChange={(v) => onParam('maxDepth', v)} title="Quadtree subdivision limit (rebuild)" />
        <Slider label="Split factor" value={p.splitFactor} min={1.2} max={4} step={0.1} digits={1} onChange={(v) => onParam('splitFactor', v)} title="Higher = subdivide sooner (more detail, more chunks)" />
        <Slider label="Chunk res" value={p.chunkRes} min={8} max={64} step={8} digits={0} onChange={(v) => onParam('chunkRes', v)} title="Grid quads per chunk side (rebuild)" />
      </Section>
      <Section title="Debug">
        <Toggle label="Wireframe" value={p.wireframe} onChange={(v) => onParam('wireframe', v)} />
      </Section>
    </>
  );
}

const FORMAT_OPTIONS = [
  { value: 'glb', label: 'GLB / GLTF' },
  { value: 'obj', label: 'OBJ + textures' },
];

const RES_OPTIONS = [
  { value: '64', label: '64 x 64' },
  { value: '128', label: '128 x 128 (Recommended)' },
  { value: '256', label: '256 x 256' },
  { value: '512', label: '512 x 512' },
];

const TEX_OPTIONS = [
  { value: '512', label: '512 x 512' },
  { value: '1024', label: '1024 x 1024' },
  { value: '2048', label: '2048 x 2048 (Crisp)' },
  { value: '4096', label: '4096 x 4096 (UHD)' },
];

export function ExportPanel({ onExport, onScreenshot }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [opt, setOpt] = useState({
    format: 'glb',
    includeMesh: true,
    meshRes: '128',
    bakeColor: true,
    bakeLighting: false,
    texRes: '1024',
    exportWater: false,
    exportPreset: true,
  });
  const set = (key, value) => setOpt((prev) => ({ ...prev, [key]: value }));

  const doExport = async () => {
    setBusy(true);
    setStatus('Preparing export...');
    try {
      await onExport(opt, setStatus);
      setStatus('Export complete');
    } catch (err) {
      console.error(err);
      setStatus('Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Quick export">
        <div className="export-actions">
          <button type="button" className="action-btn primary" onClick={doExport} disabled={busy}>
            {busy ? 'Exporting...' : 'Export Planet'}
          </button>
          <button type="button" className="action-btn" onClick={onScreenshot} disabled={busy}>
            Screenshot
          </button>
        </div>
        {status && <div className="export-status">{status}</div>}
      </Section>

      <Section title="Format & resolution">
        <SelectRow label="Format" value={opt.format} options={FORMAT_OPTIONS} onChange={(v) => set('format', v)} />
        <Toggle label="Include Planet Mesh" value={opt.includeMesh} onChange={(v) => set('includeMesh', v)} />
        {opt.includeMesh && (
          <SelectRow label="Mesh Resolution" value={opt.meshRes} options={RES_OPTIONS} onChange={(v) => set('meshRes', v)} />
        )}
      </Section>

      <Section title="Texture baking">
        <Toggle label="Bake Color Texture" value={opt.bakeColor} onChange={(v) => set('bakeColor', v)} />
        {opt.bakeColor && (
          <>
            <Toggle label="Bake Lighting into Color" value={opt.bakeLighting} onChange={(v) => set('bakeLighting', v)} />
            <SelectRow label="Texture Size" value={opt.texRes} options={TEX_OPTIONS} onChange={(v) => set('texRes', v)} />
          </>
        )}
      </Section>

      <Section title="Additional assets" defaultOpen={false}>
        <Toggle label="Include Water Shell" value={opt.exportWater} onChange={(v) => set('exportWater', v)} />
        <Toggle label="Export Preset (JSON)" value={opt.exportPreset} onChange={(v) => set('exportPreset', v)} />
      </Section>
    </>
  );
}

export const PANELS = [
  { id: 'terrain', label: 'Terrain', component: TerrainPanel, modes: ['planet'] },
  { id: 'biomes', label: 'Biomes', component: BiomesPanel, modes: ['planet'] },
  { id: 'style', label: 'Style', component: StylePanel, modes: ['planet'] },
  { id: 'water', label: 'Water', component: WaterPanel, modes: ['planet'] },
  { id: 'clouds', label: 'Clouds', component: CloudsPanel, modes: ['planet'] },
  { id: 'star', label: 'Star', component: StarPanel, modes: ['star'] },
  { id: 'shader', label: 'Shader', component: ShaderPanel, modes: ['star'] },
  { id: 'perf', label: 'Perf', component: PerformancePanel, modes: ['planet'] },
  { id: 'export', label: 'Export', component: ExportPanel, modes: ['planet'] },
];
