// Generates the parameter reference from the single sources of truth:
//   src/engine/presets.js     defaults + inline comments
//   src/components/panels.jsx studio labels, slider ranges, tooltips
// Outputs:
//   src/lib/paramDocs.js      PARAM_DOCS (runtime metadata, exported by the lib)
//   docs/parameters.md        human reference
//   types/params.d.ts         PlanetParams TypeScript interface
// Run: npm run docs:params   (CI: node scripts/gen-param-docs.mjs --check)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presetsPath = path.join(root, 'src/engine/presets.js');
const panelsPath = path.join(root, 'src/components/panels.jsx');
const { DEFAULT_PARAMS, STAR_DEFAULTS, GAS_DEFAULTS } = await import(pathToFileURL(presetsPath).href);

// Descriptions for keys that carry no comment in presets.js
const EXTRA = {
  mode: "Body type: 'planet' (terrestrial), 'gas' or 'star'. Prefer the Planet `type` option.",
  renderVersion: 'Look-model version of the parameter set (used to migrate old studio projects). Leave as is.',
  seed: 'Random seed: every procedural field (terrain, clouds, bands, spots) derives from it.',
  radius: 'Planet radius in local units (world units at scale 1).',
  heightScale: 'Terrain relief: height of the highest peaks above the base radius, in local units.',
  noiseScale: 'Base frequency of the continent noise (higher = more, smaller landmasses).',
  persistence: 'Amplitude falloff between noise octaves (higher = rougher terrain).',
  lacunarity: 'Frequency step between noise octaves.',
  warp: 'Domain warp strength: folds and twists coastlines and ranges.',
  ridge: 'Strength of the ridged mountain ranges along tectonic belts.',
  mountainScale: 'Frequency of the mountain ridges.',
  craters: 'Impact crater amount (0 = none).',
  craterScale: 'Crater frequency (higher = smaller craters).',
  continents: 'Shapes broad ocean basins and coherent landmasses (Earth-like hypsometry).',
  waterEnabled: 'Render the ocean.',
  cloudsEnabled: 'Render the volumetric cloud layer (and its shadows).',
  cloudCoverage: 'Fraction of the sky covered by clouds.',
  cloudSpeed: 'Cloud drift / evolution speed.',
  cloudShadowStrength: 'Darkness of the shadows clouds cast on the ground and sea.',
  cloudColor: 'Sunlit cloud tint (sRGB).',
  atmoEnabled: 'Render atmospheric scattering.',
  wireframe: 'Draw the terrain LOD chunks as wireframe (debug).',
  colSand: 'Beach / low coast colour (sRGB albedo).',
  colGrass: 'Temperate grassland colour (sRGB albedo).',
  colForest: 'Temperate forest colour (sRGB albedo).',
  colRock: 'Bare rock / cliff colour (sRGB albedo).',
  colSnow: 'Snow and ice colour (sRGB albedo).',
  colFoam: 'Surf foam / sea ice crust colour (sRGB albedo).',
  bioTundra: 'Cold + dry biome colour (sRGB albedo).',
  bioSteppe: 'Cold + mid-moisture biome colour (sRGB albedo).',
  bioTaiga: 'Cold + wet biome colour (sRGB albedo).',
  bioShrub: 'Temperate + dry biome colour (sRGB albedo).',
  bioDesert: 'Hot + dry biome colour (sRGB albedo).',
  bioSavanna: 'Hot + mid-moisture biome colour (sRGB albedo).',
  bioJungle: 'Hot + wet biome colour (sRGB albedo).',
  gasStormsEnabled: 'Render the great spot and the small storm ovals.',
  gasColorZone: 'Bright zone colour (sRGB albedo).',
  gasColorBelt: 'Dark belt colour (sRGB albedo).',
  gasColorAccent: 'Turbulent eddy accent colour (sRGB albedo).',
  gasColorStorm: 'Storm / great spot colour (sRGB albedo).',
  gasColorPolar: 'Polar region colour (sRGB albedo).',
  gasRingsEnabled: 'Render the ring system.',
  gasRingColor: 'Ring particle colour (sRGB albedo).',
  starSpotsEnabled: 'Render sunspots.',
  starCoronaEnabled: 'Render the corona / streamers around the disc.',
  starPulseSpeed: 'Speed of the radius breathing (starPulseAmount).',
  waveSpeed: 'Wave animation speed.',
  seaLevel: 'Sea level, as a fraction of heightScale above the base radius.',
  foamAmount: 'Overall foam strength (shore + whitecaps).',
};

