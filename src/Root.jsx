import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import App from './App.jsx';
import Landing from './landing/Landing.jsx';
import { PROJECT_TEMPLATES, createTemplateParams, getProjectTemplate } from './project/ProjectTemplates.js';
import { cloneProjectData, normalizeProject, projectStore, projectSyncStore } from './project/ProjectStore.js';
import { downloadProjectDocument, readProjectFile } from './project/ProjectDocument.js';
import { pushBoundProject } from './project/cloudSync.js';
import { adminApi } from './admin/adminApi.js';
import { useAuth } from './auth/AuthContext.jsx';
import { usePopup } from './components/ui/PopupProvider.jsx';
import './landing/landing.css';

const Exploration = lazy(() => import('./exploration/Exploration.jsx'));

const EXIT_MS = 520;
const AUTOSAVE_MS = 450;

export default function Root() {
  const { user } = useAuth();
  const { showPopup, showPrompt } = usePopup();
  const [exploring, setExploring] = useState(false);
  const [landingVisible, setLandingVisible] = useState(true);
  const [landingExiting, setLandingExiting] = useState(false);
  const [landingCreateOpen, setLandingCreateOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [templateThumbs, setTemplateThumbs] = useState({});
  const [binding, setBinding] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const saveTimerRef = useRef(null);
  const currentProjectRef = useRef(null);
  currentProjectRef.current = currentProject;

  const refreshProjects = useCallback(async () => {
    setProjects(await projectStore.list());
  }, []);

  useEffect(() => {
    refreshProjects();
    window.addEventListener('planet-projects:changed', refreshProjects);
    return () => window.removeEventListener('planet-projects:changed', refreshProjects);
  }, [refreshProjects]);

  useEffect(() => {
    const path = `${window.location.pathname}${window.location.hash.split('?')[0] || ''}`.slice(0, 255);
    adminApi.trackVisit(path).catch(() => {});
  }, []);

  // cloud binding of the open project, for the top bar's document state
  const currentId = currentProject?.preview ? null : currentProject?.id;
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!currentId) { setBinding(null); return; }
      projectSyncStore.get(currentId).then((value) => { if (!cancelled) setBinding(value); });
    };
    load();
    window.addEventListener('planet-project-sync:changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('planet-project-sync:changed', load);
    };
  }, [currentId]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // account / share links (#/login, #/community?code=…) live on the landing
  useEffect(() => {
    const onHashChange = () => {
      if (!window.location.hash.replace(/^#\/?/, '')) return;
      setLandingExiting(false);
      setLandingVisible(true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** Write a project now and mirror its new `modified` stamp into state. */
  const persist = useCallback(async (project, options) => {
    const saved = await projectStore.save(project, options);
    setCurrentProject((current) => (current?.id === saved.id
      ? { ...current, metadata: { ...current.metadata, modified: saved.metadata.modified } }
      : current));
    return saved;
  }, []);

  const scheduleSave = useCallback((project) => {
    clearTimeout(saveTimerRef.current);
    setSaving(true);
    saveTimerRef.current = setTimeout(() => {
      persist(project).catch(() => {}).finally(() => setSaving(false));
    }, AUTOSAVE_MS);
  }, [persist]);

  const openEditor = useCallback((project) => {
    setCurrentProject(project);
    setLandingExiting(true);
    setTimeout(() => {
      setLandingVisible(false);
      setLandingExiting(false);
    }, EXIT_MS);
  }, []);

  const createProject = useCallback(async (templateId) => {
    const template = getProjectTemplate(templateId);
    const project = await projectStore.save(normalizeProject({
      metadata: {
        name: template.name,
        description: template.description,
        templateId: template.id,
        thumbnail: templateThumbs[template.id] ?? null,
      },
      params: createTemplateParams(template.id),
    }));
    openEditor(project);
  }, [openEditor, templateThumbs]);

  const previewTemplate = useCallback((templateId) => {
    const template = getProjectTemplate(templateId);
    setCurrentProject({
      id: `preview-${template.id}`,
      metadata: { name: template.name, description: template.description, templateId: template.id, thumbnail: null },
      params: createTemplateParams(template.id),
      preview: true,
    });
  }, []);

  const showLanding = useCallback(({ create = false } = {}) => {
    setLandingExiting(false);
    setLandingCreateOpen(create);
    setLandingVisible(true);
    refreshProjects();
  }, [refreshProjects]);

  const updateProjectParams = useCallback((params, design = {}) => {
    setCurrentProject((project) => {
      if (!project || project.preview) return project;
      const updated = {
        ...project,
        params: cloneProjectData(params),
        ...(design.terrain !== undefined ? { terrain: cloneProjectData(design.terrain) } : {}),
        ...(design.editor !== undefined ? { editor: cloneProjectData(design.editor) } : {}),
      };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  const renameCurrent = useCallback((name) => {
    setCurrentProject((project) => {
      if (!project || project.preview) return project;
      const updated = { ...project, metadata: { ...project.metadata, name } };
      if (name.trim()) scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  // A new card thumbnail is not an edit: it must not mark a synced project changed.
  const captureThumbnail = useCallback((projectId, dataUrl) => {
    if (!dataUrl) return;
    if (projectId?.startsWith('preview-')) {
      const templateId = projectId.replace(/^preview-/, '');
      setTemplateThumbs((current) => current[templateId] ? current : { ...current, [templateId]: dataUrl });
      return;
    }
    setCurrentProject((project) => {
      if (!project || project.id !== projectId || project.metadata.thumbnail === dataUrl) return project;
      const updated = { ...project, metadata: { ...project.metadata, thumbnail: dataUrl } };
      projectStore.save(updated, { touch: false }).catch(() => {});
      return updated;
    });
  }, []);

  /** Ctrl+S: write locally now, then push to the bound cloud copy (if any). */
  const saveNow = useCallback(async () => {
    const project = currentProjectRef.current;
    if (!project || project.preview) return;
    if (!project.metadata.name.trim()) {
      showPopup('Give the project a name before saving.', { type: 'error' });
      return;
    }
    clearTimeout(saveTimerRef.current);
    setSaving(false);
    const saved = await persist(project);
    const bound = await projectSyncStore.get(saved.id);
    if (!bound) {
      showPopup(user
        ? `${saved.metadata.name} saved on this device. Sync it from Projects to keep a cloud copy.`
        : `${saved.metadata.name} saved on this device.`, { type: 'success' });
      return;
    }
    if (!user) {
      showPopup(`${saved.metadata.name} saved on this device. Sign in to sync the cloud copy.`, { type: 'info' });
      return;
    }
    setSyncing(true);
    try {
      await pushBoundProject(saved);
      showPopup(`${saved.metadata.name} saved and synced to the cloud.`, { type: 'success' });
    } catch (error) {
      if (error.code === 'PROJECT_SYNC_CONFLICT') {
        showPopup('The cloud copy was changed elsewhere. Your work is saved on this device; open Projects to choose which version to keep.', { type: 'error', title: 'Sync conflict' });
      } else if (error.code === 'PROJECT_NOT_FOUND') {
        showPopup('The cloud copy no longer exists. Your work is saved on this device; sync it again from Projects.', { type: 'error' });
      } else {
        showPopup(`Saved on this device, but the cloud sync failed: ${error.message}`, { type: 'error' });
      }
    } finally {
      setSyncing(false);
    }
  }, [persist, showPopup, user]);

  const saveAs = useCallback(async () => {
    const project = currentProjectRef.current;
    if (!project || project.preview) return;
    const name = (await showPrompt({
      title: 'Save as a new project',
      inputLabel: 'Project name',
      initialValue: `${project.metadata.name} copy`,
      confirmLabel: 'Save copy',
      maxLength: 120,
    }))?.trim();
    if (!name) return;
    clearTimeout(saveTimerRef.current);
    setSaving(false);
    await projectStore.save(project);
    const copy = await projectStore.duplicate(project, { name });
    setCurrentProject(copy);
    showPopup(`Saved as ${name}. You are now editing the copy.`, { type: 'success' });
  }, [showPopup, showPrompt]);

  const importFile = useCallback(async (file, { open = true } = {}) => {
    try {
      const project = await projectStore.importCopy(await readProjectFile(file));
      showPopup(`${project.metadata.name} imported.`, { type: 'success' });
      if (open) {
        if (landingVisible) openEditor(project);
        else setCurrentProject(project);
      }
      return project;
    } catch (error) {
      showPopup(error.message || 'Could not import this file.', { type: 'error', title: 'Import failed' });
      return null;
    }
  }, [landingVisible, openEditor, showPopup]);

  const downloadCurrent = useCallback(() => {
    const project = currentProjectRef.current;
    if (!project || project.preview) return;
    downloadProjectDocument(project);
  }, []);

  const renameProject = useCallback(async (project, name) => {
    if (!name?.trim()) return;
    const renamed = await projectStore.rename(project, name);
    if (currentProjectRef.current?.id === renamed.id) setCurrentProject(renamed);
  }, []);

  const duplicateProject = useCallback(async (project) => {
    await projectStore.duplicate(project);
  }, []);

  const deleteProject = useCallback(async (project) => {
    await projectStore.remove(project.id);
    if (currentProjectRef.current?.id === project.id) setCurrentProject(null);
  }, []);

  let documentState = 'local';
  if (syncing) documentState = 'syncing';
  else if (saving) documentState = 'saving';
  else if (binding) documentState = binding.lastSyncedLocalModified === currentProject?.metadata.modified ? 'synced' : 'unsynced';

  const landingProps = useMemo(() => ({
    projects,
    templates: PROJECT_TEMPLATES,
    templateThumbs,
    exiting: landingExiting,
    initialCreateOpen: landingCreateOpen,
    onOpen: openEditor,
    onCreate: createProject,
    onPreview: previewTemplate,
    onImportFile: importFile,
    onRename: renameProject,
    onDuplicate: duplicateProject,
    onDelete: deleteProject,
  }), [projects, templateThumbs, landingExiting, landingCreateOpen, openEditor, createProject, previewTemplate, importFile, renameProject, duplicateProject, deleteProject]);

  return (
    <>
      <div style={{ height: '100%', display: exploring ? 'none' : undefined }}>
        <App
          project={currentProject}
          landingMode={landingVisible || exploring}
          suspended={exploring}
          onExplore={() => setExploring(true)}
          documentState={documentState}
          onHome={showLanding}
          onNew={() => showLanding({ create: true })}
          onProjectChange={updateProjectParams}
          onRename={renameCurrent}
          onSave={saveNow}
          onSaveAs={saveAs}
          onLoadFile={importFile}
          onDownload={downloadCurrent}
          onThumbnail={captureThumbnail}
        />
        {landingVisible && <Landing {...landingProps} onExplore={() => setExploring(true)} />}
      </div>
      {exploring && <Suspense fallback={<div role="status">Opening exploration…</div>}><Exploration onExit={() => setExploring(false)} /></Suspense>}
    </>
  );
}
