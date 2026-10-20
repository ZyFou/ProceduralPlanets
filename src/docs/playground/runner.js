import { REVISION } from 'three';
import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';
import { VERSION } from '../../lib/index.js';

// ============================================================================
// The playground runs user code in an iframe with sandbox="allow-scripts"
// and no allow-same-origin: an opaque origin with no access to the studio's
// cookies, storage or DOM. Modules come from jsDelivr through an import map
// (the published package, the way the getting-started guide loads it), and
// console output / errors are posted back to the docs page.
// ============================================================================

const CDN = 'https://cdn.jsdelivr.net/npm';
export const PACKAGE_URL = `${CDN}/procedural-planets@${VERSION}`;
const THREE_URL = `${CDN}/three@0.${REVISION}`;

export const IMPORT_MAP = {
  imports: {
    three: `${THREE_URL}/build/three.module.js`,
    'three/': `${THREE_URL}/`,
    'three/addons/': `${THREE_URL}/examples/jsm/`,
    fflate: `${CDN}/fflate@0.8.3/esm/browser.js`,
    'procedural-planets': `${PACKAGE_URL}/dist/lib/procedural-planets.js`,
    'procedural-planets/export': `${PACKAGE_URL}/dist/lib/export.js`,
  },
};

// runs before the user module: forwards console calls and errors
const bridge = (token) => `
(() => {
  const send = (type, args) => parent.postMessage({ __playground: ${JSON.stringify(token)}, type, args }, '*');
  const describe = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || String(value);
    if (value && typeof value === 'object') {
      try {
        const seen = new WeakSet();
        const text = JSON.stringify(value, (key, item) => {
          if (item && typeof item === 'object') {
            if (item.isObject3D || item.isMaterial || item.isBufferGeometry) return '[' + (item.type || item.constructor.name) + ']';
            if (seen.has(item)) return '[circular]';
            seen.add(item);
          }
          return typeof item === 'function' ? '[function]' : item;
        });
        return text && text.length > 2000 ? text.slice(0, 2000) + '…' : text;
      } catch { return '[' + (value.constructor?.name || 'object') + ']'; }
    }
    return String(value);
  };
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { send(level, args.map(describe)); original(...args); };
  }
  window.__playgroundSend = send;
  window.__playgroundOffset = __OFFSET__;
  addEventListener('error', (event) => {
    const line = event.lineno ? event.lineno - window.__playgroundOffset : 0;
    send('error', [(event.message || 'Error') + (line > 0 ? ' (line ' + line + ')' : '')]);
  });
  addEventListener('unhandledrejection', (event) => send('error', [describe(event.reason)]));
})();`;

/** The full HTML document for one run of `code`. */
export function buildDocument(code, token) {
  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; color: #c9d1dc; font: 13px system-ui, sans-serif; }
  #app { position: fixed; inset: 0; }
  #app > canvas { display: block; }
</style>
<script type="importmap">${JSON.stringify(IMPORT_MAP)}</script>
<script>${bridge(token)}</script>
</head>
<body>
<div id="app"></div>
<script type="module" onerror="__playgroundSend('error', ['A module failed to load. Check the import names and your network connection.'])">
`;
  const offset = head.split('\n').length - 1;
  const safe = code.replace(/<\/script/gi, '<\\/script');
  return `${head.replace('__OFFSET__', String(offset))}${safe}
window.__playgroundSend('ready', []);
</script>
</body>
</html>`;
}

/** A standalone page for `code`: the same import map, no playground bridge. */
export function buildStandalone(code) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>procedural-planets</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  #app { position: fixed; inset: 0; }
</style>
<script type="importmap">
${JSON.stringify(IMPORT_MAP, null, 2)}
</script>
</head>
<body>
<div id="app"></div>
<script type="module">
${code.replace(/<\/script/gi, '<\\/script')}
</script>
</body>
</html>
`;
}

// ---- share links: zlib + base64url in the docs hash ------------------------

export function encodeCode(code) {
  const bytes = zlibSync(strToU8(code), { level: 9 });
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCode(text) {
  try {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return strFromU8(unzlibSync(bytes));
  } catch {
    return null;
  }
}

/** The docs route that opens the playground with `code`. */
export function playgroundHref(code) {
  return `#/docs/playground?code=${encodeCode(code)}`;
}

/** The `code` carried by the current hash, if any. */
export function codeFromHash(hash = window.location.hash) {
  const query = hash.split('?')[1];
  if (!query) return null;
  const value = new URLSearchParams(query).get('code');
  return value ? decodeCode(value) : null;
}
