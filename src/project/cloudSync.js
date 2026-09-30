import { projectApi } from './projectApi.js';
import { projectStore, projectSyncStore } from './ProjectStore.js';
import { syncBindingFor } from './projectSync.js';

// Local <-> cloud transfer shared by the Projects library and the editor's
// Save. A binding records which cloud copy a local project mirrors, the local
// `modified` stamp and the cloud `contentRevision` at the last sync, so later
// edits on either side can be told apart (see projectSync.js).

/**
 * Upload a local project. Updates its bound cloud copy (guarded by the last
 * synced revision: a copy changed elsewhere rejects with
 * code PROJECT_SYNC_CONFLICT) or creates one.
 */
export async function uploadProject(localProject, { cloudProject = null, binding = null, visibility } = {}) {
  const body = {
    project: localProject,
    name: localProject.metadata.name,
    description: localProject.metadata.description,
  };
  const result = cloudProject
    ? await projectApi.update(cloudProject.id, {
      ...body,
      expectedContentRevision: binding?.cloudContentRevision ?? cloudProject.contentRevision,
    })
    : await projectApi.create({ ...body, sourceProjectId: localProject.id, visibility });
  await projectSyncStore.save(syncBindingFor(localProject, result.project));
  return result.project;
}

/**
 * Download a cloud project into the local store: over `localProject` when
 * given, otherwise as a new local copy. Returns the saved local project.
 */
export async function downloadProject(cloudProjectId, { localProject = null } = {}) {
  const { project: remote } = await projectApi.getMine(cloudProjectId);
  const payload = { ...remote.data, metadata: { ...remote.data.metadata, name: remote.name } };
  // The cloud stores the card thumbnail separately; keep the local render
  // until the editor captures a fresh one.
  const saved = localProject
    ? await projectStore.save({
      ...payload,
      id: localProject.id,
      metadata: { ...payload.metadata, created: localProject.metadata.created, thumbnail: localProject.metadata.thumbnail ?? null },
    })
    : await projectStore.importCopy(payload, { name: remote.name });
  await projectSyncStore.save(syncBindingFor(saved, remote));
  return saved;
}

/**
 * Editor Save: push a just-saved local project to the cloud when it is
 * bound to a cloud copy. Returns the cloud summary, or null when the project
 * is local-only. Unbound projects are never uploaded implicitly.
 */
export async function pushBoundProject(localProject) {
  const binding = await projectSyncStore.get(localProject.id);
  if (!binding) return null;
  return uploadProject(localProject, { cloudProject: { id: binding.cloudProjectId }, binding });
}
