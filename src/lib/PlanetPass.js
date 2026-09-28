import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { PlanetRenderer } from '../engine/PlanetRenderer.js';

// ============================================================================
// PlanetPass — draws the Planets of a scene inside an EffectComposer chain.
// Put it right after the RenderPass: it composites onto the composer's read
// buffer (keeping the RenderPass depth, so your geometry still occludes the
// planets) and does not swap. Composer targets are linear HalfFloat, so by
// default the planets are written as linear HDR ('linear' output) and tone
// mapped by your OutputPass like the rest of the scene.
// ============================================================================

export class PlanetPass extends Pass {
  /**
   * @param {THREE.Object3D | Planet[]} scene  what to search for planets
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} [options]  PlanetRenderer options, or { planetRenderer }
   */
  constructor(scene, camera, options = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    const { planetRenderer, ...rendererOptions } = options;
    this.planetRenderer = planetRenderer ?? null;
    this._rendererOptions = { output: 'linear', ...rendererOptions };
  }

  render(renderer, writeBuffer, readBuffer, deltaTime /* , maskActive */) {
    if (!this.planetRenderer) this.planetRenderer = new PlanetRenderer(renderer, this._rendererOptions);
    if (this.renderToScreen && !this._warned) {
      this._warned = true;
      console.warn('[procedural-planets] PlanetPass cannot be the last pass: add an OutputPass after it');
    }
    this.planetRenderer.render(this.scene, this.camera, { target: readBuffer, delta: deltaTime });
  }

  dispose() {
    this.planetRenderer?.dispose();
  }
}
