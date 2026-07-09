import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Engine } from './engine/Engine.js';
import { DEFAULT_PARAMS } from './engine/presets.js';
import { DEFAULT_STAR_BODY } from './engine/star.js';
import { PANELS } from './components/panels.jsx';
import { searchSettings } from './components/settingsSearch.js';
import SettingsSearchOverlay from './components/SettingsSearchOverlay.jsx';

// Icons for the left toolbar (inline SVG, stroke = currentColor).
const ICONS = {
  terrain: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M3 17 L9 7 L13 12 L16 9 L21 17 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  ),
  biomes: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M6 19 C6 10 11 5 19 5 C19 13 14 18 6 19 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M6 19 C9 14 12 11 16 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
  ),
  style: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" /><path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" opacity="0.35" /></svg>
  ),
  water: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 4 C12 4 6 11 6 15 a6 6 0 0 0 12 0 C18 11 12 4 12 4 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  ),
  clouds: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M7 17 a4 4 0 1 1 1-7.9 A5 5 0 0 1 17.5 10 A3.5 3.5 0 0 1 17 17 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  ),
  gasFlow: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" /><path d="M5.5 9.5 C8.5 11.5 12 7.5 15.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M5 14.5 C8.5 12.5 13 16.5 18.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
  ),
  gasStorms: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" /><path d="M8 9.5 a4 3 0 1 1 6 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="14" cy="12.5" r="1.7" stroke="currentColor" strokeWidth="1.4" /></svg>
  ),
  gasColors: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.3" /></svg>
  ),
  gasLighting: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.6" /><path d="M12 3v2.5M12 18.5V21M4 12h2.5M17.5 12H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  ),
  perf: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M4 19 V11 M9 19 V5 M14 19 v-9 M19 19 V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
  export: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v11M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 18h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  ),
  starSurface: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.6" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3L16.9 7.1M7.1 16.9l-1.8 1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  ),
  starColors: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="2.5" fill="currentColor" opacity="0.4" /></svg>
  ),
  starSunspots: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.6" /><circle cx="9.5" cy="10.5" r="1.4" fill="currentColor" /><circle cx="14" cy="14" r="1.8" fill="currentColor" /></svg>
  ),
  starCorona: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
  ),
  starMotion: (
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.2" opacity="0.4" strokeDasharray="2 3" /></svg>
  ),
  shader: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M8 6 3 12l5 6M16 6l5 6-5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M13.5 5l-3 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
  ),
};

