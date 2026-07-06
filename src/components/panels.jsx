import { Slider, Toggle, ColorRow, Section } from './controls.jsx';
import { PLANET_PRESETS } from '../engine/presets.js';

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
        <ColorRow label="Grass" value={p.colGrass} onChange={(v) => onParam('colGrass', v)} />
        <ColorRow label="Forest" value={p.colForest} onChange={(v) => onParam('colForest', v)} />
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
      </Section>
      <Section title="Shape & motion">
        <Slider label="Scale" value={p.cloudScale} min={1} max={10} step={0.1} digits={1} onChange={(v) => onParam('cloudScale', v)} />
        <Slider label="Detail" value={p.cloudDetail} min={0} max={1} step={0.05} onChange={(v) => onParam('cloudDetail', v)} />
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

export const PANELS = [
  { id: 'terrain', label: 'Terrain', component: TerrainPanel },
  { id: 'style', label: 'Style', component: StylePanel },
  { id: 'water', label: 'Water', component: WaterPanel },
  { id: 'clouds', label: 'Clouds', component: CloudsPanel },
  { id: 'perf', label: 'Perf', component: PerformancePanel },
];
