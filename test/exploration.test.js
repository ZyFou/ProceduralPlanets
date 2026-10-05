import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Planet, PlanetRenderer } from '../src/lib/index.js';
import { AU, LIGHT_YEAR, SECTOR_SIZE, MAX_BODIES, MAX_SYSTEMS, MIN_SPEED, generateSystem, nearbySystems, desiredBodies, position, translate, relative, length, clearanceRadius, formatDistance } from '../src/exploration/world.js';
import { Flight, clampSpeed, coordinateTravelBudget, movement, wheelSpeed, safeTravel, bindFlightInput } from '../src/exploration/flight.js';
import { SystemStream } from '../src/exploration/streaming.js';

const zero = () => position();
const rock = (p = position()) => ({ id: 'test', position: p, radius: 100, type: 'terrestrial', params: { heightScale: 4 } });

describe('deterministic, physically scaled systems', () => {
  it('regenerates identical data regardless of discovery order or signed sector', () => {
    const sector = { x: -402, y: 82, z: 19 };
    const before = generateSystem('42', sector);
    nearbySystems('other', zero());
    expect(generateSystem('42', sector)).toEqual(before);
    expect(generateSystem('43', sector)).not.toEqual(before);
    expect(generateSystem('42', { ...sector, z: 20 })).not.toEqual(before);
  });
  it('has stellar and planetary diversity with separated astronomical orbits', () => {
    const presets = new Set();
    for (let seed = 0; seed < 80; seed++) {
      const system = generateSystem(seed, { x: 0, y: 0, z: 0 });
      presets.add(system.star.preset);
      expect(system.bodies.length).toBeGreaterThanOrEqual(5);
      let previous = system.star.radius;
      for (const body of system.bodies.slice(1)) {
        presets.add(body.preset);
        expect(body.orbit).toBeGreaterThan(previous * 1.4);
        expect(body.orbit).toBeGreaterThan(AU * 0.2);
        expect(body.radius).toBeGreaterThan(2000);
        expect(body.radius).toBeLessThan(75000);
        const packageBody = new Planet({ preset: body.preset, radius: 2000, seed: body.seed, ...body.params });
        packageBody.scale.setScalar(body.radius / 2000);
        expect(packageBody.params.radius * packageBody.scale.x).toBeCloseTo(body.radius, 6);
        packageBody.dispose();
        previous = body.orbit;
      }
    }
    for (const preset of ['sun', 'ember', 'blueGiant', 'redGiant', 'whiteDwarf', 'terran', 'moon', 'ringed', 'iceGiant']) expect(presets.has(preset)).toBe(true);
  });
});

describe('floating coordinates', () => {
  it('normalizes positive and negative sector crossings and large jumps', () => {
    const p = translate(zero(), { x: SECTOR_SIZE * 19.3, y: -SECTOR_SIZE * 4.9, z: SECTOR_SIZE * 0.5 });
    expect(p.sector).toEqual({ x: 19, y: -5, z: 1 });
    expect(relative(p, zero()).x).toBeCloseTo(SECTOR_SIZE * 19.3, -1);
    expect(p.offset.z).toBe(-SECTOR_SIZE / 2);
    const back = translate(p, { x: -SECTOR_SIZE * 19.3, y: SECTOR_SIZE * 4.9, z: -SECTOR_SIZE * 0.5 });
    expect(length(relative(back, zero()))).toBeLessThan(0.01);
  });
  it('retains millimetre travel in a huge sector with a light-year local offset', () => {
    const origin = position({ x: 8_000_000_000, y: -50, z: 80 }, { x: LIGHT_YEAR, y: 0, z: 0 });
    let moved = origin;
    for (let i = 0; i < 1000; i++) moved = translate(moved, { x: 0.000001, y: 0, z: 0 });
    expect(relative(moved, origin).x).toBeCloseTo(0.001, 12);
    const nearby = translate(origin, { x: 6371, y: 5, z: 7 });
    expect(relative(nearby, moved).x).toBeCloseTo(6370.999, 10);
  });
  it('retains fine distances across a sector boundary', () => {
    const origin = position({ x: 123456789, y: 0, z: 0 }, { x: SECTOR_SIZE / 2 - 0.01, y: 0, z: 0 });
    const crossed = translate(origin, { x: 0.023456, y: 0, z: 0 });
    expect(crossed.sector.x).toBe(origin.sector.x + 1);
    expect(relative(crossed, origin).x).toBeCloseTo(0.023456, 12);
    expect(relative(origin, crossed).x).toBeCloseTo(-0.023456, 12);
  });
  it('formats physical units readably', () => {
    expect(formatDistance(0.001)).toBe('1.0 m');
    expect(formatDistance(AU)).toBe('1.000 AU');
    expect(formatDistance(LIGHT_YEAR)).toBe('1.00 ly');
  });
});

