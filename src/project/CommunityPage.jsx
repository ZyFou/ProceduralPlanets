import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, Code2, Compass, Copy, Eye, FolderDown, Globe2, Globe,
  Lock, Moon, Orbit, Pencil, Search, Settings2, Sparkles, Sun, UserRound, Waves, X,
} from 'lucide-react';
import { avatarUrl, projectThumbnailUrl } from '../auth/authApi.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { projectStore } from './ProjectStore.js';
import { projectApi } from './projectApi.js';
import { planetCodeSnippet } from './codeSnippet.js';
import { usePopup } from '../components/ui/PopupProvider.jsx';
import { copyText } from '../utils/clipboard.js';

const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 10);
const COMMUNITY_TYPES = [
  { id: 'planet', label: 'Planets', single: 'Planet' },
  { id: 'gas', label: 'Gas giants', single: 'Gas giant' },
  { id: 'star', label: 'Stars', single: 'Star' },
];
const COMMUNITY_ICONS = [
  { id: 'orbit', label: 'Orbit', Icon: Orbit },
  { id: 'globe', label: 'Globe', Icon: Globe },
  { id: 'sun', label: 'Sun', Icon: Sun },
  { id: 'waves', label: 'Waves', Icon: Waves },
  { id: 'sparkles', label: 'Sparkles', Icon: Sparkles },
  { id: 'moon', label: 'Moon', Icon: Moon },
];
const ICON_BY_ID = new Map(COMMUNITY_ICONS.map((option) => [option.id, option]));
const DEFAULT_ICON_BY_TYPE = { planet: 'orbit', gas: 'waves', star: 'sun' };

function shareCodeFromHash() {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('code') ?? '';
}

function shareLinkFor(code) {
  const url = new URL(window.location.href);
  url.hash = `/community?code=${encodeURIComponent(normalizeCode(code))}`;
  return url.toString();
}

function typeLabel(type) {
  return COMMUNITY_TYPES.find((option) => option.id === type)?.single ?? translate('Planet');
}

function iconForProject(project) {
  return ICON_BY_ID.get(project.communityIcon)
    ?? ICON_BY_ID.get(DEFAULT_ICON_BY_TYPE[project.bodyType])
    ?? COMMUNITY_ICONS[0];
}

