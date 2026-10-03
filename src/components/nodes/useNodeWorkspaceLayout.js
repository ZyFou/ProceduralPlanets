import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'procedural-planets-nodes-layout-v1';
const DEFAULT = { graphEdge: 'bottom', graphRatio: 0.38, inspectorSide: 'right', inspectorWidth: 372, paletteDetached: true, paletteSide: 'left', paletteWidth: 208, paletteCollapsed: false };
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || min));
function loadLayout() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT, graphEdge: ['top', 'bottom', 'left', 'right'].includes(p.graphEdge) ? p.graphEdge : DEFAULT.graphEdge, graphRatio: clamp(p.graphRatio ?? .38, .25, .65), inspectorSide: p.inspectorSide === 'left' ? 'left' : 'right', inspectorWidth: clamp(p.inspectorWidth ?? 372, 320, 500), paletteSide: p.paletteSide === 'right' ? 'right' : 'left', paletteDetached: p.paletteDetached !== false, paletteCollapsed: p.paletteCollapsed === true };
  } catch { return { ...DEFAULT }; }
}

export default function useNodeWorkspaceLayout(rootRef, dockRef) {
  const [layout, setLayout] = useState(loadLayout);
  const [dragging, setDragging] = useState(null);
  const [snap, setSnap] = useState(null);
  const drag = useRef(null);
  const updateLayout = useCallback(patch => setLayout(p => ({ ...p, ...patch })), []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* Optional preferences. */ } }, [layout]);
  useEffect(() => {
    function target(event, kind) {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return 'bottom';
      if (kind === 'palette') {
        const d = dockRef.current?.getBoundingClientRect();
        if (d && event.clientX >= d.left && event.clientX <= d.right && event.clientY >= d.top && event.clientY <= d.bottom) return 'attached';
      }
      const distances = { left: Math.abs(event.clientX - r.left), right: Math.abs(r.right - event.clientX), top: Math.abs(event.clientY - r.top), bottom: Math.abs(r.bottom - event.clientY) };
      return (kind === 'graph' ? ['bottom', 'left', 'top', 'right'] : ['left', 'right']).sort((a, b) => distances[a] - distances[b])[0];
    }
    function move(event) {
      const d = drag.current, r = rootRef.current?.getBoundingClientRect();
      if (!d || !r) return;
      if (d.kind === 'graph-resize') {
        const edge = d.edge;
        updateLayout({ graphRatio: clamp(edge === 'bottom' ? (r.bottom - event.clientY) / r.height : edge === 'top' ? (event.clientY - r.top) / r.height : edge === 'left' ? (event.clientX - r.left - d.offset) / (r.width - d.totalOffset) : (r.right - event.clientX - d.offset) / (r.width - d.totalOffset), .25, .65) });
      } else if (d.kind === 'inspector-resize') updateLayout({ inspectorWidth: clamp(d.side === 'left' ? event.clientX - r.left - d.offset : r.right - event.clientX - d.offset, 320, 500) });
      else {
        if (!d.armed && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 6) return;
        d.armed = true;
        setDragging(d.kind); setSnap(target(event, d.kind));
      }
    }
    function finish(event) {
      const d = drag.current;
      drag.current = null; setDragging(null); setSnap(null);
      if (!d?.armed || event.type === 'pointercancel') return;
      const edge = target(event, d.kind);
      if (d.kind === 'graph') updateLayout({ graphEdge: edge });
      if (d.kind === 'inspector') updateLayout({ inspectorSide: edge });
      if (d.kind === 'palette') updateLayout(edge === 'attached' ? { paletteDetached: false, paletteCollapsed: false } : { paletteDetached: true, paletteCollapsed: false, paletteSide: edge });
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
  }, [rootRef, dockRef, updateLayout]);
  const startDock = (kind, event) => {
    if (event.button !== 0 || event.target.closest('button,input,select,textarea,a')) return;
    event.preventDefault(); drag.current = { kind, x: event.clientX, y: event.clientY, armed: false };
  };
  const paletteWidth = layout.paletteDetached && !layout.paletteCollapsed ? layout.paletteWidth : 0;
  const sideOffset = side => (layout.paletteSide === side ? paletteWidth : 0) + (layout.inspectorSide === side ? layout.inspectorWidth : 0);
  const dockStyle = ['bottom', 'top'].includes(layout.graphEdge)
    ? { [layout.graphEdge]: 0, left: sideOffset('left'), right: sideOffset('right'), height: `${layout.graphRatio * 100}%` }
    : { [layout.graphEdge]: sideOffset(layout.graphEdge), top: 0, bottom: 0, width: `calc((100% - ${sideOffset('left') + sideOffset('right')}px) * ${layout.graphRatio})` };
  return {
    layout, updateLayout, dragging, snap, dockStyle,
    paletteStyle: { [layout.paletteSide]: 0, top: 0, bottom: 0, width: layout.paletteWidth },
    inspectorStyle: { [layout.inspectorSide]: layout.paletteSide === layout.inspectorSide ? paletteWidth : 0, top: 0, bottom: 0, width: layout.inspectorWidth },
    startDock,
    startGraphResize: event => { event.preventDefault(); drag.current = { kind: 'graph-resize', edge: layout.graphEdge, offset: sideOffset(layout.graphEdge), totalOffset: sideOffset('left') + sideOffset('right') }; },
    startInspectorResize: event => { event.preventDefault(); drag.current = { kind: 'inspector-resize', side: layout.inspectorSide, offset: layout.paletteSide === layout.inspectorSide ? paletteWidth : 0 }; },
  };
}
