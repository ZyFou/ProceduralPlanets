import { GRAPH_FORMAT, GRAPH_VERSION, GRAPH_REGISTRY, GRAPH_BUDGETS, TERRAIN_KEYS } from './GraphRegistry.js';

export function cloneGraph(graph) { return structuredClone(graph); }
export function createNode(type, id, params = {}) {
  if (!Object.hasOwn(GRAPH_REGISTRY, type)) throw new Error(`Unknown height node type: ${type}`);
  return { id, type, params: { ...GRAPH_REGISTRY[type].defaults, ...structuredClone(params) } };
}
const edge = (source, target, targetPort = 'height') => ({ id: `${source}-${target}-${targetPort}`, source, sourcePort: 'height', target, targetPort });
export function createInitialGraph(params = {}) {
  return { format: GRAPH_FORMAT, version: GRAPH_VERSION, nodes: [createNode('currentTerrain', 'terrain', Object.fromEntries(TERRAIN_KEYS.filter(key => params[key] !== undefined).map(key => [key, params[key]]))), createNode('heightOutput', 'output')], edges: [edge('terrain', 'output')], outputId: 'output' };
}
export function createRecipe(name, params = {}) {
  if (name === 'current' || name === 'currentTerrain' || name === 'terrain') return createInitialGraph(params);
  if (name === 'noise' || name === 'noise-remap') return { format: GRAPH_FORMAT, version: GRAPH_VERSION, nodes: [createNode('noise3d', 'noise'), createNode('remap', 'remap', { outMin: 0.1, outMax: 0.9 }), createNode('heightOutput', 'output')], edges: [edge('noise', 'remap'), edge('remap', 'output')], outputId: 'output' };
  if (name === 'mix' || name === 'two-noises') return { format: GRAPH_FORMAT, version: GRAPH_VERSION, nodes: [createNode('noise3d', 'noiseA'), createNode('noise3d', 'noiseB', { frequency: 8, seedOffset: 17 }), createNode('mix', 'mix'), createNode('heightOutput', 'output')], edges: [edge('noiseA', 'mix', 'a'), edge('noiseB', 'mix', 'b'), edge('mix', 'output')], outputId: 'output' };
  throw new Error(`Unknown height graph recipe: ${name}`);
}

