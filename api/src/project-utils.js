import { randomBytes } from 'node:crypto';
import { PROJECT_VISIBILITIES, parseImageDataUrl } from './profile-utils.js';

// A planet project is { id, metadata, params }: params are plain
// procedural-planets package parameters, so documents stay small.
export const MAX_PROJECT_BYTES = 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 256 * 1024;
export const BODY_TYPES = Object.freeze(['planet', 'gas', 'star']);
export const PROJECT_COMMUNITY_ICONS = Object.freeze(['orbit', 'globe', 'sun', 'waves', 'sparkles', 'moon']);
const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;

export function createShareCode() {
  const bytes = randomBytes(10);
  return Array.from(bytes, (byte) => SHARE_ALPHABET[byte % SHARE_ALPHABET.length]).join('');
}

export function normalizeShareCode(value) {
  const code = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
  return SHARE_CODE_PATTERN.test(code) ? code : null;
}

export function normalizeBodyType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  return BODY_TYPES.includes(type) ? type : null;
}

/**
 * The card thumbnail travels inside the client document as
 * metadata.thumbnail (a data URL) but is stored in its own column.
 * `undefined` leaves the stored thumbnail alone, `null` clears it.
 * A malformed or oversized thumbnail is dropped rather than failing the save:
 * it is a cosmetic render artifact the client regenerates.
 */
export function parseProjectThumbnail(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const result = parseImageDataUrl(value, { maxBytes: MAX_THUMBNAIL_BYTES, tooLarge: 'Thumbnail is too large.' });
  return result.ok ? result.value : undefined;
}

function serializeProject(project, errors) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    errors.project = 'Provide a valid planet project.';
    return null;
  }
  const params = project.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    errors.project = 'The project has no planet parameters.';
    return null;
  }
  const bodyType = normalizeBodyType(params.mode ?? 'planet');
  if (!bodyType) {
    errors.project = 'The project body type must be planet, gas, or star.';
    return null;
  }
  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {};
  const thumbnail = parseProjectThumbnail(metadata.thumbnail);
  const { thumbnail: _omitted, ...storedMetadata } = metadata;
  const projectData = JSON.stringify({ ...project, metadata: storedMetadata });
  if (Buffer.byteLength(projectData, 'utf8') > MAX_PROJECT_BYTES) {
    errors.project = 'Projects must be 1 MB or smaller.';
    return null;
  }
  return { projectData, bodyType, thumbnail };
}

function normalizeName(value, fallback, errors) {
  const name = String(value ?? fallback ?? '').trim();
  if (!name) errors.name = 'Enter a project name.';
  else if (name.length > 120) errors.name = 'Use no more than 120 characters.';
  return name;
}

function normalizeDescription(value, fallback, errors) {
  const description = String(value ?? fallback ?? '').trim();
  if (description.length > 1000) errors.description = 'Use no more than 1000 characters.';
  return description || null;
}

export function validateProjectCreate(input, defaultVisibility = 'private') {
  const errors = {};
  const serialized = serializeProject(input?.project, errors);
  const name = normalizeName(input?.name, input?.project?.metadata?.name, errors);
  const description = normalizeDescription(input?.description, input?.project?.metadata?.description, errors);
  const visibility = String(input?.visibility ?? defaultVisibility).toLowerCase();
  const sourceProjectId = String(input?.sourceProjectId ?? input?.project?.id ?? '').trim();
  if (!PROJECT_VISIBILITIES.includes(visibility)) errors.visibility = 'Choose private, unlisted, or public.';
  if (sourceProjectId.length > 128) errors.project = 'The local project identifier is too long.';
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      projectData: serialized?.projectData ?? null,
      bodyType: serialized?.bodyType ?? 'planet',
      thumbnail: serialized?.thumbnail ?? null,
      name,
      description,
      visibility,
      sourceProjectId: sourceProjectId || null,
    },
  };
}

export function validateProjectUpdate(input) {
  const errors = {};
  const value = {};
  let thumbnail;
  let expectedContentRevision = null;
  if (Object.hasOwn(input ?? {}, 'project')) {
    const serialized = serializeProject(input.project, errors);
    if (serialized) {
      value.projectData = serialized.projectData;
      value.bodyType = serialized.bodyType;
      thumbnail = serialized.thumbnail;
    }
  }
  if (Object.hasOwn(input ?? {}, 'name')) value.name = normalizeName(input.name, null, errors);
  if (Object.hasOwn(input ?? {}, 'description')) value.description = normalizeDescription(input.description, null, errors);
  if (Object.hasOwn(input ?? {}, 'visibility')) {
    value.visibility = String(input.visibility ?? '').toLowerCase();
    if (!PROJECT_VISIBILITIES.includes(value.visibility)) errors.visibility = 'Choose private, unlisted, or public.';
  }
  if (Object.hasOwn(input ?? {}, 'communityIcon')) {
    value.communityIcon = String(input.communityIcon ?? '').trim().toLowerCase();
    if (!PROJECT_COMMUNITY_ICONS.includes(value.communityIcon)) errors.communityIcon = 'Choose a supported community icon.';
  }
  if (Object.hasOwn(input ?? {}, 'expectedContentRevision')) {
    expectedContentRevision = Number(input.expectedContentRevision);
    if (!Number.isInteger(expectedContentRevision) || expectedContentRevision < 1) {
      errors.expectedContentRevision = 'Provide a valid cloud content revision.';
    } else if (!Object.hasOwn(input ?? {}, 'project') && !Object.hasOwn(input ?? {}, 'communityIcon')) {
      errors.expectedContentRevision = 'A cloud content revision can only protect a project update.';
    }
  }
  if (Object.keys(value).length === 0 && !Object.keys(errors).length) errors.project = 'Provide at least one project field.';
  return { ok: Object.keys(errors).length === 0, errors, value, thumbnail, expectedContentRevision };
}