describe('free flight and controlled approach', () => {
  it('supports physical WASD and AZERTY ZQSD, with normalized diagonals', () => {
    expect(movement(new Set(['KeyW', 'KeyD'])).length()).toBeCloseTo(1);
    expect(movement(new Set(['KeyZ', 'KeyQ']), 'azerty')).toEqual(movement(new Set(['KeyW', 'KeyA'])));
    expect(movement(new Set(['KeyW', 'KeyS'])).length()).toBe(0);
    expect(movement(new Set(['Space'])).y).toBe(1);
    expect(movement(new Set(['ControlRight'])).y).toBe(-1);
  });
  it('adjusts speed exponentially with no policy ceiling and finite saturation', () => {
    expect(wheelSpeed(100, -120)).toBe(200);
    expect(wheelSpeed(100, 120)).toBe(50);
    expect(wheelSpeed(Number.MAX_VALUE, -5000)).toBe(Number.MAX_VALUE);
    expect(wheelSpeed(MIN_SPEED, 5000)).toBe(MIN_SPEED);
  });
  it('prevents tunnelling and permits tangent travel and retreat', () => {
    const body = rock();
    const start = position(undefined, { x: -1000, y: 0, z: 0 });
    const end = safeTravel(start, { x: 1e10, y: 0, z: 0 }, [body]);
    expect(end.offset.x).toBeLessThan(-clearanceRadius(body));
    expect(end.offset.x).toBeGreaterThan(-clearanceRadius(body) - 0.01);
    expect(safeTravel(start, { x: 0, y: 100, z: 0 }, [body]).offset.y).toBe(100);
    expect(safeTravel(end, { x: -20, y: 0, z: 0 }, [body]).offset.x).toBeLessThan(end.offset.x);
  });
  it('brakes near surfaces without Shift and bounds resumed frame time', () => {
    const body = rock(position(undefined, { x: 0, y: 0, z: -200 }));
    const flight = new Flight(zero(), new PerspectiveCamera());
    flight.speed = LIGHT_YEAR * 100;
    flight.keys = new Set(['KeyW']);
    flight.step(100, [body]);
    expect(flight.limited).toBe(true);
    expect(flight.actualSpeed).toBeLessThan(50);
    expect(Math.abs(flight.position.offset.z)).toBeLessThan(3);
  });
  it.each(['ShiftLeft', 'ShiftRight'])('bypasses proximity braking at full boost with %s', shift => {
    const body = rock(position(undefined, { x: 0, y: 0, z: -200 }));
    const flight = new Flight(zero(), new PerspectiveCamera());
    flight.speed = 100; flight.keys = new Set(['KeyD', shift]);
    flight.step(.05, [body]);
    expect(flight.limited).toBe(false); expect(flight.blocked).toBe(false);
    expect(flight.actualSpeed).toBeCloseTo(2000);
    flight.keys = new Set(['KeyD']); flight.step(.05, [body]);
    expect(flight.limited).toBe(true);
  });
  it('retains swept collision protection at boosted speed', () => {
    const body = rock(position(undefined, { x: 0, y: 0, z: -200 }));
    const flight = new Flight(zero(), new PerspectiveCamera());
    flight.speed = LIGHT_YEAR * 100; flight.keys = new Set(['KeyW', 'ShiftLeft']);
    flight.step(100, [body]);
    expect(flight.limited).toBe(false); expect(flight.blocked).toBe(true);
    expect(length(relative(body.position, flight.position))).toBeGreaterThan(clearanceRadius(body));
  });
  it('cancels approach if another body obstructs the segment', () => {
    const target = rock(position(undefined, { x: 100000, y: 0, z: 0 }));
    const obstacle = rock(position(undefined, { x: 1000, y: 0, z: 0 }));
    const flight = new Flight(zero(), new PerspectiveCamera());
    flight.approaching = target;
    flight.step(0.05, [target, obstacle]);
    expect(flight.blocked).toBe(true);
    expect(flight.approaching).toBe(null);
    expect(flight.position.offset.x).toBeLessThan(1000 - clearanceRadius(obstacle));
  });
  it('approaches smoothly to an orbital distance, and manual controls cancel it', () => {
    const body = rock(position(undefined, { x: 100_000, y: 0, z: 0 }));
    const flight = new Flight(zero(), new PerspectiveCamera());
    flight.approaching = body;
    for (let i = 0; i < 500; i++) flight.step(0.05, [body]);
    expect(flight.approaching).toBe(null);
    expect(length(relative(body.position, flight.position))).toBeCloseTo(260, 0);
    flight.approaching = body; flight.mouse(1, 1);
    expect(flight.approaching).toBe(null);
    flight.approaching = body; flight.keys.add('KeyD'); flight.step(0.016, [body]);
    expect(flight.approaching).toBe(null);
  });
});

