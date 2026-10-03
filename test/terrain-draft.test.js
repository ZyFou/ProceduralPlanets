import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { Planet, createNode, createRecipe, GRAPH_FORMAT, GRAPH_VERSION } from '../src/lib/index.js';
import { applyTerrainDraft, canEditGraph, terrainDraftState } from '../src/project/terrainDraft.js';

const graph = (height = 0.25) => ({ format: GRAPH_FORMAT, version: GRAPH_VERSION,
  nodes: [createNode('constant', 'source', { value: height }), createNode('heightOutput', 'output')],
  edges: [{ id: 'edge', source: 'source', sourcePort: 'height', target: 'output', targetPort: 'height' }], outputId: 'output' });
const design = (applied = graph(), draft = applied) => ({ terrain: { mode: 'nodes', graph: applied },
  editor: { draftGraph: draft, nodePositions: { source: { x: 32, y: 56 } }, futureEditorField: { retain: true } } });
const invalidDraft = () => ({ ...graph(), edges: [], unknownImportField: { recover: true } });
const planets = [];
function priorPlanet(height = 0.75) {
  const planet = new Planet({ radius: 100, heightScale: 20, waterEnabled: false, terrain: { mode: 'nodes', graph: graph(height) } });
  planets.push(planet);
  return planet;
}
const direction = new Vector3(1, 2, 3);
afterEach(() => { planets.splice(0).forEach(planet => planet.dispose()); vi.restoreAllMocks(); });

describe('terrain draft orchestration', () => {
  it('does not start a restoration for an already obsolete document', async () => {
    const planet = priorPlanet();
    const applications = vi.spyOn(planet, 'setTerrain');
    const result = await applyTerrainDraft(planet, design(), { isCurrent: () => false });
    expect(result).toMatchObject({ ok: false, obsolete: true });
    expect(applications).not.toHaveBeenCalled();
  });
  it('reopens an invalid saved draft on its saved applied surface rather than the previous planet', async () => {
    const planet = priorPlanet();
    const document = design(graph(0.25), invalidDraft());
    const original = structuredClone(document);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(115, 8);
    const result = await applyTerrainDraft(planet, document);
    expect(result).toMatchObject({ ok: true, draftValid: false });
    expect(result.diagnostics[0].code).toBe('missing-input');
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(105, 8);
    expect(planet.terrain).toEqual(document.terrain);
    expect(document).toEqual(original);
  });

  it('undoes a later valid graph to an older applied graph with an invalid draft', async () => {
    const planet = priorPlanet(0.8);
    const historical = design(graph(0.15), invalidDraft());
    const oldSnapshot = structuredClone(historical);
    const result = await applyTerrainDraft(planet, historical);
    expect(result.ok).toBe(true);
    expect(result.draftValid).toBe(false);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(103, 8);
    expect(planet.terrain.graph).toEqual(historical.terrain.graph);
    expect(historical).toEqual(oldSnapshot);
  });

  it('restores the saved applied graph before a CPU-valid draft fails candidate shader creation', async () => {
    const planet = priorPlanet();
    const document = design(graph(0.25), createRecipe('noise'));
    const before = structuredClone(document);
    const createMaterials = planet._terrainMaterials.bind(planet);
    vi.spyOn(planet, '_terrainMaterials').mockImplementation(program => {
      if (program.graph.nodes.some(node => node.type === 'noise3d')) throw new Error('Driver rejected candidate B');
      return createMaterials(program);
    });
    const applications = vi.spyOn(planet, 'setTerrain');
    expect(terrainDraftState(document).valid).toBe(true);
    const result = await applyTerrainDraft(planet, document);
    expect(result).toMatchObject({ ok: false, noAppliedTerrain: false, error: 'Driver rejected candidate B' });
    expect(applications.mock.calls[0][0]).toEqual(document.terrain);
    expect(applications.mock.calls[1][0].graph).toEqual(document.editor.draftGraph);
    expect(planet.terrain).toEqual(document.terrain);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(105, 8);
    expect(document).toEqual(before);
  });

  it('reports a missing valid applied graph for an invalid import without installing procedural terrain', async () => {
    const planet = priorPlanet();
    const originalTerrain = planet.terrain;
    const imported = design({ ...invalidDraft(), version: 999 }, invalidDraft());
    const original = structuredClone(imported);
    const applications = vi.spyOn(planet, 'setTerrain');
    const state = terrainDraftState(imported);
    expect(state).toMatchObject({ valid: false, recoverable: false });
    const result = await applyTerrainDraft(planet, imported);
    expect(result).toMatchObject({ ok: false, noAppliedTerrain: true });
    expect(applications).not.toHaveBeenCalled();
    expect(planet.terrain).toEqual(originalTerrain);
    expect(imported).toEqual(original);
  });

  it('keeps the last applied graph when procedural mode is selected with an invalid draft', async () => {
    const planet = priorPlanet();
    const document = design(graph(0.25), invalidDraft());
    document.terrain.mode = 'procedural';
    const original = structuredClone(document);
    expect(terrainDraftState(document)).toMatchObject({ valid: true, recoverable: true, candidate: document.terrain });
    const result = await applyTerrainDraft(planet, document);
    expect(result.ok).toBe(true);
    expect(planet.terrain).toEqual(document.terrain);
    expect(planet.terrain.graph.edges).toHaveLength(1);
    expect(document.editor.draftGraph.edges).toHaveLength(0);
    expect(document).toEqual(original);
  });

  it('accepts a valid draft as the first applied graph when an imported applied state is missing', async () => {
    const planet = priorPlanet();
    const document = design(null, graph(0.4));
    const result = await applyTerrainDraft(planet, document);
    expect(result).toMatchObject({ ok: true, draftValid: true, noAppliedTerrain: false });
    expect(planet.terrain.graph).toEqual(document.editor.draftGraph);
    expect(planet.getSurfaceRadius(direction)).toBeCloseTo(108, 8);
    expect(document.terrain.graph).toBeNull();
  });

  it('prevents obsolete restoration from applying the draft after document invalidation', async () => {
    const planet = priorPlanet();
    const document = design(graph(0.25), graph(0.6));
    let current = true;
    const realApply = planet.setTerrain.bind(planet);
    const applications = vi.spyOn(planet, 'setTerrain').mockImplementation(async (...arguments_) => {
      const result = await realApply(...arguments_);
      current = false;
      return result;
    });
    const result = await applyTerrainDraft(planet, document, { isCurrent: () => current });
    expect(result.obsolete).toBe(true);
    expect(applications).toHaveBeenCalledOnce();
    expect(planet.terrain.graph).toEqual(document.terrain.graph);
  });

  it('gates malformed graph structures without deleting unknown imported graph data', () => {
    const cases = [null, {}, { nodes: null, edges: [] }, { nodes: [null], edges: [] },
      { nodes: [4], edges: [] }, { nodes: [{ id: 'x', type: 'constant', params: [] }], edges: [] },
      { nodes: [], edges: [null] }, { nodes: [], edges: [{ id: 'e', source: 2, target: 'x' }] }];
    for (const candidate of cases) {
      const original = structuredClone(candidate);
      expect(canEditGraph(candidate)).toBe(false);
      expect(candidate).toEqual(original);
    }
    const unknown = { ...graph(), version: 999, futureGraphField: { retain: true } };
    unknown.nodes[0].type = 'futureNode';
    const original = structuredClone(unknown);
    expect(canEditGraph(unknown)).toBe(true);
    expect(terrainDraftState(design(unknown, unknown)).valid).toBe(false);
    expect(unknown).toEqual(original);
  });
});
