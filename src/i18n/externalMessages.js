import { getLocale, translate } from './locale.js';

// Engine and API messages remain portable English data. Translate at the UI boundary.
const patterns = [
  'a finite integer in [{0}, {1}]', 'a finite number in [{0}, {1}]',
  'Packaging {0}', 'Building face {0}/6', 'Baking texture {0}/6',
  'Unknown height node type: {0}', 'Unknown height graph recipe: {0}',
  'Unsupported height graph format: {0}.', 'Unsupported height graph version: {0}.',
  'Height graph exceeds the {0} node / {1} connection budget.',
  'Duplicate node ID: {0}.', 'Unsupported node type: {0}.',
  'Unsupported parameter {0} on {1}; its imported value has been preserved.',
  'Parameter {0} must be finite.', '{0} is invalid; expected {1}.',
  'Input {0} has more than one connection.', 'Connect the {0} input.',
  'Height graph cost {0} exceeds the {1} shader work-unit budget.',
  'Height graph exceeds the {0} byte shader budget.',
].map(key => {
  const slots = [];
  const parts = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(part.slice(1, -1)); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { key, slots, regex: new RegExp(`^${parts.join('')}$`) };
});

export function translateExternalMessage(message) {
  if (typeof message !== 'string' || getLocale() === 'en') return message;
  const direct = translate(message);
  if (direct !== message) return direct;
  for (const { key, slots, regex } of patterns) {
    const match = message.match(regex);
    if (match) return translate(key, Object.fromEntries(slots.map((slot, index) => [slot, translateExternalMessage(match[index + 1])])));
  }
  return message;
}
