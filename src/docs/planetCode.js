// Formatting helpers shared by the interactive docs pages: parameter values
// as they would be written in code, and Planet constructor snippets.

const round = (value) => Math.round(value * 1e4) / 1e4;

/** [r, g, b] in 0..1 (sRGB) → '#rrggbb'. Strings pass through. */
export function toHex(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '#000000';
  return `#${value.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** A parameter value as a JS literal. */
export function formatValue(value, type) {
  if (type === 'color') return `'${toHex(value)}'`;
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'number') return String(round(value));
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/** `{ key: value, … }` on one line when short, one key per line otherwise. */
export function formatObject(entries, indent = '') {
  if (!entries.length) return '{}';
  const parts = entries.map(([key, value]) => `${key}: ${value}`);
  const inline = `{ ${parts.join(', ')} }`;
  if (inline.length + indent.length <= 72) return inline;
  return `{\n${parts.map((part) => `${indent}  ${part},`).join('\n')}\n${indent}}`;
}

/** `const planet = new Planet({ … });` for constructor options. */
export function planetSnippet(entries, { variable = 'planet', imports = true } = {}) {
  const head = imports ? "import { Planet } from 'procedural-planets';\n\n" : '';
  return `${head}const ${variable} = new Planet(${formatObject(entries)});`;
}
