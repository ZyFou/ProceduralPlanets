import LanguageSwitcher from '../i18n/LanguageSwitcher.jsx';
import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CircleHelp,
  Clock3,
  Cloud,
  CloudOff,
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  Github,
  Globe2,
  Layers3,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Menu,
  Mountain,
  MoreVertical,
  Orbit,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  Waves,
  X,
} from 'lucide-react';
import { APP_NAME, APP_VERSION, AUTHOR_EMAIL, AUTHOR_PORTFOLIO_URL, GITHUB_REPO_URL, PROCEDURAL_TERRAINS_URL } from '../constants/app.js';
import { Logo } from './shared.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { avatarUrl } from '../auth/authApi.js';
import AuthPage from '../auth/AuthPage.jsx';
import ProfilePage from '../auth/ProfilePage.jsx';
import AdminDashboard from '../admin/AdminDashboard.jsx';
import ConfidentialityPage from '../legal/ConfidentialityPage.jsx';
import CommunityPage from '../project/CommunityPage.jsx';
import ProjectLibrary from '../project/ProjectLibrary.jsx';
import { projectApi } from '../project/projectApi.js';
import { projectMode, projectSyncStore } from '../project/ProjectStore.js';
import { buildUnifiedProjectIndex } from '../project/projectSync.js';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const AUTH_VIEWS = new Set(['login', 'register']);
const HASH_VIEWS = new Set(['login', 'register', 'profile', 'community', 'admin', 'confidentiality']);
const VISIBILITY_ICONS = { private: Lock, unlisted: Eye, public: Globe2 };
const BODY_LABELS = { planet: 'Planet', gas: 'Gas', star: 'Star' };

function viewFromHash() {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0].toLowerCase();
  return HASH_VIEWS.has(value) ? value : null;
}

