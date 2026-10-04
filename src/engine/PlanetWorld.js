import * as THREE from 'three';
import { createTerrainMaterial } from './materials.js';

// Static unit-sphere caps can be recomputed cheaply; a long close-range tour
// must not retain every node it has ever visited. Batch FIFO eviction avoids
// repeatedly scanning Map tombstones on each insertion.
export const CAP_CACHE_LIMIT = 16_384;

// ============================================================================
// Cube-sphere quadtree LOD world, geomorphed and instanced.
//
// Six cube faces, each a quadtree over face-UV [0,1]². Every selected node is
// one chunk: the SHARED unit grid, instanced — per-chunk data (face, UV
// origin + size, morph band, skirt depth) lives in instance attributes, so
// the whole terrain is ONE draw per shader variant, however many chunks.
// The vertex shader maps the grid through the face onto the unit cube,
// normalizes to the sphere and displaces by the GLSL height field.
//
// LOD transitions are continuous (CDLOD-style geomorphing). A node splits
// when the camera comes within range[level] of the nearest point of its cap
// on the sphere. Each vertex computes its own distance and, over the last
// part of its chunk's range, slides its odd grid vertices onto the parent's
// grid: by the time a chunk merges into its parent it IS its parent's
// surface, and a new chunk appears as an exact copy of the one it replaces.
// For that the ranges are sized from the nodes' real extent on the sphere
// (morphBands): a chunk's farthest vertex must still be unmorphed when the
// chunk splits. Skirts still hide the T-junction cracks at level borders.
//
// Culling per chunk, every frame: horizon (the whole cap, heights included,
// behind the planet) and frustum (bounding sphere vs the side planes).
// Chunks are sorted front to back so early-z rejects hidden terrain before
// its heavy fragment shader runs.
//
// Two shader variants (LOW_VARYING interpolates the low octaves from the
// vertices, for chunks fine enough to resolve them: level >= 3). Their
// materials live as long as the world (three deletes a program with its last
// material, and recompiling this shader takes seconds); PlanetRenderer
// compiles them ahead, asynchronously, before the first draw.
// ============================================================================

export const FACES = [
  { origin: [-1, -1, 1], u: [2, 0, 0], v: [0, 2, 0] },   // +Z
  { origin: [1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] },  // -Z
  { origin: [1, -1, 1], u: [0, 0, -2], v: [0, 2, 0] },   // +X
  { origin: [-1, -1, -1], u: [0, 0, 2], v: [0, 2, 0] },  // -X
  { origin: [-1, 1, 1], u: [2, 0, 0], v: [0, 0, -2] },   // +Y
  { origin: [-1, -1, -1], u: [2, 0, 0], v: [0, 0, 2] },  // -Y
];

const LOW_VARYING_LEVEL = 3;
const END_SLACK = 0.97;   // morph done at 97% of the parent's merge distance
const MIN_BAND = 1.15;    // morph band >= 0.13 node diameters wide
// coarsest chunks drawn: the domain warp is interpolated from the vertices
// (WARP_VARYING), which a whole cube face per chunk (level 0) is too coarse for
export const MIN_LEVEL = 1;
const NO_MORPH = 1e20;
const INSTANCE_STRIDE = { iNode: 4, iMorph: 3 };

