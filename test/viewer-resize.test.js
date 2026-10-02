import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlanetViewer } from '../src/engine/PlanetViewer.js';

function viewerStub() {
  const viewer = Object.create(PlanetViewer.prototype);
  const size = new THREE.Vector2(390, 500);
  const calls = [];
  viewer.renderer = {
    domElement: { clientWidth: 390, clientHeight: 210 },
    getSize: (target) => target.copy(size),
    setSize: vi.fn((w, h) => { size.set(w, h); calls.push('resize'); }),
  };
  viewer.camera = { aspect: 390 / 500, updateProjectionMatrix: vi.fn() };
  viewer._viewportSize = new THREE.Vector2();
  viewer._clock = { getDelta: () => 0.016 };
  viewer._applyControlLimits = () => {};
  viewer._renderFrame = vi.fn(() => calls.push('render'));
  viewer._frames = 0;
  viewer._fpsTime = performance.now();
  return { viewer, calls };
}

describe('viewer resize without blank frames', () => {
  it('resizes immediately before drawing and leaves unchanged buffers intact', () => {
    const { viewer, calls } = viewerStub();
    viewer._tick();
    viewer._tick();
    expect(calls).toEqual(['resize', 'render', 'render']);
    expect(viewer.camera.aspect).toBe(390 / 210);
  });

  it('redraws a manually resized viewer without advancing the simulation', () => {
    const { viewer, calls } = viewerStub();
    viewer.renderOnce();
    expect(calls).toEqual(['resize', 'render']);
    expect(viewer._renderFrame).toHaveBeenCalledWith(0);
  });

  it('keeps the drawing buffer when a container is temporarily hidden', () => {
    const { viewer } = viewerStub();
    viewer.renderer.domElement.clientHeight = 0;
    viewer._resize();
    expect(viewer.renderer.setSize).not.toHaveBeenCalled();
    expect(viewer.camera.updateProjectionMatrix).not.toHaveBeenCalled();
  });

  it('restores the camera aspect after a screenshot even if the buffer already fits', () => {
    const { viewer } = viewerStub();
    viewer.renderer.domElement.clientHeight = 500;
    viewer.camera.aspect = 1920 / 1080;
    viewer._resize();
    expect(viewer.renderer.setSize).not.toHaveBeenCalled();
    expect(viewer.camera.aspect).toBe(390 / 500);
    expect(viewer.camera.updateProjectionMatrix).toHaveBeenCalledOnce();
  });
});
