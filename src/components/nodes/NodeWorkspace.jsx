import { translateExternalMessage } from '../../i18n/externalMessages.js';
import { translate } from '../../i18n/locale.js';
import { useLocale } from '../../i18n/useLocale.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyNodeChanges, Background, BackgroundVariant, ConnectionMode, Controls, Handle, NodeResizer, Position, ReactFlow, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { Boxes, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, FolderPlus, GripVertical, Layers3, LoaderCircle, Maximize2, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, Trash2, Ungroup, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { GRAPH_REGISTRY, createNode, createRecipe, connectGraph, validateGraph } from '../../engine/graph/index.js';
import useNodeWorkspaceLayout from './useNodeWorkspaceLayout.js';
import { copySelection, groupSelection, movePresentation, newEditorId, nodePosition, pasteSelection, removeSelection } from './workspaceDocument.js';
import './NodeWorkspace.css';

const DESCRIPTIONS = {
  currentTerrain: 'A snapshot of the current procedural relief. Water, atmosphere and materials remain project settings.',
  noise3d: 'Continuous three-dimensional noise evaluated on the planet direction. Seed offset is relative to the project seed.',
  constant: 'One uniform height everywhere on the sphere.',
  mix: 'Blend two height branches with a factor between zero and one.',
  remap: 'Map the input height range to a new output range. A zero input interval produces a diagnostic.',
  heightOutput: 'The unique planet height output. Final height is clamped to [0, 1] and multiplied by the project height scale.',
};
const DEFINITIONS = Object.entries(GRAPH_REGISTRY).map(([id, d]) => ({ ...d, id, description: DESCRIPTIONS[id] || '', tone: id === 'heightOutput' ? 'output' : id === 'currentTerrain' ? 'green' : d.category === 'Operators' ? 'violet' : 'blue' }));
const definitionFor = type => DEFINITIONS.find(d => d.id === type) || { id: type, label: type, category: 'Unavailable', tone: 'amber', inputs: [], outputs: [], fields: [], description: translate('This node type is unavailable. Its original data remains in the saved draft.') };
const editable = target => !!target?.closest?.('input,textarea,select,[contenteditable="true"]');
function Icon({ definition, size = 14 }) {
  useLocale();
  const Component = definition.id === 'heightOutput' ? CheckCircle2 : definition.id === 'mix' ? Layers3 : definition.id === 'remap' ? SlidersHorizontal : definition.category === 'Sources' ? Sparkles : Boxes;
  return <Component size={size} strokeWidth={1.75} aria-hidden />;
}

function NodeCard({ data, selected }) {
  useLocale();
  const { node, definition: d, label, invalid, compiling } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(node.id));
    return () => cancelAnimationFrame(frame);
  }, [node.id, node.type, d.inputs.length, d.outputs.length, updateNodeInternals]);
  return <div className={`terrain-flow-node tone-${d.tone}${selected ? ' selected' : ''}${invalid ? ' invalid' : ''}${compiling ? ' compiling' : ''}`}>
    <div className="terrain-flow-node__header">
      <span className="terrain-flow-node__icon"><Icon definition={d} size={15} /></span>
      <span className="terrain-flow-node__heading"><span className="terrain-flow-node__eyebrow">{translate(d.category)}</span><span className="terrain-flow-node__title">{data.customLabel ? label : translate(label)}</span></span>
      {compiling && <span className="terrain-flow-node__compile" role="status" aria-label={translate("{0} is compiling", { 0: label })}><LoaderCircle size={12} /></span>}
      <span className="terrain-flow-node__kind">{d.protected ? translate('Output') : translate('Height')}</span>
    </div>
    <div className="terrain-flow-node__ports"><div className="terrain-flow-node__port-column inputs">{d.inputs.map((p, i) => <div className="terrain-flow-port input" key={p.id}><Handle id={p.id} type="target" position={Position.Left} style={{ top: 61 + i * 24 }} className="handle-height" isConnectableStart={false} title={translate("{0} accepts a height cable", { 0: translate(p.label) })} aria-label={translate("{0}: {1} input", { 0: label, 1: translate(p.label) })} /><span>{translate(p.label)}</span></div>)}</div>
      <div className="terrain-flow-node__port-column outputs">{d.outputs.map((p, i) => <div className="terrain-flow-port output" key={p.id}><span>{translate(p.label)}</span><Handle id={p.id} type="source" position={Position.Right} style={{ top: 61 + i * 24 }} className="handle-height" isConnectableEnd={false} title={translate("Drag or click to connect height")} aria-label={translate("{0}: height output", { 0: label })} /></div>)}</div>
    </div>
    {node.type === 'constant' && <div className="node-card-value">{node.params?.value ?? GRAPH_REGISTRY.constant.defaults.value}</div>}
  </div>;
}

