import { useState } from 'react';
import { Slider, Toggle, ColorRow, Section, SelectRow } from './controls.jsx';
import { PLANET_PRESETS, STAR_PRESETS, GAS_PRESETS } from '../engine/presets.js';
import { DEFAULT_STAR_BODY } from '../engine/star.js';
import { planetCodeSnippet } from '../project/codeSnippet.js';

// One component per side-panel tab. Each receives (params, onParam) and, for
// the style panel, onPreset. Pure declarative mappings — no engine access.

export function TerrainPanel({ params: p, onParam, terrain = { mode: 'procedural' }, onTerrainMode, onOpenNodes }) {
  return (
    <>
      <Section title="Terrain source">
        <div className="terrain-source-switch" role="group" aria-label="Terrain source">
          <button type="button" className={terrain.mode === 'procedural' ? 'active' : ''} onClick={() => onTerrainMode?.('procedural')}>Procedural</button>
          <button type="button" className={terrain.mode === 'nodes' ? 'active' : ''} onClick={() => terrain.mode === 'nodes' ? onOpenNodes?.() : onTerrainMode?.('nodes')}>Nodes</button>
        </div>
        {terrain.mode === 'nodes' && <p className="terrain-source-note">The node graph controls the relief. <button type="button" onClick={onOpenNodes}>Open graph editor</button></p>}
      </Section>
      <Section title="Planet">
        <Slider param="radius" label="Radius" value={p.radius} min={600} max={6000} step={50} digits={0} onChange={(v) => onParam('radius', v)} />
        <Slider param="heightScale" label="Height scale" value={p.heightScale} min={20} max={400} step={5} digits={0} onChange={(v) => onParam('heightScale', v)} />
        <Slider param="seaLevel" label="Sea level" value={p.seaLevel} min={0} max={0.9} step={0.01} onChange={(v) => onParam('seaLevel', v)} />
      </Section>
      {terrain.mode !== 'nodes' && <><Section title="Noise">
        <Slider param="noiseScale" label="Scale" value={p.noiseScale} min={0.5} max={8} step={0.1} digits={1} onChange={(v) => onParam('noiseScale', v)} />
        <Slider param="octaves" label="Octaves" value={p.octaves} min={3} max={8} step={1} digits={0} onChange={(v) => onParam('octaves', v)} title="Rebuilds the shaders" />
        <Slider param="persistence" label="Persistence" value={p.persistence} min={0.3} max={0.7} step={0.01} onChange={(v) => onParam('persistence', v)} />
        <Slider param="lacunarity" label="Lacunarity" value={p.lacunarity} min={1.5} max={3} step={0.05} onChange={(v) => onParam('lacunarity', v)} />
        <Slider param="warp" label="Warp" value={p.warp} min={0} max={2} step={0.05} onChange={(v) => onParam('warp', v)} />
        <Slider param="continents" label="Continents" value={p.continents} min={0} max={1} step={0.05} onChange={(v) => onParam('continents', v)} title="Shapes broad ocean basins and coherent landmasses" />
      </Section>
      <Section title="Mountains & craters">
        <Slider param="ridge" label="Ridge" value={p.ridge} min={0} max={1.5} step={0.05} onChange={(v) => onParam('ridge', v)} />
        <Slider param="mountainScale" label="Ridge scale" value={p.mountainScale} min={1} max={6} step={0.1} digits={1} onChange={(v) => onParam('mountainScale', v)} />
        <Slider param="craters" label="Craters" value={p.craters} min={0} max={1} step={0.05} onChange={(v) => onParam('craters', v)} />
        <Slider param="craterScale" label="Crater scale" value={p.craterScale} min={2} max={16} step={0.5} digits={1} onChange={(v) => onParam('craterScale', v)} />
      </Section>
      </>}
    </>
  );
}

