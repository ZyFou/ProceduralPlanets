import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Planet } from '../src/engine/Planet.js';
import { PlanetPaintLayerManager, PAINT_MATERIALS } from '../src/paint/PlanetPaintLayerManager.js';
import { faceToDirection, directionToFace, sphericalDistance, tangentFrame, offsetDirection, brushWeight } from '../src/paint/sphericalPaintMapping.js';
import { pickPlanetRay } from '../src/paint/PlanetPaintPicker.js';
import { PlanetPaintModeManager } from '../src/paint/PlanetPaintModeManager.js';
import { normalizeProject } from '../src/project/ProjectStore.js';
import { createEditableProjectDocument, readEditableProjectDocument } from '../src/project/ProjectDocument.js';
import { bakeGroup, disposeBaked } from '../src/engine/PlanetBaker.js';
import { createNode, GRAPH_FORMAT, GRAPH_VERSION, createInitialGraph } from '../src/engine/graph/index.js';

const owned = [];
const own = (object) => { owned.push(object); return object; };
afterEach(() => { owned.splice(0).forEach((o) => o.dispose()); vi.unstubAllGlobals(); });
const layers = (resolution = 64) => own(new PlanetPaintLayerManager({ resolution }));
const north = new THREE.Vector3(0, 1, 0), front = new THREE.Vector3(0, 0, 1);
const stamp = (field, patch = {}) => field.stamp({ direction: front, radius: 25, planetRadius: 100, strength: 1, falloff: 0.75, amount: 10, ...patch });
const constantGraph = (value = 0.5) => ({ format: GRAPH_FORMAT, version: GRAPH_VERSION,
  nodes: [createNode('constant', 'constant', { value }), createNode('heightOutput', 'output')],
  edges: [{ id: 'edge', source: 'constant', sourcePort: 'height', target: 'output', targetPort: 'height' }], outputId: 'output' });
const planet = (options = {}) => own(new Planet({ radius: 100, heightScale: 20, waterEnabled: false, cloudsEnabled: false, ...options }));

describe('spherical paint mapping and brushes', () => {
  it('round-trips every cube face, edges and poles', () => {
    for (let face = 0; face < 6; face++) for (const u of [0, 0.2, 0.5, 0.8, 1]) for (const v of [0, 0.35, 1]) {
      const d = faceToDirection(face, u, v), m = directionToFace(d);
      expect(faceToDirection(m.face, m.u, m.v).distanceTo(d)).toBeLessThan(1e-12);
    }
    expect(directionToFace(north).face).toBe(4);
    expect(() => directionToFace(new THREE.Vector3())).toThrow();
  });
  it('uses equal physical brush sizes at poles, equator and cube boundaries', () => {
    const settings = { radius: 25, planetRadius: 100, falloff: 1 };
    for (const center of [north, front, new THREE.Vector3(1, 1, 1).normalize()]) {
      const frame = tangentFrame(center);
      const inside = offsetDirection(center, frame.east, frame.north, 12.5, 0, 100);
      expect(sphericalDistance(center, inside, 100)).toBeCloseTo(12.5, 10);
      expect(brushWeight(inside, center, frame, settings)).toBeCloseTo(0.5, 10);
      const outside = offsetDirection(center, frame.east, frame.north, 26, 0, 100);
      expect(brushWeight(outside, center, frame, settings)).toBe(0);
    }
  });
  it('keeps height and materials continuous at all twelve face edges and corners', () => {
    const field = layers();
    for (const center of [new THREE.Vector3(1, 0, 1).normalize(), new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(-1, -1, -1).normalize()]) {
      stamp(field, { direction: center, radius: 40 });
      stamp(field, { direction: center, radius: 40, tool: 'material', material: 'snow', strength: 0.5 });
    }
    const eps = 1e-8;
    for (const z of [-1, 1]) for (const x of [-1, 1]) for (const y of [-1, 0, 1]) {
      const a = new THREE.Vector3(x * (1 - eps), y, z).normalize(), b = new THREE.Vector3(x * (1 + eps), y, z).normalize();
      expect(field.sampleHeightOffset(a)).toBeCloseTo(field.sampleHeightOffset(b), 5);
      expect(field.sampleMaterials(a)[4]).toBeCloseTo(field.sampleMaterials(b)[4], 5);
    }
  });
  it.each(['round', 'ellipse', 'organic', 'scatter', 'ribbon'])('supports deterministic %s stamps at a pole', (shape) => {
    const a = layers(), b = layers();
    stamp(a, { direction: north, shape, rotation: 0.7 }); stamp(b, { direction: north, shape, rotation: 0.7 });
    expect(a.serialize()).toEqual(b.serialize());
    expect(a.isEmpty()).toBe(false);
  });
  it('rotates ellipse and ribbon in the local tangent plane', () => {
    const frame = tangentFrame(front), rotated = tangentFrame(front, Math.PI / 2);
    const p = offsetDirection(front, frame.east, frame.north, 20, 0, 100);
    const settings = { radius: 25, planetRadius: 100, shape: 'ellipse' };
    expect(brushWeight(p, front, frame, settings)).toBeGreaterThan(0);
    expect(brushWeight(p, front, rotated, settings)).toBe(0);
  });
});

