import { PlanetViewer } from './PlanetViewer.js';
import { PlanetExporter } from './PlanetExporter.js';

// ============================================================================
// Engine — the studio's viewport: a PlanetViewer plus the studio-specific
// calls the React UI makes (per-domain presets, star shader editor, export).
// Framework-agnostic: React talks to it via setParam/applyPreset/randomize and
// receives stats through the onStats callback.
// ============================================================================

export class Engine extends PlanetViewer {
  constructor({ canvas, callbacks = {} }) {
    super({ canvas, callbacks });
  }

  get params() { return this.planet.params; }
  get uniforms() { return this.planet.uniforms; }
  get world() { return this.planet.world; }
  get starShaderBody() { return this.planet.starShaderBody; }

  setParam(key, value) {
    this.planet.setParam(key, value);
  }

  /** Apply a planet preset patch; returns the merged params for the UI to mirror. */
  applyPreset(key) {
    this.planet._applyPlanetPreset(key);
    return { ...this.params };
  }

  /** Apply a gas preset patch (gas keys only — planet params untouched). */
  applyGasPreset(key) {
    this.planet.applyPreset(key, { setType: false });
    return { ...this.params };
  }

  /** Apply a star preset patch (star keys only — planet params untouched). */
  applyStarPreset(key) {
    this.planet.applyPreset(key, { setType: false });
    return { ...this.params };
  }

  /**
   * Swap the editable starSurface() body. Compile-checks against the real GL
   * context first; on error the current material stays and {ok:false, error}
   * comes back for the Shader panel to display.
   */
  setStarShader(body) {
    return this.planet.setStarShader(body, this.renderer);
  }

  randomize() {
    return this.planet.randomizeSeed();
  }

  screenshotDataURL(w = 1920, h = 1080) {
    return this.screenshot(w, h);
  }

  async exportPlanet(options = {}, onProgress = () => {}) {
    const wasRunning = this.running;
    if (wasRunning) this.stop();
    try {
      this.renderOnce();
      await PlanetExporter.export(
        this.renderer, this.params, this.uniforms,
        { ...options, starShaderBody: this.starShaderBody },
        onProgress
      );
    } finally {
      if (wasRunning && !this._disposed) this.start();
      this._resize();
    }
  }
}