export function BiomesPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Climate">
        <Slider param="biomeAmount" label="Biome amount" value={p.biomeAmount} min={0} max={1} step={0.05} onChange={(v) => onParam('biomeAmount', v)} title="0 = plain altitude bands, 1 = full temperature/moisture biome map" />
        <Slider param="tempBias" label="Temperature" value={p.tempBias} min={-1} max={1} step={0.05} onChange={(v) => onParam('tempBias', v)} title="Shifts the whole planet colder or hotter" />
        <Slider param="moistureScale" label="Moisture scale" value={p.moistureScale} min={0.5} max={5} step={0.1} digits={1} onChange={(v) => onParam('moistureScale', v)} title="Frequency of the wet/dry regions" />
      </Section>
      <Section title="Cold biomes">
        <ColorRow param="bioTundra" label="Tundra (dry)" value={p.bioTundra} onChange={(v) => onParam('bioTundra', v)} />
        <ColorRow param="bioSteppe" label="Steppe (mid)" value={p.bioSteppe} onChange={(v) => onParam('bioSteppe', v)} />
        <ColorRow param="bioTaiga" label="Taiga (wet)" value={p.bioTaiga} onChange={(v) => onParam('bioTaiga', v)} />
      </Section>
      <Section title="Temperate biomes">
        <ColorRow param="bioShrub" label="Shrubland (dry)" value={p.bioShrub} onChange={(v) => onParam('bioShrub', v)} />
        <ColorRow param="colGrass" label="Grassland (mid)" value={p.colGrass} onChange={(v) => onParam('colGrass', v)} />
        <ColorRow param="colForest" label="Forest (wet)" value={p.colForest} onChange={(v) => onParam('colForest', v)} />
      </Section>
      <Section title="Hot biomes">
        <ColorRow param="bioDesert" label="Desert (dry)" value={p.bioDesert} onChange={(v) => onParam('bioDesert', v)} />
        <ColorRow param="bioSavanna" label="Savanna (mid)" value={p.bioSavanna} onChange={(v) => onParam('bioSavanna', v)} />
        <ColorRow param="bioJungle" label="Jungle (wet)" value={p.bioJungle} onChange={(v) => onParam('bioJungle', v)} />
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
      <Section title="Lighting">
        <Slider param="sunAzimuth" label="Sun azimuth" value={p.sunAzimuth} min={0} max={360} step={1} digits={0} onChange={(v) => onParam('sunAzimuth', v)} />
        <Slider param="sunElevation" label="Sun elevation" value={p.sunElevation} min={-30} max={90} step={1} digits={0} onChange={(v) => onParam('sunElevation', v)} />
        <Slider param="sunIntensity" label="Sun intensity" value={p.sunIntensity} min={0.2} max={2.5} step={0.05} onChange={(v) => onParam('sunIntensity', v)} />
        <Slider param="ambient" label="Sky light" value={p.ambient} min={0} max={0.8} step={0.02} onChange={(v) => onParam('ambient', v)} title="Diffuse light from the sky dome (fades out on the night side)" />
        <Slider param="exposure" label="Exposure" value={p.exposure} min={0.3} max={3} step={0.05} onChange={(v) => onParam('exposure', v)} title="Camera exposure before the filmic tone map" />
      </Section>
      <Section title="Atmosphere">
        <Toggle param="atmoEnabled" label="Enabled" value={p.atmoEnabled} onChange={(v) => onParam('atmoEnabled', v)} />
        <Slider param="atmoStrength" label="Density" value={p.atmoStrength} min={0} max={3} step={0.05} onChange={(v) => onParam('atmoStrength', v)} title="Air density — 1 matches Earth's optical depth at any planet size" />
        <Slider param="atmoHeight" label="Height" value={p.atmoHeight} min={0.01} max={0.12} step={0.005} digits={3} onChange={(v) => onParam('atmoHeight', v)} title="Atmosphere thickness as a fraction of the radius" />
        <Slider param="atmoHaze" label="Haze" value={p.atmoHaze} min={0} max={1} step={0.05} onChange={(v) => onParam('atmoHaze', v)} title="Aerosols / dust (Mie scattering): whiter sky, sun halo" />
        <ColorRow param="atmoColor" label="Scattering tint" value={p.atmoColor} onChange={(v) => onParam('atmoColor', v)} />
      </Section>
      <Section title="Surface palette">
        <ColorRow param="colSand" label="Sand" value={p.colSand} onChange={(v) => onParam('colSand', v)} />
        <ColorRow param="colRock" label="Rock" value={p.colRock} onChange={(v) => onParam('colRock', v)} />
        <ColorRow param="colSnow" label="Snow & ice" value={p.colSnow} onChange={(v) => onParam('colSnow', v)} />
        <Slider param="bandSoftness" label="Biome blend" value={p.bandSoftness} min={0.005} max={0.2} step={0.005} digits={3} onChange={(v) => onParam('bandSoftness', v)} title="Width of the transitions between biomes" />
      </Section>
      <Section title="Snow & poles">
        <Slider param="snowLine" label="Snow line" value={p.snowLine} min={0.1} max={1.2} step={0.02} onChange={(v) => onParam('snowLine', v)} title="Altitude where snow starts at the equator (drops toward the poles)" />
        <Slider param="polarCaps" label="Polar ice" value={p.polarCaps} min={0} max={1} step={0.05} onChange={(v) => onParam('polarCaps', v)} title="Extent of the polar ice sheets and sea ice" />
      </Section>
      <Section title="Stylized shading" defaultOpen={false}>
        <Toggle param="toonEnabled" label="Toon bands" value={p.toonEnabled} onChange={(v) => onParam('toonEnabled', v)} />
        <Slider param="toonBands" label="Bands" value={p.toonBands} min={2} max={8} step={1} digits={0} onChange={(v) => onParam('toonBands', v)} />
        <Slider param="toonSoftness" label="Band softness" value={p.toonSoftness} min={0} max={0.3} step={0.005} digits={3} onChange={(v) => onParam('toonSoftness', v)} />
      </Section>
    </>
  );
}

