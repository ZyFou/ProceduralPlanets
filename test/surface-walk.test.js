import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { Planet } from '../src/engine/Planet.js';
import { SurfaceWalker } from '../src/engine/SurfaceWalker.js';

function fixture() {
  const canvas = new EventTarget();
  canvas.ownerDocument = new EventTarget();
  canvas.ownerDocument.defaultView = new EventTarget();
  const camera = new PerspectiveCamera(); camera.position.set(0, 0, 6000); camera.lookAt(0, 0, 0);
  const planet = new Planet({ radius: 2000, heightScale: 100, waterEnabled: false });
  const walker = new SurfaceWalker(camera, canvas, vi.fn());
  return { walker, camera, planet };
}
describe('surface walking', () => {
  it('captures desktop look, releases it with Escape without leaving the surface, and scales wheel speed', () => {
    const { walker, camera, planet } = fixture();
    const canvas = walker.canvas, doc = canvas.ownerDocument;
    canvas.requestPointerLock = vi.fn(() => { doc.pointerLockElement = canvas; return Promise.resolve(); });
    doc.exitPointerLock = vi.fn(() => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); });
    expect(walker.enter(planet)).toBe(true);
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    const before = walker.heading.clone();
    const mouse = new Event('mousemove'); Object.assign(mouse, { movementX: 100, movementY: 0 }); doc.dispatchEvent(mouse);
    expect(walker.heading.distanceTo(before)).toBeGreaterThan(.1);
    const wheel = new Event('wheel', { cancelable: true }); Object.assign(wheel, { deltaY: -200, deltaMode: 0 }); canvas.dispatchEvent(wheel);
    expect(walker.speedMultiplier).toBeGreaterThan(1); expect(wheel.defaultPrevented).toBe(true);
    const multiplier = walker.speedMultiplier;
    const slower = new Event('wheel'); Object.assign(slower, { deltaY: 100, deltaMode: 0 }); canvas.dispatchEvent(slower);
    expect(walker.speedMultiplier).toBeLessThan(multiplier);
    walker.keys.add('w');
    const escape = new Event('keydown'); Object.assign(escape, { code: 'Escape', key: 'Escape' });
    doc.dispatchEvent(escape);
    expect(walker.active).toBe(true); expect(walker.focused).toBe(false); expect(walker.keys.size).toBe(0);
    walker.focus(); expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    walker.exit(); expect(walker.active).toBe(false); expect(walker.focused).toBe(false);
    expect(camera.position.z).toBe(6000); walker.dispose(); planet.dispose();
  });
  it('keeps touch controls free of pointer lock', () => {
    const { walker, planet } = fixture();
    walker.canvas.ownerDocument.defaultView.matchMedia = () => ({ matches: true });
    walker.canvas.requestPointerLock = vi.fn();
    expect(walker.enter(planet)).toBe(true);
    expect(walker.canvas.requestPointerLock).not.toHaveBeenCalled();
    walker.move = { x: 0, y: -1 }; const before = walker.direction.clone(); walker.step(.05);
    expect(walker.direction.distanceTo(before)).toBeGreaterThan(0);
    walker.dispose(); planet.dispose();
  });
  it('lands at the view ray, follows changing terrain and restores the orbital camera', () => {
    const { walker, camera, planet } = fixture();
    const original = camera.position.clone(), orientation = camera.quaternion.clone();
    expect(walker.enter(planet)).toBe(true);
    expect(walker.direction.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(.0001);
    walker.move = { x: 1, y: -1 };
    for (let i = 0; i < 100; i++) walker.step(.05);
    expect(walker.direction.x).toBeGreaterThan(0);
    expect(walker.direction.y).toBeGreaterThan(0);
    expect(camera.position.length() - planet.getSurfaceRadius(walker.direction)).toBeCloseTo(1.7, 5);
    expect(camera.up.dot(walker.direction)).toBeCloseTo(1);
    planet.setParam('heightScale', 200); walker.step(0);
    expect(camera.position.length() - planet.getSurfaceRadius(walker.direction)).toBeCloseTo(1.7, 5);
    walker.exit(); expect(camera.position.equals(original)).toBe(true); expect(camera.quaternion.equals(orientation)).toBe(true);
    walker.dispose(); planet.dispose();
  });
  it('rejects empty space and bodies without a solid surface', () => {
    const { walker, camera, planet } = fixture();
    camera.lookAt(0, 0, 10000); expect(walker.enter(planet)).toBe(false);
    camera.lookAt(0, 0, 0); planet.setParam('mode', 'gas'); expect(walker.enter(planet)).toBe(false);
    expect(walker.active).toBe(false); walker.dispose(); planet.dispose();
  });
  it('keeps movement local on scaled planets with an offset origin and clears input', () => {
    const { walker, camera, planet } = fixture();
    planet.position.set(100, 0, -200); planet.scale.setScalar(3);
    camera.position.set(100, 0, 18000); camera.lookAt(planet.position);
    expect(walker.enter(planet)).toBe(true); walker.look = { x: 1, y: 100 }; walker.step(.05);
    expect(Math.abs(walker.pitch)).toBeLessThanOrEqual(1.45);
    expect(camera.position.distanceTo(planet.localToWorld(walker.localPosition.clone()))).toBeLessThan(.00001);
    walker.keys.add('w'); walker.clear(); expect(walker.keys.size).toBe(0); expect(walker.look.y).toBe(0);
    planet.setParam('mode', 'star'); walker.step(.01); expect(walker.active).toBe(false);
    walker.dispose(); planet.dispose();
  });
});
