import * as THREE from 'three';
import { zlibSync, unzlibSync } from 'fflate';
import { faceToDirection, directionToFace, tangentFrame, offsetDirection, brushWeight, clamp } from './sphericalPaintMapping.js';

export const PAINT_MATERIALS = Object.freeze(['coast', 'sand', 'vegetation', 'rock', 'snow']);
const geometryCache = new Map();
const TILE = 16;
const CHANNELS = 6; // signed height, coast, sand, vegetation, rock, snow
const RECORD_BYTES = 3 + TILE * TILE * CHANNELS * 4;
const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};
const fromBase64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const validResolution = (n) => Number.isInteger(n) && n >= 16 && n <= 512;

/** Framework-independent runtime paint. Face edges include identical shared vertices. */
export class PlanetPaintLayerManager {
  constructor({ resolution = 256, uniforms = {}, onChange } = {}) {
    if (!validResolution(resolution)) throw new Error('Paint resolution must be an integer from 16 to 512.');
    this.uniforms = uniforms;
    this.onChange = onChange;
    this.revision = 0;
    this.dirtyFaces = new Set();
    this.resolution = resolution;
    this.side = resolution + 1;
    this.faces = []; this.textures = []; this.tiles = [];
    this.maxHeight = 0; this.nonzeroCount = 0; this._serialized = null;
    this.uniforms.uPaintFaces ??= { value: null };
    this.dirtyBounds = [];
    this._rendererRevisions = new WeakMap();
    this._uploadedRevision = -1;
    this.uniforms.uPaintResolution ??= { value: resolution };
    this.uniforms.uPaintActive ??= { value: 0 };
  }
  _ensure() { if (!this.faces.length) this._allocate(this.resolution); }

  _allocate(resolution) {
    this.textures?.forEach((t) => t.dispose());
    this.resolution = resolution;
    this.side = resolution + 1;
    const n = this.side * this.side;
    this.faces = Array.from({ length: 6 }, () => new Float32Array(n * CHANNELS));
    // Native WebGL2 array: one sampler, six cube faces, two RGBA banks per face.
    // Explicit Float32 interpolation matches CPU without float-linear extensions.
    const packed = new Float32Array(n * 8 * 6);
    this._rendererRevisions = new WeakMap(); this._uploadedRevision = -1;
    this.texture = new THREE.DataArrayTexture(packed, this.side, this.side * 2, 6);
    this.texture.type = THREE.FloatType;
    this.texture.format = THREE.RGBAFormat;
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.textures = [this.texture];
    this.faceGPU = this.faces.map((_, face) => packed.subarray(face * n * 8, (face + 1) * n * 8));
    this.dirtyBounds = [];
    const cached = geometryCache.get(resolution);
    this.tiles = cached?.tiles ?? [];
    this.directions = cached?.directions ?? this.faces.map((_, face) => {
      const data = new Float64Array(n * 3), d = new THREE.Vector3();
      for (let y = 0; y < this.side; y++) for (let x = 0; x < this.side; x++) {
        faceToDirection(face, x / resolution, y / resolution, d).toArray(data, (y * this.side + x) * 3);
      }
      for (let y = 0; y < this.side; y += TILE) for (let x = 0; x < this.side; x += TILE) {
        const x1 = Math.min(x + TILE - 1, resolution), y1 = Math.min(y + TILE - 1, resolution);
        const center = faceToDirection(face, (x + x1) / (2 * resolution), (y + y1) / (2 * resolution));
        const alpha = Math.max(...[[x, y], [x1, y], [x, y1], [x1, y1]].map(([a, b]) => Math.acos(clamp(center.dot(faceToDirection(face, a / resolution, b / resolution)), -1, 1))));
        this.tiles.push({ face, x, y, x1, y1, center, alpha });
      }
      return data;
    });
    if (!cached) geometryCache.set(resolution, { tiles: this.tiles, directions: this.directions });
    this.uniforms.uPaintFaces.value = this.texture;
    this.uniforms.uPaintResolution ??= { value: resolution };
    this.uniforms.uPaintResolution.value = resolution;
    this.uniforms.uPaintActive ??= { value: 0 };
    this.uniforms.uPaintActive.value = 0;
    this.maxHeight = 0; this.nonzeroCount = 0;
    this._serialized = null;
    this.dirtyFaces.clear();
  }