// Shared grid geometry: res×res quads in [0,1]² plus a skirt ring flagged by
// aSkirt=1 (the vertex shader sinks those radially to hide LOD cracks).
function buildGrid(res) {
  const size = res + 1;
  const positions = [];
  const skirt = [];
  const indices = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      positions.push(x / res, y / res, 0);
      skirt.push(0);
    }
  }
  const idx = (x, y) => y * size + x;
  // (a, b, d) (a, d, c): the geomorph collapses a quad onto the parent quad
  // with the same diagonal
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const a = idx(x, y), b = idx(x + 1, y), c = idx(x, y + 1), d = idx(x + 1, y + 1);
      indices.push(a, b, d, a, d, c);
    }
  }

  const borderIds = [];
  for (let x = 0; x < size; x++) borderIds.push(idx(x, 0));
  for (let y = 1; y < size; y++) borderIds.push(idx(size - 1, y));
  for (let x = size - 2; x >= 0; x--) borderIds.push(idx(x, size - 1));
  for (let y = size - 2; y >= 1; y--) borderIds.push(idx(0, y));

  const ringStart = positions.length / 3;
  for (const b of borderIds) {
    positions.push(positions[b * 3], positions[b * 3 + 1], 0);
    skirt.push(1);
  }
  const ringLen = borderIds.length;
  for (let i = 0; i < ringLen; i++) {
    const a = borderIds[i];
    const b = borderIds[(i + 1) % ringLen];
    const a2 = ringStart + i;
    const b2 = ringStart + ((i + 1) % ringLen);
    indices.push(a, a2, b, b, a2, b2);
  }
  return {
    position: new THREE.Float32BufferAttribute(positions, 3),
    aSkirt: new THREE.Float32BufferAttribute(skirt, 1),
    index: new THREE.Uint32BufferAttribute(indices, 1),
    triangles: indices.length / 3,
  };
}

// ---- node geometry on the unit sphere ----------------------------------------
export function faceDir(f, u, v, out = [0, 0, 0]) {
  const face = FACES[f];
  const x = face.origin[0] + u * face.u[0] + v * face.v[0];
  const y = face.origin[1] + u * face.u[1] + v * face.v[1];
  const z = face.origin[2] + u * face.u[2] + v * face.v[2];
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  out[0] = x / len; out[1] = y / len; out[2] = z / len;
  return out;
}

const _d = [0, 0, 0];
const SAMPLES = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]];

// centre direction + angular radius of the cap containing a node
function nodeCap(f, u0, v0, s) {
  const c = faceDir(f, u0 + s / 2, v0 + s / 2, [0, 0, 0]);
  let cosA = 1;
  for (const [du, dv] of SAMPLES) {
    faceDir(f, u0 + du * s, v0 + dv * s, _d);
    cosA = Math.min(cosA, _d[0] * c[0] + _d[1] * c[1] + _d[2] * c[2]);
  }
  return { c, alpha: Math.acos(Math.max(-1, Math.min(1, cosA))) };
}

/**
 * Split ranges + morph bands per level for a sphere of radius R.
 * rangeScale: range = rangeScale x the level's largest cap diameter.
 * Returns { range[], morphStart[], morphEnd[], diam[] }: level L splits when
 * the camera is nearer than range[L] to a node's cap; leaves at level L morph
 * toward level L-1 between morphStart[L] and morphEnd[L].
 */
export function morphBands(R, maxDepth, rangeScale) {
  const diam = [];
  for (let L = 0; L <= maxDepth; L++) {
    // nodes are symmetric across faces and quadrants: one quadrant of a face
    const n = 1 << L;
    const half = Math.max(1, n >> 1);
    let maxA = 0;
    for (let gy = 0; gy < half; gy++) {
      for (let gx = 0; gx < half; gx++) maxA = Math.max(maxA, nodeCap(0, gx / n, gy / n, 1 / n).alpha);
    }
    diam.push(2 * R * Math.sin(Math.min(maxA, Math.PI / 2)));
  }
  // natural ranges, then bottom-up: a level must merge far enough out that
  // its children fit a real morph band (untouched until range + diameter,
  // done by END_SLACK x the parent's range). Near the cube corners' top
  // levels the caps shrink by less than 2x per level (level 1 -> 2: 1.73x),
  // which would squeeze that band to nothing.
  const range = diam.map((d) => d * rangeScale);
  for (let L = maxDepth - 1; L >= 0; L--) {
    range[L] = Math.max(range[L], (range[L + 1] + diam[L + 1] * MIN_BAND) / END_SLACK);
  }
  // the coarsest level drawn never merges: no morph
  const morphStart = [];
  const morphEnd = [];
  for (let L = 0; L <= Math.min(MIN_LEVEL, maxDepth); L++) {
    morphStart.push(NO_MORPH);
    morphEnd.push(NO_MORPH);
  }
  for (let L = MIN_LEVEL + 1; L <= maxDepth; L++) {
    // fully morphed before the parent merges (it merges at range[L-1]), with
    // slack for the camera crossing the range between two frames ...
    const end = range[L - 1] * END_SLACK;
    // ... and untouched while any of its vertices can still be reached by its
    // own split (its farthest vertex is within range[L] + its diameter)
    const start = range[L] + diam[L] * 1.02;
    morphStart.push(start);
    morphEnd.push(end);
  }
  return { range, morphStart, morphEnd, diam };
}

