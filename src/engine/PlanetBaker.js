import * as THREE from 'three';
import { NOISE_UNIFORMS_GLSL, NOISE_FUNCTIONS_GLSL } from './noiseGLSL.js';
import { TOON_GLSL, ATMOSPHERE_GLSL, SURFACE_GLSL } from './surfaceGLSL.js';
import { PlanetHeightSampler } from './PlanetHeightSampler.js';
import { STAR_OCTAVES, DEFAULT_STAR_BODY, buildStarBakeFragment } from './star.js';
import { GAS_OCTAVES, buildGasBakeFragment, buildRingBakeFragment } from './gas.js';
import { Planet } from './Planet.js';

// ============================================================================
// PlanetBaker — turns a planet into plain three.js meshes with baked
// textures (MeshStandardMaterial, lit by the host scene's own lights). No
// custom pipeline at draw time: cheap, static, works in any scene / renderer
// setup and exports to glTF. The colour textures come from the SAME GLSL as
// the live render; the terrain relief from the CPU height mirror.
//
//   terrestrial  6 displaced cube-sphere faces (+ optional ocean shell)
//   gas          UV sphere + equirect band texture (+ rings)
//   star         UV sphere + equirect emissive texture
//   (+ optional fresnel atmosphere shell)
// ============================================================================