export default function App() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0, chunks: 0 });
  const [activePanel, setActivePanel] = useState('terrain');
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = new Engine({
      canvas,
      callbacks: { onStats: setStats },
    });
    engineRef.current = engine;
    if (import.meta.env.DEV) window.planetStudio = engine;
    setBooted(true);
    document.getElementById('boot-splash')?.classList.add('hide');
    return () => {
      engine.dispose();
      engineRef.current = null;
      if (import.meta.env.DEV && window.planetStudio === engine) window.planetStudio = null;
    };
  }, []);

  const onParam = useCallback((key, value) => {
    engineRef.current?.setParam(key, value);
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onPreset = useCallback((key) => {
    const merged = engineRef.current?.applyPreset(key);
    if (merged) setParams(merged);
  }, []);

  const onStarPreset = useCallback((key) => {
    const merged = engineRef.current?.applyStarPreset(key);
    if (merged) setParams(merged);
  }, []);

  const onGasPreset = useCallback((key) => {
    const merged = engineRef.current?.applyGasPreset(key);
    if (merged) setParams(merged);
  }, []);

  const [starShader, setStarShader] = useState(DEFAULT_STAR_BODY);
  const [starShaderStatus, setStarShaderStatus] = useState(null);

  const onStarShaderApply = useCallback((src) => {
    const res = engineRef.current?.setStarShader(src);
    setStarShaderStatus(res ?? null);
  }, []);

  const onMode = useCallback((mode) => {
    onParam('mode', mode);
    setActivePanel(mode === 'star' ? 'starSurface' : mode === 'gas' ? 'gasFlow' : 'terrain');
  }, [onParam]);

  const onRandomize = useCallback(() => {
    const seed = engineRef.current?.randomize();
    if (seed !== undefined) setParams((prev) => ({ ...prev, seed }));
  }, []);

  const onSeedInput = useCallback((text) => {
    const v = parseInt(text, 10);
    if (Number.isFinite(v)) onParam('seed', v >>> 0);
  }, [onParam]);

  const onScreenshot = useCallback(() => {
    const url = engineRef.current?.screenshotDataURL();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `planet-${params.seed}.png`;
    a.click();
  }, [params.seed]);

  const onExport = useCallback(async (options, onProgress) => {
    await engineRef.current?.exportPlanet(options, onProgress);
  }, []);

  const visiblePanels = PANELS.filter((p) => p.modes.includes(params.mode));

  // -------------------------------------------------------------- Ctrl+K search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);

  const isPanelAvailable = useCallback(
    (panelId) => visiblePanels.some((p) => p.id === panelId),
    [visiblePanels],
  );

  const searchResults = useMemo(() => {
    if (!searchOpen) return [];
    return searchSettings(searchQuery, isPanelAvailable);
  }, [searchOpen, searchQuery, isPanelAvailable]);

  const groupedSearchResults = useMemo(() => {
    const map = new Map();
    searchResults.forEach((item, flatIndex) => {
      const entry = map.get(item.panelId) ?? {
        panelId: item.panelId,
        panelLabel: PANELS.find((p) => p.id === item.panelId)?.label ?? item.panelId,
        items: [],
      };
      entry.items.push({ ...item, flatIndex });
      map.set(item.panelId, entry);
    });
    return [...map.values()];
  }, [searchResults]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchIndex(0);
    setSearchQuery('');
  }, []);

  const confirmSearch = useCallback((index = searchIndex) => {
    const item = searchResults[index];
    if (!item) return;
    setActivePanel(item.panelId);
    closeSearch();
  }, [searchIndex, searchResults, closeSearch]);

  const confirmSearchPanel = useCallback((panelId) => {
    if (!isPanelAvailable(panelId)) return;
    setActivePanel(panelId);
    closeSearch();
  }, [isPanelAvailable, closeSearch]);

  useEffect(() => {
    setSearchIndex((cur) => (searchResults.length ? Math.min(cur, searchResults.length - 1) : 0));
  }, [searchResults.length]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [searchOpen, openSearch, closeSearch]);
  const Panel = visiblePanels.find((p) => p.id === activePanel)?.component;

  return (
    <div className={`app${activePanel ? ' side-drawer-open' : ''}`}>
      <header id="topbar">
        <div className="tb-group tb-brand">
          <svg className="logo" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
            <path d="M4.2 14.1c-1.2-.8-1.8-1.7-1.5-2.6.6-1.8 5.2-2 10.3-.5s8.8 4.2 8.2 6c-.3.9-1.5 1.4-3.3 1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M19.8 9.9c1.2.8 1.8 1.7 1.5 2.6-.6 1.8-5.2 2-10.3.5S2.2 8.8 2.8 7c.3-.9 1.5-1.4 3.3-1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="app-name">Procedural Planets</span>
        </div>
        <div className="tb-group tb-mode">
          <div className="mode-switch" role="tablist" aria-label="Editor mode">
            <button
              type="button"
              className={params.mode === 'planet' ? 'active' : ''}
              onClick={() => onMode('planet')}
            >
              Planet
            </button>
            <button
              type="button"
              className={params.mode === 'gas' ? 'active' : ''}
              onClick={() => onMode('gas')}
            >
              Gas
            </button>
            <button
              type="button"
              className={params.mode === 'star' ? 'active' : ''}
              onClick={() => onMode('star')}
            >
              Star
            </button>
          </div>
        </div>
        <div className="tb-group tb-right">
          <button
            type="button"
            className={`tb-btn tb-search-btn${searchOpen ? ' active' : ''}`}
            onClick={openSearch}
            title="Search settings (Ctrl+K)"
            aria-pressed={searchOpen}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="tb-text">Search</span>
            <span className="tb-shortcut">Ctrl+K</span>
          </button>
          <label className="seed-box">
            <span>Seed</span>
            <input
              value={params.seed}
              onChange={(e) => onSeedInput(e.target.value)}
            />
          </label>
          <button type="button" className="tb-btn" onClick={onRandomize} title="Random seed">
            <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" /><circle cx="9" cy="9" r="1.4" fill="currentColor" /><circle cx="15" cy="15" r="1.4" fill="currentColor" /><circle cx="15" cy="9" r="1.4" fill="currentColor" /><circle cx="9" cy="15" r="1.4" fill="currentColor" /></svg>
          </button>
          <button type="button" className="tb-btn" onClick={onScreenshot} title="Screenshot (PNG)">
            <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="13.5" r="3.4" stroke="currentColor" strokeWidth="1.6" /><path d="M8 7 L9.6 4.5 h4.8 L16 7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </header>

      <div className="main">
        <nav className="left-toolbar">
          {visiblePanels.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`lt-btn${activePanel === p.id ? ' active' : ''}`}
              onClick={() => setActivePanel(activePanel === p.id ? null : p.id)}
              title={p.label}
            >
              {ICONS[p.id]}
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        <div className="viewport-wrap">
          <canvas id="viewport" ref={canvasRef} />
        </div>

        {Panel && (
          <aside className="side-drawer open">
            <div className="side-panel">
              <div className="side-panel-header">
                <div className="side-panel-title">{PANELS.find((p) => p.id === activePanel).label}</div>
                <button
                  type="button"
                  className="side-panel-close"
                  onClick={() => setActivePanel(null)}
                  aria-label="Close panel"
                  title="Close panel"
                >
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="side-panel-content">
                <Panel
                  params={params}
                  onParam={onParam}
                  onPreset={onPreset}
                  onStarPreset={onStarPreset}
                  onGasPreset={onGasPreset}
                  onExport={onExport}
                  onScreenshot={onScreenshot}
                  starShader={starShader}
                  onStarShaderChange={setStarShader}
                  onStarShaderApply={onStarShaderApply}
                  starShaderStatus={starShaderStatus}
                />
              </div>
            </div>
          </aside>
        )}

        {searchOpen && (
          <SettingsSearchOverlay
            open={searchOpen}
            query={searchQuery}
            groupedResults={groupedSearchResults}
            flatResults={searchResults}
            selectedIndex={searchIndex}
            onChangeQuery={(value) => {
              setSearchQuery(value);
              setSearchIndex(0);
            }}
            onSelectIndex={setSearchIndex}
            onConfirm={confirmSearch}
            onConfirmPanel={confirmSearchPanel}
            onClose={closeSearch}
          />
        )}
      </div>

      <footer className="statusbar">
        <span className={`status-dot${booted ? ' ok' : ''}`} />
        <span>{params.mode === 'star' ? 'Star' : params.mode === 'gas' ? 'Gas Giant' : 'Planet'}</span>
        <span className="sb-sep" />
        <span>Seed {params.seed}</span>
        <div className="sb-right">
          <span>{stats.chunks} chunks</span>
          <span className="sb-sep" />
          <span>{(stats.triangles / 1000).toFixed(0)}K tris</span>
          <span className="sb-sep" />
          <span>{stats.drawCalls} draws</span>
          <span className="sb-sep" />
          <span className="sb-fps">{stats.fps} FPS</span>
        </div>
      </footer>
    </div>
  );
}