/** Validate without discarding unknown imported fields or modifying the draft. */
export function validateGraph(graph) {
  const diagnostics = [], order = [], activeNodes = [];
  const issue = (code, message, nodeId) => diagnostics.push({ code, message, ...(nodeId ? { nodeId } : {}) });
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) { issue('graph', 'Height graph must be an object.'); return { valid: false, diagnostics, order, activeNodes }; }
  if (graph.format !== GRAPH_FORMAT) issue('format', `Unsupported height graph format: ${graph.format}.`);
  if (graph.version !== GRAPH_VERSION) issue('version', `Unsupported height graph version: ${graph.version}.`);
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) { issue('schema', 'Height graph requires nodes and edges arrays.'); return { valid: false, diagnostics, order, activeNodes }; }
  if (graph.nodes.length > GRAPH_BUDGETS.nodes || graph.edges.length > GRAPH_BUDGETS.edges) { issue('budget', `Height graph exceeds the ${GRAPH_BUDGETS.nodes} node / ${GRAPH_BUDGETS.edges} connection budget.`); return { valid: false, diagnostics, order, activeNodes }; }
  const nodes = new Map(), incoming = new Map(), adjacency = new Map();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim() || node.id.length > 128) { issue('node-id', 'Each node needs a nonempty ID of at most 128 characters.'); continue; }
    if (nodes.has(node.id)) issue('duplicate-node', `Duplicate node ID: ${node.id}.`, node.id);
    nodes.set(node.id, node); adjacency.set(node.id, []);
    const def = Object.hasOwn(GRAPH_REGISTRY, node.type) ? GRAPH_REGISTRY[node.type] : null;
    if (!def) { issue('unknown-node', `Unsupported node type: ${node.type}.`, node.id); continue; }
    if (node.params !== undefined && (!node.params || typeof node.params !== 'object' || Array.isArray(node.params))) { issue('params', 'Node parameters must be an object.', node.id); continue; }
    for (const [key, value] of Object.entries(node.params || {})) {
      if (!Object.hasOwn(def.defaults, key)) issue('unknown-parameter', `Unsupported parameter ${key} on ${def.label}; its imported value has been preserved.`, node.id);
      if (typeof value === 'number' && !Number.isFinite(value)) issue('nonfinite-parameter', `Parameter ${key} must be finite.`, node.id);
    }
    for (const f of def.fields) {
      const value = node.params && Object.hasOwn(node.params, f.key) ? node.params[f.key] : def.defaults[f.key];
      if (f.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value) || value < f.min || value > f.max || (f.step === 1 && !Number.isInteger(value))) issue('parameter', `${f.label} is invalid; expected ${f.type === 'boolean' ? 'a boolean' : `a finite ${f.step === 1 ? 'integer' : 'number'} in [${f.min}, ${f.max}]`}.`, node.id);
    }
    const p = { ...def.defaults, ...node.params };
    if (node.type === 'remap' && p.inMin === p.inMax) issue('remap-range', 'Remap input interval cannot have zero width.', node.id);
  }
  const outputs = graph.nodes.filter(node => node?.type === 'heightOutput');
  if (outputs.length !== 1 || outputs[0]?.id !== graph.outputId) issue('output', 'Exactly one Height Output is required and outputId must identify it.');
  const edgeIds = new Set();
  for (const e of graph.edges) {
    if (!e || typeof e.id !== 'string' || !e.id || edgeIds.has(e.id)) { issue('edge-id', 'Connections require unique nonempty IDs.'); if (!e) continue; }
    edgeIds.add(e.id);
    const from = nodes.get(e.source), to = nodes.get(e.target);
    if (!from || !to) { issue('dangling-edge', 'Connection refers to a missing node.', e.target); continue; }
    const out = GRAPH_REGISTRY[from.type]?.outputs?.find(p => p.id === e.sourcePort), input = GRAPH_REGISTRY[to.type]?.inputs?.find(p => p.id === e.targetPort);
    if (!out || !input || out.type !== input.type) { issue('port', 'Connection refers to an unknown or incompatible port.', to.id); continue; }
    const key = `${to.id}\0${e.targetPort}`;
    if (incoming.has(key)) issue('multiple-inputs', `Input ${e.targetPort} has more than one connection.`, to.id);
    incoming.set(key, from.id); adjacency.get(from.id).push(to.id);
  }
  const visited = new Set(), visiting = new Set();
  const visit = id => {
    if (visiting.has(id)) { issue('cycle', 'Height graph contains a cycle.', id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) || []) visit(next);
    visiting.delete(id); visited.add(id);
  };
  [...nodes.keys()].sort().forEach(visit);
  const active = new Set();
  const collect = id => {
    if (active.has(id) || !nodes.has(id)) return;
    active.add(id);
    const node = nodes.get(id);
    for (const port of GRAPH_REGISTRY[node.type]?.inputs || []) {
      const source = incoming.get(`${id}\0${port.id}`);
      if (!source) issue('missing-input', `Connect the ${port.label} input.`, id);
      else collect(source);
    }
    order.push(id);
  };
  collect(graph.outputId);
  activeNodes.push(...order);
  let sourceCost = 0;
  for (const id of active) {
    const node = nodes.get(id), p = { ...GRAPH_REGISTRY[node.type]?.defaults, ...node.params };
    if (node.type === 'noise3d') sourceCost += p.octaves;
    if (node.type === 'currentTerrain') sourceCost += p.octaves * 2 + 7 + (p.craters > 0.001 ? 54 : 0);
  }
  if (sourceCost > GRAPH_BUDGETS.sourceCost) issue('budget', `Height graph cost ${sourceCost} exceeds the ${GRAPH_BUDGETS.sourceCost} shader work-unit budget.`);
  return { valid: diagnostics.length === 0, diagnostics, order, activeNodes };
}

/** Replace an occupied input in one immutable operation. Invalid edits throw. */
export function connectGraph(graph, connection) {
  const result = cloneGraph(graph);
  const e = { ...connection, id: connection.id || `${connection.source}-${connection.target}-${connection.targetPort}` };
  result.edges = result.edges.filter(existing => existing.target !== e.target || existing.targetPort !== e.targetPort);
  result.edges.push(e);
  const validation = validateGraph(result);
  const invalid = validation.diagnostics.filter(d => d.code !== 'missing-input' && d.code !== 'parameter' && d.code !== 'remap-range');
  if (invalid.length) { const error = new Error(invalid[0].message); error.diagnostics = invalid; throw error; }
  return result;
}
