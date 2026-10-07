import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Planet } from '../src/lib/index.js';
import { fitPlanetCamera } from '../src/engine/planetCamera.js';
import { PlanetPipeline } from '../src/engine/PlanetPipeline.js';
import { faceDir } from '../src/engine/PlanetWorld.js';

function setup(scale, altitude, yaw = 0) {
  const planet = new Planet({ radius: 2000, heightScale: 3, maxDepth: 6, cloudsEnabled: false });
  planet.position.set(7000000, -4000000, 2000000);
  planet.rotation.set(.3, -.5, .15); planet.scale.setScalar(scale); planet.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(65, 2, .001, 1e15);
  const localEye = new THREE.Vector3(0, 0, 2000 + altitude);
  camera.position.copy(localEye).applyMatrix4(planet.matrixWorld);
  camera.up.set(0, 1, 0).transformDirection(planet.matrixWorld);
  camera.lookAt(planet.position); camera.rotateY(yaw); camera.updateMatrixWorld(true);
  const proxy = new THREE.PerspectiveCamera(); fitPlanetCamera(planet, camera, proxy);
  return { planet, camera, proxy, localEye };
}

describe('shared renderer cameras at real-world scales', () => {
  it('preserves metre-scale walking near planes on kilometre-scale planets', () => {
    const { planet, camera, proxy } = setup(3.1855, 2);
    camera.near = .00017;
    camera.userData.surfaceWalk = true;
    fitPlanetCamera(planet, camera, proxy);
    expect(proxy.near).toBeCloseTo(camera.near / 3.1855, 10);
    expect(proxy.near).toBeLessThan(.001);
    delete camera.userData.surfaceWalk;
    fitPlanetCamera(planet, camera, proxy);
    expect(proxy.near).toBeGreaterThanOrEqual(.05);
    planet.dispose();
  });
  it.each([.0031, 1, 3.1855042, 349.85, 10000])('keeps a rigid local view, local clip distances and aligned projections at scale %s', scale => {
    const { planet, camera, proxy, localEye } = setup(scale, 100, .6);
    expect(new THREE.Vector3().setFromMatrixPosition(proxy.matrixWorld).distanceTo(localEye)).toBeLessThan(1e-6);
    expect(proxy.matrixWorld.getMaxScaleOnAxis()).toBeCloseTo(1, 12);
    const vertex = new THREE.Vector3(300, 120, 1960);
    const expected = vertex.clone().applyMatrix4(planet.matrixWorld).project(camera);
    const actual = vertex.clone().project(proxy);
    expect(actual.x).toBeCloseTo(expected.x, 7); expect(actual.y).toBeCloseTo(expected.y, 7);
    const pipeline = { width: 960, height: 640 };
    const rect = PlanetPipeline.prototype.screenRect.call(pipeline, proxy, planet.boundingRadius, new THREE.Vector4());
    expect(rect).not.toBe(false);
    planet.dispose();
  });
  it('preserves non-uniform scaled objects rather than changing their screen shape', () => {
    const { planet, camera, proxy } = setup(2, 100);
    planet.scale.set(2, 1.2, 4); planet.updateMatrixWorld(true);
    fitPlanetCamera(planet, camera, proxy);
    for (const point of [new THREE.Vector3(0,0,2000),new THREE.Vector3(500,350,1500)]) {
      const expected=point.clone().applyMatrix4(planet.matrixWorld).project(camera),actual=point.clone().project(proxy);
      expect(actual.x).toBeCloseTo(expected.x,7);expect(actual.y).toBeCloseTo(expected.y,7);
    }
    planet.dispose();
  });
  it('keeps terrain ahead of an oblique surface view that the former distance-only near plane clipped', () => {
    const { planet, proxy } = setup(3.964, 30, 1.1);
    // Find ground samples inside the horizontal/vertical view, in front of
    // the eye, but closer than the old near distance (21.6 local units).
    const oldNear = planet._clipPlanes(2030)[0];
    let formerlyClipped = 0;
    for (let x = -.04; x <= .04; x += .001) for (let y = -.04; y <= .04; y += .001) {
      const point = new THREE.Vector3(x, y, 1).normalize().multiplyScalar(2000);
      const view = point.clone().applyMatrix4(proxy.matrixWorldInverse);
      const projected = point.clone().project(proxy);
      if (view.z < -proxy.near && -view.z < oldNear && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1) {
        formerlyClipped++; expect(projected.z).toBeGreaterThan(-1); expect(projected.z).toBeLessThan(1);
      }
    }
    expect(formerlyClipped).toBeGreaterThan(0);
    planet.dispose();
  });
  it('retains every visible unculled cap during near-surface yaw and pitch sweeps', () => {
    const { planet, proxy, localEye } = setup(3.1855, 25);
    const world = planet.world;
    for (const pitch of [-.35, 0, .35]) for (const yaw of [-1.2, -.6, 0, .6, 1.2]) {
      proxy.matrixWorld.makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')).setPosition(localEye);
      proxy.matrixWorldInverse.copy(proxy.matrixWorld).invert();
      world.update(localEye);
      const unculled = [...world.chunks.values()];
      world.update(localEye, proxy);
      for (const node of unculled) {
        let visible = false;
        for (const u of [0, .5, 1]) for (const v of [0, .5, 1]) {
          const direction = faceDir(node.f, node.u0 + u * node.size, node.v0 + v * node.size);
          const point = new THREE.Vector3(...direction).multiplyScalar(2000);
          const towardEye = localEye.clone().sub(point);
          const projected = point.clone().project(proxy);
          if (point.dot(towardEye) > 0 && projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1) visible = true;
        }
        if (visible) expect(world.chunks.has(node.key), `visible ${node.key} yaw=${yaw},pitch=${pitch}`).toBe(true);
      }
    }
    planet.dispose();
  });
  it('keeps usable depth precision with a wide shifted lens while retaining foreground', () => {
    const { planet, camera, proxy } = setup(3.1855, 30, 1.1);
    camera.fov = 110; camera.aspect = 3.2; camera.zoom = .75; camera.filmOffset = 4;
    camera.updateProjectionMatrix(); fitPlanetCamera(planet, camera, proxy);
    expect(proxy.near).toBeGreaterThan(1);
    let visible = 0;
    for (let x = -.12; x <= .12; x += .002) for (let y = -.12; y <= .12; y += .002) {
      const point = new THREE.Vector3(x, y, 1).normalize().multiplyScalar(2000);
      const hostProjection = point.clone().applyMatrix4(planet.matrixWorld).project(camera);
      if (Math.abs(hostProjection.x) < 1 && Math.abs(hostProjection.y) < 1 && point.clone().applyMatrix4(proxy.matrixWorldInverse).z < 0) {
        visible++; expect(point.clone().project(proxy).z).toBeGreaterThan(-1);
      }
    }
    expect(visible).toBeGreaterThan(0); planet.dispose();
  });
});
