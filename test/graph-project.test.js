import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeProject, projectStore } from '../src/project/ProjectStore.js';
import { createEditableProjectDocument, readEditableProjectDocument } from '../src/project/ProjectDocument.js';
import { planetCodeSnippet } from '../src/project/codeSnippet.js';
import { Planet } from '../src/engine/Planet.js';
import { bakeGroup, disposeBaked } from '../src/engine/PlanetBaker.js';
import { createPlanetArchive } from '../src/lib/export.js';

const graph = () => ({ format: 'procedural-planets-height-graph', version: 1,
  nodes: [{ id: 'constant', type: 'constant', params: { value: 0.75 } }, { id: 'output', type: 'heightOutput', params: {} }],
  edges: [{ id: 'edge', source: 'constant', sourcePort: 'height', target: 'output', targetPort: 'height' }], outputId: 'output' });
const project = () => ({ schemaVersion: 2, id: 'graph-world', metadata: { name: 'Graph world', thumbnail: 'local-cache' },
  params: { mode: 'planet', seed: 781, colGrass: [0.2, 0.4, 0.1] }, terrain: { mode: 'nodes', graph: graph() },
  editor: { draftGraph: { ...graph(), edges: [], futureField: { recoverable: true } },
    nodePositions: { constant: { x: 34, y: 56 } }, nodeLabels: { constant: 'Plateau' }, groups: [], viewport: { x: 5, y: 6, zoom: 0.8 } },
  futureDocumentField: { keep: 'me' } });

beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe('graph document persistence', () => {
  it('explicitly migrates old projects while retaining their parameter values', () => {
    const old = { schemaVersion: 1, params: { mode: 'gas', seed: 123, radius: 17 } };
    const migrated = normalizeProject(old);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.params).toEqual(old.params);
    expect(migrated.terrain).toEqual({ mode: 'procedural', graph: null });
    expect(old).not.toHaveProperty('terrain');
  });

  it('round-trips applied state, an invalid draft, editor data and unknown imported data', () => {
    const original = project();
    const restored = readEditableProjectDocument(JSON.parse(JSON.stringify(createEditableProjectDocument(original))));
    expect(restored.terrain).toEqual(original.terrain);
    expect(restored.editor).toEqual(original.editor);
    expect(restored.futureDocumentField).toEqual(original.futureDocumentField);
    expect(restored.metadata.thumbnail).toBeNull();
    restored.terrain.graph.nodes[0].params.value = 0;
    restored.editor.nodePositions.constant.x = 200;
    expect(original.terrain.graph.nodes[0].params.value).toBe(0.75);
    expect(original.editor.nodePositions.constant.x).toBe(34);
  });

  it('saves draft-only edits and preserves graphs in duplication, import and body switching', async () => {
    const saved = await projectStore.save(project());
    saved.params.mode = 'star';
    saved.editor.draftGraph.nodes[0].params.value = 0.9;
    await projectStore.save(saved);
    const loaded = await projectStore.get(saved.id);
    expect(loaded.params.mode).toBe('star');
    expect(loaded.terrain.graph.nodes[0].params.value).toBe(0.75);
    expect(loaded.editor.draftGraph.nodes[0].params.value).toBe(0.9);
    const copy = await projectStore.duplicate(loaded);
    const imported = await projectStore.importCopy(loaded);
    expect(copy.id).not.toBe(loaded.id);
    expect(imported.id).not.toBe(loaded.id);
    expect(copy.editor).toEqual(loaded.editor);
    expect(imported.terrain).toEqual(loaded.terrain);
    copy.terrain.graph.nodes[0].params.value = 0;
    expect(loaded.terrain.graph.nodes[0].params.value).toBe(0.75);
  });

  it('produces a full precision standalone runtime snapshot without editor data', () => {
    const original = project();
    original.params.radius = 1000.123456789;
    const snippet = planetCodeSnippet(original.params, original.terrain);
    expect(snippet).toContain('Planet.fromJSON(');
    expect(snippet).toContain('1000.123456789');
    expect(snippet).toContain('procedural-planets-height-graph');
    expect(snippet).not.toContain('draftGraph');
    expect(snippet).not.toContain('nodePositions');
  });

  it('displaces exported cube faces using the applied graph CPU evaluator', async () => {
    const planet = new Planet({ radius: 100, heightScale: 20, terrain: { mode: 'nodes', graph: graph() } });
    const baked = await bakeGroup(null, planet.params, planet.uniforms, { meshRes: 8, bakeColor: false, terrainProgram: planet._terrainProgram });
    try {
      expect(baked.children).toHaveLength(6);
      for (const mesh of baked.children) {
        const positions = mesh.geometry.attributes.position;
        for (let index = 0; index < positions.count; index++) {
          expect(Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index))).toBeCloseTo(115, 4);
        }
      }
    } finally { disposeBaked(baked); planet.dispose(); }
  });

  it('exports the same v2 preset snapshot while live state changes during packaging', async () => {
    const planet = new Planet({ seed: 42, terrain: { mode: 'nodes', graph: graph() } });
    try {
      const archive = await createPlanetArchive(null, planet, { includeMesh: false,
        onProgress: () => { planet.set({ seed: 99 }); } });
      const preset = JSON.parse(new TextDecoder().decode(archive.files['planet_preset.json']));
      expect(preset.version).toBe(2);
      expect(preset.params.seed).toBe(42);
      expect(planet.params.seed).toBe(99);
      expect(preset.terrain.graph.nodes[0].params.value).toBe(0.75);
      const restored = Planet.fromJSON(preset);
      expect(restored.terrain).toEqual(preset.terrain);
      restored.dispose();
    } finally { planet.dispose(); }
  });
});
