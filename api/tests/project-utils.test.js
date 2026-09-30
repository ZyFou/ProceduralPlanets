import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PROJECT_BYTES,
  createShareCode,
  normalizeBodyType,
  normalizeShareCode,
  parseProjectThumbnail,
  validateProjectCreate,
  validateProjectUpdate,
} from '../src/project-utils.js';

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64')}`;
const planet = (params = { mode: 'planet', seed: 7 }, metadata = { name: 'Kepler' }) => ({ id: 'local-1', metadata, params });

test('share codes avoid ambiguous characters and normalize separators', () => {
  const code = createShareCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(normalizeShareCode(`${code.slice(0, 5)}-${code.slice(5).toLowerCase()}`), code);
  assert.equal(normalizeShareCode('bad code'), null);
});

test('project creation uses metadata, the account default visibility and the local id', () => {
  const result = validateProjectCreate({ project: planet(undefined, { name: 'Cloud world', description: 'A test' }) }, 'unlisted');
  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'Cloud world');
  assert.equal(result.value.description, 'A test');
  assert.equal(result.value.visibility, 'unlisted');
  assert.equal(result.value.sourceProjectId, 'local-1');
});

test('the body type is derived from params.mode and defaults to planet', () => {
  assert.equal(validateProjectCreate({ project: planet({ mode: 'gas' }) }).value.bodyType, 'gas');
  assert.equal(validateProjectCreate({ project: planet({ mode: 'star' }) }).value.bodyType, 'star');
  assert.equal(validateProjectCreate({ project: planet({ seed: 1 }) }).value.bodyType, 'planet');
  assert.equal(validateProjectCreate({ project: planet({ mode: 'comet' }) }).ok, false);
  assert.equal(normalizeBodyType(' GAS '), 'gas');
  assert.equal(normalizeBodyType('nodes'), null);
});

test('projects without parameters are rejected', () => {
  assert.equal(validateProjectCreate({ project: { metadata: { name: 'x' } } }).ok, false);
  assert.equal(validateProjectCreate({ project: { metadata: { name: 'x' }, params: [] } }).ok, false);
  assert.equal(validateProjectCreate({ project: null }).ok, false);
});

test('oversized projects are rejected', () => {
  const huge = planet({ mode: 'planet', blob: 'x'.repeat(MAX_PROJECT_BYTES) });
  const result = validateProjectCreate({ project: huge });
  assert.equal(result.ok, false);
  assert.match(result.errors.project, /1 MB/);
});

test('the thumbnail is split out of the stored document', () => {
  const result = validateProjectCreate({ project: planet(undefined, { name: 'Thumb', thumbnail: PNG }) });
  assert.equal(result.ok, true);
  assert.equal(result.value.thumbnail.mimeType, 'image/png');
  const stored = JSON.parse(result.value.projectData);
  assert.equal('thumbnail' in stored.metadata, false);
  assert.equal(stored.metadata.name, 'Thumb');
  assert.equal(stored.params.seed, 7);
});

test('thumbnails: missing leaves unchanged, null clears, invalid is ignored', () => {
  assert.equal(parseProjectThumbnail(undefined), undefined);
  assert.equal(parseProjectThumbnail(null), null);
  assert.equal(parseProjectThumbnail('data:image/svg+xml;base64,PHN2Zz4='), undefined);
  assert.equal(parseProjectThumbnail('data:image/png;base64,aGVsbG8='), undefined);
  assert.equal(parseProjectThumbnail(PNG).mimeType, 'image/png');
});

test('an invalid thumbnail never blocks a save', () => {
  const result = validateProjectUpdate({ project: planet(undefined, { name: 'x', thumbnail: 'data:text/html;base64,AA==' }) });
  assert.equal(result.ok, true);
  assert.equal(result.thumbnail, undefined);
});

test('project updates validate visibility and require a field', () => {
  assert.equal(validateProjectUpdate({}).ok, false);
  assert.equal(validateProjectUpdate({ visibility: 'friends' }).ok, false);
  assert.equal(validateProjectUpdate({ name: 'Renamed', visibility: 'public' }).ok, true);
});

test('project updates carry the body type with the document', () => {
  const result = validateProjectUpdate({ project: planet({ mode: 'star' }), expectedContentRevision: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.value.bodyType, 'star');
  assert.equal(result.expectedContentRevision, 3);
});

test('project updates accept supported community card icons', () => {
  const result = validateProjectUpdate({ communityIcon: 'sun' });
  assert.equal(result.ok, true);
  assert.equal(result.value.communityIcon, 'sun');
  assert.equal(validateProjectUpdate({ communityIcon: 'mountain' }).ok, false);
});

test('a content revision only protects document updates', () => {
  assert.equal(validateProjectUpdate({ name: 'x', expectedContentRevision: 2 }).ok, false);
  assert.equal(validateProjectUpdate({ project: planet(), expectedContentRevision: 0 }).ok, false);
});