function relativeTime(value) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return translate('Just now');
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return translate("{0}m ago", { 0: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate("{0}h ago", { 0: hours });
  const days = Math.floor(hours / 24);
  return translate("{0}d ago", { 0: days });
}

export default function Landing({
  projects,
  templates,
  templateThumbs,
  exiting,
  initialCreateOpen = false,
  onOpen,
  onExplore,
  onCreate,
  onPreview,
  onImportFile,
  onRename,
  onDuplicate,
  onDelete,
}) {
  const locale = useLocale();
  const { user, status: authStatus, logout } = useAuth();
  const { showPrompt } = usePopup();
  const [view, setView] = useState(() => viewFromHash() ?? 'home');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const headerRef = useRef(null);
  const navigationToggleRef = useRef(null);
  const [menuFor, setMenuFor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [templateKind, setTemplateKind] = useState('Planet');
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank');
  const [cloudProjects, setCloudProjects] = useState([]);
  const [syncBindings, setSyncBindings] = useState([]);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);

  // ---- routing: account pages live in the URL hash (#/login, #/community…)
  useEffect(() => {
    const onHashChange = () => {
      const hashView = viewFromHash();
      setView((current) => hashView ?? (HASH_VIEWS.has(current) ? 'home' : current));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const showView = (next) => {
    setNavigationOpen(false);
    setQuery('');
    setMenuFor(null);
    if (HASH_VIEWS.has(next)) {
      if (window.location.hash !== `#/${next}`) window.location.hash = `/${next}`;
      else setView(next);
      return;
    }
    // drop any hash route (and share code) when leaving the account pages
    window.history.replaceState(null, '', window.location.pathname);
    setView(next);
  };
  const goHome = () => showView('home');

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (view === 'profile' && !user) showView('login');
    if (view === 'admin' && user?.role !== 'admin') showView(user ? 'home' : 'login');
  }, [view, authStatus, user]);

  useEffect(() => { setNavigationOpen(false); }, [view, exiting]);

  useEffect(() => {
    if (!navigationOpen) return undefined;
    headerRef.current?.querySelector('.lp-nav-links button')?.focus();
    const closeOutside = (event) => {
      if (!headerRef.current?.contains(event.target)) setNavigationOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setNavigationOpen(false);
      navigationToggleRef.current?.focus();
    };
    const desktop = window.matchMedia('(min-width: 1400px)');
    const closeOnDesktop = () => { if (desktop.matches) setNavigationOpen(false); };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [navigationOpen]);

  // ---- cloud state for the recent-project badges
  useEffect(() => {
    let cancelled = false;
    const load = () => projectSyncStore.list().then((items) => { if (!cancelled) setSyncBindings(items); });
    load();
    window.addEventListener('planet-project-sync:changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('planet-project-sync:changed', load);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user || view !== 'home') {
      if (!user) setCloudProjects([]);
      return () => { cancelled = true; };
    }
    projectApi.listMine()
      .then((result) => { if (!cancelled) setCloudProjects(result.projects); })
      .catch(() => { if (!cancelled) setCloudProjects([]); });
    return () => { cancelled = true; };
  }, [user, view, syncBindings]);

  const cloudEntries = useMemo(() => new Map(
    buildUnifiedProjectIndex({ localProjects: projects, cloudProjects, bindings: syncBindings })
      .filter((entry) => entry.localProject)
      .map((entry) => [entry.localProject.id, entry]),
  ), [cloudProjects, projects, syncBindings]);

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor]);

  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return templates.filter((template) => (
      template.kind === templateKind
      && (!normalized || [template.name, template.description, translate(template.name), translate(template.description)].some(text => text.toLowerCase().includes(normalized)))
    ));
  }, [templates, templateKind, query, locale]);

  const openTemplates = (kind = templateKind) => {
    setTemplateKind(kind);
    showView('templates');
    const first = templates.find((template) => template.kind === kind);
    if (first) {
      setSelectedTemplateId(first.id);
      onPreview(first.id);
    }
  };

  const selectTemplate = (template) => {
    setSelectedTemplateId(template.id);
    onPreview(template.id);
  };

  const renameProject = async (project) => {
    if (busy) return;
    const name = (await showPrompt({ title: translate('Rename project'), inputLabel: translate('Project name'), initialValue: project.metadata.name, confirmLabel: translate('Rename'), maxLength: 120 }))?.trim();
    if (!name || name === project.metadata.name) return;
    setBusy(true);
    try { await onRename(project, name); } finally { setBusy(false); }
  };

  const duplicateProject = async (project) => {
    if (busy) return;
    setBusy(true);
    try { await onDuplicate(project); } finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try { await onDelete(deleteTarget); } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  // ---- drag & drop a .ppplanet anywhere on the page
  const hasFileDrag = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const dragHandlers = {
    onDragEnter: (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      fileDragDepthRef.current += 1;
      setFileDragActive(true);
    },
    onDragOver: (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) setFileDragActive(false);
    },
    onDrop: (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onImportFile(file, { open: false });
    },
  };

  const renderProjectCard = (project) => {
    const entry = cloudEntries.get(project.id);
    const cloudProject = entry?.cloudProject;
    const isSynced = entry?.state === 'synced';
    const SyncIcon = isSynced ? Cloud : CloudOff;
    const VisibilityIcon = VISIBILITY_ICONS[cloudProject?.visibility] || Lock;
    const syncLabel = isSynced ? translate('Synced to cloud') : cloudProject ? translate(entry.label) : translate('Not synced to cloud');
    const title = cloudProject ? translate("{0} · Cloud visibility: {1}", { 0: syncLabel, 1: translate(cloudProject.visibility) }) : syncLabel;
    return (
      <article className={`lp-card${menuFor === project.id ? ' menu-open' : ''}`} key={project.id}>
        <button type="button" className="lp-card-main" onClick={() => onOpen(project)} disabled={exiting}>
          <span className="lp-card-thumb">
            {project.metadata.thumbnail
              ? <img src={project.metadata.thumbnail} alt="" />
              : <Orbit size={25} strokeWidth={1.5} />}
          </span>
          {user && (
            <span role="img" className={`lp-card-cloud-badge${isSynced ? ' synced' : ' unsynced'}`} title={title} aria-label={title}>
              <SyncIcon size={13} aria-hidden />
              {cloudProject && <span className={`lp-card-visibility-icon ${cloudProject.visibility}`}><VisibilityIcon size={12} aria-hidden /></span>}
            </span>
          )}
          <span className="lp-card-info">
            <strong>{project.metadata.name}</strong>
            <small><Clock3 size={12} /> {relativeTime(project.metadata.modified)}</small>
          </span>
          <span className="lp-template-kind-badge">{BODY_LABELS[projectMode(project)]}</span>
        </button>
        <button
          type="button"
          className="lp-card-menu-btn"
          aria-label={translate("Project actions for {0}", { 0: project.metadata.name })}
          aria-expanded={menuFor === project.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMenuFor((current) => current === project.id ? null : project.id)}
        >
          <MoreVertical size={15} />
        </button>
        {menuFor === project.id && (
          <div className="lp-card-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onOpen(project); }}><FolderOpen size={13} /> {translate("Open")}</button>
            <button type="button" role="menuitem" onClick={() => { setMenuFor(null); renameProject(project); }} disabled={busy}><Pencil size={13} /> {translate("Rename")}</button>
            <button type="button" role="menuitem" onClick={() => { setMenuFor(null); duplicateProject(project); }} disabled={busy}><Copy size={13} /> {translate("Duplicate")}</button>
            <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); setDeleteTarget(project); }} disabled={busy}><Trash2 size={13} /> {translate("Delete")}</button>
          </div>
        )}
      </article>
    );
  };

  const emptyProjects = (
    <div className="lp-empty">
      <FolderOpen size={24} />
      <strong>{translate("No projects yet")}</strong>
      <span>{translate("Create a world from a template, or drop a .ppplanet file anywhere on this page.")}</span>
      <button type="button" className="lp-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> {translate("Create planet")}</button>
    </div>
  );

  const viewClass = AUTH_VIEWS.has(view) ? ' lp--auth'
    : view === 'profile' ? ' lp--profile'
      : view === 'community' ? ' lp--community'
        : view === 'admin' ? ' lp--admin'
          : view === 'confidentiality' ? ' lp--legal' : '';

  return (
    <div className={`landing landing-overlay lp${viewClass}${exiting ? ' exiting' : ''}`} {...dragHandlers}>
      <div className="lp-bg" aria-hidden="true" />
      {fileDragActive && (
        <div className="file-drop-overlay" role="presentation">
          <div className="file-drop-card">
            <Upload size={28} aria-hidden />
            <span>{translate("Drop a .ppplanet file to add it to your projects")}</span>
          </div>
        </div>
      )}

      <header className="lp-nav" ref={headerRef} onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setNavigationOpen(false);
      }}>
        <button type="button" className="lp-brand" onClick={goHome} title={translate("Return to home")}>
          <Logo size={24} /><strong>{APP_NAME}</strong>
        </button>
        <div id="landing-navigation" className={`lp-nav-panel${navigationOpen ? ' is-open' : ''}`} onClick={(event) => {
          if (!event.target.closest('button, a')) return;
          setNavigationOpen(false);
          if (navigationOpen) navigationToggleRef.current?.focus();
        }}>
          <nav className="lp-nav-links" aria-label={translate("Main navigation")}>
            <button type="button" onClick={onExplore}>{translate("Explore")}</button>
            <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => showView('projects')}>{translate("Projects")}</button>
            <button type="button" className={view === 'templates' ? 'active' : ''} onClick={() => openTemplates('Planet')}>{translate("Templates")}</button>
            <button type="button" className={view === 'community' ? 'active' : ''} onClick={() => showView('community')}>{translate("Community")}</button>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">{translate("Docs")}</a>
            <a href="https://www.npmjs.com/package/procedural-planets" target="_blank" rel="noopener noreferrer">{translate("Package")}</a>
            <a href={PROCEDURAL_TERRAINS_URL} target="_blank" rel="noopener noreferrer">Procedural Terrains <ExternalLink size={12} aria-hidden="true" /></a>
          </nav>
          <div className="lp-nav-account">
            <button type="button" className="lp-nav-credits" onClick={() => setCreditsOpen(true)} aria-label={translate("Open credits and links")} title={translate("Credits and links")}><CircleHelp size={17} /></button>
            {user ? <>
              {user.role === 'admin' && (
                <button type="button" className={`lp-admin-chip${view === 'admin' ? ' active' : ''}`} title={translate("Open administration")} onClick={() => showView('admin')}>
                  <ShieldCheck size={14} /><span>{translate("Admin")}</span>
                </button>
              )}
              <button type="button" className={`lp-account-chip${view === 'profile' ? ' active' : ''}`} title={translate("Open your profile")} onClick={() => showView('profile')}>
                {avatarUrl(user) ? <img src={avatarUrl(user)} alt="" /> : <UserRound size={14} />}
                <span>{user.username}</span>
              </button>
              <button type="button" className="lp-secondary sm lp-auth-logout" onClick={async () => { await logout(); goHome(); }}><LogOut size={13} /> <span>{translate("Logout")}</span></button>
            </> : <>
              <button type="button" className="lp-secondary sm lp-auth-login" onClick={() => showView('login')} disabled={authStatus === 'loading'}><LogIn size={13} /> <span>{translate("Sign in")}</span></button>
              <button type="button" className="lp-primary sm lp-auth-register" onClick={() => showView('register')} disabled={authStatus === 'loading'}><UserPlus size={13} /> <span>{translate("Create account")}</span></button>
            </>}
          </div>
        </div>
        <div className="lp-nav-actions">
          <LanguageSwitcher />
          <button type="button" className="lp-nav-toggle" ref={navigationToggleRef}
            aria-expanded={navigationOpen} aria-controls="landing-navigation"
            aria-label={translate(navigationOpen ? 'Close navigation' : 'Open navigation')}
            onClick={() => setNavigationOpen((open) => !open)}>
            {navigationOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className="lp-scroll">
        <main className="lp-content">
          <div key={view} className="lp-content-scroll">
            {AUTH_VIEWS.has(view) && <AuthPage key={view} mode={view} onBack={goHome} onSwitch={showView} onSuccess={goHome} />}
            {view === 'profile' && user && <ProfilePage onBack={goHome} />}
            {view === 'community' && <CommunityPage onBack={() => showView('projects')} onOpen={onOpen} ready={!exiting} />}
            {view === 'admin' && user?.role === 'admin' && <AdminDashboard user={user} onBack={goHome} />}
            {view === 'confidentiality' && <ConfidentialityPage onBack={goHome} />}

            {view === 'home' && (
              <>
                <section className="lp-hero">
                  <div className="lp-version-pill">v{APP_VERSION}</div>
                  <h1>{translate("Craft")} <em>{translate("stunning worlds")}</em> {translate("with procedural power")}</h1>
                  <p>{APP_NAME} {translate("helps you generate, shape, and style planets, then drop them into any three.js project.")}</p>
                  <div className="lp-hero-actions">
                    <button type="button" className="lp-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> {translate("Create planet")}</button>
                    <button type="button" className="lp-secondary" onClick={() => openTemplates('Planet')}><Layers3 size={14} /> {translate("Browse templates")}</button>
                  </div>
                </section>

                <section className="lp-section">
                  <div className="lp-section-head">
                    <h2>{translate("Recent projects")}</h2>
                    {projects.length > 0 && <button type="button" className="lp-link" onClick={() => showView('projects')}>{translate("View all projects")} <ArrowRight size={12} /></button>}
                  </div>
                  {projects.length ? <div className="lp-card-grid">{projects.slice(0, 8).map(renderProjectCard)}</div> : emptyProjects}
                </section>
              </>
            )}

            {view === 'projects' && (
              <section className="lp-section lp-view">
                <div className="lp-section-head"><h2>{translate("Projects")}</h2></div>
                <ProjectLibrary
                  localProjects={projects}
                  bootReady
                  exiting={exiting}
                  onOpen={onOpen}
                  onCreate={() => setCreateOpen(true)}
                  onImportFile={(file) => file && onImportFile(file, { open: true })}
                  onRename={renameProject}
                  onDuplicate={duplicateProject}
                  onDelete={setDeleteTarget}
                  projectActionBusy={busy}
                  onSignIn={() => showView('login')}
                />
              </section>
            )}

            {view === 'templates' && (
              <section className="lp-section lp-view">
                <div className="lp-section-head lp-template-section-head">
                  <div><h2>{translate("Planet templates")}</h2><p>{translate("Choose a starting world, then keep shaping it in the editor.")}</p></div>
                  <div className="lp-template-kind-switch" role="tablist" aria-label={translate("Template type")}>
                    <button type="button" role="tab" aria-selected={templateKind === 'Planet'} className={templateKind === 'Planet' ? 'active' : ''} onClick={() => openTemplates('Planet')}><Orbit size={13} /> {translate("Planet")}</button>
                    <button type="button" role="tab" aria-selected={templateKind === 'Gas'} className={templateKind === 'Gas' ? 'active' : ''} onClick={() => openTemplates('Gas')}><Waves size={13} /> {translate("Gas")}</button>
                    <button type="button" role="tab" aria-selected={templateKind === 'Star'} className={templateKind === 'Star' ? 'active' : ''} onClick={() => openTemplates('Star')}><Sun size={13} /> {translate("Star")}</button>
                  </div>
                </div>
                <div className="lp-search">
                  <Search size={14} />
                  <input type="search" placeholder={translate("Search {0} templates...", { 0: translate(templateKind).toLowerCase() })} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={translate("Search templates")} />
                </div>
                {filteredTemplates.length === 0 && <p className="lp-no-results">{translate("No template matches “{0}”.", { 0: query.trim() })}</p>}
                <div className="lp-card-grid">
                  {filteredTemplates.map((template) => (
                    <article className={`lp-card${template.id === selectedTemplateId ? ' selected' : ''}`} key={template.id}>
                      <button type="button" className="lp-card-main" onClick={() => selectTemplate(template)} onDoubleClick={() => onCreate(template.id)}>
                        <span className="lp-card-thumb">
                          {templateThumbs[template.id]
                            ? <img src={templateThumbs[template.id]} alt="" />
                            : template.kind === 'Star' ? <Sun size={24} /> : template.kind === 'Gas' ? <Waves size={24} /> : <Orbit size={24} />}
                        </span>
                        <span className="lp-card-info"><strong>{translate(template.name)}</strong><small>{translate(template.description)}</small></span>
                        <span className="lp-template-kind-badge">{template.kind}</span>
                      </button>
                    </article>
                  ))}
                </div>
                <p className="lp-template-hint">{translate("Selecting a template previews it live in the background.")}</p>
                <button type="button" className="lp-primary lp-template-create" onClick={() => onCreate(selectedTemplateId)}><Sparkles size={15} /> {translate("Create")} {translate(templates.find((template) => template.id === selectedTemplateId)?.name ?? 'planet')}</button>
              </section>
            )}
          </div>

          <footer className="lp-footer">
            <div className="lp-footer-main">
              <div className="lp-footer-identity">
                <button type="button" className="lp-footer-brand" onClick={goHome} title={translate("Return to home")}>
                  <Logo size={20} /><strong>{APP_NAME}</strong>
                </button>
                <span>© {new Date().getFullYear()} {translate("Open source software.")}</span>
              </div>
              <div className="lp-footer-socials">
                <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={translate("Open GitHub repository")} title="GitHub"><Github size={17} aria-hidden="true" /></a>
                <a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" aria-label={translate("Open portfolio")} title={translate("Open portfolio")}><Globe2 size={17} aria-hidden="true" /></a>
                <a href={`mailto:${AUTHOR_EMAIL}`} aria-label={translate("Email {0}", { 0: AUTHOR_EMAIL })} title={translate("Email")}><Mail size={17} aria-hidden="true" /></a>
              </div>
            </div>
            <nav className="lp-footer-links" aria-label={translate("Footer navigation")}>
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">{translate("Docs")}</a>
              <a href="https://www.npmjs.com/package/procedural-planets" target="_blank" rel="noopener noreferrer">{translate("Package")}</a>
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">{translate("Source")} <ExternalLink size={12} aria-hidden="true" /></a>
              <button type="button" onClick={() => showView('confidentiality')}>{translate("Confidentiality")}</button>
            </nav>
            <a className="lp-footer-related" href={PROCEDURAL_TERRAINS_URL} target="_blank" rel="noopener noreferrer">
              <Mountain size={22} aria-hidden="true" />
              <span><strong>Procedural Terrains</strong><small>{translate("Explore procedural landscapes")}</small></span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </footer>
        </main>
      </div>

      {createOpen && (
        <div className="landing-credits-backdrop landing-create-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}>
          <section className="landing-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-planet-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>{translate("New project")}</span><h2 id="create-planet-title">{translate("Choose what to build")}</h2><p>{translate("Every project is saved on this device")}{user ? ' and can be synced to your cloud library' : ''}.</p></div>
              <button type="button" onClick={() => setCreateOpen(false)} aria-label={translate("Close")}><X size={16} /></button>
            </header>
            <div className="landing-create-options">
              <button type="button" onClick={() => onCreate('blank')}>
                <span className="landing-create-icon"><Orbit size={22} /></span>
                <strong>{translate("Planet")}</strong>
                <small>{translate("Build a solid world with procedural terrain, biomes, oceans, clouds, and atmosphere.")}</small>
                <span className="landing-create-action">{translate("Create planet")} <ArrowRight size={13} /></span>
              </button>
              <button type="button" onClick={() => onCreate('gas-giant')}>
                <span className="landing-create-icon nodes"><Waves size={22} /></span>
                <strong>{translate("Gas Giant")}</strong>
                <small>{translate("Shape flowing bands, storms, lighting, and a deep atmospheric palette.")}</small>
                <span className="landing-create-action">{translate("Create gas giant")} <ArrowRight size={13} /></span>
              </button>
              <button type="button" onClick={() => onCreate('sun')}>
                <span className="landing-create-icon manual"><Sun size={22} /></span>
                <strong>{translate("Star")}</strong>
                <small>{translate("Design a boiling stellar surface with sunspots, color, motion, and corona.")}</small>
                <span className="landing-create-action">{translate("Create star")} <ArrowRight size={13} /></span>
              </button>
            </div>
          </section>
        </div>
      )}

      {creditsOpen && (
        <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => setCreditsOpen(false)}>
          <section className="landing-credits-dialog" role="dialog" aria-modal="true" aria-labelledby="credits-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>{translate("About")}</span><h2 id="credits-title">{APP_NAME}</h2></div>
            <p>{translate("Procedural planets, gas giants and stars for three.js. Every world you make here is a set of")} <code>procedural-planets</code> {translate("parameters you can use in your own scene.")}</p>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">{translate("View the package on GitHub")}</a>
            <button type="button" onClick={() => setCreditsOpen(false)}>{translate("Close")}</button>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => !busy && setDeleteTarget(null)}>
          <section className="landing-credits-dialog landing-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>{translate("Delete project")}</span><h2 id="delete-project-title">{translate("Delete “{0}”?", { 0: deleteTarget.metadata.name })}</h2></div>
            <p>{translate("This removes the project from this browser. A cloud copy, if any, is kept.")}</p>
            <div className="landing-confirm-actions">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={busy}>{translate("Cancel")}</button>
              <button type="button" className="danger" onClick={confirmDelete} disabled={busy}><Trash2 size={14} /> {translate("Delete")}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
