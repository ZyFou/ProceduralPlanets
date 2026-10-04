import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROJECT_BYTES, validateProjectCreate, validateProjectUpdate } from '../src/project-utils.js';

test('cloud project create/update preserve paint separately from terrain and editor', () => {
  const paint = { version: 1, mapping: 'cube-vertices', resolution: 256, encoding: 'sparse-zlib-f32le', data: 'eJxjYGBgAAAABAAB' };
  const project = { schemaVersion: 2, id: 'painted', metadata: { name: 'Painted world' }, params: { mode: 'planet', seed: 42 },
    terrain: { mode: 'procedural', graph: null }, paint, editor: { draftGraph: null } };
  for (const result of [validateProjectCreate({ project }), validateProjectUpdate({ project })]) {
    assert.equal(result.ok, true);
    const restored = JSON.parse(result.value.projectData);
    assert.deepEqual(restored.paint, paint);
    assert.deepEqual(restored.terrain, project.terrain);
    assert.deepEqual(restored.editor, project.editor);
  }
});

test('the cloud project size budget includes paint payloads', () => {
  const project = { metadata: { name: 'Oversized paint' }, params: { mode: 'planet' }, paint: { data: 'x'.repeat(MAX_PROJECT_BYTES) } };
  assert.match(validateProjectCreate({ project }).errors.project, /1 MB/);
  assert.match(validateProjectUpdate({ project }).errors.project, /1 MB/);
});
