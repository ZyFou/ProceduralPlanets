import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { zipSync } from 'fflate';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL, SURFACE_GLSL } from './surfaceGLSL.js';
import { PlanetHeightSampler } from './PlanetHeightSampler.js';
import { STAR_OCTAVES, DEFAULT_STAR_BODY, buildStarBakeFragment } from './star.js';

const FACES = [
  { name: 'pos_z', origin: [-1, -1, 1], u: [2, 0, 0], v: [0, 2, 0] },
  { name: 'neg_z', origin: [1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] },
  { name: 'pos_x', origin: [1, -1, 1], u: [0, 0, -2], v: [0, 2, 0] },
  { name: 'neg_x', origin: [-1, -1, -1], u: [0, 0, 2], v: [0, 2, 0] },
  { name: 'pos_y', origin: [-1, 1, 1], u: [2, 0, 0], v: [0, 0, -2] },
  { name: 'neg_y', origin: [-1, -1, -1], u: [2, 0, 0], v: [0, 0, 2] },
];

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Same shared surface GLSL as the live terrain material, so the baked texture
// (biomes included) always matches the viewport.
const BAKE_FRAGMENT = /* glsl */ `
precision highp float;

${NOISE_UNIFORMS_GLSL}
${NOISE_FUNCTIONS_GLSL}
${TOON_GLSL}
${SURFACE_GLSL}

uniform vec3 uFaceOrigin;
uniform vec3 uFaceU;
uniform vec3 uFaceV;
uniform bool uBakeLighting;

varying vec2 vUv;

void main() {
  vec3 cube = uFaceOrigin + vUv.x * uFaceU + vUv.y * uFaceV;
  vec3 dir = normalize(cube);

  float h, slope;
  vec3 n = terrainNormal(dir, h, slope);
  vec3 col = surfaceColor(dir, h, slope);

  if (uBakeLighting) {
    float diff = toonShade(max(dot(n, uSunDir), 0.0));
    col *= uAmbient + diff * uSunIntensity;
  }

  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

function canvasToPng(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  });
}

function renderTargetToCanvas(renderer, rt, w, h = w) {
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    img.data.set(px.subarray(src, src + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function cloneUniforms(uniforms, options) {
  const out = {
    uFaceOrigin: { value: new THREE.Vector3() },
    uFaceU: { value: new THREE.Vector3() },
    uFaceV: { value: new THREE.Vector3() },
    uBakeLighting: { value: !!options.bakeLighting },
  };
  for (const [key, uniform] of Object.entries(uniforms)) {
    const value = uniform.value;
    out[key] = { value: value && typeof value.clone === 'function' ? value.clone() : value };
  }
  return out;
}

export class PlanetExporter {
  static async export(renderer, params, uniforms, options = {}, onProgress = () => {}) {
    if (params.mode === 'star') {
      return PlanetExporter.exportStar(renderer, params, uniforms, options, onProgress);
    }
    const format = options.format === 'obj' ? 'obj' : 'glb';
    const meshRes = Math.max(8, Math.min(1024, parseInt(options.meshRes, 10) || 128));
    const texRes = Math.max(64, Math.min(4096, parseInt(options.texRes, 10) || 1024));
    const includeMesh = options.includeMesh !== false;
    const bakeColor = options.bakeColor !== false;
    const exportWater = !!options.exportWater;
    const exportPreset = options.exportPreset !== false;

    const sampler = new PlanetHeightSampler(params, uniforms);
    const group = new THREE.Group();
    group.name = 'Planet';

    const quadScene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bakeUniforms = cloneUniforms(uniforms, options);
    const bakeMaterial = new THREE.ShaderMaterial({
      defines: { OCTAVES: Math.round(params.octaves) },
      uniforms: bakeUniforms,
      vertexShader: BAKE_VERTEX,
      fragmentShader: BAKE_FRAGMENT,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial);
    quadScene.add(quad);

    const zipFiles = {};
    const tmp = new THREE.Vector3();
    const vps = meshRes + 1;

    if (includeMesh) {
      for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
        const face = FACES[faceIndex];
        onProgress(`Building face ${faceIndex + 1}/6`);
        const origin = new THREE.Vector3(...face.origin);
        const u = new THREE.Vector3(...face.u);
        const v = new THREE.Vector3(...face.v);

        const positions = new Float32Array(vps * vps * 3);
        const uvs = new Float32Array(vps * vps * 2);
        const indices = new Uint32Array(meshRes * meshRes * 6);
        let p = 0;
        let t = 0;
        for (let y = 0; y < vps; y++) {
          for (let x = 0; x < vps; x++) {
            const fu = x / meshRes;
            const fv = y / meshRes;
            tmp.copy(origin).addScaledVector(u, fu).addScaledVector(v, fv).normalize();
            const r = params.radius + sampler.heightAtDirection(tmp);
            positions[p++] = tmp.x * r;
            positions[p++] = tmp.y * r;
            positions[p++] = tmp.z * r;
            uvs[t++] = fu;
            uvs[t++] = fv;
          }
        }
        let q = 0;
        for (let y = 0; y < meshRes; y++) {
          for (let x = 0; x < meshRes; x++) {
            const a = y * vps + x;
            const b = a + 1;
            const c = a + vps;
            const d = c + 1;
            indices[q++] = a; indices[q++] = b; indices[q++] = c;
            indices[q++] = b; indices[q++] = d; indices[q++] = c;
          }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();

        let map = null;
        if (bakeColor) {
          onProgress(`Baking texture ${faceIndex + 1}/6`);
          bakeUniforms.uFaceOrigin.value.copy(origin);
          bakeUniforms.uFaceU.value.copy(u);
          bakeUniforms.uFaceV.value.copy(v);
          const rt = new THREE.WebGLRenderTarget(texRes, texRes);
          renderer.setRenderTarget(rt);
          renderer.render(quadScene, quadCamera);
          renderer.setRenderTarget(null);
          const canvas = renderTargetToCanvas(renderer, rt, texRes);
          rt.dispose();
          map = new THREE.CanvasTexture(canvas);
          map.colorSpace = THREE.SRGBColorSpace;
          map._exportCanvas = canvas;
        }

        const material = new THREE.MeshStandardMaterial({
          name: `Planet_${face.name}`,
          color: map ? 0xffffff : 0x8a9a6a,
          map,
          roughness: 0.9,
          metalness: 0.03,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `Planet_${face.name}`;
        group.add(mesh);
      }
    }

    if (exportWater && params.waterEnabled && params.seaLevel > 0) {
      onProgress('Adding ocean shell');
      const waterRadius = params.radius + params.seaLevel * params.heightScale;
      const water = new THREE.Mesh(
        new THREE.SphereGeometry(waterRadius, 128, 96),
        new THREE.MeshStandardMaterial({
          name: 'Planet_Ocean',
          color: new THREE.Color(...params.colShallow),
          roughness: 0.15,
          metalness: 0.25,
          transparent: true,
          opacity: Math.min(Math.max(params.waterOpacity, 0.05), 0.95),
        })
      );
      water.name = 'Planet_Ocean';
      group.add(water);
    }

    onProgress(`Packaging ${format.toUpperCase()}`);
    if (includeMesh) {
      if (format === 'glb') {
        const model = await new Promise((resolve) => {
          new GLTFExporter().parse(
            group,
            (result) => resolve(new Uint8Array(result)),
            (err) => {
              console.error(err);
              resolve(null);
            },
            { binary: true }
          );
        });
        if (model) zipFiles['planet.glb'] = model;
      } else {
        const objText = new OBJExporter().parse(group);
        zipFiles['planet.obj'] = new TextEncoder().encode(objText);
        for (const child of group.children) {
          if (child.material?.map?._exportCanvas) {
            zipFiles[`textures/${child.name}.png`] = await canvasToPng(child.material.map._exportCanvas);
          }
        }
      }
    }

    if (exportPreset) {
      zipFiles['planet_preset.json'] = new TextEncoder().encode(
        JSON.stringify({ app: 'procedural-planets', mode: 'planet', version: 1, params }, null, 2)
      );
    }

    bakeMaterial.dispose();
    quad.geometry.dispose();
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry.dispose();
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    });

    if (Object.keys(zipFiles).length === 0) return;
    onProgress('Compressing ZIP');
    const zipped = zipSync(zipFiles);
    downloadBlob(new Blob([zipped], { type: 'application/zip' }), `planet_export-${params.seed}.zip`);
  }

  // -------------------------------------------------------------------- star
  // Star export: one UV sphere + an equirect emissive texture baked from the
  // SAME starSurface() GLSL as the viewport (custom shader included via
  // options.starShaderBody). The texture goes into both map and emissiveMap so
  // the star reads self-lit in any glTF viewer.
  static async exportStar(renderer, params, uniforms, options = {}, onProgress = () => {}) {
    const format = options.format === 'obj' ? 'obj' : 'glb';
    const meshRes = Math.max(16, Math.min(1024, parseInt(options.meshRes, 10) || 128));
    const texRes = Math.max(128, Math.min(4096, parseInt(options.texRes, 10) || 1024));
    const includeMesh = options.includeMesh !== false;
    const bakeColor = options.bakeColor !== false;
    const exportPreset = options.exportPreset !== false;
    const starBody = options.starShaderBody || DEFAULT_STAR_BODY;

    const group = new THREE.Group();
    group.name = 'Star';
    const zipFiles = {};

    let map = null;
    if (includeMesh && bakeColor) {
      onProgress('Baking star texture');
      const quadScene = new THREE.Scene();
      const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const bakeUniforms = cloneUniforms(uniforms, options);
      const bakeMaterial = new THREE.ShaderMaterial({
        defines: { OCTAVES: STAR_OCTAVES },
        uniforms: bakeUniforms,
        vertexShader: BAKE_VERTEX,
        fragmentShader: buildStarBakeFragment(starBody),
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial);
      quadScene.add(quad);

      const texW = texRes;
      const texH = Math.max(64, texRes / 2);   // equirect is 2:1
      const rt = new THREE.WebGLRenderTarget(texW, texH);
      renderer.setRenderTarget(rt);
      renderer.render(quadScene, quadCamera);
      renderer.setRenderTarget(null);
      const canvas = renderTargetToCanvas(renderer, rt, texW, texH);
      rt.dispose();
      bakeMaterial.dispose();
      quad.geometry.dispose();

      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map._exportCanvas = canvas;
    }

    if (includeMesh) {
      onProgress('Building star mesh');
      const geometry = new THREE.SphereGeometry(
        params.radius, meshRes, Math.max(8, Math.round(meshRes / 2))
      );
      const tint = new THREE.Color(...params.starColorMid);
      const material = new THREE.MeshStandardMaterial({
        name: 'Star_Surface',
        color: map ? 0xffffff : tint,
        map,
        emissive: map ? new THREE.Color(0xffffff) : tint,
        emissiveMap: map,
        roughness: 1.0,
        metalness: 0.0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'Star_Surface';
      group.add(mesh);
    }

    onProgress(`Packaging ${format.toUpperCase()}`);
    if (includeMesh) {
      if (format === 'glb') {
        const model = await new Promise((resolve) => {
          new GLTFExporter().parse(
            group,
            (result) => resolve(new Uint8Array(result)),
            (err) => {
              console.error(err);
              resolve(null);
            },
            { binary: true }
          );
        });
        if (model) zipFiles['star.glb'] = model;
      } else {
        const objText = new OBJExporter().parse(group);
        zipFiles['star.obj'] = new TextEncoder().encode(objText);
        for (const child of group.children) {
          if (child.material?.map?._exportCanvas) {
            zipFiles[`textures/${child.name}.png`] = await canvasToPng(child.material.map._exportCanvas);
          }
        }
      }
    }

    if (exportPreset) {
      zipFiles['star_preset.json'] = new TextEncoder().encode(
        JSON.stringify(
          { app: 'procedural-planets', mode: 'star', version: 1, params, starShader: starBody },
          null, 2
        )
      );
    }

    group.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry.dispose();
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    });

    if (Object.keys(zipFiles).length === 0) return;
    onProgress('Compressing ZIP');
    const zipped = zipSync(zipFiles);
    downloadBlob(new Blob([zipped], { type: 'application/zip' }), `star_export-${params.seed}.zip`);
  }
}
