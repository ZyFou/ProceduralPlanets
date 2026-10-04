import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Disc3,
  Circle,
  Cloud,
  Code2,
  Download,
  Droplets,
  Eye,
  Gauge,
  Leaf,
  Orbit,
  Palette,
  Sparkles,
  Sun,
  Waves,
  X,
} from 'lucide-react';
import { Engine } from './engine/Engine.js';
import { DEFAULT_PARAMS, migrateParams } from './engine/presets.js';
import { createTemplateParams, getProjectTemplate } from './project/ProjectTemplates.js';
import { planetCodeSnippet } from './project/codeSnippet.js';
import { copyText } from './utils/clipboard.js';
import { DEFAULT_STAR_BODY } from './engine/star.js';
import { PANELS } from './components/panels.jsx';
import { searchSettings } from './components/settingsSearch.js';
import SettingsSearchOverlay from './components/SettingsSearchOverlay.jsx';
import TopBar from './components/TopBar.jsx';
import PanelResizeHandle, { DEFAULT_PANEL_SHARE } from './components/PanelResizeHandle.jsx';
import { classifyToast } from './components/ui/Toast.jsx';
import { usePopup } from './components/ui/PopupProvider.jsx';
import { EDITOR_SHORTCUTS, SEARCH_SETTINGS_SHORTCUT, isTextEditingTarget, matchesShortcut } from './keyboardShortcuts.js';
import ShortcutsHelp from './components/ShortcutsHelp.jsx';
const NodeWorkspace = lazy(() => import('./components/nodes/NodeWorkspace.jsx'));
import { createInitialGraph, compileGraph } from './engine/graph/index.js';
import { applyTerrainDraft, canEditGraph, terrainDraftState } from './project/terrainDraft.js';
import { canEditWorkspaceEditor } from './components/nodes/workspaceDocument.js';

const toHex = (rgb) => `#${rgb.map((c) => Math.round(Math.min(Math.max(c, 0), 1) * 255).toString(16).padStart(2, '0')).join('')}`;

/** Current value of a search result's setting, as shown in the Ctrl+K list. */
function formatSearchValue(item, params) {
  const key = item.settingId.split('.').slice(1).join('.');
  const value = params[key];
  if (key === 'preset') return 'Presets';
  if (value === undefined || value === null) return item.panelId === 'export' ? 'Export' : '-';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return value.length === 3 ? toHex(value).toUpperCase() : value.join(', ');
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return String(Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(2)));
  }
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

const HISTORY_LIMIT = 100;
// edits closer together than this (a slider drag) form one undo step
const HISTORY_GROUP_MS = 600;

const LOADING_STAGES = {
  shaders: 'Compiling shaders',
  noise: 'Baking cloud noise',
  weather: 'Forming weather',
  prime: 'Warming up the GPU',
};

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