export function WaterPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Ocean">
        <Toggle param="waterEnabled" label="Enabled" value={p.waterEnabled} onChange={(v) => onParam('waterEnabled', v)} />
        <Slider param="waterClarity" label="Clarity" value={p.waterClarity} min={0.005} max={0.4} step={0.005} digits={3} onChange={(v) => onParam('waterClarity', v)} title="How deep light reaches before the water takes the shallow tint (fraction of the terrain relief)" />
        <ColorRow param="colDeep" label="Deep water" value={p.colDeep} onChange={(v) => onParam('colDeep', v)} />
        <ColorRow param="colShallow" label="Shallow tint" value={p.colShallow} onChange={(v) => onParam('colShallow', v)} />
        <Slider param="waterSpec" label="Sun glint" value={p.waterSpec} min={0} max={2} step={0.05} onChange={(v) => onParam('waterSpec', v)} />
        <Slider param="waterEmissive" label="Molten" value={p.waterEmissive} min={0} max={1} step={0.05} onChange={(v) => onParam('waterEmissive', v)} title="Self-lit liquid (lava seas); foam becomes cooled crust" />
      </Section>
      <Section title="Waves">
        <Slider param="waveSize" label="Wave size" value={p.waveSize} min={0.5} max={40} step={0.5} digits={1} onChange={(v) => onParam('waveSize', v)} title="Longest wavelength in world units — detail below a pixel turns into glint roughness" />
        <Slider param="waveHeight" label="Wave height" value={p.waveHeight} min={0} max={2} step={0.05} onChange={(v) => onParam('waveHeight', v)} title="Steepness: calm mirror to rough sea" />
        <Slider param="waveSpeed" label="Wave speed" value={p.waveSpeed} min={0} max={3} step={0.05} onChange={(v) => onParam('waveSpeed', v)} />
      </Section>
      <Section title="Foam">
        <Slider param="foamWidth" label="Shore width" value={p.foamWidth} min={0} max={1} step={0.01} onChange={(v) => onParam('foamWidth', v)} title="Surf band along the coasts (depth based)" />
        <Slider param="foamAmount" label="Amount" value={p.foamAmount} min={0} max={2} step={0.05} onChange={(v) => onParam('foamAmount', v)} />
        <Slider param="whitecaps" label="Whitecaps" value={p.whitecaps} min={0} max={1} step={0.05} onChange={(v) => onParam('whitecaps', v)} title="Breaking crests in windy open water" />
        <ColorRow param="colFoam" label="Foam" value={p.colFoam} onChange={(v) => onParam('colFoam', v)} />
      </Section>
    </>
  );
}

