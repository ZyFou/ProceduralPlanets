import { describe, expect, it } from 'vitest';
import { createRecipe } from '../../engine/graph/GraphDocument.js';
import { canEditWorkspaceEditor, copySelection, groupSelection, movePresentation, pasteSelection, removeSelection } from './workspaceDocument.js';

describe('height workspace presentation editing', () => {
  it('rejects malformed presentation data without discarding imported content', () => {
    const graph = createRecipe('noise');
    const valid = groupSelection(graph, { nodePositions: { noise: { x: 0, y: 0 } }, viewport: { x: 0, y: 0, zoom: 1 }, unknownImportedField: { recovery: 'keep me' } }, new Set(['noise']));
    expect(canEditWorkspaceEditor(valid, graph)).toBe(true);
    const variants = [null, [], { groups: {} }, { groups: [null] }, { nodePositions: { noise: null } }, { nodePositions: { noise: { x: Infinity, y: 0 } } }, { nodeLabels: { noise: {} } }, { viewport: { x: 0, y: 0, zoom: NaN } }, { groups: [{ ...valid.groups[0], nodeIds: null }] }, { groups: [{ ...valid.groups[0], position: { x: 0, y: 'bad' } }] }, { groups: [{ ...valid.groups[0], width: -10 }] }, { groups: [{ ...valid.groups[0], id: 'noise' }] }, { draftGraph: { nodes: [null], edges: [], outputId: 'output' } }];
    for (const invalid of variants) {
      const snapshot = structuredClone(invalid);
      expect(canEditWorkspaceEditor(invalid, graph)).toBe(false);
      expect(invalid).toEqual(snapshot);
    }
    expect(valid.unknownImportedField).toEqual({ recovery: 'keep me' });
    expect(canEditWorkspaceEditor({}, graph)).toBe(true);
    expect(canEditWorkspaceEditor({}, { ...graph, nodes: [null] })).toBe(false);
  });
  it('copies branches with independent IDs and internal connections, protecting output', () => {
    const graph = createRecipe('noise');
    const editor = { nodePositions: { noise: { x: 0, y: 0 }, remap: { x: 264, y: 0 }, output: { x: 528, y: 0 } }, nodeLabels: { remap: 'Gentle hills' }, groups: [] };
    const copied = copySelection(graph, editor, graph.nodes.map(n => n.id));
    const result = pasteSelection(graph, editor, copied);
    expect(result.nodeIds).toHaveLength(2);
    expect(result.graph.nodes.filter(n => n.type === 'heightOutput')).toHaveLength(1);
    const ids = new Set(result.nodeIds);
    const link = result.graph.edges.at(-1);
    expect(ids.has(link.source) && ids.has(link.target)).toBe(true);
    expect(link.targetPort).toBe('height');
    expect(result.editor.nodeLabels[link.target]).toBe('Gentle hills copy');
    expect(result.editor.nodePositions[link.target]).toEqual({ x: 300, y: 36 });
    result.graph.nodes.at(-1).params.outMax = 7;
    expect(graph.nodes[1].params.outMax).toBe(.9);
  });

  it('deletes incident links and stale presentation while preserving the unique output', () => {
    const graph = createRecipe('noise');
    const editor = { nodeLabels: { noise: 'Noise' }, nodePositions: { noise: { x: 0, y: 0 } }, groups: [{ id: 'g', nodeIds: ['noise', 'remap'] }] };
    const next = removeSelection(graph, editor, ['noise', 'output']);
    expect(next.graph.nodes.map(n => n.id)).toEqual(['remap', 'output']);
    expect(next.graph.edges.map(e => e.source)).toEqual(['remap']);
    expect(next.editor.groups[0].nodeIds).toEqual(['remap']);
    expect(next.editor.nodeLabels).toEqual({});
    expect(graph.nodes).toHaveLength(3);
  });

  it('moves collapsed groups and their children without touching the terrain graph', () => {
    const graph = createRecipe('noise');
    const before = JSON.stringify(graph);
    const editor = groupSelection(graph, { nodePositions: { noise: { x: 0, y: 0 }, remap: { x: 264, y: 0 } } }, new Set(['noise', 'remap']));
    const g = editor.groups[0]; g.collapsed = true;
    const moved = movePresentation(editor, graph, [{ id: g.id, position: { x: g.position.x + 120, y: g.position.y + 48 } }]);
    expect(moved.nodePositions.noise).toEqual({ x: 120, y: 48 });
    expect(moved.nodePositions.remap).toEqual({ x: 384, y: 48 });
    expect(JSON.stringify(graph)).toBe(before);
    expect(editor.nodePositions.noise).toEqual({ x: 0, y: 0 });
  });
});