describe('bounded progressive streaming and cleanup', () => {
  it('loads a real-scale first system, creates one resource per tick, and releases obsolete queues', () => {
    const create = vi.fn(body => ({ id: body.id }));
    const release = vi.fn();
    const stream = new SystemStream('42', { create, release });
    const home = generateSystem('42', zero().sector);
    stream.discover(home.bodies[1].position);
    stream.tick();
    expect(create).toHaveBeenCalledOnce();
    expect(stream.entries.size).toBe(1);
    for (let i = 0; i < 40; i++) stream.tick();
    expect(stream.entries.size).toBeLessThanOrEqual(MAX_BODIES);
    expect(stream.systems.length).toBe(MAX_SYSTEMS);
    const oldIds = new Set(stream.entries.keys());
    const far = position({ x: -200, y: 400, z: 80 });
    stream.discover(far);
    expect(release.mock.calls.length).toBe(oldIds.size);
    for (let i = 0; i < 40; i++) stream.tick();
    expect([...stream.entries.keys()].some(id => oldIds.has(id))).toBe(false);
    const live = stream.entries.size;
    stream.dispose(); stream.dispose(); stream.tick();
    expect(release.mock.calls.length).toBe(oldIds.size + live);
    expect(stream.entries.size).toBe(0);
    expect(stream.queue).toHaveLength(0);
  });
  it('bounds residency during hundreds of sector jumps and recreates identical data on return', () => {
    const resources = new Set();
    const stream = new SystemStream('42', { create: body => { resources.add(body.id); return body.id; }, release: id => resources.delete(id) });
    const original = nearbySystems('42', zero());
    for (let i = 0; i < 250; i++) {
      const p = position({ x: i, y: -i, z: i % 5 });
      stream.discover(p);
      for (let j = 0; j < 16; j++) stream.tick();
      expect(resources.size).toBeLessThanOrEqual(MAX_BODIES);
      expect(stream.systems.length).toBe(MAX_SYSTEMS);
    }
    stream.discover(zero());
    expect(stream.systems).toEqual(original);
    stream.dispose();
    expect(resources.size).toBe(0);
  });
  it('loads a targeted remote planet without expanding the resource budget', () => {
    const systems = nearbySystems('42', zero());
    const target = systems[3].bodies[2];
    const selected = desiredBodies(systems, zero(), target.id);
    expect(selected.some(e => e.body.id === target.id)).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(MAX_BODIES);
  });
  it('sweeps cached impostors even when no body is visible', () => {
    const renderer = Object.create(PlanetRenderer.prototype);
    renderer.renderer = { getRenderTarget: () => null, getDrawingBufferSize: size => size.set(800, 600) };
    renderer.info = {}; renderer._frame = 200; renderer._list = [];
    renderer.options = { autoUpdate: false };
    renderer.pipeline = { setSize: vi.fn() };
    renderer._impostors = { sweep: vi.fn() };
    renderer.render([], new PerspectiveCamera());
    expect(renderer._impostors.sweep).toHaveBeenCalledWith(81);
  });
  it('releases the package atlas immediately without disposing a caller-owned planet', () => {
    const renderer = Object.create(PlanetRenderer.prototype);
    const planet = { dispose: vi.fn() };
    renderer._list = [planet];
    renderer._impostors = { release: vi.fn() };
    renderer.release(planet);
    expect(renderer._impostors.release).toHaveBeenCalledWith(planet);
    expect(renderer._list).toHaveLength(0);
    expect(planet.dispose).not.toHaveBeenCalled();
  });
});