export function CloudsPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Clouds">
        <Toggle param="cloudsEnabled" label="Enabled" value={p.cloudsEnabled} onChange={(v) => onParam('cloudsEnabled', v)} />
        <Slider param="cloudCoverage" label="Coverage" value={p.cloudCoverage} min={0} max={1} step={0.02} onChange={(v) => onParam('cloudCoverage', v)} />
        <Slider param="cloudDensity" label="Density" value={p.cloudDensity} min={0.1} max={2} step={0.05} onChange={(v) => onParam('cloudDensity', v)} title="Optical thickness of the volume" />
        <Slider param="cloudSoftness" label="Softness" value={p.cloudSoftness} min={0.01} max={0.5} step={0.01} onChange={(v) => onParam('cloudSoftness', v)} title="How gradually systems thin out into broken fields" />
        <Slider param="cloudShadowStrength" label="Shadows" value={p.cloudShadowStrength} min={0} max={1} step={0.05} onChange={(v) => onParam('cloudShadowStrength', v)} title="Shadows cast on land and sea" />
      </Section>
      <Section title="Shape & motion">
        <Slider param="cloudScale" label="System scale" value={p.cloudScale} min={1} max={10} step={0.1} digits={1} onChange={(v) => onParam('cloudScale', v)} title="Frequency of weather systems" />
        <Slider param="cloudDetail" label="Erosion" value={p.cloudDetail} min={0} max={1} step={0.05} onChange={(v) => onParam('cloudDetail', v)} title="Wispy bottoms / billowy tops" />
        <Slider param="cloudDetailScale" label="Billow size" value={p.cloudDetailScale} min={0.3} max={3} step={0.05} onChange={(v) => onParam('cloudDetailScale', v)} />
        <Slider param="cloudAltitude" label="Altitude" value={p.cloudAltitude} min={0} max={0.03} step={0.001} digits={3} onChange={(v) => onParam('cloudAltitude', v)} title="Cloud base above sea level (fraction of radius)" />
        <Slider param="cloudThickness" label="Thickness" value={p.cloudThickness} min={0.002} max={0.03} step={0.001} digits={3} onChange={(v) => onParam('cloudThickness', v)} title="Depth of the cloud layer (fraction of radius)" />
        <Slider param="cloudSpeed" label="Speed" value={p.cloudSpeed} min={0} max={3} step={0.05} onChange={(v) => onParam('cloudSpeed', v)} />
      </Section>
      <Section title="Quality">
        <Slider param="cloudQuality" label="Ray steps" value={p.cloudQuality} min={24} max={128} step={4} digits={0} onChange={(v) => onParam('cloudQuality', v)} title="Maximum raymarch steps through the cloud layer" />
        <Slider param="cloudResolution" label="Resolution" value={p.cloudResolution} min={0.25} max={1} step={0.05} onChange={(v) => onParam('cloudResolution', v)} title="Pixel budget of the cloud pass when the planet fills the screen — a smaller planet automatically gets full-resolution clouds" />
      </Section>
      <Section title="Colors">
        <ColorRow param="cloudColor" label="Cloud" value={p.cloudColor} onChange={(v) => onParam('cloudColor', v)} />
        <ColorRow param="cloudShadow" label="Sky-lit tint" value={p.cloudShadow} onChange={(v) => onParam('cloudShadow', v)} />
      </Section>
    </>
  );
}

