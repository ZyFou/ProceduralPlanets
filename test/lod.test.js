import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlanetWorld, morphBands, rangeScaleFor, faceDir, MIN_LEVEL, CAP_CACHE_LIMIT } from '../src/engine/PlanetWorld.js';
import { BuddyAllocator } from '../src/engine/Impostors.js';
import { createSharedUniforms } from '../src/engine/materials.js';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';

const R = 2000;

function makeWorld(opts = {}) {
  const uniforms = createSharedUniforms({ ...DEFAULT_PARAMS, radius: R });
  const scene = new THREE.Scene();
  return new PlanetWorld(scene, uniforms, { chunkRes: 32, maxDepth: 5, splitFactor: 2.4, octaves: 6, ...opts });
}

// grid vertices of a node (a coarse subset is enough: corners, edge midpoints, centre, a few odd ones)
function nodeVertices(node, n = 8) {
  const out = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      const d = faceDir(node.f, node.u0 + (x / n) * node.size, node.v0 + (y / n) * node.size);
      out.push(new THREE.Vector3(d[0] * R, d[1] * R, d[2] * R));
    }
  }
  return out;
}

describe('LOD morph bands', () => {
  const maxDepth = 6;
  const b = morphBands(R, maxDepth, rangeScaleFor(DEFAULT_PARAMS.splitFactor));

  it('ranges shrink level by level', () => {
    for (let L = 1; L <= maxDepth; L++) expect(b.range[L]).toBeLessThan(b.range[L - 1]);
  });

  it('a chunk is fully morphed before its parent merges, and untouched while it can split', () => {
    for (let L = MIN_LEVEL + 1; L <= maxDepth; L++) {
      expect(b.morphEnd[L]).toBeLessThanOrEqual(b.range[L - 1]);
      expect(b.morphStart[L]).toBeGreaterThanOrEqual(b.range[L] + b.diam[L]);
      expect(b.morphStart[L]).toBeLessThan(b.morphEnd[L]);
    }
  });

  it('the coarsest level drawn never morphs', () => {
    for (let L = 0; L <= MIN_LEVEL; L++) expect(b.morphStart[L]).toBeGreaterThan(1e19);
  });
});

