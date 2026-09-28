import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { zipSync } from 'fflate';
import { DEFAULT_STAR_BODY } from './star.js';
import { bakeGroup, disposeBaked } from './PlanetBaker.js';

// ============================================================================
// PlanetExporter — packages a baked planet (PlanetBaker) as GLB or OBJ +
// PNG textures, plus the parameter preset, into a ZIP.
// ============================================================================

function canvasToPng(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Binary glTF of an object (Uint8Array, or null on failure). */
export function toGLB(object) {
  return new Promise((resolve) => {
    new GLTFExporter().parse(
      object,
      (result) => resolve(new Uint8Array(result)),
      (err) => {
        console.error(err);
        resolve(null);
      },
      { binary: true }
    );
  });
}

const NAMES = {
  planet: { model: 'planet', preset: 'planet_preset.json', zip: 'planet_export' },
  gas: { model: 'planet', preset: 'planet_preset.json', zip: 'gas_planet_export' },
  star: { model: 'star', preset: 'star_preset.json', zip: 'star_export' },
};

export class PlanetExporter {
  /**
   * Bake + package. Returns { files: { name: Uint8Array }, filename } where
   * filename is the suggested ZIP name. options: format ('glb' | 'obj'),
   * meshRes, texRes, includeMesh, bakeColor, bakeLighting, exportWater,
   * exportPreset, starShaderBody.
   */
  static async buildFiles(renderer, params, uniforms, options = {}, onProgress = () => {}) {
    const mode = params.mode === 'star' || params.mode === 'gas' ? params.mode : 'planet';
    const names = NAMES[mode];
    const format = options.format === 'obj' ? 'obj' : 'glb';
    const includeMesh = options.includeMesh !== false;
    const exportPreset = options.exportPreset !== false;
    const files = {};

    const group = await bakeGroup(renderer, params, uniforms, options, onProgress);

    onProgress(`Packaging ${format.toUpperCase()}`);
    if (includeMesh) {
      if (format === 'glb') {
        const model = await toGLB(group);
        if (model) files[`${names.model}.glb`] = model;
      } else {
        files[`${names.model}.obj`] = new TextEncoder().encode(new OBJExporter().parse(group));
        for (const child of group.children) {
          if (child.material?.map?._exportCanvas) {
            files[`textures/${child.name}.png`] = await canvasToPng(child.material.map._exportCanvas);
          }
        }
      }
    }

    if (exportPreset) {
      const preset = { app: 'procedural-planets', mode, version: 1, params };
      if (mode === 'star') preset.starShader = options.starShaderBody || DEFAULT_STAR_BODY;
      files[names.preset] = new TextEncoder().encode(JSON.stringify(preset, null, 2));
    }

    disposeBaked(group);
    return { files, filename: `${names.zip}-${params.seed}.zip` };
  }

  /** Bake, package and download the ZIP (the studio's Export button). */
  static async export(renderer, params, uniforms, options = {}, onProgress = () => {}) {
    const { files, filename } = await PlanetExporter.buildFiles(renderer, params, uniforms, options, onProgress);
    if (Object.keys(files).length === 0) return;
    onProgress('Compressing ZIP');
    const zipped = zipSync(files);
    downloadBlob(new Blob([zipped], { type: 'application/zip' }), filename);
  }
}
