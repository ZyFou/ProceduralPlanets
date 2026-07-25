import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CircleHelp,
  Clock3,
  Copy,
  ExternalLink,
  FolderOpen,
  Github,
  Globe2,
  Layers3,
  LogIn,
  Mail,
  MoreVertical,
  Orbit,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash2,
  UserPlus,
  Waves,
  X,
} from 'lucide-react';

const APP_NAME = 'Procedural Planets';
const APP_VERSION = '0.1.0';
const GITHUB_REPO_URL = 'https://github.com/ZyFou/ProceduralPlanets';

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

function Logo({ size = 24 }) {
  return <Orbit className="landing-logo" size={size} strokeWidth={1.9} aria-hidden />;
}

export default function Landing({
  projects,
  templates,
  templateThumbs,
  exiting,
  onOpen,
  onCreate,
  onPreview,
  onRename,
  onDuplicate,
  onDelete,
}) {
  const [view, setView] = useState('home');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [notice, setNotice] = useState(null);
  const [templateKind, setTemplateKind] = useState('Planet');
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank');

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projects.filter((project) => project.metadata.name.toLowerCase().includes(normalized));
  }, [projects, query]);

  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return templates.filter((template) => (
      template.kind === templateKind
      && (!normalized || template.name.toLowerCase().includes(normalized) || template.description.toLowerCase().includes(normalized))
    ));
  }, [templates, templateKind, query]);

  const showView = (next) => {
    setView(next);
    setQuery('');
    setMenuFor(null);
  };

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

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await onDelete(deleteTarget);
    setDeleteTarget(null);
  };

  const beginRename = (project) => {
    setMenuFor(null);
    setRenameTarget(project);
    setRenameValue(project.metadata.name);
  };

  const confirmRename = async (event) => {
    event.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;
    await onRename(renameTarget, renameValue.trim());
    setRenameTarget(null);
  };

  const renderProjectCard = (project) => (
    <article className={`lp-card${menuFor === project.id ? ' menu-open' : ''}`} key={project.id}>
      <button type="button" className="lp-card-main" onClick={() => onOpen(project)}>
        <span className="lp-card-thumb">
          {project.metadata.thumbnail
            ? <img src={project.metadata.thumbnail} alt="" />
            : <Orbit size={25} strokeWidth={1.5} />}
        </span>
        <span className="lp-card-info">
          <strong>{project.metadata.name}</strong>
          <small><Clock3 size={12} /> {relativeTime(project.metadata.modified)}</small>
        </span>
        <span className="lp-template-kind-badge">{project.params.mode === 'star' ? 'Star' : project.params.mode === 'gas' ? 'Gas' : 'Planet'}</span>
      </button>
      <button
        type="button"
        className="lp-card-menu-btn"
        aria-label={`Project actions for ${project.metadata.name}`}
        aria-expanded={menuFor === project.id}
        onClick={() => setMenuFor((current) => current === project.id ? null : project.id)}
      >
        <MoreVertical size={15} />
      </button>
      {menuFor === project.id && (
        <div className="lp-card-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onOpen(project); }}><FolderOpen size={13} /> Open</button>
          <button type="button" role="menuitem" onClick={() => beginRename(project)}><Pencil size={13} /> Rename</button>
          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onDuplicate(project); }}><Copy size={13} /> Duplicate</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); setDeleteTarget(project); }}><Trash2 size={13} /> Delete</button>
        </div>
      )}
    </article>
  );

  const emptyProjects = (
    <div className="lp-empty">
      <FolderOpen size={24} />
      <strong>No projects yet</strong>
      <span>Create a world from a template. Projects are stored locally in this browser.</span>
      <button type="button" className="lp-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Create planet</button>
    </div>
  );

  return (
    <div className={`landing landing-overlay lp${view === 'community' ? ' lp--community' : ''}${exiting ? ' exiting' : ''}`}>
      <div className="lp-bg" aria-hidden="true" />

      <header className="lp-nav">
        <button type="button" className="lp-brand" onClick={() => showView('home')} title="Return to home">
          <Logo size={24} /><strong>{APP_NAME}</strong>
        </button>
        <nav className="lp-nav-links" aria-label="Main navigation">
          <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => showView('projects')}>Projects</button>
          <button type="button" className={view === 'templates' ? 'active' : ''} onClick={() => openTemplates('Planet')}>Templates</button>
          <button type="button" className={view === 'community' ? 'active' : ''} onClick={() => showView('community')}>Community</button>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">Docs</a>
        </nav>
        <div className="lp-nav-actions">
          <button type="button" className="lp-nav-credits" onClick={() => setNotice('Procedural Planets is running in local-only mode.')} aria-label="Open credits and links"><CircleHelp size={17} /></button>
          <button type="button" className="lp-secondary sm lp-auth-login" onClick={() => setNotice('Accounts are not connected in this local build.')}><LogIn size={13} /> <span>Sign in</span></button>
          <button type="button" className="lp-primary sm lp-auth-register" onClick={() => setNotice('Accounts are not connected in this local build.')}><UserPlus size={13} /> <span>Create account</span></button>
        </div>
      </header>

      <div className="lp-scroll">
        <main className="lp-content">
          <div key={view} className="lp-content-scroll">
            {view === 'home' && (
              <>
                <section className="lp-hero">
                  <div className="lp-version-pill">v{APP_VERSION}</div>
                  <h1>Craft <em>stunning worlds</em> with procedural power</h1>
                  <p>{APP_NAME} helps you generate, shape, and style planets for your projects.</p>
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
                <div className="lp-section-head">
                  <h2>Projects</h2>
                  <button type="button" className="lp-primary sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New planet</button>
                </div>
                <div className="lp-search">
                  <Search size={14} />
                  <input type="search" placeholder="Search projects..." value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search local projects" />
                </div>
                {projects.length === 0 ? emptyProjects
                  : filteredProjects.length === 0 ? <p className="lp-no-results">No project matches "{query.trim()}".</p>
                  : <div className="lp-card-grid">{filteredProjects.map(renderProjectCard)}</div>}
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

            {view === 'community' && (
              <section className="lp-section lp-view">
                <div className="lp-section-head"><h2>Community</h2></div>
                <div className="lp-empty">
                  <Globe2 size={25} />
                  <strong>Community worlds are coming later</strong>
                  <span>This local build keeps projects on your device. No backend or account is required.</span>
                  <button type="button" className="lp-secondary" onClick={() => showView('templates')}><Layers3 size={14} /> Explore templates</button>
                </div>
              </section>
            )}
          </div>

          <footer className="lp-footer">
            <div className="lp-footer-socials">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Open GitHub repository"><Github size={17} /></a>
              <a href="https://zyfod.dev" target="_blank" rel="noopener noreferrer" aria-label="Open portfolio"><Globe2 size={16} /></a>
              <a href="mailto:zyfodexe@gmail.com" aria-label="Email zyfodexe@gmail.com"><Mail size={16} /></a>
            </div>
            <div className="lp-footer-meta"><span>{'\u00A9'} {new Date().getFullYear()} {APP_NAME}. Open source software.</span><a className="lp-link" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">Source <ExternalLink size={11} /></a></div>
          </footer>
        </main>
      </div>

      {createOpen && (
        <div className="landing-credits-backdrop landing-create-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}>
          <section className="landing-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-planet-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>New project</span><h2 id="create-planet-title">Choose what to build</h2><p>Every project keeps the same editor tools and is saved locally.</p></div>
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

      {notice && (
        <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => setNotice(null)}>
          <section className="landing-credits-dialog" role="dialog" aria-modal="true" aria-labelledby="local-mode-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>Local mode</span><h2 id="local-mode-title">No backend required</h2></div>
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice(null)}>Close</button>
          </section>
        </div>
      )}

      {renameTarget && (
        <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => setRenameTarget(null)}>
          <form className="landing-credits-dialog landing-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-project-title" onSubmit={confirmRename} onMouseDown={(event) => event.stopPropagation()}>
            <div><span>Rename project</span><h2 id="rename-project-title">Choose a new name</h2></div>
            <label>Project name<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={80} /></label>
            <div className="landing-confirm-actions">
              <button type="button" onClick={() => setRenameTarget(null)}>Cancel</button>
              <button type="submit" disabled={!renameValue.trim()}><Pencil size={14} /> Rename</button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}>
          <section className="landing-credits-dialog landing-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>Delete project</span><h2 id="delete-project-title">Delete "{deleteTarget.metadata.name}"?</h2></div>
            <p>This removes the local project from this browser.</p>
            <div className="landing-confirm-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className="danger" onClick={confirmDelete}><Trash2 size={14} /> Delete</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