export default function CommunityPage({ onBack, onOpen, ready = true }) {
  useLocale();
  const { user } = useAuth();
  const { showPopup, showPrompt } = usePopup();
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeType, setActiveType] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [editingId, setEditingId] = useState('');
  const [copied, setCopied] = useState('');
  const pendingOpenRef = useRef(null);
  const autoOpenCodeRef = useRef('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await projectApi.community({ query: activeQuery, type: activeType, page });
      setProjects(result.projects);
      setPages(result.pages);
      setTotal(result.total);
    } catch (requestError) {
      showPopup(requestError.message || translate('Could not load community projects.'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [activeQuery, activeType, page, showPopup]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ready || !pendingOpenRef.current) return;
    const project = pendingOpenRef.current;
    pendingOpenRef.current = null;
    onOpen(project);
  }, [onOpen, ready]);

  const flashCopied = (key) => {
    setCopied(key);
    window.setTimeout(() => setCopied((current) => current === key ? '' : current), 1800);
  };

  const importByCode = useCallback(async (code) => {
    const normalized = normalizeCode(code);
    if (normalized.length !== 10) {
      showPopup(translate('Search with a complete 10-character sharing code.'), { type: 'error', title: translate('Incomplete sharing code') });
      return;
    }
    setBusy(normalized);
    try {
      const result = await projectApi.shared(normalized);
      const imported = await projectStore.importCopy({
        ...result.project.data,
        metadata: {
          ...(result.project.data.metadata ?? {}),
          name: result.project.name,
          description: result.project.description ?? result.project.data.metadata?.description,
          author: result.project.author.displayName || result.project.author.username,
          communityIcon: result.project.communityIcon ?? result.project.data.metadata?.communityIcon,
        },
      }, { name: result.project.name });
      if (ready) onOpen(imported);
      else pendingOpenRef.current = imported;
    } catch (requestError) {
      showPopup(requestError.message || translate('Could not open this shared planet.'), { type: 'error' });
    } finally {
      setBusy('');
    }
  }, [onOpen, ready, showPopup]);

  useEffect(() => {
    const code = normalizeCode(shareCodeFromHash());
    if (code.length !== 10 || autoOpenCodeRef.current === code) return;
    autoOpenCodeRef.current = code;
    importByCode(code);
  }, [importByCode]);

  const search = (event) => {
    event.preventDefault();
    setPage(1);
    setActiveQuery(query.trim());
  };

  const selectType = (type) => {
    setPage(1);
    setActiveType(type);
  };

  const copyShareLink = async (code) => {
    const normalized = normalizeCode(code);
    try {
      await copyText(shareLinkFor(normalized));
      flashCopied(`link:${normalized}`);
      showPopup(translate('Opening link copied to your clipboard.'), { type: 'success' });
    } catch (copyError) {
      showPopup(copyError.message || translate('Could not copy the opening link.'), { type: 'error' });
    }
  };

  // Planets are package parameters: the shared document is all a three.js
  // project needs to recreate the body with `new Planet({...})`.
  const copyCode = async (project) => {
    setBusy(`code:${project.id}`);
    try {
      const result = await projectApi.shared(project.shareCode);
      await copyText(planetCodeSnippet(result.project.data.params ?? {}, result.project.data.terrain));
      flashCopied(`code:${project.id}`);
      showPopup(translate("Code for {0} copied. Paste it into a three.js project using procedural-planets.", { 0: project.name }), { type: 'success' });
    } catch (requestError) {
      showPopup(requestError.message || translate('Could not copy the code for this planet.'), { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const updateOwnerProject = useCallback(async (project, input, successMessage) => {
    setBusy(project.id);
    try {
      const result = await projectApi.update(project.id, input);
      if (result.project.visibility === 'public') {
        setProjects((current) => current.map((item) => item.id === project.id ? { ...item, ...result.project } : item));
      } else {
        await load();
        setEditingId('');
      }
      showPopup(successMessage, { type: 'success' });
    } catch (requestError) {
      showPopup(requestError.message || translate('Could not update this planet.'), { type: 'error' });
    } finally {
      setBusy('');
    }
  }, [load, showPopup]);

  const rename = async (project) => {
    const name = (await showPrompt({
      title: translate('Rename community planet'),
      inputLabel: translate('Planet name'),
      initialValue: project.name,
      confirmLabel: translate('Rename'),
      maxLength: 120,
    }))?.trim();
    if (!name || name === project.name) return;
    await updateOwnerProject(project, { name }, translate("Renamed to {0}.", { 0: name }));
  };

  const ownerProjects = useMemo(() => new Set(
    projects.filter((project) => user?.id && project.author?.id === user.id).map((project) => project.id),
  ), [projects, user?.id]);

  const resultsTitle = activeQuery
    ? translate("Results for “{0}”", { 0: activeQuery })
    : activeType ? COMMUNITY_TYPES.find((option) => option.id === activeType)?.label : translate('Recently shared');

  return (
    <section className="community-page" aria-labelledby="community-title">
      <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14} /> {translate("Back to projects")}</button>
      <header className="community-heading">
        <span><Compass size={14} /> {translate("Explore")}</span>
        <h1 id="community-title">{translate("Community worlds")}</h1>
        <p>{translate("Discover public planets, gas giants and stars. Open one in the studio, or copy its code straight into your three.js project.")}</p>
      </header>

      <form className="community-search" onSubmit={search}>
        <Search size={14} aria-hidden />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate("Search names, creators, or sharing codes")} aria-label={translate("Search community projects")} />
        <button type="submit" className="lp-secondary sm">{translate("Search")}</button>
      </form>

      <div className="community-filters" role="tablist" aria-label={translate("Filter community worlds by body type")}>
        <button type="button" role="tab" aria-selected={!activeType} className={!activeType ? 'active' : ''} onClick={() => selectType('')}>{translate("All worlds")}</button>
        {COMMUNITY_TYPES.map((option) => (
          <button type="button" role="tab" key={option.id} aria-selected={activeType === option.id} className={activeType === option.id ? 'active' : ''} onClick={() => selectType(option.id)}>{translate(option.label)}</button>
        ))}
      </div>

      <div className="community-results-head">
        <div><h2>{translate(resultsTitle)}</h2><span>{total} {translate("public project")}{total === 1 ? '' : 's'}</span></div>
        {activeQuery && <button type="button" className="community-clear-search" onClick={() => { setQuery(''); setActiveQuery(''); setPage(1); }}><X size={12} /> {translate("Clear search")}</button>}
      </div>

      {loading ? <div className="community-state"><Compass size={22} /><span>{translate("Loading community worlds…")}</span></div> : projects.length === 0 ? (
        <div className="community-state"><Globe2 size={24} /><strong>{translate("No worlds match these filters")}</strong><span>{translate("Try another search or browse all public worlds.")}</span></div>
      ) : (
        <div className="community-grid">
          {projects.map((project) => {
            const { Icon } = iconForProject(project);
            const thumbnail = projectThumbnailUrl(project);
            const isOwner = ownerProjects.has(project.id);
            const disabled = !!busy;
            const selectedCommunityIcon = project.communityIcon ?? DEFAULT_ICON_BY_TYPE[project.bodyType] ?? COMMUNITY_ICONS[0].id;
            return (
              <article className={`community-card${isOwner ? ' is-owner' : ''}`} key={project.id}>
                <div className={`community-card-art ${project.bodyType}${thumbnail ? ' has-thumbnail' : ''}`}>
                  {thumbnail
                    ? <img className="community-card-thumb" src={thumbnail} alt="" loading="lazy" />
                    : <span className="community-card-icon"><Icon size={30} aria-hidden /></span>}
                  <span className="community-card-type">{typeLabel(project.bodyType)}</span>
                  <button type="button" className="community-share-link" onClick={() => copyShareLink(project.shareCode)} title={translate("Copy opening link")} aria-label={translate("Copy opening link for {0}", { 0: project.name })}>
                    {copied === `link:${project.shareCode}` ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}<code>{project.shareCode}</code>
                  </button>
                </div>
                <div className="community-card-body">
                  <div className="community-card-title-row"><h3>{project.name}</h3>{isOwner && <span className="community-owner-badge">{translate("Yours")}</span>}</div>
                  <p>{project.description || translate("A shared {0} made with Procedural Planets.", { 0: translate(typeLabel(project.bodyType)).toLowerCase() })}</p>
                  <div className="community-author">
                    <span>{avatarUrl(project.author) ? <img src={avatarUrl(project.author)} alt="" /> : <UserRound size={13} />}</span>
                    <strong>{project.author.displayName || project.author.username}</strong>
                    <small>@{project.author.username}</small>
                  </div>
                  <div className="community-card-actions">
                    <button type="button" className="lp-primary sm" onClick={() => importByCode(project.shareCode)} disabled={disabled || !ready}><FolderDown size={14} /> {translate("Open copy")}</button>
                    <button type="button" className="lp-secondary sm" onClick={() => copyCode(project)} disabled={disabled} title={translate("Copy a procedural-planets snippet that recreates this world")}>
                      {copied === `code:${project.id}` ? <Check size={13} /> : <Code2 size={13} />}{translate("Copy code")}</button>
                    {isOwner && <button type="button" className={`lp-secondary sm community-edit-button${editingId === project.id ? ' active' : ''}`} onClick={() => setEditingId((current) => current === project.id ? '' : project.id)} disabled={disabled} aria-label={translate("Edit {0}", { 0: project.name })}><Settings2 size={13} /></button>}
                  </div>
                  {isOwner && editingId === project.id && (
                    <div className="community-owner-panel">
                      <div className="community-owner-panel-head"><strong>{translate("Manage planet")}</strong><button type="button" onClick={() => setEditingId('')} aria-label={translate("Close planet settings")}><X size={13} /></button></div>
                      <div className="community-owner-actions">
                        <button type="button" className="lp-secondary sm" onClick={() => rename(project)} disabled={disabled}><Pencil size={13} /> {translate("Rename")}</button>
                        <label className="community-visibility-select"><span>{translate("Visibility")}</span><span className="community-select-wrap">{project.visibility === 'public' ? <Globe2 size={12} /> : project.visibility === 'unlisted' ? <Eye size={12} /> : <Lock size={12} />}<select value={project.visibility} onChange={(event) => updateOwnerProject(project, { visibility: event.target.value }, translate("Visibility changed to {0}.", { 0: translate(event.target.value) }))} disabled={disabled} aria-label={translate("Visibility for {0}", { 0: project.name })}><option value="private">{translate("Private")}</option><option value="unlisted">{translate("Unlisted")}</option><option value="public">{translate("Public")}</option></select></span></label>
                      </div>
                      <div className="community-icon-picker"><span>{translate("Card icon")}</span><div>{COMMUNITY_ICONS.map((option) => { const OptionIcon = option.Icon; return <button type="button" key={option.id} className={selectedCommunityIcon === option.id ? 'active' : ''} onClick={() => updateOwnerProject(project, { communityIcon: option.id }, translate("{0} icon selected.", { 0: translate(option.label) }))} disabled={disabled} title={translate(option.label)} aria-label={translate("Use {0} icon", { 0: translate(option.label) })}><OptionIcon size={14} /></button>; })}</div></div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pages > 1 && <nav className="community-pagination" aria-label={translate("Community pages")}>
        <button type="button" className="lp-secondary sm" onClick={() => setPage((value) => value - 1)} disabled={page <= 1 || loading}><ArrowLeft size={13} /> {translate("Previous")}</button>
        <span>{translate("Page")} {page} {translate("of")} {pages}</span>
        <button type="button" className="lp-secondary sm" onClick={() => setPage((value) => value + 1)} disabled={page >= pages || loading}>{translate("Next")} <ArrowRight size={13} /></button>
      </nav>}
    </section>
  );
}
