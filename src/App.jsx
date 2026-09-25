import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Disc3,
  Camera,
  Circle,
  Cloud,
  Code2,
  Download,
  Droplets,
  Gauge,
  House,
  Leaf,
  Orbit,
  Palette,
  Search,
  Shuffle,
  Sparkles,
  Sun,
  Waves,
  X,
} from 'lucide-react';
import { Engine } from './engine/Engine.js';
import { DEFAULT_PARAMS, migrateParams } from './engine/presets.js';
import { getProjectTemplate } from './project/ProjectTemplates.js';
import { DEFAULT_STAR_BODY } from './engine/star.js';
import { PANELS } from './components/panels.jsx';
import { searchSettings } from './components/settingsSearch.js';
import SettingsSearchOverlay from './components/SettingsSearchOverlay.jsx';

const ICONS = {
  terrain: Orbit,
  biomes: Leaf,
  style: Circle,
  water: Droplets,
  clouds: Cloud,
  gasFlow: Waves,
  gasStorms: Sparkles,
  gasColors: Palette,
  gasRings: Disc3,
  gasLighting: Sun,
  perf: Gauge,
  export: Download,
  starSurface: Sun,
  starColors: Palette,
  starSunspots: Sparkles,
  starCorona: Activity,
  starMotion: Orbit,
  shader: Code2,
};

