import { validateGraph } from '../engine/graph/index.js';

/** Draft and applied state are independent, including after reopening or undo. */
export function terrainDraftState(design) {
  const draft = design.editor?.draftGraph ?? design.terrain.graph;
  const validation = design.terrain.mode === 'nodes' ? validateGraph(draft) : { valid: true, diagnostics: [] };
  return {
    valid: validation.valid, diagnostics: validation.diagnostics,
    recoverable: design.terrain.mode === 'procedural' || validateGraph(design.terrain.graph).valid,
    candidate: design.terrain.mode === 'procedural' || !validation.valid ? design.terrain : { mode: 'nodes', graph: draft },
  };
}

/** GPU validation happens inside Planet; never expose a failed candidate as applied. */
export async function applyTerrainDraft(planet, design, { renderer, isCurrent = () => true } = {}) {
  if (!isCurrent()) return { ok: false, obsolete: true };
  const state = terrainDraftState(design);
  if (!state.recoverable && !state.valid) return { ok: false, noAppliedTerrain: true, diagnostics: state.diagnostics };
  if (state.recoverable && JSON.stringify(planet.terrain) !== JSON.stringify(design.terrain)) {
    const restored = await planet.setTerrain(design.terrain, { renderer });
    if (!isCurrent() || restored.obsolete) return { ...restored, obsolete: true };
    if (!restored.ok) return { ...restored, noAppliedTerrain: true };
  }
  if (!isCurrent()) return { ok: false, obsolete: true };
  const result = await planet.setTerrain(state.candidate, { renderer });
  return { ...result, draftValid: state.valid, terrain: state.candidate,
    diagnostics: result.ok ? state.diagnostics : result.diagnostics,
    noAppliedTerrain: !result.ok && !state.recoverable };
}

export function canEditGraph(graph) {
  return !!graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)
    && graph.nodes.every(n => n && typeof n === 'object' && typeof n.id === 'string' && typeof n.type === 'string' && (n.params === undefined || n.params && typeof n.params === 'object' && !Array.isArray(n.params)))
    && graph.edges.every(e => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.source === 'string' && typeof e.target === 'string');
}
