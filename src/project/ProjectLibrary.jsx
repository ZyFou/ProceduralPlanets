import { translate, getIntlLocale } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Cloud, CloudDownload, CloudUpload, Copy, EllipsisVertical, HardDrive,
  Eye, FolderOpen, Globe2, Lock, Orbit, Pencil, Plus, RefreshCw, Search, Sun, Trash2, Upload, Waves,
} from 'lucide-react';
import { projectThumbnailUrl } from '../auth/authApi.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { usePopup } from '../components/ui/PopupProvider.jsx';
import { copyText } from '../utils/clipboard.js';
import { projectMode, projectSyncStore } from './ProjectStore.js';
import { projectApi } from './projectApi.js';
import { buildUnifiedProjectIndex } from './projectSync.js';
import { downloadProject, uploadProject } from './cloudSync.js';
import { PROJECT_FILE_ACCEPT } from './ProjectDocument.js';

const visibilityIcons = { private: Lock, unlisted: Eye, public: Globe2 };
const BODY = {
  planet: { label: 'Planet', Icon: Orbit },
  gas: { label: 'Gas', Icon: Waves },
  star: { label: 'Star', Icon: Sun },
};

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return translate('unknown time');
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return translate('just now');
  if (seconds < 3600) return translate("{0}m ago", { 0: Math.floor(seconds / 60) });
  if (seconds < 86400) return translate("{0}h ago", { 0: Math.floor(seconds / 3600) });
  if (seconds < 604800) return translate("{0}d ago", { 0: Math.floor(seconds / 86400) });
  return new Intl.DateTimeFormat(getIntlLocale(), { month: 'short', day: 'numeric' }).format(new Date(value));
}

function projectName(entry) {
  return entry.localProject?.metadata.name ?? entry.cloudProject?.name ?? translate('Untitled planet');
}

function projectDescription(entry) {
  return entry.localProject?.metadata.description || entry.cloudProject?.description || '';
}

