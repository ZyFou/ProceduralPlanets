import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useEffect, useRef } from 'react';

export const DEFAULT_PANEL_SHARE = 1.4 / 2.4;

export default function PanelResizeHandle({ share, onChange, onResizing }) {
  useLocale();
  const drag = useRef(null);
  useEffect(() => () => onResizing(false), [onResizing]);
  const limits = (element) => {
    const shell = element.closest('.app-shell');
    const available = Math.max(2, shell.clientHeight - shell.querySelector('.left-toolbar').offsetHeight);
    const max = Math.max(1, available - 136);
    return { available, min: Math.min(140, max), max };
  };
  const resize = (height, bounds) => {
    onChange(Math.max(bounds.min, Math.min(bounds.max, height)) / bounds.available);
  };
  const finish = () => {
    drag.current = null;
    onResizing(false);
  };

  return (
    <div
      className="panel-resize-handle"
      role="separator"
      aria-label={translate("Resize settings height")}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={translate("{0}% of the workspace", { 0: Math.round(share * 100) })}
      tabIndex={0}
      title={translate("Drag to resize settings · Double-click to reset")}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        const bounds = limits(event.currentTarget);
        drag.current = { y: event.clientY, height: event.currentTarget.closest('.side-drawer').getBoundingClientRect().height, bounds };
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizing(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        resize(drag.current.height + drag.current.y - event.clientY, drag.current.bounds);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => onChange(DEFAULT_PANEL_SHARE)}
      onKeyDown={(event) => {
        const bounds = limits(event.currentTarget);
        const step = bounds.available * 0.05;
        const height = event.currentTarget.closest('.side-drawer').getBoundingClientRect().height;
        const target = { ArrowUp: height + step, ArrowDown: height - step, Home: bounds.min, End: bounds.max }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        resize(target, bounds);
      }}
    ><span aria-hidden="true" /></div>
  );
}