describe('capture ownership and event cleanup', () => {
  it('double-clicks the pointed body across pointer capture and removes the handler on disposal', () => {
    const doc = new EventTarget(); doc.defaultView = new EventTarget();
    doc.exitPointerLock = vi.fn();
    const canvas = new EventTarget(); canvas.ownerDocument = doc;
    canvas.requestPointerLock = vi.fn(() => { doc.pointerLockElement = canvas; });
    const body = rock(); const onPick = vi.fn(() => body), onTeleport = vi.fn();
    const dispose = bindFlightInput(canvas, new Flight(zero(), new PerspectiveCamera()), { onPick, onTeleport });
    const click = new Event('click'); Object.assign(click, { detail: 1, clientX: 50, clientY: 60 });
    canvas.dispatchEvent(click);
    expect(onPick).toHaveBeenCalledWith(click);
    const second = new Event('click'); Object.assign(second, { detail: 2 });
    canvas.dispatchEvent(second); canvas.dispatchEvent(new Event('dblclick'));
    expect(onPick).toHaveBeenCalledOnce(); expect(onTeleport).toHaveBeenCalledWith(body);
    onPick.mockReturnValue(null);
    canvas.dispatchEvent(click); canvas.dispatchEvent(new Event('dblclick'));
    expect(onTeleport).toHaveBeenCalledOnce();
    dispose(); canvas.dispatchEvent(new Event('dblclick'));
    expect(onTeleport).toHaveBeenCalledOnce();
  });
  it('ignores uncaptured editor keys, clears stuck keys on unlock/blur, and removes listeners', () => {
    const win = new EventTarget();
    const doc = new EventTarget(); doc.defaultView = win;
    const canvas = new EventTarget(); canvas.ownerDocument = doc; canvas.clientHeight = 600;
    doc.exitPointerLock = vi.fn(() => { doc.pointerLockElement = null; });
    canvas.requestPointerLock = vi.fn();
    const flight = new Flight(zero(), new PerspectiveCamera());
    const onLock = vi.fn(), onPick = vi.fn();
    const dispose = bindFlightInput(canvas, flight, { onLock, onPick });
    const key = (type, code) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { code }); doc.dispatchEvent(e); return e; };
    key('keydown', 'KeyW'); expect(flight.keys.size).toBe(0);
    doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange'));
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(true);
    expect(flight.keys.has('KeyW')).toBe(true);
    flight.clear(); flight.layout = 'azerty';
    const azerty = new Event('keydown', { cancelable: true });
    Object.assign(azerty, { code: 'KeyW', key: 'z' }); doc.dispatchEvent(azerty);
    expect(movement(flight.keys, flight.layout).z).toBe(-1);
    flight.clear(); flight.layout = 'wasd';
    key('keydown', 'KeyF'); expect(onPick).toHaveBeenCalledOnce();
    doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange'));
    expect(flight.keys.size).toBe(0);
    flight.approaching = rock(); key('keydown', 'Escape');
    expect(flight.approaching).toBe(null);
    doc.pointerLockElement = canvas; key('keydown', 'Space'); win.dispatchEvent(new Event('blur'));
    expect(flight.keys.size).toBe(0); expect(doc.exitPointerLock).toHaveBeenCalled();
    dispose(); doc.pointerLockElement = canvas; key('keydown', 'KeyW');
    expect(flight.keys.size).toBe(0);
    canvas.dispatchEvent(new Event('click'));
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });
});

describe('unrestricted speed within representable coordinates', () => {
  it('accepts speeds far above the former 0.25 ly/s ceiling and rejects NaN', () => {
    expect(clampSpeed(LIGHT_YEAR * 5000)).toBe(LIGHT_YEAR * 5000);
    expect(wheelSpeed(LIGHT_YEAR, -120)).toBe(LIGHT_YEAR * 2);
    expect(clampSpeed(NaN)).toBe(MIN_SPEED);
    expect(clampSpeed(Infinity)).toBe(Number.MAX_VALUE);
  });
  it('bounds displacement, not the speed setting, at the integer-sector boundary', () => {
    const flight = new Flight(zero(), new PerspectiveCamera());
    flight.speed = Number.MAX_VALUE; flight.keys.add('KeyD');
    flight.step(.05, []);
    expect(flight.coordinateLimited).toBe(true);
    expect(Number.isSafeInteger(flight.position.sector.x)).toBe(true);
    expect(Number.isFinite(flight.actualSpeed)).toBe(true);
    expect(flight.position.sector.x).toBeGreaterThan(1e12);
    expect(Math.abs(flight.position.offset.x)).toBeLessThanOrEqual(SECTOR_SIZE / 2);
    expect(coordinateTravelBudget(flight.position, { x: -1, y: 0, z: 0 })).toBeGreaterThan(0);
    flight.keys = new Set(['KeyA']); flight.speed = 1;
    const before = flight.position; flight.step(.05, []);
    expect(relative(flight.position, before).x).toBeCloseTo(-.05, 10);
    expect(() => translate(zero(), {x:Infinity,y:0,z:0})).toThrow(/finite/);
  });
});