describe('paint tools', () => {
  it('rejects nonfinite brush parameters before changing the field', () => {
    const field = layers();
    for (const patch of [{ falloff: NaN }, { rotation: NaN }, { scatter: NaN }, { amount: Infinity }]) expect(() => stamp(field, patch)).toThrow();
    expect(field.isEmpty()).toBe(true);
  });
  it('disables paint sampling when the last nonzero channel is erased', () => {
    const field = layers(); stamp(field, { radius: 10 });
    stamp(field, { tool: 'erase', radius: 40, falloff: 0 });
    expect(field.isEmpty()).toBe(true);
    expect(field.nonzeroCount).toBe(0);
  });
  it('raises and lowers signed local-unit heights', () => {
    const field = layers(); stamp(field); expect(field.sampleHeightOffset(front)).toBe(10);
    stamp(field, { tool: 'lower', amount: 15 }); expect(field.sampleHeightOffset(front)).toBe(-5);
  });
  it('flattens toward elevation plus planet radius, including underlying terrain', () => {
    const field = layers(); stamp(field, { tool: 'flatten', targetElevation: 30, baseHeightAt: () => 10 });
    expect(field.sampleHeightOffset(front)).toBe(20);
    stamp(field, { tool: 'flatten', targetElevation: 30, baseHeightAt: () => 10 });
    expect(field.sampleHeightOffset(front)).toBe(20);
  });
  it('smooths final elevation and preserves the spherical base radius', () => {
    const field = layers(); stamp(field, { radius: 5, falloff: 1 });
    const before = field.sampleHeightOffset(front);
    stamp(field, { tool: 'smooth', radius: 25, baseHeightAt: () => 10 });
    expect(field.sampleHeightOffset(front)).toBeLessThan(before);
    expect(field.sampleHeightOffset(front)).toBeGreaterThan(0);
    const empty = layers(); stamp(empty, { tool: 'smooth', baseHeightAt: () => 10 });
    expect(empty.sampleHeightOffset(front)).toBe(0);
  });
  it('smooths the base terrain too, writing a separate compensating offset', () => {
    const field = layers(); const base = (d) => 30 * Math.exp(-(Math.acos(Math.min(1, d.z)) ** 2) / 0.0005);
    stamp(field, { tool: 'smooth', baseHeightAt: base });
    expect(field.sampleHeightOffset(front)).toBeLessThan(-1);
  });
  it('blends multiple material channels, retaining procedural influence', () => {
    const field = layers(); stamp(field, { tool: 'material', material: 'sand', strength: 0.5 });
    stamp(field, { tool: 'material', material: 'snow', strength: 0.5 });
    expect(field.sampleMaterials(front)).toEqual([0, 0.25, 0, 0, 0.5]);
    expect(field.sampleMaterials(front).reduce((a, b) => a + b, 0)).toBe(0.75);
    for (const material of PAINT_MATERIALS) stamp(field, { tool: 'material', material, strength: 0.5 });
    expect(field.sampleMaterials(front).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
  });
  it('erases height and every material progressively; clear resets paint only', () => {
    const field = layers(); stamp(field); stamp(field, { tool: 'material', material: 'rock' });
    stamp(field, { tool: 'erase', strength: 0.5 });
    expect(field.sampleHeightOffset(front)).toBe(5); expect(field.sampleMaterials(front)[3]).toBe(0.5);
    stamp(field, { tool: 'erase' }); expect(field.sampleHeightOffset(front)).toBe(0);
    field.clear(); expect(field.isEmpty()).toBe(true);
  });
  it('marks only changed faces and uploads once per flush, without recompiling', () => {
    const field = layers(); stamp(field); stamp(field);
    expect([...field.dirtyFaces]).toEqual([0]);
    const version = field.textures[0].version;
    expect(field.flushUploads()).toEqual([0]); expect(field.textures[0].version).toBe(version + 1);
    expect(field.flushUploads()).toEqual([]); expect(field.textures[0].version).toBe(version + 1);
  });
});

describe('paint persistence and runtime', () => {
  it('saves compressed sparse tiles with exact Float32 round trips', () => {
    const field = layers(128); stamp(field, { direction: new THREE.Vector3(1, 1, 1).normalize(), strength: 0.371 });
    stamp(field, { tool: 'material', material: 'rock', strength: 0.37 });
    const document = JSON.parse(JSON.stringify(field.serialize()));
    expect(JSON.stringify(document).length).toBeLessThan(20000);
    const loaded = layers(32); loaded.load(document);
    expect(loaded.serialize()).toEqual(document);
    for (let f = 0; f < 6; f++) expect(loaded.faces[f]).toEqual(field.faces[f]);
  });
  it('rejects malformed and future-version data without mutating live paint', () => {
    const field = layers(); stamp(field); const original = field.serialize();
    for (const patch of [{ version: 2 }, { data: 'nope' }, { resolution: 1 }, { encoding: 'raw' }]) {
      expect(() => field.load({ ...original, ...patch })).toThrow(); expect(field.serialize()).toEqual(original);
    }
  });
  it('loads legacy projects with no paint and keeps allocation lazy', () => {
    const p = planet(); const radius = p.getSurfaceRadius(front);
    const document = normalizeProject({ params: p.params });
    const loaded = own(Planet.fromJSON(document)); expect(loaded.getSurfaceRadius(front)).toBe(radius);
    expect(loaded.paintLayers.faces).toHaveLength(0);
  });
  it('includes paint in procedural surface queries and clone/JSON reload', () => {
    const p = planet(), before = p.getSurfaceRadius(front);
    stamp(p.paintLayers); expect(p.getSurfaceRadius(front)).toBeCloseTo(before + 10, 9);
    const serialized = p.serialize();
    for (const loaded of [own(Planet.fromJSON(JSON.stringify(serialized))), own(p.clone())]) expect(loaded.getSurfaceRadius(front)).toBe(p.getSurfaceRadius(front));
    p.set({ noiseScale: 7, seed: 99 }); expect(p.getSurfaceRadius(front)).toBeCloseTo(100 + p.getBaseElevation(front) + 10, 8);
  });
  it('allows an explicit null paint override when loading a runtime document', () => {
    const p = planet(); stamp(p.paintLayers);
    const loaded = own(Planet.fromJSON(p.serialize(), { paint: null }));
    expect(loaded.paintLayers.isEmpty()).toBe(true);
    expect(loaded.getSurfaceRadius(front)).toBe(100 + p.getBaseElevation(front));
  });
  it('keeps paint on top when applied nodes or the terrain mode change', async () => {
    const p = planet({ terrain: { mode: 'nodes', graph: constantGraph() } }); stamp(p.paintLayers);
    expect(p.getSurfaceRadius(front)).toBe(120);
    await p.setTerrainGraph(constantGraph(0.25)); expect(p.getSurfaceRadius(front)).toBe(115);
    await p.setTerrain({ mode: 'procedural', graph: null }); expect(p.getSurfaceRadius(front)).toBeCloseTo(100 + p.getBaseElevation(front) + 10, 8);
    await p.setTerrainGraph(createInitialGraph(p.params)); expect(p.getSurfaceRadius(front)).toBeCloseTo(100 + p.getBaseElevation(front) + 10, 8);
  });
  it('keeps paint through editable project file round trips', () => {
    const p = planet(); stamp(p.paintLayers); stamp(p.paintLayers, { tool: 'material', material: 'vegetation' });
    const document = createEditableProjectDocument({ id: 'paint', params: p.params, terrain: p.terrain, paint: p.paint });
    const reloaded = readEditableProjectDocument(JSON.parse(JSON.stringify(document)));
    const runtime = own(Planet.fromJSON(reloaded));
    expect(runtime.getSurfaceRadius(front)).toBe(p.getSurfaceRadius(front)); expect(runtime.paint).toEqual(p.paint);
  });
  it('clears paint without touching any other runtime authoring state', () => {
    const p = planet({ terrain: { mode: 'nodes', graph: constantGraph() } }); stamp(p.paintLayers);
    const params = JSON.stringify(p.params), terrain = p.terrain;
    p.paintLayers.clear(); expect(JSON.stringify(p.params)).toBe(params); expect(p.terrain).toEqual(terrain);
    expect(p.getSurfaceRadius(front)).toBe(110);
  });
  it('ignores retained terrestrial paint for gas and star queries', () => {
    const p = planet(); stamp(p.paintLayers);
    for (const mode of ['gas', 'star']) { p.set({ mode }); expect(p.getSurfaceRadius(front)).toBe(100); }
    p.set({ mode: 'planet' }); expect(p.paintLayers.sampleHeightOffset(front)).toBe(10);
  });
  it('picks the final displaced surface in transformed planet coordinates', () => {
    const p = planet({ terrain: { mode: 'nodes', graph: constantGraph() } }); stamp(p.paintLayers);
    p.position.set(40, 20, 0); p.rotation.y = Math.PI / 2; p.scale.setScalar(2); p.updateMatrixWorld(true);
    const worldPoint = p.localToWorld(new THREE.Vector3(0, 0, 400));
    const worldDirection = front.clone().negate().transformDirection(p.matrixWorld);
    const hit = pickPlanetRay(p, new THREE.Ray(worldPoint, worldDirection));
    expect(hit.direction.distanceTo(front)).toBeLessThan(1e-6);
    expect(hit.localPosition.length()).toBeCloseTo(120, 4);
    expect(hit.normal.dot(front)).toBeGreaterThan(0.99);
  });
  it('bakes final painted geometry without a WebGL context when color baking is off', async () => {
    const p = planet({ terrain: { mode: 'nodes', graph: constantGraph() } }); stamp(p.paintLayers);
    const group = await bakeGroup(null, p.params, p.uniforms, { meshRes: 8, bakeColor: false, terrainProgram: p._terrainProgram, paint: p.paint });
    try {
      expect(group.children).toHaveLength(6);
      const v = new THREE.Vector3(); let changed = false;
      for (const mesh of group.children) for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        v.fromBufferAttribute(mesh.geometry.attributes.position, i);
        expect(v.length()).toBeCloseTo(p.getSurfaceRadius(v.clone().normalize()), 4);
        if (v.length() > 111) changed = true;
      }
      expect(changed).toBe(true);
    } finally { disposeBaked(group); }
  });
});

