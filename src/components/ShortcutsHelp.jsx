import { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import { EDITOR_SHORTCUTS, SEARCH_SETTINGS_SHORTCUT } from '../keyboardShortcuts.js';
import ShortcutHint from './ui/ShortcutHint.jsx';

// Every editor shortcut, grouped. Shown by the top bar's help button and in
// the Ctrl+K search before anything is typed. `keys` is for non-Ctrl input.
export const SHORTCUT_GROUPS = [
  {
    title: 'File',
    items: [
      { label: 'New planet', shortcut: EDITOR_SHORTCUTS.newPlanet },
      { label: 'Projects', shortcut: EDITOR_SHORTCUTS.projects },
      { label: 'Save (and sync if linked)', shortcut: EDITOR_SHORTCUTS.save },
      { label: 'Save as…', shortcut: EDITOR_SHORTCUTS.saveAs },
      { label: 'Load .ppplanet', shortcut: EDITOR_SHORTCUTS.load },
      { label: 'Download .ppplanet', shortcut: EDITOR_SHORTCUTS.download },
    ],
  },
  {
    title: 'Edit',
    items: [
      { label: 'Undo', shortcut: EDITOR_SHORTCUTS.undo },
      { label: 'Redo', shortcut: EDITOR_SHORTCUTS.redo },
      { label: 'Random seed', shortcut: EDITOR_SHORTCUTS.randomSeed },
      { label: 'Search settings', shortcut: SEARCH_SETTINGS_SHORTCUT },
    ],
  },
  {
    title: 'Viewport',
    items: [
      { label: 'Orbit the camera', keys: 'Left drag' },
      { label: 'Pan', keys: 'Right drag' },
      { label: 'Zoom', keys: 'Wheel / pinch' },
      { label: 'Close menu, search or hidden UI', keys: 'Esc' },
    ],
  },
];

export default function ShortcutsHelp({ open, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target) && !event.target.closest?.('.tb-help-btn')) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <section className="shortcuts-help" ref={ref} role="dialog" aria-labelledby="shortcuts-help-title">
      <header>
        <Keyboard size={15} aria-hidden />
        <h2 id="shortcuts-help-title">Keyboard shortcuts</h2>
        <button type="button" onClick={onClose} aria-label="Close keyboard shortcuts"><X size={14} /></button>
      </header>
      {SHORTCUT_GROUPS.map((group) => (
        <div className="shortcuts-help-group" key={group.title}>
          <span className="shortcuts-help-title">{group.title}</span>
          {group.items.map(({ label, shortcut, keys }) => (
            <div className="shortcuts-help-row" key={label}>
              <span>{label}</span>
              {shortcut ? <ShortcutHint shortcut={shortcut} className="shortcuts-help-keys" /> : <span className="shortcuts-help-keys">{keys}</span>}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