export function GasFlowPanel({ params: p, onParam, onGasPreset }) {
  return (
    <>
      <Section title="Preset">
        <div className="preset-grid">
          {Object.entries(GAS_PRESETS).map(([key, def]) => (
            <button key={key} type="button" className="preset-btn" onClick={() => onGasPreset(key)}>
              {def.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Bands">
        <Slider param="gasBandCount" label="Band count" value={p.gasBandCount} min={2} max={32} step={1} digits={0} onChange={(v) => onParam('gasBandCount', v)} title="Belts + zones from pole to pole" />
        <Slider param="gasContrast" label="Contrast" value={p.gasContrast} min={0} max={1} step={0.05} onChange={(v) => onParam('gasContrast', v)} title="Brightness difference between dark belts and bright zones" />
        <Slider param="gasBandWarp" label="Waviness" value={p.gasBandWarp} min={0} max={1.5} step={0.05} onChange={(v) => onParam('gasBandWarp', v)} title="How much the band edges meander" />
        <Slider param="gasPolarHaze" label="Polar haze" value={p.gasPolarHaze} min={0} max={1} step={0.05} onChange={(v) => onParam('gasPolarHaze', v)} title="Banding dissolves into cyclones under a haze toward the poles" />
      </Section>
      <Section title="Flow">
        <Slider param="gasWarp" label="Turbulence" value={p.gasWarp} min={0} max={1.5} step={0.05} onChange={(v) => onParam('gasWarp', v)} title="Eddies in the shear zones between belts and zones" />
        <Slider param="gasScale" label="Eddy scale" value={p.gasScale} min={0.8} max={8} step={0.1} digits={1} onChange={(v) => onParam('gasScale', v)} title="Frequency of the turbulent eddies" />
        <Slider param="gasFlowSpeed" label="Flow speed" value={p.gasFlowSpeed} min={0} max={3} step={0.05} onChange={(v) => onParam('gasFlowSpeed', v)} title="Zonal jet + churn speed" />
      </Section>
      <Section title="Body">
        <Slider param="gasTilt" label="Axial tilt" value={p.gasTilt} min={0} max={90} step={0.5} digits={1} onChange={(v) => onParam('gasTilt', v)} title="Tilt of the spin axis (and the ring plane), degrees" />
        <Slider param="gasLimb" label="Limb darkening" value={p.gasLimb} min={0} max={1} step={0.05} onChange={(v) => onParam('gasLimb', v)} title="Minnaert limb darkening of the hazy cloud tops" />
      </Section>
    </>
  );
}

export function GasStormsPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Storms">
        <Toggle param="gasStormsEnabled" label="Enabled" value={p.gasStormsEnabled} onChange={(v) => onParam('gasStormsEnabled', v)} />
        <Slider param="gasGreatSpot" label="Great spot" value={p.gasGreatSpot} min={0} max={1} step={0.05} onChange={(v) => onParam('gasGreatSpot', v)} title="Size of the giant anticyclone (0 = none)" />
        <Slider param="gasStorms" label="Oval count" value={p.gasStorms} min={0} max={1} step={0.05} onChange={(v) => onParam('gasStorms', v)} title="Number of smaller vortices (white ovals, dark barges)" />
        <Slider param="gasStormScale" label="Oval size" value={p.gasStormScale} min={0.3} max={3} step={0.05} onChange={(v) => onParam('gasStormScale', v)} />
      </Section>
    </>
  );
}

export function GasColorsPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Cloud colors">
        <ColorRow param="gasColorZone" label="Zones" value={p.gasColorZone} onChange={(v) => onParam('gasColorZone', v)} />
        <ColorRow param="gasColorBelt" label="Belts" value={p.gasColorBelt} onChange={(v) => onParam('gasColorBelt', v)} />
        <ColorRow param="gasColorAccent" label="Accent" value={p.gasColorAccent} onChange={(v) => onParam('gasColorAccent', v)} />
        <ColorRow param="gasColorStorm" label="Great spot" value={p.gasColorStorm} onChange={(v) => onParam('gasColorStorm', v)} />
        <ColorRow param="gasColorPolar" label="Polar haze" value={p.gasColorPolar} onChange={(v) => onParam('gasColorPolar', v)} />
      </Section>
      <Section title="Atmosphere">
        <ColorRow param="gasAtmoColor" label="Scattering tint" value={p.gasAtmoColor} onChange={(v) => onParam('gasAtmoColor', v)} />
        <Slider param="gasAtmoStrength" label="Density" value={p.gasAtmoStrength} min={0} max={2} step={0.05} onChange={(v) => onParam('gasAtmoStrength', v)} title="Air above the cloud tops: limb glow and blue haze" />
        <Slider param="gasAtmoHaze" label="Haze" value={p.gasAtmoHaze} min={0} max={1} step={0.05} onChange={(v) => onParam('gasAtmoHaze', v)} title="Aerosol haze (Mie scattering)" />
      </Section>
    </>
  );
}

export function GasRingsPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Rings">
        <Toggle param="gasRingsEnabled" label="Enabled" value={p.gasRingsEnabled} onChange={(v) => onParam('gasRingsEnabled', v)} />
        <Slider param="gasRingInner" label="Inner radius" value={p.gasRingInner} min={1.05} max={3} step={0.01} onChange={(v) => onParam('gasRingInner', Math.min(v, p.gasRingOuter - 0.05))} title="Inner edge, in planet radii" />
        <Slider param="gasRingOuter" label="Outer radius" value={p.gasRingOuter} min={1.2} max={4} step={0.01} onChange={(v) => onParam('gasRingOuter', Math.max(v, p.gasRingInner + 0.05))} title="Outer edge, in planet radii" />
        <Slider param="gasRingOpacity" label="Opacity" value={p.gasRingOpacity} min={0} max={2} step={0.02} onChange={(v) => onParam('gasRingOpacity', v)} title="Optical depth of the ring particles" />
        <ColorRow param="gasRingColor" label="Color" value={p.gasRingColor} onChange={(v) => onParam('gasRingColor', v)} />
      </Section>
    </>
  );
}

