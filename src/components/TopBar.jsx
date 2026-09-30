import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Cloud,
  CloudOff,
  Code2,
  Dices,
  Download,
  EyeOff,
  FilePlus2,
  FileText,
  FolderOpen,
  HardDrive,
  HelpCircle,
  Orbit,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Undo2,
  Upload,
} from 'lucide-react';
import { APP_NAME, APP_VERSION } from '../constants/app.js';
import { EDITOR_SHORTCUTS, SEARCH_SETTINGS_SHORTCUT, matchesShortcut, shortcutText } from '../keyboardShortcuts.js';
import { PROJECT_FILE_ACCEPT } from '../project/ProjectDocument.js';
import NotificationCenter from './ui/Toast.jsx';
import ShortcutHint from './ui/ShortcutHint.jsx';

const Caret = () => (
  <svg className="tb-file-caret" viewBox="0 0 12 12" aria-hidden>
    <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DOCUMENT_STATE = {
  saving: { label: 'Saving…', Icon: HardDrive },
  local: { label: 'Saved on this device', short: 'Saved', Icon: HardDrive },
  synced: { label: 'Saved and synced to the cloud', short: 'Synced', Icon: Cloud },
  unsynced: { label: 'Saved locally · cloud copy is behind (Ctrl+S to sync)', short: 'Not synced', Icon: CloudOff },
  syncing: { label: 'Syncing to the cloud…', short: 'Syncing…', Icon: Cloud },
};

export default function TopBar({
  projectName = 'Untitled planet',
  documentState = 'local',
  shortcutsEnabled = true,
  onProjectNameChange,
  onHome,
  onNew,
  onSave,
  onSaveAs,
  onLoadFile,
  onDownload,
  onCopyCode,
  onScreenshot,
  onRandomize,
  onResetTemplate,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onResetView,
  autoRotate = false,
  onAutoRotate,
  onToggleUi,
  seed,
  onSeedInput,
  onOpenSearch,
  searchOpen,
  onExport,
  exportActive,
  onToggleHelp,
  helpOpen = false,
  recentNotifications = [],
  notificationsIgnored = false,
  onClearNotifications,
  onToggleNotificationLogging,
}) {
  const fileRef = useRef(null);
  const fileMenuRef = useRef(null);
  const editMenuRef = useRef(null);
  const viewMenuRef = useRef(null);
  const [openMenu, setOpenMenu] = useState(null);
  const shortcutActionsRef = useRef({});

  const openFilePicker = () => fileRef.current?.click();

  shortcutActionsRef.current = shortcutsEnabled ? {
    newPlanet: onNew,
    projects: onHome,
    save: onSave,
    saveAs: onSaveAs,
    load: openFilePicker,
    download: onDownload,
    randomSeed: onRandomize,
  } : {};

  useEffect(() => {
    if (!openMenu) return undefined;
    const refs = { file: fileMenuRef, edit: editMenuRef, view: viewMenuRef };
    const onPointerDown = (event) => {
      if (!refs[openMenu].current?.contains(event.target)) setOpenMenu(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    const onShortcut = (event) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      const entry = Object.entries(EDITOR_SHORTCUTS).find(([actionId, shortcut]) => (
        shortcutActionsRef.current[actionId] && matchesShortcut(event, shortcut)
      ));
      if (!entry) return;
      event.preventDefault();
      setOpenMenu(null);
      shortcutActionsRef.current[entry[0]]?.();
    };
    document.addEventListener('keydown', onShortcut, true);
    return () => document.removeEventListener('keydown', onShortcut, true);
  }, []);

  useEffect(() => {
    if (!shortcutsEnabled) setOpenMenu(null);
  }, [shortcutsEnabled]);

  const run = (action) => () => {
    setOpenMenu(null);
    action?.();
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onLoadFile?.(file);
  };

  const menuButton = (id, label) => (
    <button
      type="button"
      className={`tb-btn tb-menu-btn${openMenu === id ? ' active' : ''}`}
      onClick={() => setOpenMenu(openMenu === id ? null : id)}
      title={label}
      aria-haspopup="menu"
      aria-expanded={openMenu === id}
    >
      <span className="tb-text">{label}</span>
      <Caret />
    </button>
  );

  const state = DOCUMENT_STATE[documentState] ?? DOCUMENT_STATE.local;

  return (
    <header id="topbar" className={openMenu ? 'file-menu-open' : ''}>
      <div className="tb-group tb-brand">
        <button type="button" className="tb-brand-button" onClick={onHome} title="Back to projects">
          <Orbit className="logo" aria-hidden />
          <span className="app-name">{APP_NAME}</span>
        </button>
      </div>

      <div className="tb-group tb-left">
        <div className="tb-dropdown" ref={fileMenuRef}>
          {menuButton('file', 'File')}
          <div className={`tb-menu tb-menu-with-shortcuts${openMenu === 'file' ? ' open' : ''}`} role="menu" aria-label="File">
            <label className="tb-project-name-field">
              <span>Project name</span>
              <input
                type="text"
                value={projectName}
                maxLength={120}
                aria-label="Project name"
                onChange={(event) => onProjectNameChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  run(onSave)();
                }}
              />
            </label>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={run(onNew)}>
              <FilePlus2 size={14} strokeWidth={1.75} aria-hidden /> New planet
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.newPlanet} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={run(onHome)}>
              <FolderOpen size={14} strokeWidth={1.75} aria-hidden /> Projects
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.projects} className="tb-menu-shortcut" />
            </button>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={run(onSave)}>
              <Save size={14} strokeWidth={1.75} aria-hidden /> Save
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.save} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={run(onSaveAs)}>
              <FileText size={14} strokeWidth={1.75} aria-hidden /> Save as…
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.saveAs} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={run(openFilePicker)}>
              <Upload size={14} strokeWidth={1.75} aria-hidden /> Load…
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.load} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={run(onDownload)}>
              <Download size={14} strokeWidth={1.75} aria-hidden /> Download .ppplanet
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.download} className="tb-menu-shortcut" />
            </button>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={run(onCopyCode)}>
              <Code2 size={14} strokeWidth={1.75} aria-hidden /> Copy code snippet
            </button>
            <button type="button" role="menuitem" onClick={run(onScreenshot)}>
              <Camera size={14} strokeWidth={1.75} aria-hidden /> Screenshot (PNG)
            </button>
          </div>
        </div>
        <span className={`tb-document-state ${documentState}`} title={state.label}>
          <state.Icon size={12} aria-hidden /> {state.short ?? state.label}
        </span>

        <div className="tb-dropdown" ref={editMenuRef}>
          {menuButton('edit', 'Edit')}
          <div className={`tb-menu tb-menu-with-shortcuts${openMenu === 'edit' ? ' open' : ''}`} role="menu" aria-label="Edit">
            <button type="button" role="menuitem" onClick={run(onUndo)} disabled={!canUndo}>
              <Undo2 size={14} strokeWidth={1.75} aria-hidden /> Undo
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.undo} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={run(onRedo)} disabled={!canRedo}>
              <Redo2 size={14} strokeWidth={1.75} aria-hidden /> Redo
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.redo} className="tb-menu-shortcut" />
            </button>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={run(onRandomize)}>
              <Dices size={14} strokeWidth={1.75} aria-hidden /> Random seed
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.randomSeed} className="tb-menu-shortcut" />
            </button>
            <label className="tb-project-name-field tb-seed-field">
              <span>Seed</span>
              <input value={seed} inputMode="numeric" onChange={(event) => onSeedInput?.(event.target.value)} aria-label="Seed" />
            </label>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={run(onResetTemplate)}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> Reset to template
            </button>
          </div>
        </div>

        <div className="tb-dropdown" ref={viewMenuRef}>
          {menuButton('view', 'View')}
          <div className={`tb-menu${openMenu === 'view' ? ' open' : ''}`} role="menu" aria-label="View">
            <button type="button" role="menuitem" onClick={run(onResetView)}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> Reset camera
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={autoRotate}
              className={autoRotate ? 'active' : ''}
              onClick={run(() => onAutoRotate?.(!autoRotate))}
            >
              <Orbit size={14} strokeWidth={1.75} aria-hidden /> Auto rotate
            </button>
            <button type="button" role="menuitem" onClick={run(onToggleUi)}>
              <EyeOff size={14} strokeWidth={1.75} aria-hidden /> Hide UI
            </button>
          </div>
        </div>

        <div className="tb-history" role="group" aria-label="History">
          <button type="button" className="tb-btn tb-icon-btn" onClick={onUndo} disabled={!canUndo} title={`Undo (${shortcutText(EDITOR_SHORTCUTS.undo)})`} aria-label="Undo">
            <Undo2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
          <button type="button" className="tb-btn tb-icon-btn" onClick={onRedo} disabled={!canRedo} title={`Redo (${shortcutText(EDITOR_SHORTCUTS.redo)})`} aria-label="Redo">
            <Redo2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      <div className="tb-center">
        <button type="button" className={`tb-btn tb-search-btn${searchOpen ? ' active' : ''}`} onClick={onOpenSearch} title={`Search settings (${shortcutText(SEARCH_SETTINGS_SHORTCUT)})`} aria-pressed={searchOpen}>
          <Search size={13} />
          <span className="tb-text">Search settings</span>
          <ShortcutHint shortcut={SEARCH_SETTINGS_SHORTCUT} className="tb-shortcut" />
        </button>
      </div>

      <div className="tb-group tb-right">
        <button type="button" className="tb-btn tb-icon-btn" onClick={onRandomize} title={`Random seed (${shortcutText(EDITOR_SHORTCUTS.randomSeed)})`} aria-label="Random seed"><Dices size={14} /></button>
        <NotificationCenter
          recent={recentNotifications}
          notificationsIgnored={notificationsIgnored}
          onClear={onClearNotifications}
          onToggleIgnore={onToggleNotificationLogging}
        />
        <button type="button" className={`tb-btn primary${exportActive ? ' active' : ''}`} onClick={onExport} title="Export the planet">
          <Download size={14} /><span className="tb-text">Export</span>
        </button>
        <button type="button" className={`tb-btn tb-icon-btn tb-help-btn${helpOpen ? ' active' : ''}`} onClick={onToggleHelp} title="Keyboard shortcuts and controls" aria-label="Keyboard shortcuts and controls" aria-expanded={helpOpen}>
          <HelpCircle size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <span className="app-version">v{APP_VERSION}</span>
      </div>

      <input type="file" ref={fileRef} accept={PROJECT_FILE_ACCEPT} hidden onChange={onFile} />
    </header>
  );
}
