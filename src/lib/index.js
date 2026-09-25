// ============================================================================
// procedural-planets — public API.
//
//   Planet          a procedural terrestrial planet, gas giant or star
//                   (THREE.Object3D: add it to your scene, move it around)
//   PlanetRenderer  draws the Planets of a scene with your WebGLRenderer,
//                   composited over (and depth-tested against) your frame
//   PlanetViewer    a self-contained canvas + camera + controls viewer
//   bakePlanet      a static, cheap THREE.Group with baked textures
//   PlanetPass      EffectComposer pass wrapping PlanetRenderer
// ============================================================================

export {
  Planet, PLANET_TYPES, findPreset, listPresets, validateParams, normalizeParam, resolvePlanetParams,
} from '../engine/Planet.js';
export { PlanetRenderer } from '../engine/PlanetRenderer.js';
export { PlanetViewer } from '../engine/PlanetViewer.js';
export { bakePlanet } from '../engine/PlanetBaker.js';
export { PlanetPass } from './PlanetPass.js';
export {
  DEFAULT_PARAMS, PLANET_PRESETS, GAS_PRESETS, STAR_PRESETS,
  GAS_DEFAULTS, STAR_DEFAULTS, migrateParams,
} from '../engine/presets.js';
export { DEFAULT_STAR_BODY } from '../engine/star.js';
export { PARAM_DOCS } from './paramDocs.js';

export const VERSION = '0.2.0';
