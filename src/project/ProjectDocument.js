import { normalizeProject } from './ProjectStore.js';

// Editable project file (.ppplanet): the studio document as JSON. The params
// are plain procedural-planets parameters, so the same file also feeds
// `new Planet(document.params)` directly.
export const EDITABLE_PROJECT_FORMAT = 'procedural-planets-project';
export const PROJECT_FILE_EXTENSION = '.ppplanet';
export const PROJECT_FILE_ACCEPT = '.ppplanet,.json,application/json';

export function createEditableProjectDocument(project) {
  const { metadata, ...rest } = normalizeProject(project);
  // the card thumbnail is a local render cache, not part of the design
  return { format: EDITABLE_PROJECT_FORMAT, ...rest, metadata: { ...metadata, thumbnail: null } };
}

/**
 * Parse an editable project file. Also accepts a bare params object (such as
 * a `new Planet({...})` options object saved as JSON) for convenience.
 */
export function readEditableProjectDocument(input, { fallbackName } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Could not parse the project file.');
  if (input.format && input.format !== EDITABLE_PROJECT_FORMAT) {
    throw new Error('This file is not an editable Procedural Planets project.');
  }
  if (input.params && typeof input.params === 'object') return normalizeProject(input);
  if (typeof input.mode === 'string' || typeof input.seed === 'number') {
    return normalizeProject({ metadata: { name: fallbackName }, params: input });
  }
  throw new Error('This file is not an editable Procedural Planets project.');
}

export function suggestedProjectFilename(name) {
  const slug = String(name || 'planet').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'planet';
  return `${slug}${PROJECT_FILE_EXTENSION}`;
}

export function downloadProjectDocument(project) {
  const document = createEditableProjectDocument(project);
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedProjectFilename(document.metadata.name);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readProjectFile(file) {
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error('Could not parse the project file.'); }
  return readEditableProjectDocument(json, { fallbackName: file.name.replace(/\.(ppplanet|json)$/i, '') });
}
