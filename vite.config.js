import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Studio app (index.html) + the package examples (examples/*.html). The
// examples import 'procedural-planets' exactly like a consumer would; the
// alias points it at the library source. The library itself is built by
// vite.lib.config.js.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^procedural-planets\/export$/, replacement: resolve(__dirname, 'src/lib/export.js') },
      { find: /^procedural-planets$/, replacement: resolve(__dirname, 'src/lib/index.js') },
    ],
  },
  server: {
    port: 6061,
    strictPort: false,
  },
  build: {
    outDir: 'dist/studio',
  },
});