export default function App({
  project,
  landingMode = false,
  suspended = false,
  onExplore,
  documentState = 'local',
  onHome,
  onNew,
  onProjectChange,
  onRename,
  onSave,
  onSaveAs,
  onLoadFile,
  onDownload,
  onThumbnail,
}) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const skipPersistRef = useRef(false);
  const loadedProjectIdRef = useRef(null);
  const loadedParamsRef = useRef(null);
  const historyLoadingRef = useRef(null);
  const { showPopup } = usePopup();

  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [design, setDesign] = useState({ terrain: { mode: 'procedural', graph: null }, editor: {} });
  const designRef = useRef(design);
  designRef.current = design;
  const [nodesOpen, setNodesOpen] = useState(false);
  const [graphStatus, setGraphStatus] = useState({ state: 'ready', diagnostics: [] });
  const [invalidImportedTerrain, setInvalidImportedTerrain] = useState(false);
  const [nodeLayout, setNodeLayout] = useState({ graphEdge: 'bottom', graphRatio: .38, paletteDetached: true, paletteCollapsed: false, paletteSide: 'left', paletteWidth: 208, inspectorSide: 'right', inspectorWidth: 372 });
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0, chunks: 0 });
  const [activePanel, setActivePanel] = useState('terrain');
  const [retainedPanel, setRetainedPanel] = useState('terrain');
  const [panelShare, setPanelShare] = useState(DEFAULT_PANEL_SHARE);
  const [panelResizing, setPanelResizing] = useState(false);
  // Keep the outgoing panel mounted until its closing transition finishes.
  // Reopening cancels the removal, including when another tool is selected.
  useEffect(() => {
    if (activePanel) {
      setRetainedPanel(activePanel);
      return undefined;
    }
    const timer = window.setTimeout(() => setRetainedPanel(null), 260);
    return () => window.clearTimeout(timer);
  }, [activePanel]);
  const [booted, setBooted] = useState(false);
  // shaders still compiling for what the viewport should show (the last
  // frame stays up meanwhile; nothing freezes)
  const [compiling, setCompiling] = useState(false);
  const precompiledRef = useRef(false);
  const watchRef = useRef(0);

  const watchCompile = useCallback(() => {
    cancelAnimationFrame(watchRef.current);
    let frames = 0;
    const poll = () => {
      const pending = engineRef.current?.planetRenderer.pending ?? 0;
      if (pending > 0) setCompiling(true);
      if (pending === 0 && frames > 2) { setCompiling(false); return; }
      frames++;
      watchRef.current = requestAnimationFrame(poll);
    };
    watchRef.current = requestAnimationFrame(poll);
  }, []);

  const precompileTypes = useCallback(() => {
    if (precompiledRef.current || !engineRef.current) return;
    precompiledRef.current = true;
    engineRef.current.precompileAll();
  }, []);

  // Boot: the loading screen (index.html) stays up until the planet's first
  // final-quality frame is on the canvas — shaders compile in parallel and
  // the GPU bakes run a slice per frame, so the loader keeps animating. Then
  // it fades out over that frame. The other body types compile on intent
  // (pointer on the type switcher), not eagerly: the browser's shader cache
  // is small, and filling it with every type's programs evicts the planet's
  // own for the next visit (bench: repeat visits 1.6 s -> 1.0 s).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const engine = new Engine({ canvas, callbacks: { onStats: setStats } });
    engineRef.current = engine;
    if (import.meta.env.DEV) window.planetStudio = engine;
    performance.mark('pp:engine-created');
    const loader = window.__ppLoader;
    const span = (p) => 0.14 + p * 0.8;
    let cancelled = false;
    (async () => {
      await engine.prepare({
        onProgress: ({ stage, progress, stageEnd }) => loader?.progress(span(progress), LOADING_STAGES[stage], span(stageEnd)),
      });
      if (cancelled) return;
      performance.mark('pp:first-frame');
      loader?.progress(0.97, 'Rendering first frame', 1);
      // one more frame: the first one must be presented before the reveal
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (cancelled) return;
      setBooted(true);
      await loader?.done();
      performance.mark('pp:loader-hidden');
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(watchRef.current);
      engine.dispose();
      engineRef.current = null;
      if (import.meta.env.DEV && window.planetStudio === engine) window.planetStudio = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !booted) return;
    engine.controls.enabled = !suspended;
    if (suspended) engine.stop();
    else engine.start();
  }, [suspended, booted]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !booted || !project?.params) return;
    // older projects carry the toon-era look: migrate it, keep the shape
    const template = getProjectTemplate(project.metadata?.templateId);
    const presetKey = template.mode === 'planet' ? template.preset : 'terran';
    const modePreset = { [template.mode]: template.preset };
    const next = { ...DEFAULT_PARAMS, ...migrateParams(project.params, presetKey, modePreset) };
    loadedProjectIdRef.current = project.id;
    loadedParamsRef.current = next;
    historyLoadingRef.current = next;
    skipPersistRef.current = true;
    skipHistoryRef.current = true;
    resetHistory();
    engine.planet.cancelTerrainCompilation();
    const nextDesign = JSON.parse(JSON.stringify({ terrain: project.terrain ?? { mode: 'procedural', graph: null }, editor: project.editor ?? {} }));
    setDesign(nextDesign);
    designRef.current = nextDesign;
    setNodesOpen(nextDesign.terrain.mode === 'nodes');
    setInvalidImportedTerrain(false);
    Object.entries(next).forEach(([key, value]) => engine.setParam(key, value));
    setParams(next);
    watchCompile();
    setActivePanel(next.mode === 'star' ? 'starSurface' : next.mode === 'gas' ? 'gasFlow' : 'terrain');
  }, [booted, project?.id, watchCompile]);

  useEffect(() => {
    if (!project || project.preview || !onProjectChange) return;
    // Not edits, so never saved: the render that switches projects (params
    // still belong to the previous one), anything before this project's
    // params are loaded, and the loaded params themselves (saving them would
    // bump `modified` and make a synced project look changed).
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      if (params === loadedParamsRef.current) loadedParamsRef.current = null;
      return;
    }
    if (loadedProjectIdRef.current !== project.id) return;
    if (params === loadedParamsRef.current) {
      loadedParamsRef.current = null;
      return;
    }
    onProjectChange(params, design);
  }, [params, design, project?.id, project?.preview, onProjectChange]);

  // ---- undo / redo: snapshots of the whole params object ------------------
  // A snapshot is pushed when an edit group starts; edits within
  // HISTORY_GROUP_MS of each other (a slider drag) extend the same group.
  const historyRef = useRef({ past: [], future: [], grouping: false, timer: 0 });
  const committedRef = useRef(null);
  const skipHistoryRef = useRef(false);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const syncHistoryState = useCallback(() => {
    const history = historyRef.current;
    setHistoryState({ canUndo: history.past.length > 0, canRedo: history.future.length > 0 });
  }, []);

  function resetHistory() {
    const history = historyRef.current;
    clearTimeout(history.timer);
    history.past = [];
    history.future = [];
    history.grouping = false;
    committedRef.current = null;
    setHistoryState({ canUndo: false, canRedo: false });
  }

  const endHistoryGroup = useCallback(() => {
    const history = historyRef.current;
    clearTimeout(history.timer);
    history.grouping = false;
    committedRef.current = { params: paramsRef.current, design: designRef.current };
  }, []);

  useEffect(() => {
    if (skipHistoryRef.current || committedRef.current === null) {
      if (historyLoadingRef.current && params !== historyLoadingRef.current) return;
      historyLoadingRef.current = null;
      skipHistoryRef.current = false;
      committedRef.current = { params, design: designRef.current };
      return;
    }
    const history = historyRef.current;
    if (!history.grouping) {
      history.past.push(committedRef.current);
      if (history.past.length > HISTORY_LIMIT) history.past.shift();
      history.future = [];
      history.grouping = true;
    }
    clearTimeout(history.timer);
    history.timer = setTimeout(endHistoryGroup, HISTORY_GROUP_MS);
    syncHistoryState();
  }, [params, design.editor, design.terrain.mode, endHistoryGroup, syncHistoryState]);

  const applyParams = useCallback((next) => {
    const engine = engineRef.current;
    if (!engine) return;
    const modeChanged = next.mode !== paramsRef.current.mode;
    skipHistoryRef.current = true;
    Object.entries(next).forEach(([key, value]) => {
      if (paramsRef.current[key] !== value) engine.setParam(key, value);
    });
    setParams(next);
    watchCompile();
    if (modeChanged) setActivePanel(next.mode === 'star' ? 'starSurface' : next.mode === 'gas' ? 'gasFlow' : 'terrain');
  }, [watchCompile]);

  const applyDocument = useCallback((snapshot) => {
    engineRef.current?.planet.cancelTerrainCompilation();
    applyParams(snapshot.params);
    setDesign(snapshot.design);
    designRef.current = snapshot.design;
  }, [applyParams]);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.grouping) endHistoryGroup();
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push({ params: paramsRef.current, design: designRef.current });
    applyDocument(previous);
    syncHistoryState();
  }, [applyDocument, endHistoryGroup, syncHistoryState]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.grouping) endHistoryGroup();
    const next = history.future.pop();
    if (!next) return;
    history.past.push({ params: paramsRef.current, design: designRef.current });
    applyDocument(next);
    syncHistoryState();
  }, [applyDocument, endHistoryGroup, syncHistoryState]);

  const draftGraph = design.editor.draftGraph ?? design.terrain.graph;
  const editableWorkspace = canEditGraph(draftGraph) && canEditWorkspaceEditor(design.editor, draftGraph);
  const graphKey = JSON.stringify(draftGraph);
  const appliedKey = JSON.stringify(design.terrain.graph);
  // Layout never enters this dependency list. A rejected draft remains editable
  // while the last applied shader and its sampler keep drawing the same terrain.
  useEffect(() => {
    const engine = engineRef.current;
    if (!booted || !engine || loadedProjectIdRef.current !== project?.id) return undefined;
    let cancelled = false;
    engine.planet.cancelTerrainCompilation();
    const current = designRef.current;
    const validation = terrainDraftState(current);
    if (!validation.valid && !validation.recoverable) {
      setInvalidImportedTerrain(true);
      setGraphStatus({ state: 'error', diagnostics: validation.diagnostics });
      return undefined;
    }
    setGraphStatus({ state: validation.valid ? 'compiling' : 'error', diagnostics: validation.diagnostics });
    let delay = validation.valid ? 280 : 0;
    if (validation.valid && validation.candidate.mode === 'nodes') {
      try {
        if (compileGraph(validation.candidate.graph, paramsRef.current).structureSignature === engine.planet._terrainProgram?.structureSignature) delay = 16;
      } catch { /* Planet returns the precise compilation diagnostic below. */ }
    }
    const timer = setTimeout(async () => {
      const result = await applyTerrainDraft(engine.planet, current, { renderer: engine.renderer, isCurrent: () => !cancelled });
      if (cancelled || result.obsolete) return;
      if (result.ok) {
        if (result.draftValid) setDesign((state) => JSON.stringify(state.terrain) === JSON.stringify(result.terrain) ? state : { ...state, terrain: result.terrain });
        setInvalidImportedTerrain(false);
        setGraphStatus({ state: validation.valid ? 'ready' : 'error', diagnostics: validation.diagnostics });
      } else {
        setInvalidImportedTerrain(result.noAppliedTerrain ?? false);
        setGraphStatus({ state: 'error', diagnostics: result.diagnostics ?? [{ message: result.error }] });
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); engine.planet.cancelTerrainCompilation(); };
  }, [booted, project?.id, design.terrain.mode, graphKey, appliedKey, params.seed, params.mode]);

  const onGraphChange = useCallback((graph, editor, action = {}) => {
    if (action.gesture === 'end') { endHistoryGroup(); return; }
    if (action.gesture !== 'parameter') endHistoryGroup();
    if (action.history === false) skipHistoryRef.current = true;
    setDesign((current) => ({ ...current, editor: { ...editor, draftGraph: graph } }));
  }, [endHistoryGroup]);

  const onTerrainMode = useCallback((mode) => {
    endHistoryGroup();
    setDesign((current) => {
      const graph = current.editor.draftGraph ?? current.terrain.graph ?? createInitialGraph(paramsRef.current);
      return { ...current, terrain: { ...current.terrain, mode }, editor: { ...current.editor, draftGraph: graph } };
    });
    setNodesOpen(mode === 'nodes');
    if (mode === 'nodes') setActivePanel(null);
  }, [endHistoryGroup]);

  useEffect(() => {
    if (landingMode) return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return;
      if (matchesShortcut(event, EDITOR_SHORTCUTS.undo)) {
        event.preventDefault();
        undo();
      } else if (matchesShortcut(event, EDITOR_SHORTCUTS.redo) || matchesShortcut(event, EDITOR_SHORTCUTS.redoAlt)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [landingMode, undo, redo]);

  const onResetTemplate = useCallback(() => {
    const templateId = project?.metadata?.templateId;
    applyParams(createTemplateParams(templateId, paramsRef.current.seed));
    // a reset is an edit: record it (applyParams skips history)
    skipHistoryRef.current = false;
  }, [applyParams, project?.metadata?.templateId]);

  // ---- notifications (popup + the top bar's recent activity list) ---------
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [notificationsIgnored, setNotificationsIgnored] = useState(false);
  const notify = useCallback((message, type = classifyToast(message)) => {
    if (!notificationsIgnored) {
      setRecentNotifications((current) => [{ id: `${Date.now()}-${Math.random()}`, msg: message, type, timestamp: Date.now() }, ...current].slice(0, 20));
    }
    showPopup(message, { type });
  }, [notificationsIgnored, showPopup]);

  // ---- view -----------------------------------------------------------------
  const [uiHidden, setUiHidden] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const [autoRotate, setAutoRotate] = useState(false);
  const onAutoRotate = useCallback((enabled) => {
    setAutoRotate(enabled);
    engineRef.current?.setAutoRotate(enabled);
  }, []);
  const onResetView = useCallback(() => engineRef.current?.frame(), []);

  useEffect(() => {
    if (!uiHidden) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setUiHidden(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [uiHidden]);

  const onCopyCode = useCallback(async () => {
    try {
      if (invalidImportedTerrain) throw new Error('No valid terrain is available.');
      await copyText(planetCodeSnippet(paramsRef.current, engineRef.current?.planet.terrain));
      notify(graphStatus.state === 'ready' ? 'Code snippet copied to the clipboard.' : 'Code snippet of the last valid terrain copied.', 'success');
    } catch {
      notify('Could not copy the code snippet.', 'error');
    }
  }, [notify, graphStatus.state, invalidImportedTerrain]);

  // project card thumbnail: a small copy of the next drawn frame once edits
  // settle (no extra render, no render-target resize, a few KB of WebP)
  useEffect(() => {
    if (!booted || !project?.id || !onThumbnail) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      engineRef.current?.captureThumbnail().then((dataUrl) => {
        if (!cancelled && dataUrl) onThumbnail(project.id, dataUrl);
      });
    }, 850);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [booted, params, design.terrain, project?.id, onThumbnail]);

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
    watchCompile();
    setActivePanel(mode === 'star' ? 'starSurface' : mode === 'gas' ? 'gasFlow' : 'terrain');
  }, [onParam, watchCompile]);

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
    if (invalidImportedTerrain) throw new Error('No valid terrain is available for export.');
    if (graphStatus.state !== 'ready') throw new Error('Apply a valid graph before exporting. The last valid terrain is still visible.');
    await engineRef.current?.exportPlanet(options, onProgress);
  }, [graphStatus.state, invalidImportedTerrain]);

  const visiblePanels = PANELS.filter((panel) => panel.modes.includes(params.mode));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);

  const isPanelAvailable = useCallback(
    (panelId) => visiblePanels.some((panel) => panel.id === panelId),
    [visiblePanels],
  );

  const searchResults = useMemo(() => (
    searchOpen
      ? searchSettings(searchQuery, isPanelAvailable).map((item) => ({ ...item, valueText: formatSearchValue(item, params) }))
      : []
  ), [searchOpen, searchQuery, isPanelAvailable, params]);

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

  // the setting a search result points at: the drawer scrolls to it and
  // flashes it once it is on screen (see the effect below)
  const [settingsTarget, setSettingsTarget] = useState(null);

  const confirmSearch = useCallback((index = searchIndex) => {
    const item = searchResults[index];
    if (!item) return;
    setActivePanel(item.panelId);
    setSettingsTarget({ ...item, requestedAt: Date.now() });
    closeSearch();
  }, [searchIndex, searchResults, closeSearch]);

  useEffect(() => {
    if (!settingsTarget) return undefined;
    let cancelled = false;
    let attempts = 0;
    let sectionOpened = false;
    const timers = [];
    const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
    const content = () => document.querySelector('.side-drawer .side-panel-content');
    const run = () => {
      if (cancelled) return;
      const root = content();
      const key = settingsTarget.settingId.split('.').slice(1).join('.');
      const section = root && [...root.querySelectorAll('[data-section]')]
        .find((node) => node.dataset.section === settingsTarget.sectionLabel);
      // collapsed section: open it, then look again once it has rendered
      if (section && !section.classList.contains('open') && !sectionOpened) {
        sectionOpened = true;
        section.querySelector('.section-header')?.click();
        later(run, 60);
        return;
      }
      const target = root?.querySelector(`[data-param="${CSS.escape(key)}"]`) ?? section;
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.classList.remove('setting-target-flash');
        void target.offsetWidth;   // restart the animation on a repeat hit
        target.classList.add('setting-target-flash');
        later(() => target.classList.remove('setting-target-flash'), 1200);
        target.querySelector('input:not([type=range]), select, button[role=switch], input[type=range]')?.focus({ preventScroll: true });
        setSettingsTarget(null);
        return;
      }
      if (++attempts < 12) later(run, 80);
      else setSettingsTarget(null);
    };
    later(run, 120);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [settingsTarget]);

  const confirmSearchPanel = useCallback((panelId) => {
    if (!isPanelAvailable(panelId)) return;
    setActivePanel(panelId);
    closeSearch();
  }, [isPanelAvailable, closeSearch]);

  useEffect(() => {
    setSearchIndex((current) => searchResults.length ? Math.min(current, searchResults.length - 1) : 0);
  }, [searchResults.length]);

  useEffect(() => {
    if (landingMode) return undefined;
    const onKeyDown = (event) => {
      if (matchesShortcut(event, SEARCH_SETTINGS_SHORTCUT)) {
        event.preventDefault();
        if (searchOpen) closeSearch();
        else {
          setUiHidden(false);
          openSearch();
        }
      } else if (event.key === 'Escape' && searchOpen) {
        event.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [landingMode, searchOpen, openSearch, closeSearch]);

  const displayedPanel = activePanel ?? retainedPanel;
  const Panel = visiblePanels.find((panel) => panel.id === displayedPanel)?.component;
  const showNodes = nodesOpen && params.mode === 'planet' && !landingMode && !uiHidden;
  const paletteWidth = nodeLayout.paletteDetached && !nodeLayout.paletteCollapsed ? nodeLayout.paletteWidth : 0;
  const leftOffset = 64 + (nodeLayout.paletteSide === 'left' ? paletteWidth : 0) + (nodeLayout.inspectorSide === 'left' ? nodeLayout.inspectorWidth : 0);
  const rightOffset = (nodeLayout.paletteSide === 'right' ? paletteWidth : 0) + (nodeLayout.inspectorSide === 'right' ? nodeLayout.inspectorWidth : 0);
  const viewportStyle = showNodes ? {
    '--nodes-left': `${leftOffset}px`, '--nodes-right': `${rightOffset}px`,
    '--nodes-top': nodeLayout.graphEdge === 'top' ? `max(220px, ${nodeLayout.graphRatio * 100}%)` : '0px',
    '--nodes-bottom': nodeLayout.graphEdge === 'bottom' ? `max(220px, ${nodeLayout.graphRatio * 100}%)` : '0px',
    ...(nodeLayout.graphEdge === 'left' ? { '--nodes-left': `calc(${leftOffset}px + max(320px, (100% - ${leftOffset + rightOffset}px) * ${nodeLayout.graphRatio}))` } : {}),
    ...(nodeLayout.graphEdge === 'right' ? { '--nodes-right': `calc(${rightOffset}px + max(320px, (100% - ${leftOffset + rightOffset}px) * ${nodeLayout.graphRatio}))` } : {}),
  } : {};

  return (
    <div id="app" className={`app${landingMode ? ' landing-mode' : ''}${activePanel && !showNodes ? ' side-drawer-open' : ''}${showNodes ? ' nodes-open' : ''}${uiHidden ? ' ui-hidden' : ''}`}>
      <TopBar
        projectName={project?.metadata?.name ?? 'Untitled planet'}
        documentState={documentState}
        shortcutsEnabled={!landingMode && !searchOpen}
        onProjectNameChange={onRename}
        onHome={onHome}
        onExplore={onExplore}
        onNew={onNew}
        onSave={onSave}
        onSaveAs={onSaveAs}
        onLoadFile={onLoadFile}
        onDownload={onDownload}
        onCopyCode={onCopyCode}
        onScreenshot={onScreenshot}
        onRandomize={onRandomize}
        onResetTemplate={onResetTemplate}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        onResetView={onResetView}
        autoRotate={autoRotate}
        onAutoRotate={onAutoRotate}
        onToggleUi={() => setUiHidden(true)}
        seed={params.seed}
        onSeedInput={onSeedInput}
        onOpenSearch={openSearch}
        searchOpen={searchOpen}
        onExport={() => setActivePanel('export')}
        exportActive={activePanel === 'export'}
        onToggleHelp={() => setHelpOpen((value) => !value)}
        helpOpen={helpOpen}
        recentNotifications={recentNotifications}
        notificationsIgnored={notificationsIgnored}
        onClearNotifications={() => setRecentNotifications([])}
        onToggleNotificationLogging={() => setNotificationsIgnored((value) => !value)}
      />
      <ShortcutsHelp open={helpOpen && !landingMode} onClose={closeHelp} />
      {uiHidden && (
        <button type="button" className="ui-hidden-restore" onClick={() => setUiHidden(false)} title="Show the interface (Esc)">
          <Eye size={14} aria-hidden /> Show UI
        </button>
      )}

      <div id="main" className={`main app-shell${panelResizing ? ' panel-resizing' : ''}`} style={{ '--panel-weight': `${panelShare / (1 - panelShare)}fr` }}>
        <nav className="left-toolbar" aria-label="Planet tools">
          {visiblePanels.map((panel) => {
            const Icon = ICONS[panel.id] ?? Orbit;
            return (
              <button key={panel.id} type="button" className={`toolbar-btn${activePanel === panel.id ? ' active' : ''}`} onClick={() => { setNodesOpen(false); setActivePanel(activePanel === panel.id ? null : panel.id); }} title={panel.label}>
                <Icon aria-hidden />
                <span className="toolbar-btn-label">{panel.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="viewport-wrap viewport-area" style={viewportStyle}>
          <canvas id="viewport" ref={canvasRef} />
          {invalidImportedTerrain && <div className="terrain-render-error" role="alert">This project's terrain graph cannot be rendered.<br />{graphStatus.diagnostics[0]?.message}<br />The document is preserved for recovery.</div>}
        </div>

        {compiling && (
          <div className="viewport-compiling" role="status"><span className="viewport-compiling-dot" aria-hidden />Compiling shaders</div>
        )}

        <div className="viewport-mode-bar" role="tablist" aria-label="Editor mode" onPointerEnter={precompileTypes} onFocus={precompileTypes}>
          <button type="button" role="tab" aria-label="Planet" title="Planet" aria-selected={params.mode === 'planet'} className={params.mode === 'planet' ? 'active' : ''} onClick={() => onMode('planet')}><Orbit size={14} /><span>Planet</span></button>
          <button type="button" role="tab" aria-label="Gas" title="Gas" aria-selected={params.mode === 'gas'} className={params.mode === 'gas' ? 'active' : ''} onClick={() => onMode('gas')}><Waves size={14} /><span>Gas</span></button>
          <button type="button" role="tab" aria-label="Star" title="Star" aria-selected={params.mode === 'star'} className={params.mode === 'star' ? 'active' : ''} onClick={() => onMode('star')}><Sun size={14} /><span>Star</span></button>
        </div>

        {showNodes && editableWorkspace && <Suspense fallback={<div className="nodes-editor-loading">Loading node editor…</div>}><NodeWorkspace graph={draftGraph} editor={design.editor} params={params} status={graphStatus} onChange={onGraphChange} onLayoutChange={setNodeLayout} onClose={() => { setNodesOpen(false); setActivePanel('terrain'); }} onUndo={undo} onRedo={redo} /></Suspense>}
        {showNodes && !editableWorkspace && <div className="nodes-recovery-notice" role="alert">The imported graph or editor layout is malformed. Its data is preserved in the project file.<br />{graphStatus.diagnostics[0]?.message}<br /><button type="button" onClick={() => { setNodesOpen(false); setActivePanel('terrain'); }}>Return to viewer</button></div>}

        {Panel && !showNodes && (
          <aside className={`side-drawer${activePanel ? ' open' : ''}`} inert={activePanel ? undefined : ''} aria-hidden={!activePanel}>
            <div className="side-panel">
              <div className="side-panel-header">
                <div className="side-panel-heading">
                  <div className="side-panel-title">{PANELS.find((panel) => panel.id === displayedPanel).label}</div>
                  <div className="side-panel-desc">Adjust procedural {params.mode === 'star' ? 'star' : params.mode === 'gas' ? 'gas giant' : 'planet'} settings.</div>
                </div>
                <PanelResizeHandle share={panelShare} onChange={setPanelShare} onResizing={setPanelResizing} />
                <button type="button" className="side-panel-close" onClick={() => setActivePanel(null)} aria-label="Close panel" title="Close panel"><X size={15} /></button>
              </div>
              <div className="side-panel-content">
                <Panel
                  params={params}
                  terrain={displayedPanel === 'export' ? (engineRef.current?.planet.terrain ?? design.terrain) : design.terrain}
                  onTerrainMode={onTerrainMode}
                  onOpenNodes={() => { setNodesOpen(true); setActivePanel(null); }}
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