describe('PlanetWorld', () => {
  it('draws every chunk after growing beyond the first GPU instance capacity', () => {
    const w = makeWorld({ maxDepth: 9, splitFactor: 4 });
    w.update(new THREE.Vector3(0, 0, R * 10));
    const geometries = w.meshes.map(mesh => mesh.geometry);
    const disposed = [0, 0];
    geometries.forEach((geo, index) => {
      // The renderer sets this on the first GPU draw, independently of later
      // replacements of the instanced attributes.
      geo._maxInstanceCount = geo.attributes.iNode.count;
      geo.addEventListener('dispose', () => disposed[index]++);
    });
    w.update(new THREE.Vector3(0.3, 0.4, 0.87).normalize().multiplyScalar(R + 15));
    expect(w.chunkCount).toBeGreaterThan(256);
    let drawn = 0;
    geometries.forEach((geo, index) => {
      if (geo.instanceCount > 256) {
        expect(disposed[index]).toBe(1);
        expect(geo._maxInstanceCount).toBeUndefined();
      }
      drawn += Math.min(geo.instanceCount, geo._maxInstanceCount ?? geo.attributes.iNode.count);
    });
    expect(drawn).toBe(w.chunkCount);
    expect(geometries[0].attributes.position).not.toBe(geometries[1].attributes.position);
    w.dispose();
  });

  it('reuses stationary LOD buffers and refreshes them for view, variant and settings changes', () => {
    const w = makeWorld();
    const camera = new THREE.PerspectiveCamera(65, 1.5, 1, R * 10);
    camera.position.set(0, 0, R + 60); camera.lookAt(0, 0, 0);
    const version = () => w.meshes[1].geometry.attributes.iNode.version;
    w.update(camera.position, camera);
    const initial = version();
    const initialCount = w.chunkCount;
    w.update(camera.position, camera); expect(version()).toBe(initial);
    camera.lookAt(0, 0, R * 3);
    w.update(camera.position, camera); expect(version()).toBeGreaterThan(initial);
    expect(w.chunkCount).toBeLessThan(initialCount);
    camera.lookAt(0, 0, 0); w.update(camera.position, camera);
    expect(w.chunkCount).toBeGreaterThan(0);
    w.useLowVarying = false; w.update(camera.position, camera);
    expect(w.meshes[0].geometry.instanceCount).toBe(w.chunkCount);
    expect(w.meshes[1].geometry.instanceCount).toBe(0);
    w.rebuild({ maxDepth: 4 }); w.update(camera.position, camera);
    expect(w.chunkCount).toBeGreaterThan(0);
    expect(Math.max(...[...w.chunks.values()].map(node => node.level))).toBe(4);
    w.dispose();
  });

  it('preserves visible leaves when culling branches before subdivision', () => {
    const w = makeWorld({ maxDepth: 7, splitFactor: 4 });
    const camera = new THREE.PerspectiveCamera(65, 1.5, 1, R * 10);
    const visit = w._visit;
    for (const altitude of [15, 300, R, R * 3]) for (const look of [[0, 0, 0], [R * 0.6, 0, 0]]) {
      camera.position.set(R * .2, 0, R + altitude); camera.lookAt(...look);
      w._lastUpdateKey = null;
      w.update(camera.position, camera);
      const culled = [...w.chunks.keys()];
      // Reference: traverse without frustum pruning, then cull only leaves.
      w._visit = function (...args) {
        const planes = this._planes; this._planes = null;
        visit.apply(this, args); this._planes = planes;
      };
      w._lastUpdateKey = null; w.update(camera.position, camera);
      const reference = [...w.chunks.values()].filter(node => w._inFrustum(node.c, node.alpha, node.skirt)).map(node => node.key);
      expect(culled).toEqual(reference);
      w._visit = visit;
    }
    w.dispose();
  });

  it('bounds the cap cache across a surface tour, recreates the same chunks and clears CPU caches on disposal', () => {
    const w = makeWorld({ maxDepth: 9, splitFactor: 12 });
    const start = new THREE.Vector3(0, 0, R + 15);
    w.update(start);
    const original = [...w.chunks];
    const initialCaps = [...w._caps.keys()];
    for (let i = 0; i < 120; i++) {
      const latitude = Math.asin(-1 + 2 * (i + .5) / 120), longitude = i * 2.399963229728653;
      w.update(new THREE.Vector3(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)).multiplyScalar(R + 15));
      expect(w._caps.size).toBeLessThanOrEqual(CAP_CACHE_LIMIT);
    }
    expect(initialCaps.some(key => !w._caps.has(key))).toBe(true);
    w.update(start);
    expect([...w.chunks]).toEqual(original);
    w.dispose();
    expect(w._caps.size).toBe(0); expect(w.chunks.size).toBe(0); expect(w._leaves).toHaveLength(0);
  });
  it('draws the whole planet in two instanced draws, coarsest level >= MIN_LEVEL', () => {
    const w = makeWorld();
    w.update(new THREE.Vector3(R * 2.4, R * 1.4, R * 2.4));
    expect(w.chunkCount).toBeGreaterThan(0);
    for (const node of w.chunks.values()) expect(node.level).toBeGreaterThanOrEqual(MIN_LEVEL);
    const drawn = w.meshes.reduce((a, m) => a + m.geometry.instanceCount, 0);
    expect(drawn).toBe(w.chunkCount);
    expect(w.meshes).toHaveLength(2);
    w.dispose();
  });

  it('subdivides to maxDepth under a low camera, front to back', () => {
    const w = makeWorld();
    const cam = new THREE.Vector3(0.3, 0.4, 0.87).normalize().multiplyScalar(R + 60);
    w.update(cam);
    const nodes = [...w.chunks.values()];
    expect(Math.max(...nodes.map((n) => n.level))).toBe(5);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].d).toBeGreaterThanOrEqual(nodes[i - 1].d);
    w.dispose();
  });

  it('never pops: a split shows children identical to their parent, a merge a parent identical to its children', () => {
    const w = makeWorld({ maxDepth: 6 });
    w._updateBands();
    const { morphStart, morphEnd } = w._bands;
    const morph = (L, dv) => Math.min(1, Math.max(0, (dv - morphStart[L]) / Math.max(morphEnd[L] - morphStart[L], 1e-3)));
    // descend from orbit to the ground and back up, ~1.5% of the altitude per
    // frame (a brisk zoom at 60 fps)
    const dir = new THREE.Vector3(0.21, 0.63, -0.75).normalize();
    const path = [];
    const n = 400;
    for (let i = 0; i <= n; i++) path.push(Math.exp(Math.log(R * 3) * (1 - i / n) + Math.log(15) * (i / n)));
    for (let i = n - 1; i >= 0; i--) path.push(path[i]);
    let prev = null;
    let splits = 0, merges = 0;
    for (const alt of path) {
      const cam = dir.clone().multiplyScalar(R + alt);
      w.update(cam);
      const cur = new Map(w.chunks);
      if (prev) {
        for (const [key, node] of cur) {
          if (prev.has(key)) continue;
          const [f, level, gx, gy] = key.split(':').map(Number);
          const parent = `${f}:${level - 1}:${gx >> 1}:${gy >> 1}`;
          if (prev.has(parent)) {
            // split: every vertex of the new child sits on the parent's grid
            splits++;
            for (const v of nodeVertices(node)) expect(morph(level, v.distanceTo(cam))).toBeGreaterThan(0.999);
          } else if (level < 6 && [...prev.keys()].some((k) => k.startsWith(`${f}:${level + 1}:`) && (Number(k.split(':')[2]) >> 1) === gx && (Number(k.split(':')[3]) >> 1) === gy)) {
            // merge: the parent that comes back is not morphing itself
            merges++;
            for (const v of nodeVertices(node)) expect(morph(level, v.distanceTo(cam))).toBeLessThan(0.001);
          }
        }
      }
      prev = cur;
    }
    expect(splits).toBeGreaterThan(20);
    expect(merges).toBeGreaterThan(20);
    w.dispose();
  });
});

describe('impostor atlas allocator', () => {
  it('packs power-of-two slots without overlap and merges them back', () => {
    const a = new BuddyAllocator(512);
    const slots = [];
    for (const s of [256, 128, 128, 64, 64, 64, 64, 32]) slots.push(a.alloc(s));
    expect(slots.every(Boolean)).toBe(true);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const p = slots[i], q = slots[j];
        const overlap = p.x < q.x + q.s && q.x < p.x + p.s && p.y < q.y + q.s && q.y < p.y + p.s;
        expect(overlap).toBe(false);
      }
    }
    expect(a.alloc(512)).toBeNull();
    for (const s of slots) a.release(s);
    expect(a.alloc(512)).toEqual({ x: 0, y: 0, s: 512 });
  });
});