export default function ProjectLibrary({
  localProjects,
  bootReady,
  exiting,
  onOpen,
  onCreate,
  onImportFile,
  onRename,
  onDuplicate,
  onDelete,
  projectActionBusy,
  onSignIn,
}) {
  useLocale();
  const { user, status: authStatus } = useAuth();
  const { showChoice, showConfirm, showPopup } = usePopup();
  const [cloudProjects, setCloudProjects] = useState([]);
  const [bindings, setBindings] = useState([]);
  const [cloudStatus, setCloudStatus] = useState('idle');
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [busyId, setBusyId] = useState('');
  const fileInputRef = useRef(null);

  const loadBindings = useCallback(async () => {
    setBindings(await projectSyncStore.list());
  }, []);

  const refreshCloud = useCallback(async () => {
    if (!user) {
      setCloudProjects([]);
      setCloudStatus('idle');
      return [];
    }
    setCloudStatus('loading');
    try {
      const result = await projectApi.listMine();
      setCloudProjects(result.projects);
      setCloudStatus('ready');
      return result.projects;
    } catch (error) {
      setCloudStatus('error');
      return [];
    }
  }, [user]);

  useEffect(() => {
    loadBindings();
    window.addEventListener('planet-project-sync:changed', loadBindings);
    return () => window.removeEventListener('planet-project-sync:changed', loadBindings);
  }, [loadBindings]);

  useEffect(() => {
    if (user) refreshCloud();
    else {
      setCloudProjects([]);
      setCloudStatus('idle');
    }
  }, [refreshCloud, user]);

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor]);

  const entries = useMemo(
    () => buildUnifiedProjectIndex({ localProjects, cloudProjects, bindings }),
    [bindings, cloudProjects, localProjects],
  );
  const visibleEntries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? entries.filter((entry) => `${projectName(entry)} ${projectDescription(entry)}`.toLowerCase().includes(term)) : entries;
  }, [entries, query]);

  const download = useCallback(async (entry, { openAfter = false } = {}) => {
    const cloudProject = entry.cloudProject;
    if (!cloudProject || busyId) return null;
    setBusyId(entry.id);
    try {
      const localProject = await downloadProject(cloudProject.id, { localProject: entry.localProject });
      await refreshCloud();
      if (openAfter) onOpen(localProject);
      else showPopup(translate("{0} downloaded from the cloud.", { 0: localProject.metadata.name }), { type: 'success' });
      return localProject;
    } catch (error) {
      showPopup(error.message || translate('Could not download this project.'), { type: 'error' });
      return null;
    } finally {
      setBusyId('');
    }
  }, [busyId, onOpen, refreshCloud, showPopup]);

  const upload = useCallback(async (entry) => {
    const localProject = entry.localProject;
    if (!localProject || busyId) return;
    setBusyId(entry.id);
    try {
      await uploadProject(localProject, {
        cloudProject: entry.cloudProject,
        binding: entry.binding,
        visibility: user?.defaultProjectVisibility,
      });
      await refreshCloud();
      showPopup(translate("{0} synced to the cloud.", { 0: localProject.metadata.name }), { type: 'success' });
    } catch (error) {
      if (error.code === 'PROJECT_SYNC_CONFLICT') {
        await refreshCloud();
        showPopup(translate('The cloud copy changed while syncing. Choose a version to continue.'), { type: 'info' });
      } else {
        showPopup(error.message || translate('Could not sync this project.'), { type: 'error' });
      }
    } finally {
      setBusyId('');
    }
  }, [busyId, refreshCloud, showPopup, user?.defaultProjectVisibility]);

  const sync = useCallback(async (entry) => {
    if (!user || busyId) return;
    if (entry.state === 'cloud-only' || entry.state === 'cloud-changes') {
      await download(entry);
      return;
    }
    if (entry.state === 'conflict' || entry.state === 'needs-review') {
      const choice = await showChoice({
        title: entry.state === 'conflict' ? translate('Resolve sync conflict') : translate('Review cloud copy'),
        message: translate("{0} has versions on this device and in the cloud. Choose the version to keep.", { 0: projectName(entry) }),
        actions: [
          { value: 'local', label: translate('Keep local and upload') },
          { value: 'cloud', label: translate('Keep cloud and download') },
        ],
      });
      if (choice === 'local') await upload(entry);
      if (choice === 'cloud') await download(entry);
      return;
    }
    if (entry.state === 'synced') {
      await refreshCloud();
      showPopup(translate("{0} is up to date.", { 0: projectName(entry) }), { type: 'success' });
      return;
    }
    await upload(entry);
  }, [busyId, download, refreshCloud, showChoice, showPopup, upload, user]);

  const openEntry = useCallback(async (entry) => {
    if (entry.localProject) {
      onOpen(entry.localProject);
      return;
    }
    await download(entry, { openAfter: true });
  }, [download, onOpen]);

  const changeVisibility = useCallback(async (entry, visibility) => {
    if (!entry.cloudProject || busyId) return;
    setBusyId(entry.id);
    try {
      await projectApi.update(entry.cloudProject.id, { visibility });
      await refreshCloud();
      showPopup(translate("{0} is now {1}.", { 0: projectName(entry), 1: translate(visibility) }), { type: 'success' });
    } catch (error) {
      showPopup(error.message || translate('Could not change project visibility.'), { type: 'error' });
    } finally {
      setBusyId('');
      setMenuFor(null);
    }
  }, [busyId, refreshCloud, showPopup]);

  const removeCloudCopy = useCallback(async (entry) => {
    if (!entry.cloudProject || busyId) return;
    const confirmed = await showConfirm({
      title: translate('Remove cloud copy?'),
      message: translate("Remove “{0}” from the cloud? Your local project will remain available.", { 0: projectName(entry) }),
      confirmLabel: translate('Remove cloud copy'),
      danger: true,
    });
    if (!confirmed) return;
    setBusyId(entry.id);
    try {
      await projectApi.remove(entry.cloudProject.id);
      if (entry.localProject) await projectSyncStore.remove(entry.localProject.id);
      await refreshCloud();
      showPopup(translate('Cloud copy removed. Your local project is unchanged.'), { type: 'success' });
    } catch (error) {
      showPopup(error.message || translate('Could not remove this cloud copy.'), { type: 'error' });
    } finally {
      setBusyId('');
      setMenuFor(null);
    }
  }, [busyId, refreshCloud, showConfirm, showPopup]);

  const isCloudUsable = Boolean(user) && cloudStatus === 'ready';
  const empty = visibleEntries.length === 0;

  return (
    <section className="project-library" aria-label={translate("Projects")}>
      <div className="project-library-head">
        <div className="lp-search project-library-search">
          <Search size={14} aria-hidden />
          <input type="search" placeholder={translate("Search projects…")} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={translate("Search projects")} />
        </div>
        <div className="lp-head-actions">
          <button type="button" className="lp-secondary sm" onClick={() => fileInputRef.current?.click()} disabled={!bootReady || exiting}><Upload size={13} /> {translate("Import")}</button>
          <button type="button" className="lp-primary sm" onClick={onCreate} disabled={!bootReady || exiting}><Plus size={14} /> {translate("New planet")}</button>
        </div>
      </div>

      {!user && authStatus !== 'loading' && (
        <div className="project-cloud-note">
          <Cloud size={16} aria-hidden />
          <span>{authStatus === 'unavailable' ? translate('Cloud sync is unavailable right now. Your local projects are safe on this device.') : translate('Sign in to sync projects, download cloud copies, and manage sharing visibility.')}</span>
          {authStatus !== 'unavailable' && <button type="button" onClick={onSignIn}>{translate("Sign in")}</button>}
        </div>
      )}
      {user && cloudStatus === 'loading' && <div className="project-cloud-note checking"><RefreshCw size={15} className="spin" aria-hidden /><span>{translate("Checking your cloud projects…")}</span></div>}
      {user && cloudStatus === 'error' && <div className="project-cloud-note error"><AlertTriangle size={16} aria-hidden /><span>{translate("Cloud projects could not be checked. Local projects remain available.")}</span><button type="button" onClick={refreshCloud}>{translate("Try again")}</button></div>}

      {empty ? (
        query.trim() ? <p className="lp-no-results">{translate("No project matches “{0}”.", { 0: query.trim() })}</p> : (
          <div className="lp-empty project-library-empty">
            <FolderOpen size={24} />
            <strong>{translate("No projects yet")}</strong>
            <span>{translate("Create a planet, import a .ppplanet file, or download a project from the cloud.")}</span>
            <button type="button" className="lp-primary" onClick={onCreate} disabled={!bootReady || exiting}><Plus size={15} /> {translate("Create planet")}</button>
          </div>
        )
      ) : (
        <div className="project-library-grid">
          {visibleEntries.map((entry) => {
            const localProject = entry.localProject;
            const cloudProject = entry.cloudProject;
            const VisibilityIcon = visibilityIcons[cloudProject?.visibility] || Lock;
            const isBusy = busyId === entry.id;
            const statusLabel = user && cloudStatus === 'error' && entry.state !== 'cloud-only' ? translate('Cloud unavailable') : translate(entry.label);
            const name = projectName(entry);
            const modified = localProject?.metadata.modified ?? cloudProject?.updatedAt;
            const isConflict = entry.state === 'conflict' || entry.state === 'needs-review';
            const body = BODY[localProject ? projectMode(localProject) : cloudProject?.bodyType] ?? BODY.planet;
            const thumbnail = localProject?.metadata.thumbnail || projectThumbnailUrl(cloudProject);
            return (
              <article className={`project-library-card ${entry.state}${menuFor === entry.id ? ' menu-open' : ''}`} key={entry.id}>
                <button type="button" className="project-library-main" onClick={() => openEntry(entry)} disabled={isBusy || !bootReady || exiting || (!localProject && !isCloudUsable)}>
                  <span className="project-library-thumb">
                    {thumbnail ? <img src={thumbnail} alt="" /> : <body.Icon size={28} strokeWidth={1.5} />}
                  </span>
                  <span className="lp-template-kind-badge">{translate(body.label)}</span>
                  {cloudProject && <span className={`project-library-cloud-badge ${cloudProject.visibility}`} title={translate("In the cloud · {0}", { 0: translate(cloudProject.visibility) })} aria-label={translate("In the cloud · {0}", { 0: translate(cloudProject.visibility) })}><Cloud size={12} /><VisibilityIcon size={12} /></span>}
                  <span className="project-library-copy">
                    <strong>{name}</strong>
                    <small className="project-library-time"><Clock size={11} aria-hidden /> {translate("Updated")} {relativeTime(modified)}</small>
                  </span>
                </button>
                <div className="project-library-footer">
                  <span className={`project-library-status icon-only${isConflict ? ' attention' : ''}`} title={translate(statusLabel)} aria-label={translate(statusLabel)}><span className="project-library-status-icon">{isConflict ? <AlertTriangle size={14} aria-hidden /> : entry.state === 'synced' ? <CheckCircle2 size={14} aria-hidden /> : localProject && !cloudProject ? <HardDrive size={14} aria-hidden /> : <Cloud size={14} aria-hidden />}</span></span>
                  <div className="project-library-actions">
                    <button type="button" className="project-library-sync" onClick={() => sync(entry)} disabled={isBusy || !isCloudUsable} aria-label={`${translate(entry.action)} ${name}`}>
                      {isBusy ? <RefreshCw size={13} className="spin" /> : entry.state === 'cloud-only' || entry.state === 'cloud-changes' ? <CloudDownload size={13} /> : <CloudUpload size={13} />}
                      {translate(entry.action)}
                    </button>
                    <button type="button" className="project-library-menu-button" aria-label={translate("Actions for {0}", { 0: name })} aria-expanded={menuFor === entry.id} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMenuFor((current) => current === entry.id ? null : entry.id)}><EllipsisVertical size={16} /></button>
                  </div>
                </div>
                {menuFor === entry.id && (
                  <div className="project-library-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
                    {localProject && <>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); openEntry(entry); }} disabled={!bootReady || exiting}><FolderOpen size={13} /> {translate("Open")}</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onRename(localProject); }} disabled={projectActionBusy}><Pencil size={13} /> {translate("Rename")}</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onDuplicate(localProject); }} disabled={projectActionBusy}><Copy size={13} /> {translate("Duplicate")}</button>
                    </>}
                    {cloudProject && <>
                      <span className="project-library-menu-label">{translate("Cloud visibility")}</span>
                      <div className="project-library-visibility-actions" role="group" aria-label={translate("Cloud visibility for {0}", { 0: name })}>
                        {Object.entries(visibilityIcons).map(([visibility, Icon]) => <button key={visibility} type="button" className={cloudProject.visibility === visibility ? 'active' : ''} onClick={() => changeVisibility(entry, visibility)} disabled={isBusy} title={translate(visibility)}><Icon size={13} /><span>{translate(visibility)}</span></button>)}
                      </div>
                      {cloudProject.visibility !== 'private' && <button type="button" role="menuitem" onClick={() => copyText(cloudProject.shareCode).then(() => showPopup(translate("Copied {0}.", { 0: cloudProject.shareCode }), { type: 'success' })).catch((error) => showPopup(error.message, { type: 'error' }))}><Copy size={13} /> {translate("Copy sharing code")}</button>}
                      <button type="button" role="menuitem" className="danger" onClick={() => removeCloudCopy(entry)} disabled={isBusy}><Cloud size={13} /> {translate("Remove cloud copy")}</button>
                    </>}
                    {localProject && <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); onDelete(localProject); }} disabled={projectActionBusy}><Trash2 size={13} /> {translate("Delete local project")}</button>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept={PROJECT_FILE_ACCEPT} hidden onChange={(event) => { onImportFile(event.target.files?.[0]); event.target.value = ''; }} />
    </section>
  );
}
