import { DEFAULT_PARAMS } from '../presets.js';

const field = (key, label, min, max, step = 0.01, structural = false) => ({ key, label, type: 'number', min, max, step, structural });
export const TERRAIN_KEYS = ['noiseScale', 'octaves', 'persistence', 'lacunarity', 'warp', 'ridge', 'mountainScale', 'craters', 'craterScale', 'continents'];
const currentFields = [
  field('noiseScale', 'Frequency', 0.01, 20), field('octaves', 'Octaves', 1, 12, 1, true),
  field('persistence', 'Persistence', 0, 1), field('lacunarity', 'Lacunarity', 1, 4),
  field('warp', 'Domain warp', 0, 3), field('ridge', 'Mountains', 0, 1.5),
  field('mountainScale', 'Mountain frequency', 0.01, 20), field('craters', 'Craters', 0, 1),
  field('craterScale', 'Crater frequency', 0.01, 40), field('continents', 'Continents', 0, 1),
];
const port = (id, label = 'Height') => ({ id, label, type: 'height' });
export const GRAPH_REGISTRY = {
  currentTerrain: { label: 'Current Terrain', category: 'Sources', color: '#4bb5dc', inputs: [], outputs: [port('height')], fields: currentFields, defaults: Object.fromEntries(TERRAIN_KEYS.map(key => [key, DEFAULT_PARAMS[key]])) },
  noise3d: { label: 'Noise 3D', category: 'Sources', color: '#4bb5dc', inputs: [], outputs: [port('height')], fields: [field('frequency', 'Frequency', 0.01, 20), field('octaves', 'Octaves', 1, 12, 1, true), field('lacunarity', 'Lacunarity', 1, 4), field('persistence', 'Persistence', 0, 1), field('seedOffset', 'Seed offset', -65536, 65536, 1)], defaults: { frequency: 2.6, octaves: 6, lacunarity: 2.05, persistence: 0.52, seedOffset: 0 } },
  constant: { label: 'Constant', category: 'Sources', color: '#4bb5dc', inputs: [], outputs: [port('height')], fields: [field('value', 'Height', -10, 10)], defaults: { value: 0.5 } },
  mix: { label: 'Mix', category: 'Operators', color: '#b79cea', inputs: [port('a', 'A'), port('b', 'B')], outputs: [port('height')], fields: [field('factor', 'Factor', 0, 1)], defaults: { factor: 0.5 } },
  remap: { label: 'Remap', category: 'Operators', color: '#b79cea', inputs: [port('height')], outputs: [port('height')], fields: [field('inMin', 'Input minimum', -10, 10), field('inMax', 'Input maximum', -10, 10), field('outMin', 'Output minimum', -10, 10), field('outMax', 'Output maximum', -10, 10), { key: 'clamp', label: 'Clamp', type: 'boolean' }], defaults: { inMin: 0, inMax: 1, outMin: 0, outMax: 1, clamp: true } },
  heightOutput: { label: 'Height Output', category: 'Output', color: '#5ed6ad', protected: true, inputs: [port('height')], outputs: [], fields: [], defaults: {} },
};
export const GRAPH_FORMAT = 'procedural-planets-height-graph';
export const GRAPH_VERSION = 1;
// Conservative V1 budgets for this shader, independent of the 2D editor:
// each Noise octave costs one work unit. Current Terrain costs two octave
// stacks, six warp samples, one belt sample, and (when enabled) 54 Worley
// cell visits across its two crater layers. Inactive nodes do not add GPU cost.
// 64 nodes also bound scalar uniform storage (< 384 added components); the
// generated helper copies have a separate 250 kB source-size ceiling. These
// are admission limits, not measured frame-time guarantees on every device.
export const GRAPH_BUDGETS = Object.freeze({ nodes: 64, edges: 128, sourceCost: 128, shaderBytes: 250000 });
