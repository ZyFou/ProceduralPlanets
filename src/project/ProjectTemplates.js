import {
  DEFAULT_PARAMS,
  GAS_PRESETS,
  PLANET_PRESETS,
  STAR_PRESETS,
} from '../engine/presets.js';

export const PROJECT_TEMPLATES = [
  { id: 'blank', name: 'Blank planet', description: 'A clean Terran world ready to shape.', mode: 'planet', preset: 'terran', kind: 'Planet' },
  { id: 'desert', name: 'Desert world', description: 'Dry continents, warm stone, and thin cloud cover.', mode: 'planet', preset: 'desert', kind: 'Planet' },
  { id: 'ice', name: 'Frozen world', description: 'Polar oceans, ice fields, and a cool atmosphere.', mode: 'planet', preset: 'ice', kind: 'Planet' },
  { id: 'alien', name: 'Alien biosphere', description: 'An unfamiliar palette with vivid atmosphere and water.', mode: 'planet', preset: 'alien', kind: 'Planet' },
  { id: 'gas-giant', name: 'Gas giant', description: 'Jovian belts and zones, turbulent jets, and a great red storm.', mode: 'gas', preset: 'gasGiant', kind: 'Gas' },
  { id: 'ringed-giant', name: 'Ringed giant', description: 'Pale bands under a broad, shadowed ring system.', mode: 'gas', preset: 'ringed', kind: 'Gas' },
  { id: 'ice-giant', name: 'Ice giant', description: 'Cold blue bands and soft high-altitude storms.', mode: 'gas', preset: 'iceGiant', kind: 'Gas' },
  { id: 'sun', name: 'Sun', description: 'A G-type star: granulation, sunspots, prominences, and corona.', mode: 'star', preset: 'sun', kind: 'Star' },
  { id: 'red-giant', name: 'Red giant', description: 'A slow, turbulent stellar surface with a broad corona.', mode: 'star', preset: 'redGiant', kind: 'Star' },
];

export function getProjectTemplate(templateId) {
  return PROJECT_TEMPLATES.find((template) => template.id === templateId) ?? PROJECT_TEMPLATES[0];
}

export function createTemplateParams(templateId, seed = (Math.random() * 0xffffffff) >>> 0) {
  const template = getProjectTemplate(templateId);
  const source = template.mode === 'gas'
    ? GAS_PRESETS
    : template.mode === 'star'
      ? STAR_PRESETS
      : PLANET_PRESETS;
  return {
    ...DEFAULT_PARAMS,
    seed,
    mode: template.mode,
    ...(source[template.preset]?.patch ?? {}),
  };
}
