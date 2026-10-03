// Presentation data stays separate from the portable terrain graph.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finitePoint = value => record(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const identifier = value => typeof value === 'string' && value.length > 0;

/** Mounting guard only: never normalizes, deletes or mutates imported editor data. */
export function canEditWorkspaceEditor(editor, graph) {
  if (!record(editor)) return false;
  if (editor.nodePositions !== undefined && (!record(editor.nodePositions) || !Object.values(editor.nodePositions).every(finitePoint))) return false;
  if (editor.nodeLabels !== undefined && (!record(editor.nodeLabels) || !Object.values(editor.nodeLabels).every(value => typeof value === 'string'))) return false;
  if (editor.viewport !== undefined && (!finitePoint(editor.viewport) || !Number.isFinite(editor.viewport.zoom) || editor.viewport.zoom <= 0)) return false;
  const safeGraphShape = candidate => record(candidate) && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges)
    && candidate.nodes.every(node => record(node) && identifier(node.id) && identifier(node.type) && (node.params === undefined || record(node.params)))
    && candidate.edges.every(edge => record(edge) && identifier(edge.id) && identifier(edge.source) && identifier(edge.target))
    && identifier(candidate.outputId);
  if (editor.draftGraph != null && !safeGraphShape(editor.draftGraph)) return false;
  if (graph !== undefined && !safeGraphShape(graph)) return false;
  if (editor.groups !== undefined) {
    if (!Array.isArray(editor.groups)) return false;
    const graphIds = new Set((graph?.nodes || []).map(node => node.id)), groupIds = new Set();
    for (const group of editor.groups) {
      if (!record(group) || !identifier(group.id) || graphIds.has(group.id) || groupIds.has(group.id)) return false;
      groupIds.add(group.id);
      if (typeof group.label !== 'string' || !finitePoint(group.position)) return false;
      if (!Number.isFinite(group.width) || !Number.isFinite(group.height) || group.width <= 0 || group.height <= 0) return false;
      if (!Array.isArray(group.nodeIds) || !group.nodeIds.every(identifier) || new Set(group.nodeIds).size !== group.nodeIds.length) return false;
      if (group.color !== undefined && typeof group.color !== 'string') return false;
      if (group.collapsed !== undefined && typeof group.collapsed !== 'boolean') return false;
    }
  }
  return true;
}

export const newEditorId = (prefix = 'node') => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
export const nodePosition = (editor, node, index = 0) => editor.nodePositions?.[node.id] || { x: index * 264, y: 60 };

export function removeSelection(graph, editor, nodeIds, edgeIds = [], groupIds = []) {
  const removed = new Set([...nodeIds].filter(id => id !== graph.outputId));
  const edges = new Set(edgeIds), groups = new Set(groupIds);
  const nodePositions = { ...editor.nodePositions }, nodeLabels = { ...editor.nodeLabels };
  removed.forEach(id => { delete nodePositions[id]; delete nodeLabels[id]; });
  return {
    graph: { ...graph, nodes: graph.nodes.filter(n => !removed.has(n.id)), edges: graph.edges.filter(e => !edges.has(e.id) && !removed.has(e.source) && !removed.has(e.target)) },
    editor: { ...editor, nodePositions, nodeLabels, groups: (editor.groups || []).filter(g => !groups.has(g.id)).map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !removed.has(id)) })).filter(g => g.nodeIds.length) },
  };
}

export function copySelection(graph, editor, selectedNodes, selectedGroups = []) {
  const groups = (editor.groups || []).filter(g => selectedGroups.includes(g.id));
  const ids = new Set([...selectedNodes, ...groups.flatMap(g => g.nodeIds)]);
  ids.delete(graph.outputId);
  return structuredClone({
    nodes: graph.nodes.filter(n => ids.has(n.id)),
    edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)),
    groups: groups.map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => ids.has(id)) })).filter(g => g.nodeIds.length),
    positions: Object.fromEntries(graph.nodes.filter(n => ids.has(n.id)).map(n => [n.id, nodePosition(editor, n, graph.nodes.indexOf(n))])),
    labels: Object.fromEntries([...ids].filter(id => editor.nodeLabels?.[id] !== undefined).map(id => [id, editor.nodeLabels[id]])),
  });
}

export function pasteSelection(graph, editor, clipboard, offset = { x: 36, y: 36 }) {
  if (!clipboard?.nodes?.length) return null;
  const ids = new Map(clipboard.nodes.map(n => [n.id, newEditorId()]));
  const nodePositions = { ...editor.nodePositions }, nodeLabels = { ...editor.nodeLabels };
  clipboard.nodes.forEach(n => {
    const p = clipboard.positions[n.id] || { x: 0, y: 0 };
    nodePositions[ids.get(n.id)] = { x: p.x + offset.x, y: p.y + offset.y };
    if (clipboard.labels[n.id]) nodeLabels[ids.get(n.id)] = `${clipboard.labels[n.id]} copy`;
  });
  return {
    graph: { ...graph, nodes: [...graph.nodes, ...clipboard.nodes.map(n => ({ ...n, id: ids.get(n.id), params: structuredClone(n.params) }))], edges: [...graph.edges, ...clipboard.edges.map(e => ({ ...e, id: newEditorId('edge'), source: ids.get(e.source), target: ids.get(e.target) }))] },
    editor: { ...editor, nodePositions, nodeLabels, groups: [...(editor.groups || []), ...clipboard.groups.map(g => ({ ...g, id: newEditorId('group'), position: { x: g.position.x + offset.x, y: g.position.y + offset.y }, nodeIds: g.nodeIds.map(id => ids.get(id)) }))] },
    nodeIds: [...ids.values()],
  };
}

export function groupSelection(graph, editor, ids) {
  const nodes = graph.nodes.filter(n => ids.has(n.id));
  if (!nodes.length) return null;
  const points = nodes.map(n => nodePosition(editor, n, graph.nodes.indexOf(n)));
  const x = Math.min(...points.map(p => p.x)) - 28, y = Math.min(...points.map(p => p.y)) - 48;
  const group = { id: newEditorId('group'), label: 'Planet section', color: '#788392', nodeIds: nodes.map(n => n.id), position: { x, y }, width: Math.max(...points.map(p => p.x)) + 216 - x, height: Math.max(...points.map(p => p.y)) + 118 - y, collapsed: false };
  const selected = new Set(group.nodeIds);
  return { ...editor, groups: [...(editor.groups || []).map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !selected.has(id)) })).filter(g => g.nodeIds.length), group] };
}

export function movePresentation(editor, graph, changes) {
  const nodePositions = { ...editor.nodePositions };
  let groups = [...(editor.groups || [])];
  const explicit = new Set(changes.map(c => c.id));
  changes.forEach(change => {
    const group = groups.find(g => g.id === change.id);
    if (group) {
      const dx = change.position.x - group.position.x, dy = change.position.y - group.position.y;
      group.nodeIds.forEach(id => {
        if (explicit.has(id)) return;
        const n = graph.nodes.find(n => n.id === id);
        if (!n) return;
        const p = nodePosition(editor, n, graph.nodes.indexOf(n));
        nodePositions[id] = { x: p.x + dx, y: p.y + dy };
      });
      groups = groups.map(g => g.id === group.id ? { ...g, position: change.position } : g);
    } else nodePositions[change.id] = change.position;
  });
  return { ...editor, nodePositions, groups };
}