function event(type, values = {}) { const e = new Event(type, { cancelable: true }); Object.assign(e, values); return e; }
function editor() {
  vi.stubGlobal('window', new EventTarget());
  const p = planet({ terrain: { mode: 'nodes', graph: constantGraph() } });
  const canvas = new EventTarget(); canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn(); canvas.hasPointerCapture = () => true;
  const controls = { enabled: true, autoRotate: false, mouseButtons: { LEFT: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN } };
  const onStrokeStart = vi.fn(), onStrokeEnd = vi.fn();
  const mode = own(new PlanetPaintModeManager({ planet: p, camera: new THREE.PerspectiveCamera(), domElement: canvas, controls, onStrokeStart, onStrokeEnd }));
  let direction = front.clone(); mode.picker.pickEvent = () => ({ direction, elevation: p.getSurfaceRadius(direction) - 100 });
  mode.setState({ brushSize: 25 }); mode.enable();
  return { p, mode, canvas, controls, onStrokeStart, onStrokeEnd, moveTo: (d) => { direction = d; canvas.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 0, clientY: 0 })); } };
}
describe('stroke lifecycle and history boundary', () => {
  it('clamps the brush to the current planet size when entering the workspace', () => {
    const { p, mode } = editor();
    mode.disable(); p.set({ radius: 20 }); mode.enable();
    expect(mode.state.brushSize).toBe(9);
    mode.disable(); p.set({ radius: 2000 }); mode.enable();
    expect(mode.state.brushSize).toBe(2000 * 4 / p.paintLayers.resolution);
  });
  it('groups many stamps into one complete action and retains paint after exit', () => {
    const { p, mode, canvas, controls, onStrokeStart, onStrokeEnd, moveTo } = editor();
    canvas.dispatchEvent(event('pointerdown', { button: 0, pointerId: 1 }));
    for (const x of [0.1, 0.2, 0.3, 0.4]) moveTo(new THREE.Vector3(x, 0, 1).normalize());
    mode.update(); window.dispatchEvent(event('pointerup', { pointerId: 1, clientX: 2000, clientY: 2000 }));
    expect(onStrokeStart).toHaveBeenCalledOnce(); expect(onStrokeEnd).toHaveBeenCalledOnce();
    const result = p.paint; mode.disable(); expect(p.paint).toEqual(result);
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE); expect(controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.PAN);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);
  });
  it('restores the exact field on undo and redo at the complete-stroke boundary', () => {
    const { p, mode, canvas, onStrokeEnd } = editor(); const before = p.paint;
    canvas.dispatchEvent(event('pointerdown', { button: 0, pointerId: 1 })); mode.finish();
    const after = onStrokeEnd.mock.calls[0][0];
    p.setPaint(before); expect(p.paintLayers.sampleHeightOffset(front)).toBe(0);
    p.setPaint(after); expect(p.paintLayers.sampleHeightOffset(front)).toBeGreaterThan(0); expect(p.paint).toEqual(after);
  });
  it('separates strokes while brush changes never emit document actions', () => {
    const { mode, canvas, onStrokeEnd } = editor(); mode.setState({ strength: 0.8 }); mode.setState({ falloff: 0.4 });
    expect(onStrokeEnd).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) { canvas.dispatchEvent(event('pointerdown', { button: 0, pointerId: i })); mode.finish(); }
    expect(onStrokeEnd).toHaveBeenCalledTimes(2);
  });
  it.each(['pointercancel', 'blur'])('ends pointer capture on %s', (type) => {
    const { mode, canvas, onStrokeEnd } = editor(); canvas.dispatchEvent(event('pointerdown', { button: 0, pointerId: 1 }));
    window.dispatchEvent(event(type, { pointerId: 1 })); expect(mode.isPainting).toBe(false); expect(onStrokeEnd).toHaveBeenCalledOnce();
  });
  it('owns left paint and Shift-wheel, leaving right drag and ordinary wheel to the camera', () => {
    const { mode, canvas, controls } = editor(); const left = event('pointerdown', { button: 0, pointerId: 1 }); canvas.dispatchEvent(left); expect(left.defaultPrevented).toBe(true); mode.finish();
    const right = event('pointerdown', { button: 2, pointerId: 1 }); canvas.dispatchEvent(right); expect(right.defaultPrevented).toBe(false); expect(controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.ROTATE);
    const normal = event('wheel', { shiftKey: false, deltaY: -1 }); canvas.dispatchEvent(normal); expect(normal.defaultPrevented).toBe(false);
    const size = mode.state.brushSize; const shifted = event('wheel', { shiftKey: true, deltaY: -1 }); canvas.dispatchEvent(shifted); expect(shifted.defaultPrevented).toBe(true); expect(mode.state.brushSize).toBeGreaterThan(size);
  });
});
