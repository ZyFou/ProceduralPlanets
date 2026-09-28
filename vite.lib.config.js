import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Library build: ESM, three.js (and fflate) left external so the consumer's
// single copy is used. Two entries share one chunk of engine code:
//   dist/lib/procedural-planets.js   Planet, PlanetRenderer, PlanetViewer, bakePlanet, PlanetPass
//   dist/lib/export.js               ZIP / GLB export helpers (pulls in fflate)
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2020',
    lib: {
      entry: {
        'procedural-planets': resolve(__dirname, 'src/lib/index.js'),
        export: resolve(__dirname, 'src/lib/export.js'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^three($|\/)/, 'fflate'],
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
