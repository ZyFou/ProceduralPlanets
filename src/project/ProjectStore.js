const DB_NAME = 'procedural-planets-projects';
const STORE_NAME = 'projects';
const SYNC_STORE_NAME = 'project-sync';
const DB_VERSION = 2;
const FALLBACK_KEY = 'procedural-planets-projects-v1';
const SYNC_FALLBACK_KEY = 'procedural-planets-project-sync-v1';

const COMMUNITY_ICON_BY_MODE = Object.freeze({ planet: 'orbit', gas: 'waves', star: 'sun' });
export const COMMUNITY_ICONS = Object.freeze(['orbit', 'globe', 'sun', 'waves', 'sparkles', 'moon']);

const now = () => new Date().toISOString();
const createId = () => globalThis.crypto?.randomUUID?.()
  ?? `planet-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function emitChange() {
  window.dispatchEvent(new Event('planet-projects:changed'));
}

function emitSyncChange() {
  window.dispatchEvent(new Event('planet-project-sync:changed'));
}

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(SYNC_STORE_NAME)) {
        database.createObjectStore(SYNC_STORE_NAME, { keyPath: 'localProjectId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

function fallbackRead(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); }
  catch { return []; }
}

function fallbackWrite(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function normalizeSyncBinding(input = {}) {
  const localProjectId = String(input.localProjectId ?? '').trim();
  const cloudProjectId = String(input.cloudProjectId ?? '').trim();
  const cloudContentRevision = Number(input.cloudContentRevision);
  const lastSyncedLocalModified = String(input.lastSyncedLocalModified ?? '').trim();
  if (!localProjectId || !cloudProjectId || !lastSyncedLocalModified || !Number.isInteger(cloudContentRevision) || cloudContentRevision < 1) return null;
  return { localProjectId, cloudProjectId, lastSyncedLocalModified, cloudContentRevision };
}

/** Which cloud copy each local project mirrors (see project/projectSync.js). */
export const projectSyncStore = {
  async list() {
    try {
      const bindings = await withStore(SYNC_STORE_NAME, 'readonly', (store) => store.getAll());
      return bindings.map(normalizeSyncBinding).filter(Boolean);
    } catch {
      return fallbackRead(SYNC_FALLBACK_KEY).map(normalizeSyncBinding).filter(Boolean);
    }
  },

  async get(localProjectId) {
    const key = String(localProjectId ?? '').trim();
    if (!key) return null;
    try {
      return normalizeSyncBinding(await withStore(SYNC_STORE_NAME, 'readonly', (store) => store.get(key)) ?? {});
    } catch {
      return normalizeSyncBinding(fallbackRead(SYNC_FALLBACK_KEY).find((item) => item.localProjectId === key) ?? {});
    }
  },

  async save(binding) {
    const normalized = normalizeSyncBinding(binding);
    if (!normalized) throw new Error('A complete cloud sync binding is required.');
    try { await withStore(SYNC_STORE_NAME, 'readwrite', (store) => store.put(normalized)); }
    catch {
      const bindings = fallbackRead(SYNC_FALLBACK_KEY).filter((item) => item.localProjectId !== normalized.localProjectId);
      bindings.push(normalized);
      fallbackWrite(SYNC_FALLBACK_KEY, bindings);
    }
    emitSyncChange();
    return normalized;
  },

  async remove(localProjectId) {
    const key = String(localProjectId ?? '').trim();
    if (!key) return;
    try { await withStore(SYNC_STORE_NAME, 'readwrite', (store) => store.delete(key)); }
    catch { fallbackWrite(SYNC_FALLBACK_KEY, fallbackRead(SYNC_FALLBACK_KEY).filter((item) => item.localProjectId !== key)); }
    emitSyncChange();
  },
};

export function projectMode(project) {
  const mode = project?.params?.mode;
  return mode === 'gas' || mode === 'star' ? mode : 'planet';
}

export function normalizeProject(input = {}) {
  const created = input.metadata?.created ?? input.created ?? now();
  const params = { ...(input.params ?? {}) };
  const communityIcon = COMMUNITY_ICONS.includes(input.metadata?.communityIcon)
    ? input.metadata.communityIcon
    : COMMUNITY_ICON_BY_MODE[projectMode({ params })];
  return {
    schemaVersion: 1,
    id: input.id ?? createId(),
    metadata: {
      name: String(input.metadata?.name ?? input.name ?? 'Untitled planet').trim() || 'Untitled planet',
      description: String(input.metadata?.description ?? ''),
      created,
      modified: input.metadata?.modified ?? input.modified ?? now(),
      thumbnail: input.metadata?.thumbnail ?? null,
      templateId: input.metadata?.templateId ?? input.templateId ?? 'blank',
      communityIcon,
    },
    params,
  };
}

export const projectStore = {
  async list() {
    const byModified = (a, b) => b.metadata.modified.localeCompare(a.metadata.modified);
    try {
      const projects = await withStore(STORE_NAME, 'readonly', (store) => store.getAll());
      return projects.map(normalizeProject).sort(byModified);
    } catch {
      return fallbackRead(FALLBACK_KEY).map(normalizeProject).sort(byModified);
    }
  },

  async get(projectId) {
    try {
      const project = await withStore(STORE_NAME, 'readonly', (store) => store.get(projectId));
      return project ? normalizeProject(project) : null;
    } catch {
      const project = fallbackRead(FALLBACK_KEY).find((item) => item.id === projectId);
      return project ? normalizeProject(project) : null;
    }
  },

  /**
   * Persist a project. `touch: false` keeps `modified` as is, for changes
   * that are not edits (a new card thumbnail) and so must not make a synced
   * project look locally changed.
   */
  async save(project, { touch = true } = {}) {
    const normalized = normalizeProject(project);
    if (touch) normalized.metadata.modified = now();
    try {
      await withStore(STORE_NAME, 'readwrite', (store) => store.put(normalized));
    } catch {
      const projects = fallbackRead(FALLBACK_KEY);
      const index = projects.findIndex((item) => item.id === normalized.id);
      if (index >= 0) projects[index] = normalized;
      else projects.push(normalized);
      fallbackWrite(FALLBACK_KEY, projects);
    }
    emitChange();
    return normalized;
  },

  async remove(projectId) {
    try { await withStore(STORE_NAME, 'readwrite', (store) => store.delete(projectId)); }
    catch { fallbackWrite(FALLBACK_KEY, fallbackRead(FALLBACK_KEY).filter((project) => project.id !== projectId)); }
    await projectSyncStore.remove(projectId);
    emitChange();
  },

  async rename(project, name) {
    const nextName = String(name ?? '').trim();
    if (!nextName) throw new Error('A project name is required.');
    return this.save({ ...project, metadata: { ...project.metadata, name: nextName } });
  },

  async duplicate(project, { name } = {}) {
    return this.save({
      ...project,
      id: createId(),
      metadata: {
        ...project.metadata,
        name: String(name ?? `${project.metadata.name} copy`),
        created: now(),
        modified: now(),
      },
    });
  },

  /** Save a project that came from elsewhere (file, cloud, share code) as a new local copy. */
  async importCopy(project, { name } = {}) {
    return this.save({
      ...project,
      id: createId(),
      metadata: {
        ...project?.metadata,
        name: String(name ?? project?.metadata?.name ?? 'Shared planet'),
        created: now(),
      },
    });
  },
};