export const FACES = [
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
${ATMOSPHERE_GLSL}
${SURFACE_GLSL}

uniform vec3 uFaceOrigin;
uniform vec3 uFaceU;
uniform vec3 uFaceV;
uniform bool uBakeLighting;

varying vec2 vUv;

void main() {
  vec3 cube = uFaceOrigin + vUv.x * uFaceU + vUv.y * uFaceV;
  vec3 dir = normalize(cube);

  vec3 grad;
  float cLow, mtn;
  float h = heightField(dir, grad, cLow, mtn);
  float r = uRadius + h * uHeightScale;
  vec3 n = normalize(dir - (grad - dir * dot(grad, dir)) * (uHeightScale / r));
  float slope = 1.0 - clamp(dot(n, dir), 0.0, 1.0);
  // texel footprint in world units: detail finer than a texel filters out
  vec3 wp = dir * r;
  float fp = max(length(dFdx(wp)), length(dFdy(wp)));
  vec3 dSlope;
  float det = surfaceDetail(wp, fp, dSlope);
  float rock, snow;
  vec3 col = surfaceAlbedo(dir, h, slope, cLow, mtn, det, rock, snow);

  if (uBakeLighting) {
    float diff = toonShade(max(dot(n, uSunDir), 0.0));
    col *= uAmbient + diff * uSunIntensity;
  }

  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

// simple view-dependent rim for the baked tier (additive, unlit)
const ATMO_SHELL_VERTEX = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
// glow by impact parameter b (in body radii): peaks at the body's limb
// (b = 1), fades to 0 at the shell's edge (b = uShell), hugs the limb over
// the disc
const ATMO_SHELL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uShell;      // shell radius / body radius
uniform float uAdditive;   // 1 = pure glow (adds light, hides nothing)
varying vec3 vN;
varying vec3 vV;
void main() {
  float x = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float b = sqrt(max(1.0 - x * x, 0.0)) * uShell;
  float a = b >= 1.0
    ? pow(clamp(1.0 - (b - 1.0) / max(uShell - 1.0, 1e-3), 0.0, 1.0), 2.5)
    : pow(b, 8.0);
  a *= uStrength;
  // encode the colour first, then premultiply: the sRGB curve would lift
  // the faint (premultiplied) fringe into a visible band
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - uAdditive));
}
`;

export function renderTargetToCanvas(renderer, rt, w, h = w) {
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

function cloneUniforms(uniforms, options) {
  const out = {
    uFaceOrigin: { value: new THREE.Vector3() },
    uFaceU: { value: new THREE.Vector3() },
    uFaceV: { value: new THREE.Vector3() },
    uBakeLighting: { value: !!options.bakeLighting },
  };
  for (const [key, uniform] of Object.entries(uniforms)) {
    const value = uniform.value;
    // baked textures (LUT / weather / noise volume) are shared, never cloned
    const clonable = value && typeof value.clone === 'function' && !value.isTexture;
    out[key] = { value: clonable ? value.clone() : value };
  }
  return out;
}

// render one fullscreen bake into a w x h canvas texture (sRGB)
function bakeTexture(renderer, material, w, h) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const rt = new THREE.WebGLRenderTarget(w, h);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prev);
  const canvas = renderTargetToCanvas(renderer, rt, w, h);
  rt.dispose();
  quad.geometry.dispose();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  map._exportCanvas = canvas;
  return map;
}

const clampInt = (v, lo, hi, def) => Math.max(lo, Math.min(hi, parseInt(v, 10) || def));

/**
 * Build the baked meshes for a parameter set. options:
 *   meshRes (128), texRes (1024), includeMesh (true), bakeColor (true),
 *   bakeLighting (false), exportWater (false), rings (false), atmosphere
 *   (false), starMaterial ('standard' | 'basic'), starShaderBody
 * Returns a THREE.Group (name 'Planet' | 'GasPlanet' | 'Star').
 */
export async function bakeGroup(renderer, params, uniforms, options = {}, onProgress = () => {}) {
  if (params.mode === 'star') return bakeStar(renderer, params, uniforms, options, onProgress);
  if (params.mode === 'gas') return bakeGas(renderer, params, uniforms, options, onProgress);
  return bakeTerrain(renderer, params, uniforms, options, onProgress);
}

function bakeTerrain(renderer, params, uniforms, options, onProgress) {
  const meshRes = clampInt(options.meshRes, 8, 1024, 128);
  const texRes = clampInt(options.texRes, 64, 4096, 1024);
  const includeMesh = options.includeMesh !== false;
  const bakeColor = options.bakeColor !== false;

  const sampler = new PlanetHeightSampler(params, uniforms);
  const group = new THREE.Group();
  group.name = 'Planet';

  const bakeUniforms = cloneUniforms(uniforms, options);
  const bakeMaterial = new THREE.ShaderMaterial({
    defines: { OCTAVES: Math.round(params.octaves) },
    uniforms: bakeUniforms,
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
  });

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
        map = bakeTexture(renderer, bakeMaterial, texRes, texRes);
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
  bakeMaterial.dispose();

  if (options.exportWater && params.waterEnabled && params.seaLevel > 0) {
    onProgress('Adding ocean shell');
    const waterRadius = params.radius + params.seaLevel * params.heightScale;
    const water = new THREE.Mesh(
      new THREE.SphereGeometry(waterRadius, 128, 96),
      new THREE.MeshStandardMaterial({
        name: 'Planet_Ocean',
        color: new THREE.Color().setRGB(...params.colShallow, THREE.SRGBColorSpace),
        roughness: 0.15,
        metalness: 0.25,
        transparent: true,
        opacity: Math.min(Math.max(params.waterOpacity, 0.05), 0.95),
      })
    );
    water.name = 'Planet_Ocean';
    group.add(water);
  }

  if (options.atmosphere && params.atmoEnabled && params.atmoStrength > 0) {
    group.add(atmosphereShell(params.radius + params.heightScale * params.seaLevel, params.radius * (1 + params.atmoHeight),
      params.atmoColor, Math.min(1.2, 0.9 * params.atmoStrength)));
  }
  return group;
}

// fresnel rim shell of `radius` around a body of `bodyRadius`
function atmosphereShell(bodyRadius, radius, color, strength, additive = 0) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    new THREE.ShaderMaterial({
      name: 'Planet_Atmosphere',
      uniforms: {
        uColor: { value: new THREE.Color().setRGB(...color, THREE.SRGBColorSpace) },
        uStrength: { value: strength },
        uShell: { value: radius / bodyRadius },
        uAdditive: { value: additive },
      },
      vertexShader: ATMO_SHELL_VERTEX,
      fragmentShader: ATMO_SHELL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
  );
  mesh.name = 'Planet_Atmosphere';
  return mesh;
}

// Gas giant: one smooth UV sphere + an equirect texture baked from the SAME
// gasAlbedo() GLSL as the viewport. Unlike the star it is not emissive —
// bakeLighting optionally folds a Lambert sun into the colour map.
function bakeGas(renderer, params, uniforms, options, onProgress) {
  const meshRes = clampInt(options.meshRes, 16, 1024, 128);
  const texRes = clampInt(options.texRes, 128, 4096, 1024);
  const includeMesh = options.includeMesh !== false;
  const bakeColor = options.bakeColor !== false;

  const group = new THREE.Group();
  group.name = 'GasPlanet';

  let map = null;
  if (includeMesh && bakeColor) {
    onProgress('Baking gas texture');
    const bakeMaterial = new THREE.ShaderMaterial({
      defines: { OCTAVES: GAS_OCTAVES },
      uniforms: cloneUniforms(uniforms, options),
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildGasBakeFragment(),
    });
    map = bakeTexture(renderer, bakeMaterial, texRes, Math.max(64, texRes / 2));   // equirect is 2:1
    bakeMaterial.dispose();
  }

  if (includeMesh) {
    onProgress('Building gas planet mesh');
    const geometry = new THREE.SphereGeometry(
      params.radius, meshRes, Math.max(8, Math.round(meshRes / 2))
    );
    const material = new THREE.MeshStandardMaterial({
      name: 'GasPlanet_Surface',
      color: map ? 0xffffff : new THREE.Color().setRGB(...params.gasColorZone, THREE.SRGBColorSpace),
      map,
      roughness: 0.85,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GasPlanet_Surface';
    group.add(mesh);
  }

  if (options.rings && params.gasRingsEnabled) {
    onProgress('Baking rings');
    const W = 1024;
    const ringMat = new THREE.ShaderMaterial({
      defines: { OCTAVES: GAS_OCTAVES },
      uniforms: cloneUniforms(uniforms, options),
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildRingBakeFragment(W),
    });
    const ringMap = bakeTexture(renderer, ringMat, W, 1);
    ringMat.dispose();
    const inner = params.radius * params.gasRingInner;
    const outer = params.radius * params.gasRingOuter;
    const geometry = new THREE.RingGeometry(inner, outer, 256, 1);
    // radial UVs: u = inner -> outer
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - inner) / Math.max(outer - inner, 1e-6), 0.5);
    }
    geometry.rotateX(-Math.PI / 2);   // ring plane = the equator (XZ)
    const ring = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      name: 'GasPlanet_Rings',
      map: ringMap,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 1.0,
      metalness: 0.0,
    }));
    ring.name = 'GasPlanet_Rings';
    ring.renderOrder = 1;
    group.add(ring);
  }

  if (options.atmosphere && params.gasAtmoStrength > 0) {
    group.add(atmosphereShell(params.radius, params.radius * 1.025, params.gasAtmoColor, Math.min(1, 1.5 * params.gasAtmoStrength)));
  }
  return group;
}

// Star: one UV sphere + an equirect emissive texture baked from the SAME
// starSurface() GLSL as the viewport (custom shader included via
// options.starShaderBody). 'standard': texture in map AND emissiveMap (reads
// self-lit in any glTF viewer); 'basic': unlit MeshBasicMaterial.
function bakeStar(renderer, params, uniforms, options, onProgress) {
  const meshRes = clampInt(options.meshRes, 16, 1024, 128);
  const texRes = clampInt(options.texRes, 128, 4096, 1024);
  const includeMesh = options.includeMesh !== false;
  const bakeColor = options.bakeColor !== false;
  const starBody = options.starShaderBody || DEFAULT_STAR_BODY;

  const group = new THREE.Group();
  group.name = 'Star';

  let map = null;
  if (includeMesh && bakeColor) {
    onProgress('Baking star texture');
    const bakeMaterial = new THREE.ShaderMaterial({
      defines: { OCTAVES: STAR_OCTAVES },
      uniforms: cloneUniforms(uniforms, options),
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildStarBakeFragment(starBody),
    });
    map = bakeTexture(renderer, bakeMaterial, texRes, Math.max(64, texRes / 2));
    bakeMaterial.dispose();
  }

  if (includeMesh) {
    onProgress('Building star mesh');
    const geometry = new THREE.SphereGeometry(
      params.radius, meshRes, Math.max(8, Math.round(meshRes / 2))
    );
    const tint = new THREE.Color().setRGB(...params.starTint, THREE.SRGBColorSpace);
    const material = options.starMaterial === 'basic'
      ? new THREE.MeshBasicMaterial({ name: 'Star_Surface', color: map ? 0xffffff : tint, map })
      : new THREE.MeshStandardMaterial({
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

  if (options.atmosphere && params.starCoronaEnabled) {
    group.add(atmosphereShell(params.radius, params.radius * (1.05 + 0.25 * params.starCoronaSize),
      params.starCoronaColor, Math.min(2, 2.2 * params.starCoronaStrength), 1));
  }
  return group;
}

/** Dispose every geometry / material / texture of a baked group. */
export function disposeBaked(group) {
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry.dispose();
    for (const key of ['map', 'emissiveMap']) obj.material[key]?.dispose();
    obj.material.dispose();
  });
}

const BAKE_OPTION_KEYS = new Set(['planet', 'meshResolution', 'textureSize', 'bakeLighting',
  'water', 'atmosphere', 'rings', 'onProgress', 'starMaterial']);

/**
 * Bake a planet into a static THREE.Group of standard-material meshes.
 *
 *   const group = await bakePlanet(renderer, { preset: 'desert', seed: 7 });
 *   scene.add(group);
 *
 * options:
 *   planet          a Planet to bake (otherwise the remaining options are
 *                   Planet constructor options: type, preset, seed, params...)
 *   meshResolution  quads per cube-face side (terrestrial) / sphere segments (128)
 *   textureSize     texture size per face / equirect width (1024)
 *   water           add a translucent ocean shell (true)
 *   atmosphere      add a fresnel atmosphere / corona rim (true)
 *   rings           bake gas giant rings (true)
 *   bakeLighting    fold a fixed sun into the textures (false — the host
 *                   scene's lights shade the meshes)
 *   starMaterial    'basic' (unlit, default) | 'standard'
 *   onProgress      (message) => void
 * The group's dispose() frees everything; userData.params holds the params.
 */
export async function bakePlanet(renderer, options = {}) {
  let planet = options.planet;
  let owned = false;
  if (!planet?.isPlanet) {
    const planetOptions = {};
    for (const [k, v] of Object.entries(options)) if (!BAKE_OPTION_KEYS.has(k)) planetOptions[k] = v;
    planet = new Planet(planetOptions);
    owned = true;
  }
  // the gas bake reads the jet table
  planet._prepareFrame(renderer);
  const group = await bakeGroup(renderer, planet.params, planet.uniforms, {
    meshRes: options.meshResolution ?? 128,
    texRes: options.textureSize ?? 1024,
    bakeLighting: !!options.bakeLighting,
    exportWater: options.water !== false,
    atmosphere: options.atmosphere !== false,
    rings: options.rings !== false,
    starMaterial: options.starMaterial ?? 'basic',
    starShaderBody: planet.starShaderBody,
  }, options.onProgress ?? (() => {}));
  if (planet.params.mode === 'gas') {
    // same axial tilt as the live gas giant
    group.rotation.set(0, 0, 0);
    group.rotateY(THREE.MathUtils.degToRad(45));
    group.rotateX(THREE.MathUtils.degToRad(planet.params.gasTilt));
  }
  group.userData.params = JSON.parse(JSON.stringify(planet.params));
  group.dispose = () => disposeBaked(group);
  if (owned) planet.dispose();
  return group;
}
