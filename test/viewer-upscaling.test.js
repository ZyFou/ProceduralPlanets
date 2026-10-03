import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlanetViewer } from '../src/engine/PlanetViewer.js';
import { Planet, normalizeParam } from '../src/engine/Planet.js';
import { searchSettings } from '../src/components/settingsSearch.js';
import { snippetParams } from '../src/project/codeSnippet.js';

function viewerStub(scale = 0.5) {
  const viewer = Object.create(PlanetViewer.prototype);
  let target = null;
  viewer.renderer = {
    info: { reset: vi.fn() },
    getDrawingBufferSize: (v) => v.set(1600, 900),
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((rt) => { target = rt; }),
    render: vi.fn(),
    autoClear: true,
  };
  viewer.planet = { params: { renderResolution: scale, upscaler: 'bilinear' } };
  viewer.planetRenderer = { render: vi.fn(), pending: 0 };
  viewer.camera = {};
  viewer._afterFrame = [];
  viewer._drawingSize = new THREE.Vector2();
  return viewer;
}

describe('viewer resolution and upscaling', () => {
  it('reduces all pipeline passes while keeping the output at display resolution', () => {
    const viewer = viewerStub();
    viewer._renderFrame(0.016);
    const upscaler = viewer._upscaler;
    expect([upscaler.target.width, upscaler.target.height]).toEqual([800, 450]);
    expect(viewer.planetRenderer.render).toHaveBeenCalledWith(viewer.planet, viewer.camera, { target: upscaler.target, delta: 0.016 });
    expect(viewer.renderer.render).toHaveBeenCalledWith(upscaler.scene, upscaler.camera);
    expect(viewer.renderer.getRenderTarget()).toBeNull();
    expect(viewer.renderer.autoClear).toBe(true);
    viewer._upscaler.dispose();
  });

  it('switches algorithms without reallocating and resizes with the drawing buffer (including DPR)', () => {
    const viewer = viewerStub();
    viewer._renderFrame(0);
    const upscaler = viewer._upscaler;
    const resized = vi.spyOn(upscaler.target, 'setSize');
    viewer.planet.params.upscaler = 'spatial';
    viewer._renderFrame(0);
    expect(resized).not.toHaveBeenCalled();
    expect(upscaler.material.uniforms.uSpatial.value).toBe(true);
    viewer.renderer.getDrawingBufferSize = (v) => v.set(780, 420);
    viewer._renderFrame(0);
    expect([upscaler.target.width, upscaler.target.height]).toEqual([390, 210]);
    viewer._upscaler.dispose();
  });

  it('keeps the previous frame while offscreen shaders compile', () => {
    const viewer = viewerStub();
    viewer.planetRenderer.pending = 1;
    viewer._renderFrame(0);
    expect(viewer.renderer.render).not.toHaveBeenCalled();
    viewer._upscaler.dispose();
  });

  it('bypasses scaling for captures, then frees resources when returning to 100%', () => {
    const viewer = viewerStub();
    viewer._renderFrame(0);
    const upscaler = viewer._upscaler;
    const disposals = [upscaler.target, upscaler.material, upscaler.quad.geometry].map((o) => vi.spyOn(o, 'dispose'));
    viewer._renderFrame(0, { native: true });
    expect(viewer.planetRenderer.render).toHaveBeenLastCalledWith(viewer.planet, viewer.camera, { target: null, delta: 0 });
    expect(viewer._upscaler).toBe(upscaler);
    viewer.planet.params.renderResolution = 1;
    viewer._renderFrame(0);
    expect(viewer._upscaler).toBeNull();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it.each([undefined, NaN, Infinity])('uses native resolution for malformed scale %s', (scale) => {
    const viewer = viewerStub();
    viewer.planet.params.renderResolution = scale;
    viewer._renderFrame(0);
    expect(viewer._upscaler).toBeUndefined();
    expect(viewer.planetRenderer.render).toHaveBeenCalledWith(viewer.planet, viewer.camera, { target: null, delta: 0 });
  });
});

describe('performance settings', () => {
  it('validates supported scales and algorithms', () => {
    for (const scale of [0.25, 0.5, 1]) expect(normalizeParam('renderResolution', scale).ok).toBe(true);
    for (const scale of [0, -1, 1.1, NaN, Infinity, '0.5']) expect(normalizeParam('renderResolution', scale).ok).toBe(false);
    for (const method of ['bilinear', 'spatial']) expect(normalizeParam('upscaler', method).ok).toBe(true);
    for (const method of ['unknown', 1, null]) expect(normalizeParam('upscaler', method).ok).toBe(false);
  });

  it('round trips through saved parameters and preserves performance choices across presets', () => {
    const planet = new Planet({ renderResolution: 0.5, upscaler: 'spatial' });
    for (const preset of ['desert', 'ringed', 'sun', 'terran']) {
      planet.applyPreset(preset);
      expect(planet.params).toMatchObject({ renderResolution: 0.5, upscaler: 'spatial' });
    }
    const restored = Planet.fromJSON(planet.serialize());
    expect(restored.params).toMatchObject({ renderResolution: 0.5, upscaler: 'spatial' });
    expect(snippetParams(planet.params)).not.toHaveProperty('renderResolution');
    expect(snippetParams(planet.params)).not.toHaveProperty('upscaler');
    planet.dispose();
    restored.dispose();
  });

  it('finds both settings in quick search', () => {
    expect(searchSettings('render resolution')[0].settingId).toBe('perf.renderResolution');
    expect(searchSettings('spatial')[0].settingId).toBe('perf.upscaler');
  });
});