export function GasLightingPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Lighting">
        <Slider param="sunAzimuth" label="Sun azimuth" value={p.sunAzimuth} min={0} max={360} step={1} digits={0} onChange={(v) => onParam('sunAzimuth', v)} />
        <Slider param="sunElevation" label="Sun elevation" value={p.sunElevation} min={-30} max={90} step={1} digits={0} onChange={(v) => onParam('sunElevation', v)} />
        <Slider param="sunIntensity" label="Sun intensity" value={p.sunIntensity} min={0.2} max={2.5} step={0.05} onChange={(v) => onParam('sunIntensity', v)} />
        <Slider param="ambient" label="Ambient" value={p.ambient} min={0} max={0.8} step={0.02} onChange={(v) => onParam('ambient', v)} />
        <Slider param="exposure" label="Exposure" value={p.exposure} min={0.2} max={3} step={0.05} onChange={(v) => onParam('exposure', v)} />
        <Toggle param="toonEnabled" label="Toon shading" value={p.toonEnabled} onChange={(v) => onParam('toonEnabled', v)} />
        <Slider param="toonBands" label="Toon bands" value={p.toonBands} min={2} max={8} step={1} digits={0} onChange={(v) => onParam('toonBands', v)} />
      </Section>
    </>
  );
}

export function StarSurfacePanel({ params: p, onParam, onStarPreset }) {
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
      <Section title="Photosphere">
        <Slider param="starTemperature" label="Temperature" value={p.starTemperature} min={2000} max={30000} step={100} digits={0} onChange={(v) => onParam('starTemperature', v)} title="Effective temperature in kelvin — sets the blackbody colour" />
        <Slider param="starBrightness" label="Brightness" value={p.starBrightness} min={0.2} max={5} step={0.05} onChange={(v) => onParam('starBrightness', v)} title="Emitted radiance: higher overexposes the disc into glare" />
        <Slider param="starLimbDarken" label="Limb darkening" value={p.starLimbDarken} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starLimbDarken', v)} title="1 = solar; the limb also reddens" />
      </Section>
      <Section title="Convection">
        <Slider param="starNoiseScale" label="Granule scale" value={p.starNoiseScale} min={0.5} max={8} step={0.1} digits={1} onChange={(v) => onParam('starNoiseScale', v)} title="Size of the convection cells (larger = smaller cells)" />
        <Slider param="starGranules" label="Granulation" value={p.starGranules} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starGranules', v)} title="Contrast between bright cells and dark lanes" />
        <Slider param="starTurbulence" label="Network" value={p.starTurbulence} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starTurbulence', v)} title="Supergranulation network and large-scale mottling" />
        <Slider param="starFaculae" label="Faculae" value={p.starFaculae} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starFaculae', v)} title="Bright magnetic network, strongest toward the limb" />
        <Slider param="starFlowSpeed" label="Flow speed" value={p.starFlowSpeed} min={0} max={3} step={0.05} onChange={(v) => onParam('starFlowSpeed', v)} title="Convection + rotation speed" />
      </Section>
    </>
  );
}

export function StarColorsPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Colors">
        <ColorRow param="starTint" label="Tint" value={p.starTint} onChange={(v) => onParam('starTint', v)} />
        <ColorRow param="starChromoColor" label="Chromosphere" value={p.starChromoColor} onChange={(v) => onParam('starChromoColor', v)} />
        <ColorRow param="starCoronaColor" label="Corona" value={p.starCoronaColor} onChange={(v) => onParam('starCoronaColor', v)} />
      </Section>
    </>
  );
}

export function StarSunspotsPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Sunspots">
        <Toggle param="starSpotsEnabled" label="Enabled" value={p.starSpotsEnabled} onChange={(v) => onParam('starSpotsEnabled', v)} />
        <Slider param="starSpots" label="Amount" value={p.starSpots} min={0} max={1} step={0.05} onChange={(v) => onParam('starSpots', v)} title="Magnetic activity: spot coverage in the active belts" />
        <Slider param="starSpotScale" label="Region size" value={p.starSpotScale} min={0.5} max={8} step={0.1} digits={1} onChange={(v) => onParam('starSpotScale', v)} title="Frequency of the active regions (larger = smaller groups)" />
      </Section>
    </>
  );
}