const GROUP = { mode: 'General', renderVersion: 'General', seed: 'General' };

// ---------------------------------------------------------------- presets.js
function parseDefaults(src) {
  const out = {};
  for (const name of ['STAR_DEFAULTS', 'GAS_DEFAULTS', 'DEFAULT_PARAMS']) {
    const start = src.indexOf(`export const ${name} = {`);
    const end = src.indexOf('\n};', start);
    const lines = src.slice(start, end).split('\n').slice(1);
    let group = '';
    let pending = [];
    let prevBlank = true;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { prevBlank = true; pending = []; continue; }
      if (line.startsWith('...')) { prevBlank = false; continue; }
      if (line.startsWith('//')) {
        const text = line.replace(/^\/\/\s?/, '');
        if (prevBlank && !pending.length) { group = text; pending = []; pending.isGroup = true; }
        else if (pending.isGroup) group += ` ${text}`;
        else pending.push(text);
        prevBlank = false;
        continue;
      }
      const m = line.match(/^([a-zA-Z0-9]+):\s*(.*?)(?:,)?\s*(?:\/\/\s*(.*))?$/);
      if (m) {
        const [, key, , trailing] = m;
        const desc = [...(pending.isGroup ? [] : pending), trailing].filter(Boolean).join(' ');
        if (!(key in out)) out[key] = { group: group.replace(/\s*\(.*$/, '').replace(/\.$/, ''), comment: desc };
        pending = [];
      }
      prevBlank = false;
    }
  }
  return out;
}

// ---------------------------------------------------------------- panels.jsx
function parsePanels(src) {
  const out = {};
  let panel = '';
  let section = '';
  for (const line of src.split('\n')) {
    const fn = line.match(/^export function (\w+)Panel/);
    if (fn) { panel = fn[1]; continue; }
    const sec = line.match(/<Section title="([^"]+)"/);
    if (sec) section = sec[1];
    const ctl = line.match(/<(Slider|Toggle|ColorRow|SelectRow)\s+label="([^"]+)"\s+value=\{p\.(\w+)\}(.*)/);
    if (!ctl) continue;
    const [, kind, label, key, rest] = ctl;
    if (out[key]) continue;
    const num = (n) => { const m = rest.match(new RegExp(`${n}=\\{([-0-9.e]+)\\}`)); return m ? Number(m[1]) : undefined; };
    const title = rest.match(/title="([^"]+)"/)?.[1];
    out[key] = { kind, label, panel, section, min: num('min'), max: num('max'), step: num('step'), title };
  }
  return out;
}

const defs = parseDefaults(fs.readFileSync(presetsPath, 'utf8'));
const ui = parsePanels(fs.readFileSync(panelsPath, 'utf8'));

