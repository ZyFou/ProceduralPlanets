import { DEFAULT_PARAMS, GAS_KEYS, STAR_KEYS } from '../engine/presets.js';

// ============================================================================
// "Use in code": the studio's current planet as a procedural-planets
// constructor call — only the parameters that differ from the defaults of
// the body's own domain (plus the seed), so the snippet stays short.
// ============================================================================

// keys every body type reads besides its own domain
const COMMON_KEYS = ['seed', 'radius', 'sunAzimuth', 'sunElevation', 'sunIntensity', 'ambient',
  'exposure', 'toonEnabled', 'toonBands', 'toonSoftness'];
const SKIP = new Set(['mode', 'renderVersion', 'wireframe']);
const TYPE = { planet: 'terrestrial', gas: 'gas', star: 'star' };

const round = (v) => Math.round(v * 1e4) / 1e4;
const same = (a, b) => (Array.isArray(a)
  ? a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6)
  : typeof a === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

function domainKeys(mode) {
  const keys = Object.keys(DEFAULT_PARAMS);
  if (mode === 'gas') return keys.filter((k) => GAS_KEYS.has(k) || COMMON_KEYS.includes(k));
  if (mode === 'star') return keys.filter((k) => STAR_KEYS.has(k) || COMMON_KEYS.includes(k));
  return keys.filter((k) => !GAS_KEYS.has(k) && !STAR_KEYS.has(k));
}

/** The parameters worth writing down for this body (non-default, own domain). */
export function snippetParams(params) {
  const mode = params.mode ?? 'planet';
  const out = {};
  for (const key of domainKeys(mode)) {
    if (SKIP.has(key) || !(key in params)) continue;
    const v = params[key];
    if (key !== 'seed' && same(v, DEFAULT_PARAMS[key])) continue;
    out[key] = Array.isArray(v) ? v.map(round) : typeof v === 'number' ? round(v) : v;
  }
  return out;
}

const fmt = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(v));

/** JavaScript that recreates the planet with the procedural-planets package. */
export function planetCodeSnippet(params) {
  const mode = params.mode ?? 'planet';
  const lines = [`  type: '${TYPE[mode]}',`];
  for (const [k, v] of Object.entries(snippetParams(params))) lines.push(`  ${k}: ${fmt(v)},`);
  return [
    "import { Planet, PlanetRenderer } from 'procedural-planets';",
    '',
    'const planet = new Planet({',
    ...lines,
    '});',
    'scene.add(planet);',
    '',
    '// once, next to your WebGLRenderer:',
    'const planets = new PlanetRenderer(renderer);',
    '// every frame, after renderer.render(scene, camera):',
    'planets.render(scene, camera);',
    '',
  ].join('\n');
}
