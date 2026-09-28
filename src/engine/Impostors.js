import * as THREE from 'three';

// ============================================================================
// Impostors — distant planets drawn from a picture of themselves.
//
// A planet that covers few pixels still costs its full pipeline every frame
// (scene, clouds, composite, weather). Below PlanetRenderer's impostor size it
// is instead rendered — by the very same pipeline, so it looks the same — into
// a slot of a shared HDR atlas, from the current viewpoint, and drawn every
// frame as a billboard: a quad in the capture's image plane through the
// planet's centre, so from the capture point it covers exactly the captured
// image. The capture is refreshed when it goes stale (view or sun direction
// moved, distance / size changed, parameters edited, animation time passed),
// a budgeted few per frame, stalest first.
//
// The billboard writes what the full composite writes: premultiplied colour
// in the output's encoding (the capture is linear HDR; tone mapping happens
// here), depth-tested against the host frame, and — in a second, colour-less
// draw — the solid sphere's per-pixel depth into the host depth buffer.
// ============================================================================

const MIN_SLOT = 32;

const IMPOSTOR_VERTEX = /* glsl */ `
uniform vec3 uCenter;     // planet centre (world)
uniform vec3 uRight;      // capture image plane axes (world, scaled to the half size)
uniform vec3 uUp;
uniform mat4 uWorldToLocal;
varying vec2 vUv;
varying vec3 vLocal;      // quad point in the planet's frame
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vec3 wp = uCenter + uRight * position.x + uUp * position.y;
  vLocal = (uWorldToLocal * vec4(wp, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// shared with the pipeline: embedDepth() from EMBED_GLSL
export function impostorFragment(embedGLSL, tonemapGLSL) {
  return /* glsl */ `