function NodeGroup({ data, selected }) {
  useLocale();
  const g = data.group;
  return <div className={`terrain-flow-group${selected ? ' selected' : ''}${g.collapsed ? ' collapsed' : ''}`} style={{ '--group-tone': /^#[\da-f]{6}$/i.test(g.color) ? g.color : '#788392' }}>
    <NodeResizer isVisible={selected && !g.collapsed} minWidth={220} minHeight={100} lineClassName="terrain-flow-group__resize-line" handleClassName="terrain-flow-group__resize-handle" onResize={(_, s) => data.onResize(g.id, s, false)} onResizeEnd={(_, s) => data.onResize(g.id, s, true)} />
    <div className="terrain-flow-group__header"><span className="terrain-flow-group__icon"><Layers3 size={13} /></span><span className="terrain-flow-group__heading"><strong>{g.label}</strong><small>{g.nodeIds.length} {translate("stages")}</small></span><button type="button" className="nodrag" onClick={e => { e.stopPropagation(); data.onToggle(g.id); }}><ChevronDown size={13} className={g.collapsed ? 'collapsed' : ''} /><span>{g.collapsed ? translate('Expand') : translate('Collapse')}</span></button></div>
  </div>;
}
const NODE_TYPES = { planetNode: NodeCard, planetGroup: NodeGroup };

// Fit only after React Flow has measured the new nodes and their actual ports.
function FitRequested({ request }) {
  useLocale();
  const flow = useReactFlow();
  useEffect(() => {
    if (!request) return;
    let frame, attempts = 0;
    const fit = () => {
      const ready = request.ids.every(id => {
        const node = flow.getInternalNode(id);
        return node?.measured?.width > 0 && node?.measured?.height > 0 && node?.internals?.handleBounds !== undefined;
      });
      if (ready) flow.fitView({ padding: .18, maxZoom: 1, duration: 280 });
      else if (++attempts < 120) frame = requestAnimationFrame(fit);
    };
    frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [request, flow]);
  return null;
}

function NodePalette({ detached, side, style, query, onQuery, onAdd, onCollapse, onDragHeader }) {
  useLocale();
  const [collapsed, setCollapsed] = useState({});
  const filtered = DEFINITIONS.filter(d => !d.protected && `${d.label} ${translate(d.label)} ${d.category} ${translate(d.category)} ${d.description} ${translate(d.description)}`.toLowerCase().includes(query.toLowerCase()));
  const categories = [...new Set(filtered.map(d => d.category))];
  return <aside className={`node-quick-palette${detached ? ` detached detached-${side}` : ''}`} style={style} aria-label={translate("Planet height nodes")}>
    <header className="node-palette-drag-header" onPointerDown={onDragHeader} title={translate("Drag to dock the palette on either side or inside the graph")}><span>{translate("Height nodes")}</span><small>{DEFINITIONS.length - 1}</small><GripVertical className="node-palette-drag-cue" size={14} /><button type="button" onClick={onCollapse} title={translate("Collapse node palette")}><ChevronLeft size={14} /></button></header>
    <label className="node-palette-filter"><Search size={12} /><input value={query} onChange={e => onQuery(e.target.value)} placeholder={translate("Find a node…")} aria-label={translate("Find a height node")} />{query && <button type="button" onClick={() => onQuery('')} title={translate("Clear node filter")}><X size={11} /></button>}</label>
    <div className="node-palette-scroll">{categories.map(category => <section className={`node-palette-group${collapsed[category] ? ' collapsed' : ''}`} key={category}>
      <button type="button" className="node-palette-group-toggle" aria-expanded={!collapsed[category]} onClick={() => setCollapsed(p => ({ ...p, [category]: !p[category] }))}><span className="node-palette-group-title">{translate(category)}</span><span className="node-palette-group-count">{filtered.filter(d => d.category === category).length}</span><ChevronDown size={12} /></button>
      {!collapsed[category] && <div className="node-palette-group-body">{filtered.filter(d => d.category === category).map(d => <button key={d.id} type="button" draggable title={translate("{0} Click to add or drag onto the graph.", { 0: translate(d.description) })} onClick={() => onAdd(d.id)} onDragStart={e => { e.dataTransfer.setData('application/x-planet-height-node', d.id); e.dataTransfer.effectAllowed = 'copy'; }}><span className={`node-palette-icon tone-${d.tone}`}><Icon definition={d} size={12} /></span><span>{translate(d.label)}</span><Plus size={12} /></button>)}</div>}
    </section>)}{!filtered.length && <div className="node-palette-empty">{translate("No matching nodes")}</div>}</div>
    <footer><span>{filtered.length} {translate("shown")}</span><span className="node-palette-footer-spacer" /><kbd>{translate("Shift")}</kbd> + <kbd>A</kbd><span>{translate("all nodes")}</span></footer>
  </aside>;
}

function InspectorField({ field, value, onChange, onEnd, onBegin }) {
  useLocale();
  if (field.type === 'boolean') return <label className="node-inspector-toggle"><span>{translate(field.label)}</span><input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} /></label>;
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  return <label className="node-inspector-field"><span><span>{translate(field.label)}</span><output>{Number(number).toFixed(field.step >= 1 ? 0 : 2)}</output></span>
    <div className="node-inspector-number-row"><input type="range" min={field.min} max={field.max} step={field.step} value={number} onPointerDown={onBegin} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd} onChange={e => onChange(Number(e.target.value))} aria-label={translate(field.label)} /><input type="number" min={field.min} max={field.max} step={field.step} value={number} onFocus={onBegin} onBlur={onEnd} onChange={e => { if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value)); }} aria-label={translate("{0} value", { 0: translate(field.label) })} /></div>
  </label>;
}

