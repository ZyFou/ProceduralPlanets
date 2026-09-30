import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Studio app (index.html) + the package examples (examples/*.html). The
// examples import 'procedural-planets' exactly like a consumer would; the
// alias points it at the library source. The library itself is built by
// vite.lib.config.js.
//
// The studio talks to the account API (api/, port 7070) on the same origin:
// /api is proxied in dev and preview, so session cookies stay first-party.
const apiProxy = {
  '/api': {
    target: 'http://localhost:7070',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^procedural-planets\/export$/, replacement: resolve(__dirname, 'src/lib/export.js') },
      { find: /^procedural-planets$/, replacement: resolve(__dirname, 'src/lib/index.js') },
    ],
  },
  server: {
    port: 7071,
    strictPort: false,
    proxy: apiProxy,
  },
  preview: {
    port: 7071,
    proxy: apiProxy,
  },
  test: {
    // the API has its own node:test suite (npm run test:api)
    exclude: ['node_modules/**', 'dist/**', 'api/**'],
  },
  build: {
    outDir: 'dist/studio',
  },
});