  sample(direction, channel = 0) {
    const { face, u, v } = directionToFace(direction);
    if (!this.faces.length) return 0;
    const x = u * this.resolution, y = v * this.resolution;
    const ix = Math.floor(x), iy = Math.floor(y), jx = Math.min(ix + 1, this.resolution), jy = Math.min(iy + 1, this.resolution);
    const a = x - ix, b = y - iy, data = this.faces[face];
    const at = (px, py) => data[(py * this.side + px) * CHANNELS + channel];
    return (at(ix, iy) * (1 - a) + at(jx, iy) * a) * (1 - b) + (at(ix, jy) * (1 - a) + at(jx, jy) * a) * b;
  }
  sampleHeightOffset(direction) { return this.sample(direction); }
  sampleMaterials(direction) { return PAINT_MATERIALS.map((_, i) => this.sample(direction, i + 1)); }
  isEmpty() { return !this.uniforms.uPaintActive.value; }

  _write(face, pixel, channel, value) {
    const data = this.faces[face], index = pixel * CHANNELS + channel;
    value = Math.fround(value);
    if (data[index] === value) return false;
    if (data[index] === 0 && value !== 0) this.nonzeroCount++;
    if (data[index] !== 0 && value === 0) this.nonzeroCount--;
    data[index] = value;
    const gpu = this.faceGPU[face];
    const n = this.side * this.side;
    gpu[channel < 4 ? pixel * 4 + channel : (n + pixel) * 4 + channel - 4] = value;
    this.dirtyFaces.add(face);
    const x = pixel % this.side, y = Math.floor(pixel / this.side), bounds = this.dirtyBounds[face];
    if (bounds) { bounds.x0 = Math.min(bounds.x0, x); bounds.y0 = Math.min(bounds.y0, y); bounds.x1 = Math.max(bounds.x1, x); bounds.y1 = Math.max(bounds.y1, y); }
    else this.dirtyBounds[face] = { x0: x, y0: y, x1: x, y1: y };
    if (channel === 0) this.maxHeight = Math.max(this.maxHeight, Math.abs(value));
    return true;
  }

  stamp({ direction, radius, planetRadius, tool = 'raise', strength = 0.35, falloff = 0.75,
    shape = 'round', rotation = 0, tangent = null, scatter = 0.55, seed = 0,
    targetElevation = 0, material = 'sand', baseHeightAt = () => 0, amount = radius * 0.12 }) {
    if (!direction || !Number.isFinite(radius + planetRadius + strength + targetElevation + amount + falloff + rotation + scatter + seed) || radius <= 0 || planetRadius <= 0) throw new Error('Invalid paint stamp.');
    if (!['raise', 'lower', 'smooth', 'flatten', 'material', 'erase'].includes(tool)) throw new Error('Unknown paint tool.');
    if (!['round', 'ellipse', 'organic', 'scatter', 'ribbon'].includes(shape)) throw new Error('Unknown paint brush.');
    const channel = PAINT_MATERIALS.indexOf(material) + 1;
    if (tool === 'material' && channel === 0) throw new Error('Unknown paint material.');
    this._ensure();
    const center = direction.clone().normalize();
    directionToFace(center);
    const frame = tangentFrame(center, rotation, tangent), d = new THREE.Vector3();
    const changes = [];
    const angularRadius = Math.min(radius / planetRadius, Math.PI);
    for (const tile of this.tiles) {
      if (center.dot(tile.center) < Math.cos(Math.min(Math.PI, angularRadius + tile.alpha))) continue;
      const { face, x, y, x1, y1 } = tile;
      const dirs = this.directions[face], data = this.faces[face];
      for (let py = y; py <= y1; py++) for (let px = x; px <= x1; px++) {
        const pixel = py * this.side + px;
        d.fromArray(dirs, pixel * 3);
        const w = brushWeight(d, center, frame, { radius, planetRadius, falloff: clamp(falloff, 0, 1), shape, seed, scatter });
        const alpha = w * clamp(strength, 0, 1);
        if (alpha <= 0) continue;
        const offset = pixel * CHANNELS, old = data[offset];
        if (tool === 'raise' || tool === 'lower') changes.push([face, pixel, 0, old + (tool === 'lower' ? -1 : 1) * amount * alpha]);
        if (tool === 'flatten') changes.push([face, pixel, 0, old + (targetElevation - baseHeightAt(d) - old) * alpha]);
        if (tool === 'smooth') {
          const basis = tangentFrame(d), q = new THREE.Vector3();
          // Average final elevations on a geodesic ring, never world Y or radius.
          const step = Math.max(planetRadius * 2 / this.resolution, radius * 0.18);
          let total = 0;
          for (let k = 0; k < 8; k++) {
            const theta = k * Math.PI / 4;
            offsetDirection(d, basis.east, basis.north, Math.cos(theta) * step, Math.sin(theta) * step, planetRadius, q);
            total += baseHeightAt(q) + this.sampleHeightOffset(q);
          }
          changes.push([face, pixel, 0, old + (total / 8 - baseHeightAt(d) - old) * alpha]);
        }
        if (tool === 'material') {
          // Blend the complete weight vector toward one channel; total <= 1,
          // with the remainder reserved for procedural classification.
          for (let c = 1; c < CHANNELS; c++) changes.push([face, pixel, c, data[offset + c] * (1 - alpha) + (c === channel ? alpha : 0)]);
        }
        if (tool === 'erase') for (let c = 0; c < CHANNELS; c++) changes.push([face, pixel, c, data[offset + c] * (1 - alpha)]);
      }
    }
    let changed = false;
    for (const args of changes) changed = this._write(...args) || changed;
    if (changed) this._changed(true);
    return changed;
  }

