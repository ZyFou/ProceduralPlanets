import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROJECT_BYTES, validateProjectCreate, validateProjectUpdate } from '../src/project-utils.js';

test('cloud create and update retain applied graphs, invalid drafts and editor positions', () => {
  const graph = { format: 'procedural-planets-height-graph', version: 1, nodes: [{ id: 'future', type: 'unknown', params: { retained: true } }], edges: [], outputId: 'output' };
  const project = { schemaVersion: 2, id: 'local-nodes', metadata: { name: 'Nodes' }, params: { mode: 'planet', seed: 42 },
    terrain: { mode: 'nodes', graph }, editor: { draftGraph: { ...graph, version: 999 }, nodePositions: { future: { x: 40, y: 70 } } } };
  for (const result of [validateProjectCreate({ project }), validateProjectUpdate({ project })]) {
    assert.equal(result.ok, true);
    const restored = JSON.parse(result.value.projectData);
    assert.deepEqual(restored.terrain, project.terrain);
    assert.deepEqual(restored.editor, project.editor);
    assert.equal(restored.schemaVersion, 2);
  }
});

test('the cloud 1 MB limit includes editor drafts and graph data', () => {
  const project = { metadata: { name: 'Oversized nodes' }, params: { mode: 'planet' },
    terrain: { mode: 'procedural', graph: null }, editor: { draftGraph: { recovery: 'x'.repeat(MAX_PROJECT_BYTES) } } };
  assert.match(validateProjectCreate({ project }).errors.project, /1 MB/);
  assert.match(validateProjectUpdate({ project }).errors.project, /1 MB/);
  assert.equal(project.editor.draftGraph.recovery.length, MAX_PROJECT_BYTES);
});