export default function App({ project, landingMode = false, onHome, onProjectChange, onThumbnail }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const skipPersistRef = useRef(false);

  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0, chunks: 0 });
  const [activePanel, setActivePanel] = useState('terrain');
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = new Engine({ canvas, callbacks: { onStats: setStats } });
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

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !booted || !project?.params) return;
    // older projects carry the toon-era look: migrate it, keep the shape
    const template = getProjectTemplate(project.metadata?.templateId);
    const presetKey = template.mode === 'planet' ? template.preset : 'terran';
    const modePreset = { [template.mode]: template.preset };
    const next = { ...DEFAULT_PARAMS, ...migrateParams(project.params, presetKey, modePreset) };
    skipPersistRef.current = true;
    Object.entries(next).forEach(([key, value]) => engine.setParam(key, value));
    setParams(next);
    setActivePanel(next.mode === 'star' ? 'starSurface' : next.mode === 'gas' ? 'gasFlow' : 'terrain');
  }, [booted, project?.id]);

  useEffect(() => {
    if (!project || project.preview || !onProjectChange) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    onProjectChange(params);
  }, [params, project?.id, project?.preview, onProjectChange]);

  useEffect(() => {
    if (!booted || !project?.id || !onThumbnail) return undefined;
    const timer = window.setTimeout(() => {
      const dataUrl = engineRef.current?.screenshotDataURL();
      if (dataUrl) onThumbnail(project.id, dataUrl);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [booted, params, project?.id, onThumbnail]);

  const onParam = useCallback((key, value) => {
    engineRef.current?.setParam(key, value);
    setParams((previous) => ({ ...previous, [key]: value }));
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

  const onStarShaderApply = useCallback((source) => {
    setStarShaderStatus(engineRef.current?.setStarShader(source) ?? null);
  }, []);

  const onMode = useCallback((mode) => {
    onParam('mode', mode);
    setActivePanel(mode === 'star' ? 'starSurface' : mode === 'gas' ? 'gasFlow' : 'terrain');
  }, [onParam]);

  const onRandomize = useCallback(() => {
    const seed = engineRef.current?.randomize();
    if (seed !== undefined) setParams((previous) => ({ ...previous, seed }));
  }, []);

  const onSeedInput = useCallback((text) => {
    const value = parseInt(text, 10);
    if (Number.isFinite(value)) onParam('seed', value >>> 0);
  }, [onParam]);

  const onScreenshot = useCallback(() => {
    const url = engineRef.current?.screenshotDataURL();
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `planet-${params.seed}.png`;
    anchor.click();
  }, [params.seed]);

  const onExport = useCallback(async (options, onProgress) => {
    await engineRef.current?.exportPlanet(options, onProgress);
  }, []);

  const visiblePanels = PANELS.filter((panel) => panel.modes.includes(params.mode));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);

  const isPanelAvailable = useCallback(
    (panelId) => visiblePanels.some((panel) => panel.id === panelId),
    [visiblePanels],
  );

  const searchResults = useMemo(() => (
    searchOpen ? searchSettings(searchQuery, isPanelAvailable) : []
  ), [searchOpen, searchQuery, isPanelAvailable]);

  const groupedSearchResults = useMemo(() => {
    const map = new Map();
    searchResults.forEach((item, flatIndex) => {
      const entry = map.get(item.panelId) ?? {
        panelId: item.panelId,
        panelLabel: PANELS.find((panel) => panel.id === item.panelId)?.label ?? item.panelId,
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
    setSearchIndex((current) => searchResults.length ? Math.min(current, searchResults.length - 1) : 0);
  }, [searchResults.length]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        openSearch();
      } else if (event.key === 'Escape' && searchOpen) {
        event.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [searchOpen, openSearch, closeSearch]);

  const Panel = visiblePanels.find((panel) => panel.id === activePanel)?.component;

  return (
    <div id="app" className={`app${landingMode ? ' landing-mode' : ''}${activePanel ? ' side-drawer-open' : ''}`}>
      <header id="topbar">
        <div className="tb-group tb-brand">
          <button type="button" className="tb-brand-button" onClick={onHome} title="Back to projects">
            <Orbit className="logo" aria-hidden />
            <span className="app-name">Procedural Planets</span>
          </button>
        </div>
        <div className="tb-group tb-left">
          <button type="button" className="tb-btn tb-file-btn" onClick={onHome}><House size={14} /><span className="tb-text">Projects</span></button>
          <span className="tb-workspace-pill">{project?.metadata?.name ?? 'Untitled planet'}</span>
        </div>
        <div className="tb-center">
          <button type="button" className={`tb-btn tb-search-btn${searchOpen ? ' active' : ''}`} onClick={openSearch} title="Search settings (Ctrl+K)" aria-pressed={searchOpen}>
            <Search size={13} />
            <span className="tb-text">Search settings</span>
            <span className="tb-shortcut">Ctrl+K</span>
          </button>
        </div>
        <div className="tb-group tb-right">
          <label className="seed-box"><span>Seed</span><input value={params.seed} onChange={(event) => onSeedInput(event.target.value)} /></label>
          <button type="button" className="tb-btn tb-icon-btn" onClick={onRandomize} title="Random seed"><Shuffle size={14} /></button>
          <button type="button" className="tb-btn tb-icon-btn" onClick={onScreenshot} title="Screenshot (PNG)"><Camera size={14} /></button>
          <button type="button" className="tb-btn primary" onClick={() => setActivePanel('export')}><Download size={14} /><span className="tb-text">Export</span></button>
        </div>
      </header>

      <div id="main" className="main app-shell">
        <nav className="left-toolbar" aria-label="Planet tools">
          {visiblePanels.map((panel) => {
            const Icon = ICONS[panel.id] ?? Orbit;
            return (
              <button key={panel.id} type="button" className={`toolbar-btn${activePanel === panel.id ? ' active' : ''}`} onClick={() => setActivePanel(activePanel === panel.id ? null : panel.id)} title={panel.label}>
                <Icon aria-hidden />
                <span className="toolbar-btn-label">{panel.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="viewport-wrap viewport-area">
          <canvas id="viewport" ref={canvasRef} />
        </div>

        <div className="viewport-mode-bar" role="tablist" aria-label="Editor mode">
          <button type="button" role="tab" aria-selected={params.mode === 'planet'} className={params.mode === 'planet' ? 'active' : ''} onClick={() => onMode('planet')}><Orbit size={14} /> Planet</button>
          <button type="button" role="tab" aria-selected={params.mode === 'gas'} className={params.mode === 'gas' ? 'active' : ''} onClick={() => onMode('gas')}><Waves size={14} /> Gas</button>
          <button type="button" role="tab" aria-selected={params.mode === 'star'} className={params.mode === 'star' ? 'active' : ''} onClick={() => onMode('star')}><Sun size={14} /> Star</button>
        </div>

        {Panel && (
          <aside className="side-drawer open">
            <div className="side-panel">
              <div className="side-panel-header">
                <div className="side-panel-heading">
                  <div className="side-panel-title">{PANELS.find((panel) => panel.id === activePanel).label}</div>
                  <div className="side-panel-desc">Adjust procedural {params.mode === 'star' ? 'star' : params.mode === 'gas' ? 'gas giant' : 'planet'} settings.</div>
                </div>
                <button type="button" className="side-panel-close" onClick={() => setActivePanel(null)} aria-label="Close panel" title="Close panel"><X size={15} /></button>
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
            onChangeQuery={(value) => { setSearchQuery(value); setSearchIndex(0); }}
            onSelectIndex={setSearchIndex}
            onConfirm={confirmSearch}
            onConfirmPanel={confirmSearchPanel}
            onClose={closeSearch}
          />
        )}
      </div>

      <footer id="statusbar" className="statusbar">
        <span className={`status-dot${booted ? ' ok' : ''}`} />
        <span>{params.mode === 'star' ? 'Star' : params.mode === 'gas' ? 'Gas Giant' : 'Planet'}</span>
        <span className="sb-sep" />
        <span>Seed {params.seed}</span>
        <div className="sb-right">
          <span>{stats.chunks} chunks</span><span className="sb-sep" />
          <span>{(stats.triangles / 1000).toFixed(0)}K tris</span><span className="sb-sep" />
          <span>{stats.drawCalls} draws</span><span className="sb-sep" />
          <span className="sb-fps">{stats.fps} FPS</span>
        </div>
      </footer>
    </div>
  );
}
