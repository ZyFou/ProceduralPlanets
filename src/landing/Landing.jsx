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
import { APP_NAME, APP_VERSION, AUTHOR_EMAIL, AUTHOR_PORTFOLIO_URL, GITHUB_REPO_URL } from '../constants/app.js';
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
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'Just now';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Landing({
  projects,
  templates,
  templateThumbs,
  exiting,
  initialCreateOpen = false,
  onOpen,
  onCreate,
  onPreview,
  onImportFile,
  onRename,
  onDuplicate,
  onDelete,
}) {
  const { user, status: authStatus, logout } = useAuth();
  const { showPrompt } = usePopup();
  const [view, setView] = useState(() => viewFromHash() ?? 'home');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [creditsOpen, setCreditsOpen] = useState(false);
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
      && (!normalized || template.name.toLowerCase().includes(normalized) || template.description.toLowerCase().includes(normalized))
    ));
  }, [templates, templateKind, query]);

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
    const name = (await showPrompt({ title: 'Rename project', inputLabel: 'Project name', initialValue: project.metadata.name, confirmLabel: 'Rename', maxLength: 120 }))?.trim();
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
    const syncLabel = isSynced ? 'Synced to cloud' : cloudProject ? entry.label : 'Not synced to cloud';
    const title = cloudProject ? `${syncLabel} · Cloud visibility: ${cloudProject.visibility}` : syncLabel;
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
          aria-label={`Project actions for ${project.metadata.name}`}
          aria-expanded={menuFor === project.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMenuFor((current) => current === project.id ? null : project.id)}
        >
          <MoreVertical size={15} />
        </button>
        {menuFor === project.id && (
          <div className="lp-card-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onOpen(project); }}><FolderOpen size={13} /> Open</button>
            <button type="button" role="menuitem" onClick={() => { setMenuFor(null); renameProject(project); }} disabled={busy}><Pencil size={13} /> Rename</button>
            <button type="button" role="menuitem" onClick={() => { setMenuFor(null); duplicateProject(project); }} disabled={busy}><Copy size={13} /> Duplicate</button>
            <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); setDeleteTarget(project); }} disabled={busy}><Trash2 size={13} /> Delete</button>
          </div>
        )}
      </article>
    );
  };

  const emptyProjects = (
    <div className="lp-empty">
      <FolderOpen size={24} />
      <strong>No projects yet</strong>
      <span>Create a world from a template, or drop a .ppplanet file anywhere on this page.</span>
      <button type="button" className="lp-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Create planet</button>
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
            <span>Drop a .ppplanet file to add it to your projects</span>
          </div>
        </div>
      )}

      <header className="lp-nav">
        <button type="button" className="lp-brand" onClick={goHome} title="Return to home">
          <Logo size={24} /><strong>{APP_NAME}</strong>
        </button>
        <nav className="lp-nav-links" aria-label="Main navigation">
          <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => showView('projects')}>Projects</button>
          <button type="button" className={view === 'templates' ? 'active' : ''} onClick={() => openTemplates('Planet')}>Templates</button>
          <button type="button" className={view === 'community' ? 'active' : ''} onClick={() => showView('community')}>Community</button>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">Docs</a>
        </nav>
        <div className="lp-nav-actions">
          <button type="button" className="lp-nav-credits" onClick={() => setCreditsOpen(true)} aria-label="Open credits and links" title="Credits and links"><CircleHelp size={17} /></button>
          {user ? <>
            {user.role === 'admin' && (
              <button type="button" className={`lp-admin-chip${view === 'admin' ? ' active' : ''}`} title="Open administration" onClick={() => showView('admin')}>
                <ShieldCheck size={14} /><span>Admin</span>
              </button>
            )}
            <button type="button" className={`lp-account-chip${view === 'profile' ? ' active' : ''}`} title="Open your profile" onClick={() => showView('profile')}>
              {avatarUrl(user) ? <img src={avatarUrl(user)} alt="" /> : <UserRound size={14} />}
              <span>{user.username}</span>
            </button>
            <button type="button" className="lp-secondary sm lp-auth-logout" onClick={async () => { await logout(); goHome(); }}><LogOut size={13} /> <span>Logout</span></button>
          </> : <>
            <button type="button" className="lp-secondary sm lp-auth-login" onClick={() => showView('login')} disabled={authStatus === 'loading'}><LogIn size={13} /> <span>Sign in</span></button>
            <button type="button" className="lp-primary sm lp-auth-register" onClick={() => showView('register')} disabled={authStatus === 'loading'}><UserPlus size={13} /> <span>Create account</span></button>
          </>}
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
                  <h1>Craft <em>stunning worlds</em> with procedural power</h1>
                  <p>{APP_NAME} helps you generate, shape, and style planets, then drop them into any three.js project.</p>
                  <div className="lp-hero-actions">
                    <button type="button" className="lp-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Create planet</button>
                    <button type="button" className="lp-secondary" onClick={() => openTemplates('Planet')}><Layers3 size={14} /> Browse templates</button>
                  </div>
                </section>

                <section className="lp-section">
                  <div className="lp-section-head">
                    <h2>Recent projects</h2>
                    {projects.length > 0 && <button type="button" className="lp-link" onClick={() => showView('projects')}>View all projects <ArrowRight size={12} /></button>}
                  </div>
                  {projects.length ? <div className="lp-card-grid">{projects.slice(0, 8).map(renderProjectCard)}</div> : emptyProjects}
                </section>
              </>
            )}

            {view === 'projects' && (
              <section className="lp-section lp-view">
                <div className="lp-section-head"><h2>Projects</h2></div>
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
                  <div><h2>Planet templates</h2><p>Choose a starting world, then keep shaping it in the editor.</p></div>
                  <div className="lp-template-kind-switch" role="tablist" aria-label="Template type">
                    <button type="button" role="tab" aria-selected={templateKind === 'Planet'} className={templateKind === 'Planet' ? 'active' : ''} onClick={() => openTemplates('Planet')}><Orbit size={13} /> Planet</button>
                    <button type="button" role="tab" aria-selected={templateKind === 'Gas'} className={templateKind === 'Gas' ? 'active' : ''} onClick={() => openTemplates('Gas')}><Waves size={13} /> Gas</button>
                    <button type="button" role="tab" aria-selected={templateKind === 'Star'} className={templateKind === 'Star' ? 'active' : ''} onClick={() => openTemplates('Star')}><Sun size={13} /> Star</button>
                  </div>
                </div>
                <div className="lp-search">
                  <Search size={14} />
                  <input type="search" placeholder={`Search ${templateKind.toLowerCase()} templates...`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search templates" />
                </div>
                {filteredTemplates.length === 0 && <p className="lp-no-results">No template matches "{query.trim()}".</p>}
                <div className="lp-card-grid">
                  {filteredTemplates.map((template) => (
                    <article className={`lp-card${template.id === selectedTemplateId ? ' selected' : ''}`} key={template.id}>
                      <button type="button" className="lp-card-main" onClick={() => selectTemplate(template)} onDoubleClick={() => onCreate(template.id)}>
                        <span className="lp-card-thumb">
                          {templateThumbs[template.id]
                            ? <img src={templateThumbs[template.id]} alt="" />
                            : template.kind === 'Star' ? <Sun size={24} /> : template.kind === 'Gas' ? <Waves size={24} /> : <Orbit size={24} />}
                        </span>
                        <span className="lp-card-info"><strong>{template.name}</strong><small>{template.description}</small></span>
                        <span className="lp-template-kind-badge">{template.kind}</span>
                      </button>
                    </article>
                  ))}
                </div>
                <p className="lp-template-hint">Selecting a template previews it live in the background.</p>
                <button type="button" className="lp-primary lp-template-create" onClick={() => onCreate(selectedTemplateId)}><Sparkles size={15} /> Create {templates.find((template) => template.id === selectedTemplateId)?.name ?? 'planet'}</button>
              </section>
            )}
          </div>

          <footer className="lp-footer">
            <div className="lp-footer-socials">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Open GitHub repository"><Github size={17} /></a>
              <a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" aria-label="Open portfolio"><Globe2 size={16} /></a>
              <a href={`mailto:${AUTHOR_EMAIL}`} aria-label={`Email ${AUTHOR_EMAIL}`}><Mail size={16} /></a>
            </div>
            <div className="lp-footer-meta">
              <span>{'©'} {new Date().getFullYear()} {APP_NAME}. Open source software.</span>
              <button type="button" className="lp-link" onClick={() => showView('confidentiality')}>Confidentiality</button>
              <a className="lp-link" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">Source <ExternalLink size={11} /></a>
            </div>
          </footer>
        </main>
      </div>

      {createOpen && (
        <div className="landing-credits-backdrop landing-create-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}>
          <section className="landing-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-planet-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>New project</span><h2 id="create-planet-title">Choose what to build</h2><p>Every project is saved on this device{user ? ' and can be synced to your cloud library' : ''}.</p></div>
              <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close"><X size={16} /></button>
            </header>
            <div className="landing-create-options">
              <button type="button" onClick={() => onCreate('blank')}>
                <span className="landing-create-icon"><Orbit size={22} /></span>
                <strong>Planet</strong>
                <small>Build a solid world with procedural terrain, biomes, oceans, clouds, and atmosphere.</small>
                <span className="landing-create-action">Create planet <ArrowRight size={13} /></span>
              </button>
              <button type="button" onClick={() => onCreate('gas-giant')}>
                <span className="landing-create-icon nodes"><Waves size={22} /></span>
                <strong>Gas Giant</strong>
                <small>Shape flowing bands, storms, lighting, and a deep atmospheric palette.</small>
                <span className="landing-create-action">Create gas giant <ArrowRight size={13} /></span>
              </button>
              <button type="button" onClick={() => onCreate('sun')}>
                <span className="landing-create-icon manual"><Sun size={22} /></span>
                <strong>Star</strong>
                <small>Design a boiling stellar surface with sunspots, color, motion, and corona.</small>
                <span className="landing-create-action">Create star <ArrowRight size={13} /></span>
              </button>
            </div>
          </section>
        </div>
      )}

      {creditsOpen && (
        <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => setCreditsOpen(false)}>
          <section className="landing-credits-dialog" role="dialog" aria-modal="true" aria-labelledby="credits-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>About</span><h2 id="credits-title">{APP_NAME}</h2></div>
            <p>Procedural planets, gas giants and stars for three.js. Every world you make here is a set of <code>procedural-planets</code> parameters you can use in your own scene.</p>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">View the package on GitHub</a>
            <button type="button" onClick={() => setCreditsOpen(false)}>Close</button>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => !busy && setDeleteTarget(null)}>
          <section className="landing-credits-dialog landing-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>Delete project</span><h2 id="delete-project-title">Delete "{deleteTarget.metadata.name}"?</h2></div>
            <p>This removes the project from this browser. A cloud copy, if any, is kept.</p>
            <div className="landing-confirm-actions">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</button>
              <button type="button" className="danger" onClick={confirmDelete} disabled={busy}><Trash2 size={14} /> Delete</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
