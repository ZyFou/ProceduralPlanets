import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import App from './App.jsx';
import Landing from './landing/Landing.jsx';
import { PROJECT_TEMPLATES, createTemplateParams, getProjectTemplate } from './project/ProjectTemplates.js';
import { normalizeProject, projectStore } from './project/ProjectStore.js';
import './landing/landing.css';

const EXIT_MS = 520;

export default function Root() {
  const [landingVisible, setLandingVisible] = useState(true);
  const [landingExiting, setLandingExiting] = useState(false);
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [templateThumbs, setTemplateThumbs] = useState({});
  const saveTimerRef = useRef(null);

  const refreshProjects = useCallback(async () => {
    setProjects(await projectStore.list());
  }, []);

  useEffect(() => {
    refreshProjects();
    window.addEventListener('planet-projects:changed', refreshProjects);
    return () => window.removeEventListener('planet-projects:changed', refreshProjects);
  }, [refreshProjects]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

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

  const showLanding = useCallback(() => {
    setLandingExiting(false);
    setLandingVisible(true);
    refreshProjects();
  }, [refreshProjects]);

  const updateProjectParams = useCallback((params) => {
    setCurrentProject((project) => {
      if (!project || project.preview) return project;
      const updated = { ...project, params: { ...params } };
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => projectStore.save(updated).catch(() => {}), 450);
      return updated;
    });
  }, []);

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
      projectStore.save(updated).catch(() => {});
      return updated;
    });
  }, []);

  const renameProject = useCallback(async (project, name) => {
    if (!name?.trim()) return;
    const renamed = await projectStore.rename(project, name);
    if (currentProject?.id === renamed.id) setCurrentProject(renamed);
  }, [currentProject?.id]);

  const duplicateProject = useCallback(async (project) => {
    await projectStore.duplicate(project);
  }, []);

  const deleteProject = useCallback(async (project) => {
    await projectStore.remove(project.id);
    if (currentProject?.id === project.id) setCurrentProject(null);
  }, [currentProject?.id]);

  const landingProps = useMemo(() => ({
    projects,
    templates: PROJECT_TEMPLATES,
    templateThumbs,
    exiting: landingExiting,
    onOpen: openEditor,
    onCreate: createProject,
    onPreview: previewTemplate,
    onRename: renameProject,
    onDuplicate: duplicateProject,
    onDelete: deleteProject,
  }), [projects, templateThumbs, landingExiting, openEditor, createProject, previewTemplate, renameProject, duplicateProject, deleteProject]);

  return (
    <>
      <App project={currentProject} landingMode={landingVisible} onHome={showLanding} onProjectChange={updateProjectParams} onThumbnail={captureThumbnail} />
      {landingVisible && <Landing {...landingProps} />}
    </>
  );
}