precision highp float;
uniform sampler2D tAtlas;
uniform vec4 uSlot;          // atlas UV rect: x0, y0, w, h
uniform float uTexel;        // one atlas texel (UV)
uniform float uLinearOut;    // 0 tone map + sRGB, 1 linear HDR, 2 tone map (sRGB target encodes)
uniform vec3 uCamLocal;      // camera, planet-local
uniform float uSolidRadius;  // what occludes the host (terrain / sea / cloud tops)
uniform float uDepthOnly;
varying vec2 vUv;
varying vec3 vLocal;
${embedGLSL}
${tonemapGLSL}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec3 rd = normalize(vLocal - uCamLocal);
  float b = dot(uCamLocal, rd);
  float h = b * b - (dot(uCamLocal, uCamLocal) - uSolidRadius * uSolidRadius);
  float surfT = 1e20;
  if (h >= 0.0 && -b + sqrt(h) > 0.0) surfT = max(-b - sqrt(h), 0.0);
  if (uDepthOnly > 0.5) {
    if (surfT > 1e19) discard;
    gl_FragDepth = hostDepth(uCamLocal + rd * surfT);
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragDepth = embedDepth(uCamLocal, rd, surfT);
  // half a texel inside the slot: bilinear taps never reach a neighbour slot
  vec4 c = texture2D(tAtlas, uSlot.xy + clamp(vUv * uSlot.zw, vec2(0.5 * uTexel), uSlot.zw - 0.5 * uTexel));
  if (c.a < 0.002 && max(c.r, max(c.g, c.b)) < 1e-4) discard;
  if (uLinearOut > 0.5 && uLinearOut < 1.5) { gl_FragColor = c; return; }
  vec3 t = aces(c.rgb);
  if (uLinearOut > 1.5) { gl_FragColor = vec4(t, c.a); return; }
  gl_FragColor = vec4(linearToSrgb(t) + (ign(gl_FragCoord.xy) - 0.5) / 255.0 * c.a, c.a);
}
`;
}

// Power-of-two square slots, buddy-allocated in a square atlas.
export class BuddyAllocator {
  constructor(size) {
    this.size = size;
    this.free = new Map([[size, [{ x: 0, y: 0 }]]]);
  }

  alloc(s) {
    let size = s;
    while (size <= this.size && !(this.free.get(size)?.length)) size *= 2;
    if (size > this.size) return null;
    const block = this.free.get(size).pop();
    while (size > s) {
      size /= 2;
      const list = this.free.get(size) ?? [];
      list.push({ x: block.x + size, y: block.y }, { x: block.x, y: block.y + size }, { x: block.x + size, y: block.y + size });
      this.free.set(size, list);
    }
    return { x: block.x, y: block.y, s };
  }

  release({ x, y, s }) {
    let block = { x, y };
    let size = s;
    while (size < this.size) {
      const list = this.free.get(size) ?? [];
      const px = block.x - (block.x % (size * 2));
      const py = block.y - (block.y % (size * 2));
      const buddies = [];
      for (const [bx, by] of [[px, py], [px + size, py], [px, py + size], [px + size, py + size]]) {
        if (bx === block.x && by === block.y) continue;
        const i = list.findIndex((b) => b.x === bx && b.y === by);
        if (i < 0) break;
        buddies.push(i);
      }
      if (buddies.length < 3) {
        list.push(block);
        this.free.set(size, list);
        return;
      }
      buddies.sort((a, b) => b - a).forEach((i) => list.splice(i, 1));
      block = { x: px, y: py };
      size *= 2;
    }
    this.free.set(this.size, [{ x: 0, y: 0 }]);
  }
}

export class ImpostorAtlas {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} size  atlas edge in pixels (power of two)
   * @param {string} fragment  impostorFragment(...) source
   */
  constructor(renderer, maxSize, fragment) {
    this.renderer = renderer;
    this.maxSize = maxSize;
    this.maxSlot = Math.min(256, maxSize);
    this.size = 0;
    this.target = null;
    this.entries = new Map();   // planet -> entry
    // start small (512: 2 MB) and double when full, up to maxSize
    this._allocate(Math.min(512, maxSize));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tAtlas: { value: this.target.texture },   // (re-pointed by _allocate)
        uSlot: { value: new THREE.Vector4() },
        uTexel: { value: 1 / this.size },
        uLinearOut: { value: 0 },
        uCamLocal: { value: new THREE.Vector3() },
        uSolidRadius: { value: 1 },
        uDepthOnly: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uRight: { value: new THREE.Vector3() },
        uUp: { value: new THREE.Vector3() },
        uWorldToLocal: { value: new THREE.Matrix4() },
        // EMBED_GLSL (hostDepth / embedDepth)
        uViewMat: { value: new THREE.Matrix4() },
        uHostProj: { value: new THREE.Matrix4() },
        uLogDepthFC: { value: 0 },
        uBoundRadius: { value: 1 },
        uRingAxis: { value: new THREE.Vector3(0, 1, 0) },
        uRingRange: { value: new THREE.Vector2() },
      },
      vertexShader: IMPOSTOR_VERTEX,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    // same uniforms, depth-only draw of the solid sphere
    this.depthMaterial = new THREE.ShaderMaterial({
      uniforms: this.material.uniforms,
      vertexShader: IMPOSTOR_VERTEX,
      fragmentShader: fragment,
      toneMapped: false,
      colorWrite: false,
      depthWrite: true,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
  }

  _allocate(size) {
    this.target?.dispose();
    this.size = size;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.alloc = new BuddyAllocator(size);
    this.entries.clear();   // every capture is gone: re-captured over the next frames
    if (this.material) {
      this.material.uniforms.tAtlas.value = this.target.texture;
      this.material.uniforms.uTexel.value = 1 / size;
    }
  }

  /** Slot edge for a planet of `radiusPx` screen radius. */
  slotSize(radiusPx) {
    let s = MIN_SLOT;
    while (s < radiusPx * 2.5 && s < this.maxSlot) s *= 2;
    return s;
  }

  entry(planet) { return this.entries.get(planet) ?? null; }

  /** (Re)assign a slot of edge s; null when the atlas is full. */
  ensureSlot(planet, s) {
    let e = this.entries.get(planet);
    if (e?.slot?.s === s) return e;
    if (e?.slot) this.alloc.release(e.slot);
    let slot = this.alloc.alloc(s);
    if (!slot && this.size < this.maxSize) {
      this._allocate(this.size * 2);
      slot = this.alloc.alloc(s);
    }
    if (!slot) {
      this.entries.delete(planet);
      return null;
    }
    e = { slot, valid: false, capture: null };
    this.entries.set(planet, e);
    return e;
  }

  release(planet) {
    const e = this.entries.get(planet);
    if (!e) return;
    this.alloc.release(e.slot);
    this.entries.delete(planet);
  }

  /** Drop the entries of planets not seen since `frame`. */
  sweep(frame) {
    for (const [planet, e] of this.entries) if (e.seen < frame) this.release(planet);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