// splitFactor (1.2 .. 4, default 2.4) -> range / node diameter. The morph
// band between two levels needs ~1.45 to stay pop-free (bench: flythrough
// pops); 1.2 -> 1.3 trades a few faint pops for fewer chunks, 4 -> 1.825.
export const rangeScaleFor = (splitFactor) => 1.3 + (Math.max(splitFactor, 0.2) - 1.2) * 0.1875;

export class PlanetWorld {
  constructor(scene, sharedUniforms, opts) {
    this.scene = scene;
    this.shared = sharedUniforms;
    this.opts = { chunkRes: 32, maxDepth: 5, splitFactor: 2.4, octaves: 6, ...opts };
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.wireframe = false;
    this.lowVaryingLevel = LOW_VARYING_LEVEL;
    // the LOW_VARYING program is an optimisation: until it has compiled
    // (PlanetRenderer sets this), its chunks draw with the exact variant
    this.useLowVarying = true;
    this.templateMaterials = this._createMaterials();
    this._buildMeshes();

    this.chunks = new Map();     // key -> node, the chunks of the last update
    this.chunkCount = 0;
    this.pendingCount = 0;       // nothing streams: every chunk is live at once

    this._caps = new Map();      // node key -> { c, alpha } (static geometry)
    this._bands = null;
    this._bandsKey = '';
    this._leaves = [];
    this._camPos = new THREE.Vector3();
    this._camN = [0, 1, 0];
    this._camDist = 0;
    this._thetaMax = Math.PI;
    this._frustum = new THREE.Frustum();
    this._projView = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
  }

  get radius() { return this.shared.uRadius.value; }
  get heightScale() { return this.shared.uHeightScale.value; }

  // one material per variant (0: per-pixel low octaves, 1: LOW_VARYING)
  _createMaterials() {
    return [0, 1].map((low) => {
      const m = createTerrainMaterial(this.terrainUniforms ?? this.shared, this.terrainOctaves ?? this.opts.octaves, low === 1, this.opts.chunkRes, this.terrainProgram, this.opts.analyticTerrainDepth);
      m.wireframe = this.wireframe;
      return m;
    });
  }