const domainOf = (k) => (k in STAR_DEFAULTS ? 'star' : k in GAS_DEFAULTS ? 'gas' : 'planet');
const typeOf = (v) => (Array.isArray(v) ? 'color' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const docs = {};
for (const [key, def] of Object.entries(DEFAULT_PARAMS)) {
  const d = defs[key] ?? {};
  const u = ui[key];
  const label = u ? (/^(Enabled|Toggle)$/i.test(u.label) ? `${u.section}` : u.label) : key;
  let description = EXTRA[key] || cap(d.comment) || (u?.title ? cap(u.title) : '') || label;
  if (!EXTRA[key] && d.comment && u?.title && !description.toLowerCase().includes(u.title.toLowerCase().slice(0, 12))) {
    description += ` — ${u.title}`;
  }
  const entry = {
    domain: domainOf(key),
    group: GROUP[key] ?? u?.section ?? cap(d.group) ?? '',
    label,
    type: typeOf(def),
    default: def,
    description,
  };
  if (u?.min !== undefined) entry.min = u.min;
  if (u?.max !== undefined) entry.max = u.max;
  if (u?.step !== undefined) entry.step = u.step;
  if (['octaves', 'chunkRes', 'maxDepth'].includes(key)) entry.structural = true;
  docs[key] = entry;
}

// ------------------------------------------------------------------ outputs
const header = '// GENERATED by scripts/gen-param-docs.mjs — do not edit by hand.\n';
const js = `${header}// Metadata for every Planet parameter: domain (planet | gas | star),
// studio group / label, type, default, slider range and description.
export const PARAM_DOCS = ${JSON.stringify(docs, null, 2)};
`;

const fmt = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(v));
const range = (e) => (e.min !== undefined ? `${e.min} – ${e.max}` : e.type === 'color' ? 'sRGB 0 – 1' : '');
const esc = (s) => String(s).replace(/\|/g, '\\|');
const TITLES = { planet: 'Terrestrial planets', gas: 'Gas giants', star: 'Stars' };
let md = `<!-- GENERATED by scripts/gen-param-docs.mjs from src/engine/presets.js + src/components/panels.jsx — do not edit by hand. -->
# Parameter reference

Every Planet is driven by one flat parameter object (the same keys the studio
edits). Pass them to the constructor (\`new Planet({ radius: 3000 })\`), change
them live with \`planet.set({...})\`, read them with \`planet.get(key)\`.

- **Colours** are sRGB albedos in 0–1: \`[r, g, b]\`, or \`'#rrggbb'\`, \`0xrrggbb\`, \`THREE.Color\`.
- **Ranges** are the studio slider ranges — a sensible envelope, not a hard limit.
- **Structural** keys rebuild the terrain LOD world (not a per-frame operation).
- The three domains are independent: a gas giant ignores the terrestrial keys and vice versa, so
  one parameter object can hold all three looks (\`mode\` picks the one rendered).

`;
for (const domain of ['planet', 'gas', 'star']) {
  md += `## ${TITLES[domain]}\n\n`;
  const groups = {};
  for (const [k, e] of Object.entries(docs)) {
    if (e.domain !== domain) continue;
    (groups[e.group || 'General'] ??= []).push([k, e]);
  }
  for (const [g, entries] of Object.entries(groups)) {
    md += `### ${g}\n\n| Key | Type | Default | Range | Description |\n|---|---|---|---|---|\n`;
    for (const [k, e] of entries) {
      md += `| \`${k}\` | ${e.type}${e.structural ? ' (structural)' : ''} | \`${esc(fmt(e.default))}\` | ${range(e)} | ${esc(e.description)} |\n`;
    }
    md += '\n';
  }
}

const tsType = (e, k) => (k === 'mode' ? "'planet' | 'gas' | 'star'" : e.type === 'color' ? 'ColorInput' : e.type);
let dts = `${header}
/** sRGB colour: [r, g, b] in 0..1, '#rrggbb', 0xrrggbb or a THREE.Color. */
export type ColorInput = [number, number, number] | string | number | import('three').Color;

/** Every Planet parameter (all optional when passed in; see docs/parameters.md). */
export interface PlanetParams {
`;
for (const [k, e] of Object.entries(docs)) {
  const r = e.min !== undefined ? ` Range ${e.min}..${e.max}.` : '';
  dts += `  /** ${e.description.replace(/\*\//g, '* /')}${r} Default: ${fmt(e.default)}. */\n  ${k}?: ${tsType(e, k)};\n`;
}
dts += `}

/** Parameter object as stored on a Planet (colours normalised to arrays). */
export type ResolvedPlanetParams = {
  [K in keyof PlanetParams]-?: PlanetParams[K] extends ColorInput | undefined
    ? (Exclude<PlanetParams[K], undefined> extends ColorInput ? [number, number, number] : Exclude<PlanetParams[K], undefined>)
    : Exclude<PlanetParams[K], undefined>;
};
`;

const outputs = {
  'src/lib/paramDocs.js': js,
  'docs/parameters.md': md,
  'types/params.d.ts': dts,
};
const check = process.argv.includes('--check');
let stale = false;
for (const [rel, content] of Object.entries(outputs)) {
  const file = path.join(root, rel);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (old === content) continue;
  if (check) { console.error(`stale: ${rel}`); stale = true; continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`wrote ${rel}`);
}
if (stale) process.exit(1);