export function StarCoronaPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Corona">
        <Toggle param="starCoronaEnabled" label="Enabled" value={p.starCoronaEnabled} onChange={(v) => onParam('starCoronaEnabled', v)} />
        <Slider param="starCoronaSize" label="Size" value={p.starCoronaSize} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starCoronaSize', v)} title="Extent of the outer corona" />
        <Slider param="starCoronaStrength" label="Strength" value={p.starCoronaStrength} min={0} max={2} step={0.05} onChange={(v) => onParam('starCoronaStrength', v)} />
        <Slider param="starFlares" label="Streamers" value={p.starFlares} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starFlares', v)} title="Contrast of the radial streamers" />
      </Section>
      <Section title="Limb">
        <Slider param="starProminences" label="Prominences" value={p.starProminences} min={0} max={1.5} step={0.05} onChange={(v) => onParam('starProminences', v)} title="Glowing plasma loops rising off the limb" />
      </Section>
      <Section title="Glare">
        <Slider param="starBloom" label="Bloom" value={p.starBloom} min={0} max={3} step={0.05} onChange={(v) => onParam('starBloom', v)} title="Glare spreading from the overexposed disc" />
        <Slider param="exposure" label="Exposure" value={p.exposure} min={0.2} max={3} step={0.05} onChange={(v) => onParam('exposure', v)} />
      </Section>
    </>
  );
}

export function StarMotionPanel({ params: p, onParam }) {
  return (
    <>
      <Section title="Motion">
        <Slider param="starPulseAmount" label="Pulse amount" value={p.starPulseAmount} min={0} max={0.08} step={0.002} digits={3} onChange={(v) => onParam('starPulseAmount', v)} title="Radius breathing of a pulsating variable (0 = quiet star)" />
        <Slider param="starPulseSpeed" label="Pulse speed" value={p.starPulseSpeed} min={0} max={4} step={0.1} digits={1} onChange={(v) => onParam('starPulseSpeed', v)} />
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
      <Section title="Rendering">
        <SelectRow param="renderResolution" label="Resolution" value={p.renderResolution} options={[
          { value: '1', label: '100% (Native)' },
          { value: '0.85', label: '85%' },
          { value: '0.75', label: '75%' },
          { value: '0.67', label: '67%' },
          { value: '0.5', label: '50%' },
          { value: '0.33', label: '33%' },
          { value: '0.25', label: '25%' },
        ]} onChange={(v) => onParam('renderResolution', Number(v))} title="Render at a percentage of the display resolution. 50% uses one quarter of the pixels." />
        <SelectRow param="upscaler" label="Upscaler" value={p.upscaler} options={[
          { value: 'bilinear', label: 'Bilinear' },
          { value: 'spatial', label: 'Spatial' },
        ]} onChange={(v) => onParam('upscaler', v)} title="Reconstruct reduced-resolution frames: Bilinear is faster; Spatial uses sharper bicubic reconstruction. Active below 100%." />
      </Section>
      {p.mode === 'planet' && (
        <>
          <Section title="LOD">
            <Slider param="maxDepth" label="Max depth" value={p.maxDepth} min={2} max={7} step={1} digits={0} onChange={(v) => onParam('maxDepth', v)} title="Quadtree subdivision limit (rebuild)" />
            <Slider param="splitFactor" label="Split factor" value={p.splitFactor} min={1.2} max={4} step={0.1} digits={1} onChange={(v) => onParam('splitFactor', v)} title="Higher = subdivide sooner (more detail, more chunks)" />
            <Slider param="chunkRes" label="Chunk res" value={p.chunkRes} min={8} max={64} step={8} digits={0} onChange={(v) => onParam('chunkRes', v)} title="Grid quads per chunk side (rebuild)" />
          </Section>
          <Section title="Debug">
            <Toggle param="wireframe" label="Wireframe" value={p.wireframe} onChange={(v) => onParam('wireframe', v)} />
          </Section>
        </>
      )}
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

export function ExportPanel({ params: p, terrain, onExport, onScreenshot }) {
  const isStar = p.mode === 'star';
  const isGas = p.mode === 'gas';
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
            {busy ? 'Exporting...' : isStar ? 'Export Star' : isGas ? 'Export Gas Planet' : 'Export Planet'}
          </button>
          <button type="button" className="action-btn" onClick={onScreenshot} disabled={busy}>
            Screenshot
          </button>
        </div>
        {status && <div className="export-status">{status}</div>}
      </Section>

      <Section title="Format & resolution">
        <SelectRow param="format" label="Format" value={opt.format} options={FORMAT_OPTIONS} onChange={(v) => set('format', v)} />
        <Toggle param="includeMesh" label={isStar ? 'Include Star Mesh' : isGas ? 'Include Gas Planet Mesh' : 'Include Planet Mesh'} value={opt.includeMesh} onChange={(v) => set('includeMesh', v)} />
        {opt.includeMesh && (
          <SelectRow param="meshRes" label="Mesh Resolution" value={opt.meshRes} options={RES_OPTIONS} onChange={(v) => set('meshRes', v)} />
        )}
      </Section>

      <Section title="Texture baking">
        <Toggle param="bakeColor" label="Bake Color Texture" value={opt.bakeColor} onChange={(v) => set('bakeColor', v)} />
        {opt.bakeColor && (
          <>
            {!isStar && (
              <Toggle param="bakeLighting" label="Bake Lighting into Color" value={opt.bakeLighting} onChange={(v) => set('bakeLighting', v)} />
            )}
            <SelectRow param="texRes" label="Texture Size" value={opt.texRes} options={TEX_OPTIONS} onChange={(v) => set('texRes', v)} />
          </>
        )}
      </Section>

      <Section title="Additional assets" defaultOpen={false}>
        {!isStar && !isGas && (
          <Toggle param="exportWater" label="Include Water Shell" value={opt.exportWater} onChange={(v) => set('exportWater', v)} />
        )}
        <Toggle param="exportPreset" label="Export Preset (JSON)" value={opt.exportPreset} onChange={(v) => set('exportPreset', v)} />
      </Section>

      <UseInCodeSection params={p} terrain={terrain} />
    </>
  );
}

// The current body as a procedural-planets constructor call, for pasting
// into another three.js project.
function UseInCodeSection({ params, terrain }) {
  const [copied, setCopied] = useState('');
  const code = planetCodeSnippet(params, terrain);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied('Copied to clipboard');
    } catch {
      setCopied('Select the code and copy it manually');
    }
    window.setTimeout(() => setCopied(''), 2000);
  };
  return (
    <Section title="Use in code" defaultOpen={false}>
      <div className="export-actions">
        <button type="button" className="action-btn" onClick={copy}>Copy code</button>
      </div>
      {copied && <div className="export-status">{copied}</div>}
      <pre className="code-snippet">{code}</pre>
    </Section>
  );
}

