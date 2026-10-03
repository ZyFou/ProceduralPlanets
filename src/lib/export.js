// ============================================================================
// procedural-planets/export — download / serialise planets as files. A
// separate entry so the core package does not pull in fflate and the three
// exporters.
// ============================================================================
import { PlanetExporter, toGLB, downloadBlob } from '../engine/PlanetExporter.js';
import { bakePlanet } from '../engine/PlanetBaker.js';
import { zipSync } from 'fflate';
import { Planet } from '../engine/Planet.js';

function exportOptions(planet, options) {
  return {
    format: options.format ?? 'glb',
    meshRes: options.meshResolution ?? 128,
    texRes: options.textureSize ?? 1024,
    includeMesh: options.includeMesh !== false,
    bakeColor: options.bakeColor !== false,
    bakeLighting: !!options.bakeLighting,
    exportWater: !!options.water,
    exportPreset: options.preset !== false,
    starShaderBody: planet.starShaderBody,
    terrain: planet.terrain,
    terrainProgram: planet._terrainProgram,
  };
}

/**
 * Bake a Planet and package it like the studio's Export button:
 * { blob (ZIP), filename, files: { name: Uint8Array } }.
 * options: format ('glb' | 'obj'), meshResolution, textureSize, water,
 *          bakeLighting, includeMesh, bakeColor, preset (include the params
 *          JSON, default true), onProgress
 */
export async function createPlanetArchive(renderer, planet, options = {}) {
  const source = planet;
  planet = Planet.fromJSON(source.serialize(), { starShader: source.starShaderBody });
  planet.time = source.time;
  planet.cloudTime = source.cloudTime;
  try {
    planet._prepareFrame();
    planet._bakeFrame(renderer);
    const { files, filename } = await PlanetExporter.buildFiles(
      renderer, planet.params, planet.uniforms, exportOptions(planet, options), options.onProgress
    );
    const blob = new Blob([zipSync(files)], { type: 'application/zip' });
    return { blob, filename, files };
  } finally {
    planet.dispose();
  }
}

/** createPlanetArchive + trigger a browser download. */
export async function downloadPlanetArchive(renderer, planet, options = {}) {
  const archive = await createPlanetArchive(renderer, planet, options);
  downloadBlob(archive.blob, options.filename ?? archive.filename);
  return archive;
}

/**
 * Bake a Planet to a binary glTF (Uint8Array). options as bakePlanet
 * (meshResolution, textureSize, water, atmosphere: false by default here
 * since glTF viewers cannot run the fresnel shader, rings).
 */
export async function exportPlanetGLB(renderer, planet, options = {}) {
  const group = await bakePlanet(renderer, { atmosphere: false, starMaterial: 'standard', ...options, planet });
  try { return await toGLB(group); }
  finally { group.dispose(); }
}

export { toGLB, downloadBlob };