  _buildMeshes() {
    const grid = buildGrid(this.opts.chunkRes);
    this._grid = grid;
    this.meshes = [0, 1].map((low) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', grid.position);
      geo.setAttribute('aSkirt', grid.aSkirt);
      geo.setIndex(grid.index);
      geo.instanceCount = 0;
      this._allocInstances(geo, 256);
      const mesh = new THREE.Mesh(geo, this.templateMaterials[low]);
      mesh.frustumCulled = false;       // culled per chunk in update()
      mesh.renderOrder = low ? 0 : 1;   // fine (near) chunks first: early-z
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    });
  }

  _allocInstances(geo, capacity) {
    for (const [name, size] of Object.entries(INSTANCE_STRIDE)) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }
    geo.userData.capacity = capacity;
  }

  _disposeMeshes() {
    for (const mesh of this.meshes ?? []) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.meshes = [];
  }

  setWireframe(on) {
    this.wireframe = on;
    for (const m of this.templateMaterials) m.wireframe = on;
  }

  /** Swap only shaders: retain the grid, instance buffers and LOD tree. */
  installTerrainMaterials(materials, { program = null, uniforms = null, octaves = null } = {}) {
    const previous = this.templateMaterials;
    this.terrainProgram = program;
    this.terrainUniforms = uniforms;
    this.terrainOctaves = octaves;
    this.templateMaterials = materials;
    this.meshes.forEach((mesh, index) => { mesh.material = materials[index]; });
    for (const material of previous) material.dispose();
  }

  /** Rebuild everything (structural change: chunkRes / maxDepth / octaves). */
  rebuild(opts = {}) {
    const prev = { ...this.opts };
    Object.assign(this.opts, opts);
    // new materials BEFORE the old ones go: an unchanged shader keeps its
    // programs (no recompile), a changed one gets compiled ahead
    if (this.opts.octaves !== prev.octaves || this.opts.analyticTerrainDepth !== prev.analyticTerrainDepth) {
      const old = this.templateMaterials;
      this.templateMaterials = this._createMaterials();
      for (const m of old) m.dispose();
    }
    for (const m of this.templateMaterials) m.uniforms.uGridRes.value = this.opts.chunkRes;
    this._disposeMeshes();
    this._buildMeshes();
    this._bandsKey = '';
    this.chunks.clear();
    this.chunkCount = 0;
  }

  _cap(f, level, gx, gy) {
    const key = ((f * 16 + level) * 65536 + gy) * 65536 + gx;
    let cap = this._caps.get(key);
    if (!cap) {
      if (this._caps.size >= CAP_CACHE_LIMIT) {
        const oldest = this._caps.keys();
        for (let i = 0; i < CAP_CACHE_LIMIT / 2; i++) this._caps.delete(oldest.next().value);
      }
      const s = 1 / (1 << level);
      cap = nodeCap(f, gx * s, gy * s, s);
      this._caps.set(key, cap);
    }
    return cap;
  }

  _updateBands() {
    const key = `${this.radius}|${this.opts.maxDepth}|${this.opts.splitFactor}`;
    if (key === this._bandsKey) return;
    this._bandsKey = key;
    this._bands = morphBands(this.radius, this.opts.maxDepth, rangeScaleFor(this.opts.splitFactor));
  }

  /** Select, cull and upload the chunks for the camera; `camera` (optional) enables frustum culling. */
  update(cameraPos, camera = null) {
    this._updateBands();
    const R = this.radius;
    const H = this.heightScale;
    const cam = this._camPos.copy(cameraPos);
    const camDist = cam.length();
    this._camDist = camDist;
    this._camN = camDist > 0 ? [cam.x / camDist, cam.y / camDist, cam.z / camDist] : [0, 1, 0];
    // horizon: a cap is hidden once its nearest direction is farther than
    // acos(R / camDist) (the tangent) + acos(R / (R + H)) (peaks rising above
    // it) from the camera direction
    this._thetaMax = camDist > R ? Math.acos(R / camDist) + Math.acos(R / (R + H)) : Math.PI;

    const leaves = this._leaves;
    leaves.length = 0;
    for (let f = 0; f < 6; f++) this._visit(f, 0, 0, 0);

    // frustum (side planes: near / far are refitted every frame)
    let planes = null;
    if (camera) {
      camera.updateMatrixWorld();
      this._projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      planes = this._frustum.setFromProjectionMatrix(this._projView).planes;
    }
    const s = this._sphere;
    let n = 0;
    for (const node of leaves) {
      let vis = true;
      if (planes) {
        const { c, alpha } = node;
        const r0 = R - node.skirt;
        const r1 = R + H;
        const rm = 0.5 * (r0 + r1);
        const ca = Math.cos(alpha);
        const d0 = r0 * r0 + rm * rm - 2 * r0 * rm * ca;
        const d1 = r1 * r1 + rm * rm - 2 * r1 * rm * ca;
        s.center.set(c[0] * rm, c[1] * rm, c[2] * rm);
        s.radius = Math.sqrt(Math.max(d0, d1)) * 1.01 + 1;
        for (let i = 0; i < 4 && vis; i++) vis = planes[i].distanceToPoint(s.center) >= -s.radius;
      }
      if (vis) leaves[n++] = node;
    }
    leaves.length = n;
    leaves.sort((a, b) => a.d - b.d);

    // upload, per variant, front to back
    const lowLevel = this.useLowVarying ? this.lowVaryingLevel : Infinity;
    const counts = [0, 0];
    for (const node of leaves) counts[node.level >= lowLevel ? 1 : 0]++;
    for (let low = 0; low < 2; low++) {
      const geo = this.meshes[low].geometry;
      if (geo.userData.capacity < counts[low]) {
        let cap = geo.userData.capacity;
        while (cap < counts[low]) cap *= 2;
        this._allocInstances(geo, cap);
      }
    }
    const iNode = this.meshes.map((m) => m.geometry.attributes.iNode.array);
    const iMorph = this.meshes.map((m) => m.geometry.attributes.iMorph.array);
    const at = [0, 0];
    const { morphStart, morphEnd } = this._bands;
    this.chunks.clear();
    for (const node of leaves) {
      const low = node.level >= lowLevel ? 1 : 0;
      const k = at[low]++;
      const a = iNode[low];
      const m = iMorph[low];
      a[k * 4] = node.u0;
      a[k * 4 + 1] = node.v0;
      a[k * 4 + 2] = node.size;
      a[k * 4 + 3] = node.f;
      m[k * 3] = morphStart[node.level];
      m[k * 3 + 1] = morphEnd[node.level];
      m[k * 3 + 2] = node.skirt;
      this.chunks.set(node.key, node);
    }
    for (let low = 0; low < 2; low++) {
      const mesh = this.meshes[low];
      const geo = mesh.geometry;
      geo.instanceCount = counts[low];
      mesh.visible = counts[low] > 0;
      for (const name of Object.keys(INSTANCE_STRIDE)) {
        const attr = geo.attributes[name];
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(1, counts[low]) * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
    this.chunkCount = leaves.length;
  }

  // distance from the camera to the nearest point of a cap on the sphere of
  // radius R: a lower bound for every vertex of the node
  _capDistance(c, alpha) {
    const R = this.radius;
    const camDist = this._camDist;
    const n = this._camN;
    const cosT = Math.min(1, Math.max(-1, c[0] * n[0] + c[1] * n[1] + c[2] * n[2]));
    const theta = Math.acos(cosT);
    if (theta <= alpha) return Math.abs(camDist - R);
    return Math.sqrt(Math.max(0, camDist * camDist + R * R - 2 * camDist * R * Math.cos(theta - alpha)));
  }

  _visit(f, level, gx, gy) {
    const { c, alpha } = this._cap(f, level, gx, gy);
    const n = this._camN;
    const theta = Math.acos(Math.min(1, Math.max(-1, c[0] * n[0] + c[1] * n[1] + c[2] * n[2])));
    if (theta - alpha > this._thetaMax + 1e-3) return;   // behind the horizon

    const d = this._capDistance(c, alpha);
    if (level < this.opts.maxDepth && (level < MIN_LEVEL || d < this._bands.range[level])) {
      this._visit(f, level + 1, gx * 2, gy * 2);
      this._visit(f, level + 1, gx * 2 + 1, gy * 2);
      this._visit(f, level + 1, gx * 2, gy * 2 + 1);
      this._visit(f, level + 1, gx * 2 + 1, gy * 2 + 1);
      return;
    }
    const size = 1 / (1 << level);
    this._leaves.push({
      key: `${f}:${level}:${gx}:${gy}`,
      f, level, u0: gx * size, v0: gy * size, size, c, alpha, d,
      // skirt depth scales with node size so coarse chunks hide bigger cracks
      skirt: Math.max(this.heightScale * 0.6, size * this.radius * 0.05),
    });
  }

  dispose() {
    this._disposeMeshes();
    for (const m of this.templateMaterials) m.dispose();
    this.scene.remove(this.group);
    this._caps.clear();
    this.chunks.clear();
    this._leaves.length = 0;
    this.chunkCount = 0;
  }
}
