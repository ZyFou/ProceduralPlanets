import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Orbit, RotateCcw, Search, Sun, Waves } from 'lucide-react';
import { PARAM_DOCS } from '../lib/paramDocs.js';
import CodeBlock from './CodeBlock.jsx';
import LivePlanet from './LivePlanet.jsx';
import { formatValue, planetSnippet, toHex } from './planetCode.js';

// ============================================================================
// Parameter reference generated from PARAM_DOCS (the same metadata as
// docs/parameters.md), with a control per parameter driving a live planet
// and the code that reproduces it.
// ============================================================================

const DOMAINS = [
  { id: 'planet', label: 'Terrestrial', icon: Orbit, options: {} },
  { id: 'gas', label: 'Gas giant', icon: Waves, options: { type: 'gas' } },
  { id: 'star', label: 'Star', icon: Sun, options: { type: 'star' } },
];
// metadata or viewer-level keys: documented, not editable here
const READ_ONLY = new Set(['mode', 'renderVersion', 'weatherSystems', 'renderResolution', 'upscaler']);

const ENTRIES = Object.entries(PARAM_DOCS).map(([key, doc]) => ({ key, ...doc }));

const decimals = (step = 1) => Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));

function formatDefault(entry) {
  if (entry.type === 'color') return toHex(entry.default);
  if (entry.type === 'array') return '[]';
  if (typeof entry.default === 'number') return String(Math.round(entry.default * 1e4) / 1e4);
  return String(entry.default);
}

function Control({ entry, value, onChange }) {
  if (READ_ONLY.has(entry.key)) return <span className="docs-param-readonly">{translate('Set in code')}</span>;
  if (entry.type === 'boolean') {
    return (
      <label className="docs-switch">
        <input type="checkbox" checked={!!value} onChange={(event) => onChange(event.target.checked)} aria-label={entry.key} />
        <span aria-hidden />
      </label>
    );
  }
  if (entry.type === 'color') {
    return <input type="color" className="docs-color" value={toHex(value)} onChange={(event) => onChange(event.target.value)} aria-label={entry.key} />;
  }
  if (entry.type === 'number' && Number.isFinite(entry.min) && Number.isFinite(entry.max)) {
    const step = entry.step ?? (entry.max - entry.min) / 100;
    return (
      <div className="docs-range">
        <input type="range" min={entry.min} max={entry.max} step={step} value={value}
          onChange={(event) => onChange(Number(event.target.value))} aria-label={entry.key} />
        <output>{Number(value).toFixed(decimals(step))}</output>
      </div>
    );
  }
  return <span className="docs-param-readonly">{translate('Set in code')}</span>;
}

