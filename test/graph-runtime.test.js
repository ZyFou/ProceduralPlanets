import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { Planet, createInitialGraph, createNode, createRecipe, GRAPH_FORMAT, GRAPH_VERSION } from '../src/lib/index.js';

const direction = new Vector3(1, 2, 3).normalize();
const constantGraph = (value = 0.75) => ({ format: GRAPH_FORMAT, version: GRAPH_VERSION,
  nodes: [createNode('constant', 'source', { value }), createNode('heightOutput', 'output')],
  edges: [{ id: 'height', source: 'source', sourcePort: 'height', target: 'output', targetPort: 'height' }], outputId: 'output' });
const makePlanet = (graph = constantGraph()) => new Planet({ radius: 100, heightScale: 20, waterEnabled: false,
  terrain: { mode: 'nodes', graph } });
const planets = [];
const own = planet => { planets.push(planet); return planet; };
afterEach(() => { planets.splice(0).forEach(planet => planet.dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });

// Model three.js's program map and the parallel shader readiness/link checks.
function fakeRenderer({ ready = () => true, linked = true } = {}) {
  const properties = new WeakMap();
  const materials = [];
  let target = null;
  return {
    materials,
    extensions: { has: () => true },
    properties: { get: material => properties.get(material) ?? {} },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: next => { target = next; },
    compile: scene => {
      const material = scene.children[0].material;
      materials.push(material);
      properties.set(material, { programs: new Map([['terrain', { program: {}, isReady: ready }]]) });
    },
    getContext: () => ({ LINK_STATUS: 0x8b82, getProgramParameter: () => linked,
      getProgramInfoLog: () => 'Simulated terrain shader link failure' }),
  };
}

describe('Planet node runtime', () => {
  it('recreates its applied shape from constructor, JSON and independent clones', async () => {
    const input = constantGraph();
    const source = own(makePlanet(input));
    input.nodes[0].params.value = 0;
    expect(source.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
    const serialized = source.serialize();
    const loaded = own(Planet.fromJSON(JSON.stringify(serialized)));
    const clone = own(source.clone());
    expect(loaded.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
    expect(clone.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
    await clone.setTerrainGraph(constantGraph(0.25));
    serialized.terrain.graph.nodes[0].params.value = 0;
    expect(clone.getSurfaceRadius(direction)).toBeCloseTo(105, 8);
    expect(source.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
    expect(loaded.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
  });

  it('preserves terrain through Gas, Star and procedural mode switches', async () => {
    const planet = own(makePlanet());
    const initial = planet.terrain;
    for (const mode of ['gas', 'star', 'planet']) {
      planet.set({ mode });
      expect(planet.terrain).toEqual(initial);
    }
    await planet.setTerrain({ ...initial, mode: 'procedural' });
    expect(planet.terrain.graph).toEqual(initial.graph);
    await planet.setTerrain(initial);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
  });

  it('keeps the optimized classic material and exact CPU surface for Current Terrain identity', () => {
    const classic = own(new Planet({ seed: 743, craters: 0.2 }));
    const nodes = own(new Planet({ params: classic.params,
      terrain: { mode: 'nodes', graph: createInitialGraph(classic.params) } }));
    expect(nodes.world.terrainProgram).toBeNull();
    for (const dir of [direction, new Vector3(1, 1, 1).normalize(), new Vector3(-1, -1, 1).normalize()]) {
      expect(nodes.getSurfaceRadius(dir)).toBeCloseTo(classic.getSurfaceRadius(dir), 8);
    }
  });

  it('ignores presentation changes and unordered JSON in semantic signatures and versions', async () => {
    const planet = own(makePlanet());
    const version = planet._version;
    const materials = [...planet.world.templateMaterials];
    const draft = constantGraph();
    draft.nodes.reverse();
    draft.nodes[0].position = { x: 800, y: 400 };
    draft.nodes[1].label = 'Presentation only';
    const result = await planet.setTerrainGraph(draft);
    expect(result).toMatchObject({ ok: true, compiled: false });
    expect(planet._version).toBe(version);
    expect(planet.world.templateMaterials[0]).toBe(materials[0]);
    expect(planet.world.templateMaterials[1]).toBe(materials[1]);
  });

  it('applies uniform-only graph edits without replacing materials', async () => {
    const planet = own(makePlanet());
    const materials = [...planet.world.templateMaterials];
    const version = planet._version;
    const result = await planet.setTerrainGraph(constantGraph(0.2));
    expect(result).toMatchObject({ ok: true, compiled: false });
    expect(planet.world.templateMaterials[0]).toBe(materials[0]);
    expect(planet.world.templateMaterials[1]).toBe(materials[1]);
    expect(planet._version).toBeGreaterThan(version);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(104, 8);
  });

  it('rejects invalid construction and leaves applied materials and sampler intact on a bad edit', async () => {
    const invalid = constantGraph();
    invalid.edges = [];
    expect(() => makePlanet(invalid)).toThrow(/Connect/);
    const planet = own(makePlanet());
    const materials = planet.world.templateMaterials;
    const sampler = planet._sampler;
    const before = planet.terrain;
    const result = await planet.setTerrainGraph(invalid);
    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics[0].code).toBe('missing-input');
    expect(planet.terrain).toEqual(before);
    expect(planet.world.templateMaterials).toBe(materials);
    expect(planet._sampler).toBe(sampler);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
  });

  it('rejects completed but failed shader links and disposes candidate materials', async () => {
    const planet = own(makePlanet());
    const before = planet.terrain;
    const materials = planet.world.templateMaterials;
    const renderer = fakeRenderer({ linked: false });
    const createMaterials = planet._terrainMaterials.bind(planet);
    const disposal = [];
    vi.spyOn(planet, '_terrainMaterials').mockImplementation(program => {
      const candidates = createMaterials(program);
      disposal.push(...candidates.map(material => vi.spyOn(material, 'dispose')));
      return candidates;
    });
    const result = await planet.setTerrainGraph(createRecipe('noise'), { renderer });
    expect(result).toMatchObject({ ok: false, error: 'Simulated terrain shader link failure' });
    expect(planet.world.templateMaterials).toBe(materials);
    expect(planet.terrain).toEqual(before);
    disposal.forEach(spy => expect(spy).toHaveBeenCalledOnce());
    expect(renderer.materials.length).toBeGreaterThan(0);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
  });

  it('prevents a slow older shader candidate from replacing a newer edit', async () => {
    vi.useFakeTimers();
    const planet = own(makePlanet());
    let complete = false;
    const renderer = fakeRenderer({ ready: () => complete });
    const stale = planet.setTerrainGraph(createRecipe('noise'), { renderer });
    const disposal = renderer.materials.map(material => vi.spyOn(material, 'dispose'));
    const current = await planet.setTerrainGraph(constantGraph(0.4));
    complete = true;
    await vi.advanceTimersByTimeAsync(32);
    expect(await stale).toMatchObject({ ok: false, obsolete: true });
    expect(current.ok).toBe(true);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(108, 8);
    expect(planet.terrain.graph).toEqual(constantGraph(0.4));
    disposal.forEach(spy => expect(spy).toHaveBeenCalledOnce());
  });

  it('invalidates pending shader work after a seed change', async () => {
    vi.useFakeTimers();
    const planet = own(makePlanet());
    const renderer = fakeRenderer({ ready: () => false });
    const stale = planet.setTerrainGraph(createRecipe('noise'), { renderer });
    planet.set({ seed: 842 });
    await vi.advanceTimersByTimeAsync(32);
    expect(await stale).toMatchObject({ ok: false, obsolete: true });
    expect(planet.params.seed).toBe(842);
    expect(planet.terrain.graph).toEqual(constantGraph());
  });
});
