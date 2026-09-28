// Start a Vite dev server for one checkout with its own dependency cache:
//   node vite-serve.mjs <root> <port> <cacheDir>
// (A/B checkouts share node_modules; a shared .vite cache would mix their
// pre-bundled dependencies.)
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, port, cacheDir] = process.argv.slice(2);
const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.js'),
  cacheDir,
  clearScreen: false,
  server: { port: Number(port), strictPort: true, host: '127.0.0.1' },
});
await server.listen();
console.log(`ready ${server.resolvedUrls?.local?.[0] ?? port}`);
