import * as THREE from 'three';
import { createTerrainMaterial } from './materials.js';

// ============================================================================
// Cube-sphere quadtree LOD world.
//
// Six cube faces, each a quadtree over face-UV [0,1]². Every visible node is
// one chunk mesh: a SHARED unit grid geometry whose vertex shader maps
// (uv0 + pos*size) through the per-chunk face basis onto the unit cube, then
// normalizes to the sphere and displaces by the GLSL height field. Split /
// merge is purely a CPU tree decision — geometry never changes, so LOD
// transitions are just meshes appearing/disappearing (with skirts hiding the
// cracks between levels).
//
// Culling: horizon test — a chunk whose center direction lies beyond the
// planet horizon from the camera (with a height margin) cannot be visible.
// ============================================================================

const FACES = [
  { origin: [-1, -1, 1], u: [2, 0, 0], v: [0, 2, 0] },   // +Z
  { origin: [1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] },  // -Z
  { origin: [1, -1, 1], u: [0, 0, -2], v: [0, 2, 0] },   // +X
  { origin: [-1, -1, -1], u: [0, 0, 2], v: [0, 2, 0] },  // -X
  { origin: [-1, 1, 1], u: [2, 0, 0], v: [0, 0, -2] },   // +Y
  { origin: [-1, -1, -1], u: [2, 0, 0], v: [0, 0, 2] },  // -Y
];

// Shared grid geometry: res×res quads in [0,1]² plus a skirt ring flagged by
// aSkirt=1 (the vertex shader sinks those radially to hide LOD cracks).
function buildChunkGeometry(res) {
  const size = res + 1;
  const positions = [];
  const skirt = [];
  const indices = [];

  // interior grid
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      positions.push(x / res, y / res, 0);
      skirt.push(0);
    }
  }
  const idx = (x, y) => y * size + x;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const a = idx(x, y), b = idx(x + 1, y), c = idx(x, y + 1), d = idx(x + 1, y + 1);
      indices.push(a, b, d, a, d, c);
    }
  }

  // skirt ring: duplicate border vertices with aSkirt=1
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

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
  geo.setIndex(indices);
  return geo;
}

export class PlanetWorld {
  constructor(scene, sharedUniforms, opts) {
    this.scene = scene;
    this.shared = sharedUniforms;
    this.opts = { chunkRes: 32, maxDepth: 5, splitFactor: 2.4, octaves: 6, ...opts };
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.geometry = buildChunkGeometry(this.opts.chunkRes);
    this.chunks = new Map();     // key -> mesh
    this._desired = new Map();   // key -> node desc (rebuilt every update)
    this._camPos = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.chunkCount = 0;
    this.wireframe = false;
  }

  get radius() { return this.shared.uRadius.value; }
  get heightScale() { return this.shared.uHeightScale.value; }

  setWireframe(on) {
    this.wireframe = on;
    for (const mesh of this.chunks.values()) mesh.material.wireframe = on;
  }

  /** Rebuild everything (structural change: chunkRes / maxDepth / octaves). */
  rebuild(opts = {}) {
    Object.assign(this.opts, opts);
    for (const mesh of this.chunks.values()) {
      this.group.remove(mesh);
      mesh.material.dispose();
    }
    this.chunks.clear();
    this.geometry.dispose();
    this.geometry = buildChunkGeometry(this.opts.chunkRes);
  }

  update(cameraPos) {
    this._camPos.copy(cameraPos);
    this._desired.clear();

    const camDist = this._camPos.length();
    const R = this.radius;
    // horizon cos with generous margin for terrain height + skirt
    const hr = Math.min(R / Math.max(camDist, R + 1), 1);
    const cosHorizon = Math.sqrt(Math.max(1 - hr * hr, 0));
    const camDirN = this._v.copy(this._camPos).normalize();
    this._cosCull = -1;
    if (camDist > R * 1.05) {
      // widen by the angular size of a chunk + height margin
      this._cosCull = cosHorizon * hr - 0.18;
    }
    this._camDirN = camDirN.clone();

    for (let f = 0; f < 6; f++) this._visit(f, 0, 0, 0);

    // diff desired vs current
    for (const [key, mesh] of this.chunks) {
      if (!this._desired.has(key)) {
        this.group.remove(mesh);
        mesh.material.dispose();
        this.chunks.delete(key);
      }
    }
    for (const [key, node] of this._desired) {
      if (!this.chunks.has(key)) this._createChunk(key, node);
    }
    this.chunkCount = this.chunks.size;
  }

  _centerDir(f, u, v) {
    const face = FACES[f];
    const x = face.origin[0] + u * face.u[0] + v * face.v[0];
    const y = face.origin[1] + u * face.u[1] + v * face.v[1];
    const z = face.origin[2] + u * face.u[2] + v * face.v[2];
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / len, y / len, z / len];
  }

  _visit(f, level, gx, gy) {
    const size = 1 / (1 << level);          // node size in face UV
    const u0 = gx * size, v0 = gy * size;
    const cd = this._centerDir(f, u0 + size / 2, v0 + size / 2);

    // horizon cull (only meaningful when the camera is outside the sphere)
    if (this._cosCull > -1) {
      const dot = cd[0] * this._camDirN.x + cd[1] * this._camDirN.y + cd[2] * this._camDirN.z;
      // margin grows for big top-level nodes whose center can be far from
      // their nearest edge
      if (dot < this._cosCull - size * 0.9) return;
    }

    const R = this.radius;
    const cx = cd[0] * R, cy = cd[1] * R, cz = cd[2] * R;
    const dx = this._camPos.x - cx, dy = this._camPos.y - cy, dz = this._camPos.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const worldSize = size * R * 1.6;        // ~arc length of the node

    if (level < this.opts.maxDepth && dist < worldSize * this.opts.splitFactor) {
      this._visit(f, level + 1, gx * 2, gy * 2);
      this._visit(f, level + 1, gx * 2 + 1, gy * 2);
      this._visit(f, level + 1, gx * 2, gy * 2 + 1);
      this._visit(f, level + 1, gx * 2 + 1, gy * 2 + 1);
    } else {
      this._desired.set(`${f}:${level}:${gx}:${gy}`, { f, level, u0, v0, size });
    }
  }

  _createChunk(key, node) {
    const face = FACES[node.f];
    const chunkUniforms = {
      uFaceOrigin: { value: new THREE.Vector3(...face.origin) },
      uFaceU:      { value: new THREE.Vector3(...face.u) },
      uFaceV:      { value: new THREE.Vector3(...face.v) },
      uUV0:        { value: new THREE.Vector2(node.u0, node.v0) },
      uUVSize:     { value: node.size },
    };
    const mat = createTerrainMaterial(this.shared, this.opts.octaves, chunkUniforms);
    // skirt depth scales with node size so coarse chunks hide bigger cracks
    mat.uniforms.uSkirtDepth = { value: Math.max(this.heightScale * 0.6, node.size * this.radius * 0.05) };
    mat.wireframe = this.wireframe;
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.frustumCulled = false;  // horizon-culled in update() instead
    this.group.add(mesh);
    this.chunks.set(key, mesh);
  }

  dispose() {
    for (const mesh of this.chunks.values()) {
      this.group.remove(mesh);
      mesh.material.dispose();
    }
    this.chunks.clear();
    this.geometry.dispose();
    this.scene.remove(this.group);
  }
}