  _changed(active) {
    this.uniforms.uPaintActive.value = active && this.nonzeroCount > 0 ? 1 : 0;
    this.revision++;
    this._serialized = null;
    this.onChange?.();
  }
  flushUploads(renderer) {
    const dirty = [...this.dirtyFaces];
    if (!this.texture) return dirty;
    if (!dirty.length && (!renderer || this._rendererRevisions.get(renderer) === this.revision)) return dirty;
    if (!renderer) {
      // Offline callers/baker: defer one complete upload until first use.
      this.texture.needsUpdate = true;
    } else {
      const properties = renderer.properties.get(this.texture);
      const missed = this._rendererRevisions.get(renderer) !== this._uploadedRevision;
      if (missed || !dirty.length) this.texture.needsUpdate = true;
      if (missed || !dirty.length || !properties.__webglTexture || properties.__version !== this.texture.version) {
        renderer.initTexture(this.texture); // initial allocation or restoration
      } else {
        // three r160 has no array-layer update API. Preserve GL state and upload
        // only changed rectangles, once per face/bank per frame. CPU backing
        // memory remains authoritative for context restoration and other renderers.
        const gl = renderer.getContext();
        const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
        const fields = [gl.UNPACK_ALIGNMENT, gl.UNPACK_ROW_LENGTH, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_IMAGES, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL];
        const previous = fields.map((key) => gl.getParameter(key));
        try {
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, properties.__webglTexture);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.side);
          gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, this.side * 2); gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          for (const face of dirty) {
            const b = this.dirtyBounds[face] ?? { x0: 0, y0: 0, x1: this.resolution, y1: this.resolution };
            gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, b.x0);
            for (let bank = 0; bank < 2; bank++) {
              gl.pixelStorei(gl.UNPACK_SKIP_ROWS, b.y0 + bank * this.side);
              gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, b.x0, b.y0 + bank * this.side, face,
                b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, 1, gl.RGBA, gl.FLOAT, this.faceGPU[face]);
            }
          }
        } finally {
          fields.forEach((key, i) => gl.pixelStorei(key, previous[i]));
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, previousTexture);
        }
      }
    }
    if (renderer) this._rendererRevisions.set(renderer, this.revision);
    this._uploadedRevision = this.revision;
    this.dirtyFaces.clear(); this.dirtyBounds = [];
    return dirty;
  }
  clear() {
    this.faces.forEach((data, face) => { data.fill(0); this.faceGPU[face].fill(0); this.dirtyFaces.add(face); });
    this.dirtyBounds = [];
    this.maxHeight = 0; this.nonzeroCount = 0;
    this._changed(false);
  }

  serialize() {
    if (this._serialized) return { ...this._serialized };
    const nonempty = this.tiles.filter(({ face, x, y, x1, y1 }) => {
      const data = this.faces[face];
      for (let py = y; py <= y1; py++) for (let px = x; px <= x1; px++) {
        const i = (py * this.side + px) * CHANNELS;
        for (let c = 0; c < CHANNELS; c++) if (data[i + c] !== 0) return true;
      }
      return false;
    });
    const bytes = new Uint8Array(4 + nonempty.length * RECORD_BYTES), view = new DataView(bytes.buffer);
    view.setUint32(0, nonempty.length, true);
    let offset = 4;
    for (const { face, x, y } of nonempty) {
      bytes[offset++] = face; bytes[offset++] = x / TILE; bytes[offset++] = y / TILE;
      for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) for (let c = 0; c < CHANNELS; c++) {
        const value = x + px < this.side && y + py < this.side ? this.faces[face][((y + py) * this.side + x + px) * CHANNELS + c] : 0;
        view.setFloat32(offset, value, true); offset += 4;
      }
    }
    this._serialized = { version: 1, mapping: 'cube-vertices', resolution: this.resolution, encoding: 'sparse-zlib-f32le', data: toBase64(zlibSync(bytes, { level: 6 })) };
    return { ...this._serialized };
  }

  load(document) {
    if (document == null) { this.clear(); return; }
    if (document.version !== 1 || document.mapping !== 'cube-vertices' || document.encoding !== 'sparse-zlib-f32le' || !validResolution(document.resolution) || typeof document.data !== 'string' || document.data.length > 24 * 1024 * 1024) throw new Error('Unsupported or malformed paint document.');
    const countMax = 6 * Math.ceil((document.resolution + 1) / TILE) ** 2;
    // Fixed output capacity prevents compression bombs from allocating unbounded memory.
    const bytes = unzlibSync(fromBase64(document.data), { out: new Uint8Array(4 + countMax * RECORD_BYTES) });
    if (bytes.length < 4) throw new Error('Truncated paint document.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(0, true);
    if (count > countMax || bytes.length !== 4 + count * RECORD_BYTES) throw new Error('Invalid paint tile count.');
    const records = [], seen = new Set();
    let offset = 4;
    for (let i = 0; i < count; i++) {
      const face = bytes[offset++], x = bytes[offset++] * TILE, y = bytes[offset++] * TILE, id = `${face}/${x}/${y}`;
      if (face > 5 || x > document.resolution || y > document.resolution || seen.has(id)) throw new Error('Invalid paint tile.');
      seen.add(id);
      const data = new Float32Array(TILE * TILE * CHANNELS);
      for (let j = 0; j < data.length; j++) {
        const value = view.getFloat32(offset, true); offset += 4;
        if (!Number.isFinite(value) || (j % CHANNELS !== 0 && (value < 0 || value > 1)) || Math.abs(value) > 1e7) throw new Error('Invalid paint sample.');
        data[j] = value;
      }
      records.push({ face, x, y, data });
    }
    // Validate everything before mutating live layers.
    if (count === 0) {
      this.clear();
      if (!this.faces.length) { this.resolution = document.resolution; this.side = this.resolution + 1; this.uniforms.uPaintResolution.value = this.resolution; }
      this._serialized = { ...document }; return;
    }
    if (!this.faces.length || this.resolution !== document.resolution) this._allocate(document.resolution);
    else this.clear();
    for (const { face, x, y, data } of records) for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) {
      if (x + px >= this.side || y + py >= this.side) continue;
      for (let c = 0; c < CHANNELS; c++) this._write(face, (y + py) * this.side + x + px, c, data[(py * TILE + px) * CHANNELS + c]);
    }
    this._changed(count > 0);
    this._serialized = { ...document };
  }
  dispose() { this.textures.forEach((t) => t.dispose()); }
}