export default function ParameterReference({ anchor, onOpenInStudio }) {
  const locale = useLocale();
  const anchorDomain = PARAM_DOCS[anchor]?.domain;
  const [domain, setDomain] = useState(anchorDomain ?? 'planet');
  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState({});
  const [onlyEdited, setOnlyEdited] = useState(false);
  const viewerRef = useRef(null);
  const listRef = useRef(null);
  const current = DOMAINS.find((item) => item.id === domain);

  // a search result or shared link: show its domain, scroll to the row
  useEffect(() => {
    if (!anchor || !PARAM_DOCS[anchor]) return;
    setDomain(PARAM_DOCS[anchor].domain);
    setQuery('');
    setOnlyEdited(false);
    // after the domain switch has rendered the row
    const timer = setTimeout(() => {
      const row = document.getElementById(`param-${anchor}`);
      row?.scrollIntoView({ block: 'center' });
      row?.classList.add('flash');
      setTimeout(() => row?.classList.remove('flash'), 1600);
    }, 30);
    return () => clearTimeout(timer);
  }, [anchor]);

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const map = new Map();
    for (const entry of ENTRIES) {
      if (entry.domain !== domain) continue;
      if (onlyEdited && !(entry.key in edits)) continue;
      if (normalized && ![entry.key, entry.label, entry.description, translate(entry.label), translate(entry.description), entry.group, translate(entry.group)]
        .some((text) => String(text ?? '').toLowerCase().includes(normalized))) continue;
      if (!map.has(entry.group)) map.set(entry.group, []);
      map.get(entry.group).push(entry);
    }
    return [...map];
  }, [domain, query, onlyEdited, edits, locale]);

  const selectDomain = (id) => {
    setDomain(id);
    setEdits({});
    setOnlyEdited(false);
  };

  const change = (entry, value) => {
    setEdits((prev) => ({ ...prev, [entry.key]: value }));
    viewerRef.current?.planet.set({ [entry.key]: value });
  };

  const reset = (entry) => {
    setEdits(({ [entry.key]: _removed, ...rest }) => rest);
    viewerRef.current?.planet.set({ [entry.key]: entry.default });
  };

  const resetAll = () => {
    const defaults = {};
    for (const key of Object.keys(edits)) defaults[key] = PARAM_DOCS[key].default;
    viewerRef.current?.planet.set(defaults);
    setEdits({});
  };

  const codeEntries = [
    ...(current.options.type ? [['type', `'${current.options.type}'`]] : []),
    ...Object.entries(edits).map(([key, value]) => [key, formatValue(value, PARAM_DOCS[key].type)]),
  ];
  if (!('seed' in edits)) codeEntries.push(['seed', '42']);
  const editedCount = Object.keys(edits).length;
  const planetOptions = useMemo(() => ({ ...current.options, seed: 42 }), [current]);

  return (
    <div className="docs-params">
      <header className="docs-page-head">
        <span className="docs-eyebrow">{translate('Reference')}</span>
        <h1>{translate('Parameters')}</h1>
        <p>{translate('Every parameter a Planet accepts, with its type, default and range. Move a control to change the live planet; the code on the right reproduces it.')}</p>
      </header>

      <div className="docs-params-toolbar">
        <div className="docs-segmented" role="tablist" aria-label={translate('Body type')}>
          {DOMAINS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={domain === id} className={domain === id ? 'active' : ''} onClick={() => selectDomain(id)}>
              <Icon size={13} aria-hidden /> {translate(label)}
            </button>
          ))}
        </div>
        <label className="docs-filter">
          <Search size={14} aria-hidden />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate('Filter parameters…')} aria-label={translate('Filter parameters')} />
        </label>
        <label className="docs-check">
          <input type="checkbox" checked={onlyEdited} onChange={(event) => setOnlyEdited(event.target.checked)} disabled={!editedCount && !onlyEdited} />
          {translate('Changed only')}
        </label>
      </div>

      <div className="docs-params-layout">
        <div className="docs-params-list" ref={listRef}>
          {groups.length === 0 && <p className="docs-empty">{translate('No parameter matches this filter.')}</p>}
          {groups.map(([group, entries]) => (
            <section key={group} className="docs-param-group">
              <h2>{translate(group)}</h2>
              {entries.map((entry) => {
                const edited = entry.key in edits;
                const value = edited ? edits[entry.key] : entry.default;
                return (
                  <article key={entry.key} id={`param-${entry.key}`} className={`docs-param${edited ? ' edited' : ''}`}>
                    <div className="docs-param-info">
                      <div className="docs-param-name">
                        <code>{entry.key}</code>
                        {entry.label !== entry.key && <span>{translate(entry.label)}</span>}
                        {entry.structural && <em title={translate('Changing it rebuilds the terrain mesh')}>{translate('rebuild')}</em>}
                      </div>
                      <p>{translate(entry.description)}</p>
                      <dl>
                        <div><dt>{translate('Type')}</dt><dd>{entry.type}</dd></div>
                        <div><dt>{translate('Default')}</dt><dd>
                          {entry.type === 'color' && <i className="docs-swatch" style={{ background: toHex(entry.default) }} aria-hidden />}
                          {formatDefault(entry)}
                        </dd></div>
                        {Number.isFinite(entry.min) && <div><dt>{translate('Range')}</dt><dd>{entry.min} – {entry.max}</dd></div>}
                      </dl>
                    </div>
                    <div className="docs-param-control">
                      <Control entry={entry} value={value} onChange={(next) => change(entry, next)} />
                      {edited && (
                        <button type="button" className="docs-icon-btn" onClick={() => reset(entry)} title={translate('Reset to default')} aria-label={translate('Reset {0} to default', { 0: entry.key })}>
                          <RotateCcw size={13} aria-hidden />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>

        <aside className="docs-params-preview">
          <LivePlanet planet={planetOptions} onViewer={(viewer) => { viewerRef.current = viewer; if (viewer) viewer.planet.set(edits); }} />
          <div className="docs-preview-actions">
            <span>{editedCount ? translate('{0} changed', { 0: editedCount }) : translate('Defaults')}</span>
            <div>
              <button type="button" className="docs-btn ghost" onClick={resetAll} disabled={!editedCount}><RotateCcw size={13} aria-hidden /> {translate('Reset all')}</button>
              {onOpenInStudio && (
                <button type="button" className="docs-btn" onClick={() => onOpenInStudio(translate(current.label), { ...current.options, seed: 42, ...edits })}>
                  <ExternalLink size={13} aria-hidden /> {translate('Open in Studio')}
                </button>
              )}
            </div>
          </div>
          <CodeBlock code={planetSnippet(codeEntries)} lang="js" />
        </aside>
      </div>
    </div>
  );
}