export const PANELS = [
  { id: 'terrain', label: 'Terrain', component: TerrainPanel, modes: ['planet'] },
  { id: 'biomes', label: 'Biomes', component: BiomesPanel, modes: ['planet'] },
  { id: 'style', label: 'Style', component: StylePanel, modes: ['planet'] },
  { id: 'water', label: 'Water', component: WaterPanel, modes: ['planet'] },
  { id: 'clouds', label: 'Clouds', component: CloudsPanel, modes: ['planet'] },
  { id: 'gasFlow', label: 'Flow', component: GasFlowPanel, modes: ['gas'] },
  { id: 'gasStorms', label: 'Storms', component: GasStormsPanel, modes: ['gas'] },
  { id: 'gasColors', label: 'Colors', component: GasColorsPanel, modes: ['gas'] },
  { id: 'gasRings', label: 'Rings', component: GasRingsPanel, modes: ['gas'] },
  { id: 'gasLighting', label: 'Lighting', component: GasLightingPanel, modes: ['gas'] },
  { id: 'starSurface', label: 'Surface', component: StarSurfacePanel, modes: ['star'] },
  { id: 'starColors', label: 'Colors', component: StarColorsPanel, modes: ['star'] },
  { id: 'starSunspots', label: 'Sunspots', component: StarSunspotsPanel, modes: ['star'] },
  { id: 'starCorona', label: 'Corona', component: StarCoronaPanel, modes: ['star'] },
  { id: 'starMotion', label: 'Motion', component: StarMotionPanel, modes: ['star'] },
  // Shader tab hidden for now — ShaderPanel + Engine.setStarShader stay wired,
  // re-add { id: 'shader', modes: ['star'] } here to bring it back.
  { id: 'perf', label: 'Perf', component: PerformancePanel, modes: ['planet', 'gas', 'star'] },
  { id: 'export', label: 'Export', component: ExportPanel, modes: ['planet', 'gas', 'star'] },
];
