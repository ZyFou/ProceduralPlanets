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
// Chunks the tree keeps are then hidden (not destroyed) every frame when they
// are outside the view frustum or entirely below the true horizon: the
// vertex shader evaluates the full height field, so off-screen chunks are
// not free.
//
// Chunk meshes are pooled, never disposed while the world lives: three
// deletes a shader program as soon as its last material is disposed, so
// dropping every chunk of one terrain variant (crossing the level-2 LOD
// boundary while zooming) would recompile it — a multi-second stall for this
// shader — on the way back. warmup() compiles both variants in the
// background up front, before the first zoom needs the fine one.
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
    this._pool = [[], []];       // free chunk meshes by variant (1: LOW_VARYING)
    this._desired = new Map();   // key -> node desc (rebuilt every update)
    this._camPos = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._frustum = new THREE.Frustum();
    this._projView = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this.chunkCount = 0;
    this.wireframe = false;
  }

  get radius() { return this.shared.uRadius.value; }
  get heightScale() { return this.shared.uHeightScale.value; }

  setWireframe(on) {
    this.wireframe = on;
    for (const mesh of this.chunks.values()) mesh.material.wireframe = on;
  }

  /**
   * Start compiling both terrain variants and park their meshes in the pool,
   * which keeps the programs alive. compile() only issues compile + link; the
   * driver builds them in the background and nothing waits on the status
   * until first use. (Not compileAsync: its status poll throws if the world
   * is rebuilt or disposed before the compile finishes.) `target` must be
   * the render target the terrain is drawn into: the program key depends on
   * its colour space.
   */
  warmup(renderer, camera, target) {
    const scene = new THREE.Scene();
    for (const low of [0, 1]) {
      if (this._pool[low].length) continue;
      const mesh = this._newMesh(low);
      scene.add(mesh);
      this._pool[low].push(mesh);
    }
    if (!scene.children.length) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(prev);
  }

  _disposeMeshes() {
    for (const mesh of this.chunks.values()) {
      this.group.remove(mesh);
      mesh.material.dispose();
    }
    this.chunks.clear();
    for (const pool of this._pool) {
      for (const mesh of pool) {
        mesh.removeFromParent();
        mesh.material.dispose();
      }
      pool.length = 0;
    }
  }

  /** Rebuild everything (structural change: chunkRes / maxDepth / octaves). */
  rebuild(opts = {}) {
    Object.assign(this.opts, opts);
    this._disposeMeshes();
    this.geometry.dispose();
    this.geometry = buildChunkGeometry(this.opts.chunkRes);
  }

  /** Rebuild the LOD tree for the camera; `camera` (optional) enables culling. */
  update(cameraPos, camera = null) {
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
        this._pool[mesh.userData.low].push(mesh);
        this.chunks.delete(key);
      }
    }
    for (const [key, node] of this._desired) {
      if (!this.chunks.has(key)) this._createChunk(key, node);
    }
    this.chunkCount = this.chunks.size;

    // draw front to back so early-z rejects hidden terrain before its (heavy)
    // fragment shader runs. Every chunk owns a material, so three would
    // otherwise sort by material id (creation order).
    for (const mesh of this.chunks.values()) {
      const c = mesh.userData.center;
      const dx = this._camPos.x - c[0] * R, dy = this._camPos.y - c[1] * R, dz = this._camPos.z - c[2] * R;
      mesh.renderOrder = dx * dx + dy * dy + dz * dz;
    }
    this._cull(camera, camDist, camDirN);
  }

  // Hide chunks that cannot put a pixel on screen. Both tests are
  // conservative: a chunk spans directions within `alpha` of its center and
  // radii from R - skirt to R + heightScale.
  //   horizon: every point of it (radius <= R + H) is behind the sphere of
  //            radius R (terrain never dips below it) as seen from the camera
  //   frustum: its bounding sphere is outside a side plane (near / far move
  //            with the camera every frame, so they are left out)
  _cull(camera, camDist, camDirN) {
    const R = this.radius;
    const H = this.heightScale;
    const thetaMax = camDist > R ? Math.acos(R / camDist) + Math.acos(R / (R + H)) : Math.PI;
    let planes = null;
    if (camera) {
      camera.updateMatrixWorld();
      this._projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      planes = this._frustum.setFromProjectionMatrix(this._projView).planes;
    }
    const s = this._sphere;
    for (const mesh of this.chunks.values()) {
      const { center: c, alpha } = mesh.userData;
      const cosT = c[0] * camDirN.x + c[1] * camDirN.y + c[2] * camDirN.z;
      let vis = Math.acos(Math.min(Math.max(cosT, -1), 1)) - alpha <= thetaMax + 1e-3;
      if (vis && planes) {
        const r0 = R - mesh.material.uniforms.uSkirtDepth.value;
        const r1 = R + H;
        const rm = 0.5 * (r0 + r1);
        const ca = Math.cos(alpha);
        const d0 = r0 * r0 + rm * rm - 2 * r0 * rm * ca;
        const d1 = r1 * r1 + rm * rm - 2 * r1 * rm * ca;
        s.center.set(c[0] * rm, c[1] * rm, c[2] * rm);
        s.radius = Math.sqrt(Math.max(d0, d1)) * 1.01 + 1;
        for (let i = 0; i < 4 && vis; i++) vis = planes[i].distanceToPoint(s.center) >= -s.radius;
      }
      mesh.visible = vis;
    }
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

  // A chunk mesh of one terrain variant (low: LOW_VARYING), placed later.
  _newMesh(low) {
    const chunkUniforms = {
      uFaceOrigin: { value: new THREE.Vector3() },
      uFaceU:      { value: new THREE.Vector3() },
      uFaceV:      { value: new THREE.Vector3() },
      uUV0:        { value: new THREE.Vector2() },
      uUVSize:     { value: 1 },
    };
    const mat = createTerrainMaterial(this.shared, this.opts.octaves, chunkUniforms, low === 1);
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.frustumCulled = false;  // culled in update() instead (shader-displaced)
    mesh.userData.low = low;
    return mesh;
  }

  _createChunk(key, node) {
    const face = FACES[node.f];
    const low = node.level >= 2 ? 1 : 0;
    const mesh = this._pool[low].pop() || this._newMesh(low);
    const mu = mesh.material.uniforms;
    mu.uFaceOrigin.value.fromArray(face.origin);
    mu.uFaceU.value.fromArray(face.u);
    mu.uFaceV.value.fromArray(face.v);
    mu.uUV0.value.set(node.u0, node.v0);
    mu.uUVSize.value = node.size;
    // skirt depth scales with node size so coarse chunks hide bigger cracks
    mu.uSkirtDepth.value = Math.max(this.heightScale * 0.6, node.size * this.radius * 0.05);
    mesh.material.wireframe = this.wireframe;
    const u0 = node.u0, v0 = node.v0, s = node.size;
    const c = this._centerDir(node.f, u0 + s / 2, v0 + s / 2);
    // angular radius: farthest corner / edge midpoint from the center
    let cosA = 1;
    for (const [du, dv] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]]) {
      const d = this._centerDir(node.f, u0 + du * s, v0 + dv * s);
      cosA = Math.min(cosA, d[0] * c[0] + d[1] * c[1] + d[2] * c[2]);
    }
    mesh.userData.center = c;
    mesh.userData.alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
    this.group.add(mesh);
    this.chunks.set(key, mesh);
  }

  dispose() {
    this._disposeMeshes();
    this.geometry.dispose();
    this.scene.remove(this.group);
  }
}
