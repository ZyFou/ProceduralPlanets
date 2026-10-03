import * as THREE from 'three';

// The viewer's pipeline already tone maps and encodes sRGB. Store those
// display values verbatim and reconstruct them without another colour transform.
const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform sampler2D tSource;
uniform vec2 uSourceSize;
uniform bool uSpatial;
varying vec2 vUv;

// Catmull-Rom reconstruction: sharper than linear interpolation. Clamp to
// the central 2x2 neighbourhood to prevent ringing along bright silhouettes.
vec4 cubicWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(-0.5 * t + t2 - 0.5 * t3,
              1.0 - 2.5 * t2 + 1.5 * t3,
              0.5 * t + 2.0 * t2 - 1.5 * t3,
             -0.5 * t2 + 0.5 * t3);
}

void main() {
  if (!uSpatial) {
    gl_FragColor = texture2D(tSource, vUv);
    return;
  }
  vec2 pixel = vUv * uSourceSize - 0.5;
  vec2 base = floor(pixel);
  vec2 f = fract(pixel);
  vec4 wx = cubicWeights(f.x);
  vec4 wy = cubicWeights(f.y);
  vec3 colour = vec3(0.0);
  vec3 lo = vec3(1.0);
  vec3 hi = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 sampleUv = (base + vec2(float(x - 1), float(y - 1)) + 0.5) / uSourceSize;
      vec3 c = texture2D(tSource, sampleUv).rgb;
      colour += c * wx[x] * wy[y];
      if (x >= 1 && x <= 2 && y >= 1 && y <= 2) {
        lo = min(lo, c);
        hi = max(hi, c);
      }
    }
  }
  gl_FragColor = vec4(clamp(colour, lo, hi), 1.0);
}`;

export class RenderUpscaler {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
      // Intentionally NoColorSpace: these are already display-encoded values.
      colorSpace: THREE.NoColorSpace,
    });
    this.material = new THREE.RawShaderMaterial({
      name: 'pp.upscale',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tSource: { value: this.target.texture },
        uSourceSize: { value: new THREE.Vector2(1, 1) },
        uSpatial: { value: false },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }

  setSize(width, height, scale) {
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    this.material.uniforms.uSourceSize.value.set(w, h);
  }

  render(renderer, method) {
    this.material.uniforms.uSpatial.value = method === 'spatial';
    const previousTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
