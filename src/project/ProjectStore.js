const DB_NAME = 'procedural-planets-projects';
const STORE_NAME = 'projects';
const DB_VERSION = 1;
const FALLBACK_KEY = 'procedural-planets-projects-v1';

const now = () => new Date().toISOString();
const createId = () => globalThis.crypto?.randomUUID?.()
  ?? `planet-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function emitChange() {
  window.dispatchEvent(new Event('planet-projects:changed'));
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

function fallbackRead() {
  try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? '[]'); }
  catch { return []; }
}

function fallbackWrite(projects) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(projects));
}

export function normalizeProject(input = {}) {
  const created = input.metadata?.created ?? input.created ?? now();
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
    },
    params: { ...(input.params ?? {}) },
  };
}

export const projectStore = {
  async list() {
    try {
      const projects = await withStore('readonly', (store) => store.getAll());
      return projects.map(normalizeProject).sort((a, b) => b.metadata.modified.localeCompare(a.metadata.modified));
    } catch {
      return fallbackRead().map(normalizeProject).sort((a, b) => b.metadata.modified.localeCompare(a.metadata.modified));
    }
  },

  async save(project) {
    const normalized = normalizeProject(project);
    normalized.metadata.modified = now();
    try {
      await withStore('readwrite', (store) => store.put(normalized));
    } catch {
      const projects = fallbackRead();
      const index = projects.findIndex((item) => item.id === normalized.id);
      if (index >= 0) projects[index] = normalized;
      else projects.push(normalized);
      fallbackWrite(projects);
    }
    emitChange();
    return normalized;
  },

  async remove(projectId) {
    try { await withStore('readwrite', (store) => store.delete(projectId)); }
    catch { fallbackWrite(fallbackRead().filter((project) => project.id !== projectId)); }
    emitChange();
  },

  async rename(project, name) {
    const nextName = String(name ?? '').trim();
    if (!nextName) throw new Error('A project name is required.');
    return this.save({ ...project, metadata: { ...project.metadata, name: nextName } });
  },

  async duplicate(project) {
    return this.save({
      ...project,
      id: createId(),
      metadata: {
        ...project.metadata,
        name: `${project.metadata.name} copy`,
        created: now(),
        modified: now(),
      },
    });
  },
};