function NodeInspector({ node, group, editor, diagnostics, onNodeLabel, onParam, onReset, onDelete, onGroupPatch, onUngroup, onHeader, onClose, onBegin, onEnd }) {
  useLocale();
  const [query, setQuery] = useState('');
  const [sections, setSections] = useState({});
  useEffect(() => setQuery(''), [node?.id, group?.id]);
  const d = node ? definitionFor(node.type) : null;
  const fields = (d?.fields || []).filter(f => `${f.label} ${translate(f.label)}`.toLowerCase().includes(query.toLowerCase()));
  const grouped = fields.reduce((map, f) => { const name = node.type === 'remap' ? f.key.startsWith('in') ? translate('Input range') : f.key.startsWith('out') ? translate('Output range') : translate('Behavior') : translate('Parameters'); (map[name] ||= []).push(f); return map; }, {});
  return <aside className="node-inspector" aria-label={translate("Node inspector")}>
    <header className="node-dock-header node-inspector__header node-dock-header--draggable" onPointerDown={onHeader} title={translate("Drag the inspector to dock left or right")}><div className="node-dock-heading"><span className="node-dock-kicker">{translate("Inspector")}</span><strong>{group ? translate('Group') : translate(d?.label) || translate('Height graph')}</strong></div><GripVertical className="node-dock-drag-cue" size={14} /><button type="button" className="node-icon-button" title={translate("Close node editor")} onClick={onClose}><X size={14} /></button></header>
    {!node && !group ? <div className="node-inspector-empty"><Boxes size={30} /><strong>{translate("Select a node")}</strong><span>{translate("Edit its height parameters here.")}</span><small>{translate("Shift+A adds · F fits · G groups")}</small></div> : <>
      {node && fields.length > 0 || node && query ? <label className="node-inspector-search-wrap"><Search size={14} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={translate("Find a property…")} aria-label={translate("Find a node property")} />{query && <button type="button" onClick={() => setQuery('')} title={translate("Clear property filter")}><X size={13} /></button>}</label> : null}
      <div className="node-inspector__body">{group ? <>
        <label className="node-inspector-field"><span>{translate("Name")}</span><input value={group.label} onChange={e => onGroupPatch({ label: e.target.value })} /></label>
        <label className="node-inspector-field"><span>{translate("Frame color")}</span><input type="color" value={/^#[\da-f]{6}$/i.test(group.color) ? group.color : '#788392'} onChange={e => onGroupPatch({ color: e.target.value })} /></label>
        <label className="node-inspector-toggle"><span>{translate("Collapse frame")}</span><input type="checkbox" checked={!!group.collapsed} onChange={e => onGroupPatch({ collapsed: e.target.checked })} /></label>
        <p className="node-inspector-description">{translate("Grouping changes the editor layout. All")} {group.nodeIds.length} {translate("nodes continue to generate the planet.")}</p><button type="button" className="node-inspector-reset" onClick={onUngroup}><Ungroup size={13} /> {translate("Ungroup")}</button>
      </> : <>
        <p className="node-inspector-description">{translate(d.description)}</p>
        <label className="node-inspector-field"><span>{translate("Name")}</span><input value={editor.nodeLabels?.[node.id] ?? translate(d.label)} onFocus={onBegin} onBlur={onEnd} onChange={e => onNodeLabel(e.target.value)} /></label>
        {Object.entries(grouped).map(([name, items]) => <section className={`node-inspector-section${sections[name] ? ' collapsed' : ''}`} key={name}><button type="button" className="node-inspector-section-toggle" onClick={() => setSections(p => ({ ...p, [name]: !p[name] }))} aria-expanded={!sections[name]}><span>{name}</span><small>{items.length}</small><ChevronDown size={12} /></button>{!sections[name] && <div className="node-inspector-section-body">{items.map(f => <InspectorField key={f.key} field={f} value={node.params?.[f.key] ?? d.defaults?.[f.key]} onChange={value => onParam(f.key, value)} onBegin={onBegin} onEnd={onEnd} />)}</div>}</section>)}
        {query && !fields.length && <div className="node-inspector-no-results">{translate("No properties match “{0}”.", { 0: query })}</div>}
        {!d.protected && <div className="node-inspector-actions"><button type="button" className="node-inspector-reset" onClick={onReset}><RotateCcw size={12} /> {translate("Reset parameters")}</button><button type="button" className="node-danger-button" onClick={onDelete}><Trash2 size={12} /> {translate("Delete node")}</button></div>}
      </>}
      {diagnostics.map((item, i) => <div className="node-local-diagnostic" role="alert" key={i}><CircleAlert size={13} /><span>{translateExternalMessage(typeof item === 'string' ? item : item.message)}</span></div>)}
      </div>
    </>}
    {!node && !group && diagnostics.length > 0 && <div className="node-graph-health invalid" role="alert"><CircleAlert size={13} /><span>{translateExternalMessage(typeof diagnostics[0] === 'string' ? diagnostics[0] : diagnostics[0].message)}</span></div>}
  </aside>;
}

export default function NodeWorkspace({ graph, editor = {}, params, status = { state: 'ready', diagnostics: [] }, onChange, onClose, onUndo, onRedo, onLayoutChange }) {
  useLocale();
  const rootRef = useRef(null), dockRef = useRef(null), searchRef = useRef(null), pointerRef = useRef(null), clipboard = useRef(null), gestureRef = useRef(null);
  const [localGraph, setGraph] = useState(graph), [localEditor, setEditor] = useState(editor);
  const graphRef = useRef(graph), editorRef = useRef(editor);
  const [instance, setInstance] = useState(null), [selectedNodes, setNodes] = useState(new Set()), [selectedGroups, setGroups] = useState(new Set()), [selectedEdges, setEdges] = useState(new Set());
  const [fitRequest, setFitRequest] = useState(null), [query, setQuery] = useState(''), [search, setSearch] = useState(null), [searchQuery, setSearchQuery] = useState(''), [searchIndex, setSearchIndex] = useState(0), [connectionError, setConnectionError] = useState('');
  const { layout, updateLayout, dragging, snap, dockStyle, paletteStyle, inspectorStyle, startDock, startGraphResize, startInspectorResize } = useNodeWorkspaceLayout(rootRef, dockRef);
  useEffect(() => { onLayoutChange?.(layout); }, [layout, onLayoutChange]);
  useEffect(() => { graphRef.current = graph; setGraph(graph); }, [graph]);
  useEffect(() => { editorRef.current = editor; setEditor(editor); }, [editor]);
  const commit = useCallback((nextGraph, nextEditor = editorRef.current, kind = 'graph', history = true) => {
    graphRef.current = nextGraph; editorRef.current = nextEditor; setGraph(nextGraph); setEditor(nextEditor);
    onChange?.(nextGraph, nextEditor, { kind, gesture: gestureRef.current, history });
  }, [onChange]);
  const beginGesture = () => { gestureRef.current = 'parameter'; };
  const endGesture = () => { if (gestureRef.current) onChange?.(graphRef.current, editorRef.current, { kind: 'param', gesture: 'end', history: true }); gestureRef.current = null; };
  const previewEditor = useCallback(next => { editorRef.current = next; setEditor(next); }, []);
  const patchGroup = useCallback((id, patch, finished = true) => {
    const next = { ...editorRef.current, groups: (editorRef.current.groups || []).map(g => g.id === id ? { ...g, ...patch } : g) };
    if (finished) commit(graphRef.current, next, 'layout'); else previewEditor(next);
  }, [commit, previewEditor]);
  const validation = useMemo(() => validateGraph(localGraph), [localGraph]);
  const diagnostics = [...(validation.diagnostics || []), ...(status.diagnostics || []), ...(connectionError ? [{ message: connectionError }] : [])];
  const invalidIds = new Set(diagnostics.map(d => d.nodeId).filter(Boolean));
  const hidden = useMemo(() => new Set((localEditor.groups || []).filter(g => g.collapsed).flatMap(g => g.nodeIds)), [localEditor.groups]);
  const presentedNodes = useMemo(() => [
    ...(localEditor.groups || []).map(g => ({ id: g.id, type: 'planetGroup', position: g.position, selected: selectedGroups.has(g.id), zIndex: g.collapsed ? 3 : 0, style: { width: g.collapsed ? 240 : g.width, height: g.collapsed ? 42 : g.height }, data: { group: g, onToggle: id => patchGroup(id, { collapsed: !g.collapsed }), onResize: (id, size, finished) => patchGroup(id, { width: size.width, height: size.height, position: { x: size.x, y: size.y } }, finished) } })),
    ...localGraph.nodes.filter(n => !hidden.has(n.id)).map(n => ({ id: n.id, type: 'planetNode', zIndex: 2, position: nodePosition(localEditor, n, localGraph.nodes.indexOf(n)), selected: selectedNodes.has(n.id), deletable: n.id !== localGraph.outputId, data: { node: n, definition: definitionFor(n.type), label: localEditor.nodeLabels?.[n.id] || definitionFor(n.type).label, customLabel: !!localEditor.nodeLabels?.[n.id], invalid: invalidIds.has(n.id), compiling: status.state === 'compiling' } })),
  ], [localGraph, localEditor, selectedGroups, selectedNodes, hidden, patchGroup, status.state, JSON.stringify([...invalidIds])]);
  // Keep React Flow's complete node objects, including its measured dimensions.
  // Recreating them from the document alone resets handle initialization.
  const [flowNodes, setFlowNodes] = useState(presentedNodes);
  useEffect(() => {
    setFlowNodes(previous => {
      const previousById = new Map(previous.map(node => [node.id, node]));
      return presentedNodes.map(node => {
        const existing = previousById.get(node.id);
        return existing ? { ...existing, ...node, measured: existing.measured } : node;
      });
    });
  }, [presentedNodes]);
  const flowEdges = useMemo(() => localGraph.edges.filter(e => !hidden.has(e.source) && !hidden.has(e.target)).map(e => ({ ...e, sourceHandle: e.sourcePort, targetHandle: e.targetPort, selected: selectedEdges.has(e.id), className: 'terrain-flow-edge edge-height', type: 'default', zIndex: 1 })), [localGraph, selectedEdges, hidden]);
  const clearSelection = () => { setNodes(new Set()); setGroups(new Set()); setEdges(new Set()); };
  const addAt = useCallback((type, position) => {
    if (!GRAPH_REGISTRY[type] || GRAPH_REGISTRY[type].protected) return;
    const n = createNode(type, newEditorId(), type === 'currentTerrain' ? createRecipe('current', params).nodes[0].params : {});
    commit({ ...graphRef.current, nodes: [...graphRef.current.nodes, n] }, { ...editorRef.current, nodePositions: { ...editorRef.current.nodePositions, [n.id]: position } });
    setNodes(new Set([n.id])); setGroups(new Set()); setEdges(new Set()); setSearch(null);
    rootRef.current?.focus({ preventScroll: true });
  }, [commit, params]);
  const addFromPalette = type => {
    const r = dockRef.current.getBoundingClientRect();
    addAt(type, instance?.screenToFlowPosition({ x: r.left + r.width * .5, y: r.top + Math.max(80, r.height * .45) }) || { x: 240, y: 60 });
  };
  const openSearch = useCallback(() => {
    const r = dockRef.current?.getBoundingClientRect(); if (!r) return;
    const p = pointerRef.current || { x: r.left + r.width / 2, y: r.top + 90 };
    setSearch({ left: Math.max(8, Math.min(r.width - 304, p.x - r.left)), top: Math.max(48, Math.min(r.height - 240, p.y - r.top)), position: instance?.screenToFlowPosition(p) || { x: 240, y: 60 } });
    setSearchQuery(''); setSearchIndex(0);
  }, [instance]);
  useEffect(() => { if (search) searchRef.current?.focus(); }, [search]);
  const deleteSelection = useCallback(() => {
    const result = removeSelection(graphRef.current, editorRef.current, selectedNodes, selectedEdges, selectedGroups);
    commit(result.graph, result.editor); setNodes(new Set()); setGroups(new Set()); setEdges(new Set());
  }, [commit, selectedNodes, selectedEdges, selectedGroups]);
  const paste = useCallback(data => {
    const result = pasteSelection(graphRef.current, editorRef.current, data);
    if (!result) return; commit(result.graph, result.editor); setNodes(new Set(result.nodeIds)); setGroups(new Set()); setEdges(new Set());
  }, [commit]);
  const group = useCallback(() => {
    const next = groupSelection(graphRef.current, editorRef.current, selectedNodes);
    if (!next) return; commit(graphRef.current, next, 'layout'); setNodes(new Set()); setEdges(new Set()); setGroups(new Set([next.groups.at(-1).id]));
  }, [commit, selectedNodes]);
  const ungroup = useCallback(() => { commit(graphRef.current, { ...editorRef.current, groups: (editorRef.current.groups || []).filter(g => !selectedGroups.has(g.id)) }, 'layout'); setGroups(new Set()); }, [commit, selectedGroups]);
  useEffect(() => {
    const onKey = event => {
      if (!rootRef.current?.contains(document.activeElement) || editable(event.target)) return;
      const key = event.key.toLowerCase(), primary = event.ctrlKey || event.metaKey;
      let handled = true;
      if (primary && key === 'c') clipboard.current = copySelection(graphRef.current, editorRef.current, [...selectedNodes], [...selectedGroups]);
      else if (primary && key === 'v') paste(clipboard.current);
      else if (primary && key === 'd') paste(copySelection(graphRef.current, editorRef.current, [...selectedNodes], [...selectedGroups]));
      else if (primary && key === 'a') { setNodes(new Set(graphRef.current.nodes.map(n => n.id))); setGroups(new Set()); }
      else if (primary && key === 'z') { if (event.shiftKey) onRedo?.(); else onUndo?.(); }
      else if (primary && key === 'y') onRedo?.();
      else if (!primary && event.shiftKey && key === 'a') openSearch();
      else if (!primary && key === 'g') { if (event.shiftKey) ungroup(); else group(); }
      else if (!primary && [translate('Delete'), 'Backspace'].includes(event.key)) deleteSelection();
      else if (!primary && key === 'f') instance?.fitView({ padding: .18, maxZoom: 1, duration: 280 });
      else if (event.key === 'Escape') setSearch(null);
      else handled = false;
      if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedNodes, selectedGroups, paste, onUndo, onRedo, openSearch, group, ungroup, deleteSelection, instance]);
  const selectedGroup = (localEditor.groups || []).find(g => selectedGroups.has(g.id));
  const selectedNode = selectedGroup ? null : localGraph.nodes.find(n => selectedNodes.has(n.id));
  const param = (key, value) => commit({ ...graphRef.current, nodes: graphRef.current.nodes.map(n => n.id === selectedNode.id ? { ...n, params: { ...n.params, [key]: value } } : n) }, editorRef.current, 'param');
  const searchResults = DEFINITIONS.filter(d => !d.protected && `${d.label} ${translate(d.label)} ${d.category} ${translate(d.category)} ${d.description} ${translate(d.description)}`.toLowerCase().includes(searchQuery.toLowerCase()));
  const palette = <NodePalette detached={layout.paletteDetached} side={layout.paletteSide} style={layout.paletteDetached ? paletteStyle : undefined} query={query} onQuery={setQuery} onAdd={addFromPalette} onCollapse={() => updateLayout({ paletteCollapsed: true })} onDragHeader={e => startDock('palette', e)} />;
  const attention = validation.valid === false || status.state === 'error';
  return <section ref={rootRef} tabIndex={-1} data-node-workspace className={`pp-nodes nodes-workspace graph-edge-${layout.graphEdge} inspector-${layout.inspectorSide}`} aria-label={translate("Planet height node workspace")} onPointerDownCapture={e => { if (!editable(e.target) && !e.target.closest('button')) rootRef.current?.focus({ preventScroll: true }); }}>
    <div className="nodes-mobile-notice"><strong>{translate("Height graph loaded")}</strong><span>{translate("Node editing is available on desktop. Your planet and graph remain available in this viewer.")}</span><button type="button" onClick={onClose}>{translate("Return to viewer")}</button></div>
    {dragging && <div className="node-panel-snap-layer" aria-hidden>{(dragging === 'graph' ? ['bottom', 'left', 'top', 'right'] : ['left', 'right']).map(edge => <div key={edge} className={`node-panel-snap-zone snap-${edge}${snap === edge ? ' active' : ''}`} />)}{dragging === 'palette' && <div className={`node-panel-snap-zone snap-attached${snap === 'attached' ? ' active' : ''}`} style={dockStyle}>{translate("Attach palette")}</div>}</div>}
    {layout.paletteDetached && !layout.paletteCollapsed && palette}
    {layout.paletteCollapsed && <button type="button" className="node-palette-expand" style={{ [layout.paletteSide]: 8, left: layout.paletteSide === 'right' ? 'auto' : 8, top: 8 }} title={translate("Show node palette")} onClick={() => updateLayout({ paletteCollapsed: false })}><ChevronRight size={15} /></button>}
    <div ref={dockRef} className="node-graph-dock" style={dockStyle} onPointerMove={e => { pointerRef.current = { x: e.clientX, y: e.clientY }; }} onContextMenu={e => e.preventDefault()} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); const type = e.dataTransfer.getData('application/x-planet-height-node'); if (type) addAt(type, instance?.screenToFlowPosition({ x: e.clientX, y: e.clientY }) || { x: 240, y: 60 }); }}>
      <div className="node-graph-resizer" onPointerDown={startGraphResize}><GripVertical size={14} /></div>
      <header className="node-dock-header node-graph-toolbar node-dock-header--draggable" onPointerDown={e => startDock('graph', e)} title={translate("Drag to dock the graph on any side")}><div className="node-dock-heading"><span className="node-dock-kicker">{translate("Nodes")}</span><strong>{translate("Planet Height Graph")}</strong></div><div className={`node-graph-summary${attention ? ' invalid' : ''}`}><span className="node-graph-summary__status"><span />{status.state === 'compiling' ? translate('Compiling') : attention ? translate('Needs attention') : translate('Live graph')}</span><span>{localGraph.nodes.length} {translate("nodes")}</span><span>{localGraph.edges.length} {translate("links")}</span></div><div className="node-toolbar-actions">
        <label className="node-template-picker" title={translate("Replace the graph with a height recipe")}><Sparkles size={13} /><select value="" aria-label={translate("Load a planet height recipe")} onChange={e => { if (!e.target.value) return; const next = createRecipe(e.target.value, params); const nextEditor = { ...editorRef.current, groups: [], nodeLabels: {}, nodePositions: Object.fromEntries(next.nodes.map((n, i) => [n.id, { x: i * 264, y: next.nodes.length === 4 && i === 1 ? 180 : 60 }])), viewport: { x: 0, y: 0, zoom: 1 } }; commit(next, nextEditor); clearSelection(); setFitRequest({ ids: next.nodes.map(n => n.id) }); }}><option value="">{translate("Recipes")}</option><option value="current">{translate("Current Terrain")}</option><option value="noise">{translate("Noise → Remap")}</option><option value="mix">{translate("Two Noise → Mix")}</option></select><ChevronDown size={11} /></label>
        <button type="button" className="node-toolbar-button" onClick={openSearch}><Plus size={14} /> {translate("Add")}</button><button type="button" className="node-toolbar-button" onClick={group} disabled={!selectedNodes.size} title={translate("Group selected nodes (G)")}><FolderPlus size={13} /> {translate("Group")}</button><button type="button" className="node-icon-button" onClick={ungroup} disabled={!selectedGroups.size} title={translate("Ungroup (Shift+G)")}><Ungroup size={13} /></button><button type="button" className="node-icon-button" onClick={() => instance?.fitView({ padding: .18, maxZoom: 1, duration: 280 })} title={translate("Fit graph (F)")}><Maximize2 size={14} /></button><button type="button" className="node-toolbar-button subtle" onClick={() => { const next = createRecipe('current', params); const output = next.nodes.find(n => n.id === next.outputId); commit({ ...next, nodes: [output], edges: [] }, { ...editorRef.current, nodeLabels: {}, groups: [], nodePositions: { [output.id]: { x: 360, y: 60 } } }); clearSelection(); }} title={translate("Clear graph; retain Height Output")}>{translate("Clear graph")}</button>
      </div></header>
      {!layout.paletteDetached && !layout.paletteCollapsed && palette}
      <div className="node-flow-frame"><ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={NODE_TYPES} onInit={flow => { setInstance(flow); if (!editorRef.current.viewport) setFitRequest({ ids: graphRef.current.nodes.map(n => n.id) }); }} defaultViewport={localEditor.viewport || { x: 0, y: 0, zoom: 1 }} minZoom={.18} maxZoom={2.2} snapToGrid snapGrid={[12, 12]} connectionRadius={36} selectionOnDrag panOnDrag={[1, 2]} connectOnClick connectionMode={ConnectionMode.Strict} elevateNodesOnSelect={false} deleteKeyCode={null} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} connectionLineStyle={{ stroke: 'var(--node-cyan)', strokeWidth: 2.4 }}
        isValidConnection={c => { try { connectGraph(graphRef.current, { source: c.source, sourcePort: c.sourceHandle || 'height', target: c.target, targetPort: c.targetHandle || 'height' }); return true; } catch { return false; } }}
        onConnect={c => { try { commit(connectGraph(graphRef.current, { source: c.source, sourcePort: c.sourceHandle || 'height', target: c.target, targetPort: c.targetHandle || 'height' })); setConnectionError(''); } catch (e) { setConnectionError(e.message); } }}
        onMoveEnd={(_, viewport) => { if (JSON.stringify(viewport) !== JSON.stringify(editorRef.current.viewport)) commit(graphRef.current, { ...editorRef.current, viewport }, 'view', false); }}
        onNodesChange={changes => {
          setFlowNodes(previous => applyNodeChanges(changes, previous));
          const positions = changes.filter(c => c.type === 'position' && c.position); if (positions.length) previewEditor(movePresentation(editorRef.current, graphRef.current, positions));
          const selections = changes.filter(c => c.type === 'select'); if (selections.length) { const groupIds = new Set((editorRef.current.groups || []).map(g => g.id)); const apply = (prev, groups) => { const next = new Set(prev); selections.filter(c => groupIds.has(c.id) === groups).forEach(c => c.selected ? next.add(c.id) : next.delete(c.id)); return next; }; setNodes(p => apply(p, false)); setGroups(p => apply(p, true)); }
        }}
        onNodeDragStop={() => commit(graphRef.current, editorRef.current, 'layout')}
        onEdgesChange={changes => { const removed = changes.filter(c => c.type === 'remove').map(c => c.id); if (removed.length) commit({ ...graphRef.current, edges: graphRef.current.edges.filter(e => !removed.includes(e.id)) }); const selections = changes.filter(c => c.type === 'select'); if (selections.length) setEdges(p => { const next = new Set(p); selections.forEach(c => c.selected ? next.add(c.id) : next.delete(c.id)); return next; }); }} colorMode="dark" proOptions={{ hideAttribution: true }}><FitRequested request={fitRequest} /><Background variant={BackgroundVariant.Dots} gap={22} size={1.15} color="rgba(160,178,198,.17)" /><Controls showInteractive={false} position="bottom-right" /></ReactFlow></div>
      {attention && <div className="node-draft-status" role="status"><CircleAlert size={12} /> {translate("Draft needs attention; the last valid planet remains visible.")}</div>}
      {search && <div className="node-search-popover" style={{ left: search.left, top: search.top }}><div className="node-search-input"><Search size={15} /><input ref={searchRef} value={searchQuery} placeholder={translate("Search height nodes…")} onChange={e => { setSearchQuery(e.target.value); setSearchIndex(0); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIndex(i => Math.min(searchResults.length - 1, i + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIndex(i => Math.max(0, i - 1)); } else if (e.key === 'Enter' && searchResults[searchIndex]) { e.preventDefault(); addAt(searchResults[searchIndex].id, search.position); } else if (e.key === 'Escape') { e.stopPropagation(); setSearch(null); rootRef.current?.focus(); } }} /><button type="button" title={translate("Close node search")} onClick={() => setSearch(null)}><X size={14} /></button></div><div className="node-search-results">{searchResults.map((d, i) => <button key={d.id} type="button" className={searchIndex === i ? 'active' : ''} onMouseEnter={() => setSearchIndex(i)} onClick={() => addAt(d.id, search.position)}><span className={`node-search-icon tone-${d.tone}`}><Icon definition={d} size={13} /></span><span><strong>{translate(d.label)}</strong><small>{translate(d.category)}</small></span><span>{translate(d.description)}</span></button>)}{!searchResults.length && <div className="node-palette-empty">{translate("No matching nodes")}</div>}</div></div>}
    </div>
    <div className="node-inspector-dock" style={inspectorStyle}><div className="node-inspector-resizer" onPointerDown={startInspectorResize} /><NodeInspector node={selectedNode} group={selectedGroup} editor={localEditor} diagnostics={diagnostics.filter(d => !d.nodeId || d.nodeId === selectedNode?.id)} onNodeLabel={label => commit(graphRef.current, { ...editorRef.current, nodeLabels: { ...editorRef.current.nodeLabels, [selectedNode.id]: label } }, 'layout')} onParam={param} onReset={() => commit({ ...graphRef.current, nodes: graphRef.current.nodes.map(n => n.id === selectedNode.id ? { ...n, params: structuredClone(GRAPH_REGISTRY[n.type]?.defaults || n.params) } : n) })} onDelete={() => { const next = removeSelection(graphRef.current, editorRef.current, [selectedNode.id]); commit(next.graph, next.editor); setNodes(new Set()); }} onGroupPatch={patch => patchGroup(selectedGroup.id, patch)} onUngroup={ungroup} onHeader={e => startDock('inspector', e)} onClose={onClose} onBegin={beginGesture} onEnd={endGesture} /></div>
  </section>;
}

