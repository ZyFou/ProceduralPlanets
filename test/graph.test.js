import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { compileGraph, connectGraph, createInitialGraph, createNode, createRecipe, validateGraph } from '../src/engine/graph/index.js';
import { DEFAULT_PARAMS, seedToOffset } from '../src/engine/presets.js';
import { PlanetHeightSampler } from '../src/engine/PlanetHeightSampler.js';

const directions = [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], new Vector3(0.32, -0.47, 0.81).normalize().toArray()];
const constantGraph = value => { const g = createInitialGraph(); g.nodes[0] = createNode('constant', 'terrain', { value }); return g; };
const edge = (source, target, targetPort = 'height') => ({ id: `${source}-${target}-${targetPort}`, source, sourcePort: 'height', target, targetPort });
const diagnosticCodes = graph => validateGraph(graph).diagnostics.map(d => d.code);

describe('height graph document validation', () => {
  it('validates all three recipes and does not change imported unknown fields', () => {
    for (const name of ['current', 'noise', 'mix']) expect(validateGraph(createRecipe(name)).valid).toBe(true);
    const graph = createInitialGraph(); graph.future = { saveMe: true };
    const copy = structuredClone(graph); expect(validateGraph(graph).valid).toBe(true); expect(graph).toEqual(copy); expect(compileGraph(graph).graph).toEqual(copy);
  });
  it('preserves unsupported parameters for recovery with precise diagnostics', () => {
    const graph = createInitialGraph(); graph.nodes[0].params.future = 42;
    const copy = structuredClone(graph); expect(diagnosticCodes(graph)).toContain('unknown-parameter'); expect(graph).toEqual(copy);
    graph.nodes[0].params.future = Infinity; expect(diagnosticCodes(graph)).toContain('nonfinite-parameter'); expect(() => compileGraph(graph)).toThrow(/Unsupported parameter future/);
    const dangerous = JSON.parse('{"__proto__": {"polluted": true}}'); graph.nodes[0].params = dangerous;
    expect(diagnosticCodes(graph)).toContain('unknown-parameter'); expect({}.polluted).toBeUndefined();
  });
  it('reports malformed parameter containers without crashing', () => {
    for (const params of [null, [], 2, 'bad', false]) { const graph = createInitialGraph(); graph.nodes[0].params = params; expect(diagnosticCodes(graph)).toContain('params'); expect(() => compileGraph(graph)).toThrow(); }
  });
  it('reports unsupported versions, nodes, duplicate IDs, missing ports and dangling edges', () => {
    const version = createInitialGraph(); version.version = 20; expect(diagnosticCodes(version)).toContain('version');
    const node = createInitialGraph(); node.nodes[0].type = 'futureNoise'; expect(diagnosticCodes(node)).toContain('unknown-node');
    const prototype = createInitialGraph(); prototype.nodes[0].type = 'toString'; expect(diagnosticCodes(prototype)).toContain('unknown-node'); expect(() => createNode('__proto__', 'unsafe')).toThrow(/Unknown/);
    const duplicate = createInitialGraph(); duplicate.nodes.push(structuredClone(duplicate.nodes[0])); expect(diagnosticCodes(duplicate)).toContain('duplicate-node');
    const port = createInitialGraph(); port.edges[0].sourcePort = 'mask'; expect(diagnosticCodes(port)).toContain('port');
    const dangling = createInitialGraph(); dangling.edges[0].source = 'missing'; expect(diagnosticCodes(dangling)).toContain('dangling-edge');
  });
  it('requires exactly one output and one connection per input', () => {
    const graph = createInitialGraph(); graph.nodes.push(createNode('heightOutput', 'other')); expect(diagnosticCodes(graph)).toContain('output');
    const double = createInitialGraph(); double.nodes.push(createNode('constant', 'constant')); double.edges.push(edge('constant', 'output')); expect(diagnosticCodes(double)).toContain('multiple-inputs');
  });
  it('allows incomplete disconnected nodes but rejects an incomplete active branch', () => {
    const graph = createInitialGraph(); graph.nodes.push(createNode('mix', 'loose')); expect(validateGraph(graph).valid).toBe(true);
    graph.edges = [edge('loose', 'output')]; expect(diagnosticCodes(graph)).toContain('missing-input');
  });
  it('rejects cycles in disconnected branches too and replaces an occupied input atomically', () => {
    const graph = createInitialGraph(); graph.nodes.push(createNode('constant', 'new'));
    const updated = connectGraph(graph, edge('new', 'output'));
    expect(graph.edges[0].source).toBe('terrain'); expect(updated.edges).toHaveLength(1); expect(updated.edges[0].source).toBe('new');
    updated.nodes.push(createNode('remap', 'one'), createNode('remap', 'two')); updated.edges.push(edge('one', 'two'));
    expect(() => connectGraph(updated, edge('two', 'one'))).toThrow(/cycle/);
  });
  it('diagnoses zero-width remaps, nonfinite values, fractional octaves and resource budgets', () => {
    const zero = createRecipe('noise'); zero.nodes[1].params.inMin = zero.nodes[1].params.inMax; expect(diagnosticCodes(zero)).toContain('remap-range');
    const nan = createRecipe('noise'); nan.nodes[0].params.frequency = NaN; expect(diagnosticCodes(nan)).toContain('parameter'); expect(() => compileGraph(nan)).toThrow();
    const nullParam = createRecipe('noise'); nullParam.nodes[0].params.frequency = null; expect(diagnosticCodes(nullParam)).toContain('parameter');
    const fraction = createRecipe('noise'); fraction.nodes[0].params.octaves = 3.5; expect(diagnosticCodes(fraction)).toContain('parameter');
    const big = createInitialGraph(); for (let i = 0; i < 64; i++) big.nodes.push(createNode('constant', `c${i}`)); expect(diagnosticCodes(big)).toContain('budget');
  });
});

describe('height graph evaluation and GLSL compilation', () => {
  it('preserves the existing terrain exactly on first activation, including craters', () => {
    for (const craters of [0, 0.8]) {
      const params = { ...DEFAULT_PARAMS, seed: 9182, craters }, program = compileGraph(createInitialGraph(params), params);
      const sampler = new PlanetHeightSampler(params, { uSeedOffset: { value: new Vector3(...seedToOffset(params.seed)) } });
      expect(program.identityParams).toEqual(params);
      for (const direction of directions) {
        const result = program.evaluate(direction); expect(result.height).toBe(sampler.height01(...direction));
        expect(result.gradient.every(Number.isFinite)).toBe(true); expect(result.cLow).toBeGreaterThan(-1); expect(result.mtn).toBeGreaterThanOrEqual(0); expect(result.mtn).toBeLessThanOrEqual(1);
      }
    }
  });
  it('preserves the complete classic slider range including Ridge 1.5', () => {
    const params = { ...DEFAULT_PARAMS, noiseScale: 8, octaves: 8, persistence: 0.7, lacunarity: 3, warp: 2, ridge: 1.5, mountainScale: 6, craters: 1, craterScale: 16, continents: 1, seed: 52 };
    const graph = createInitialGraph(params), program = compileGraph(graph, params), sampler = new PlanetHeightSampler(params, { uSeedOffset: { value: new Vector3(...seedToOffset(params.seed)) } });
    expect(validateGraph(graph).valid).toBe(true); expect(program.identityParams).toEqual(params);
    for (const direction of directions) expect(program.evaluate(direction).height).toBe(sampler.height01(...direction));
  });
  it('returns finite values at every admitted noise parameter extreme', () => {
    const graph = createRecipe('noise'); graph.nodes[0].params = { frequency: 20, octaves: 12, lacunarity: 4, persistence: 1, seedOffset: 65536 };
    const program = compileGraph(graph, { seed: 0xffffffff });
    for (const dir of directions) { const sample = program.evaluate(dir); expect([sample.height, sample.cLow, sample.mtn, ...sample.gradient].every(Number.isFinite)).toBe(true); expect(sample.height).toBeGreaterThanOrEqual(0); expect(sample.height).toBeLessThanOrEqual(1); }
  });
  it('normalizes direction independently of face, chunk, LOD or JSON order', () => {
    const graph = createRecipe('mix'), reordered = structuredClone(graph); reordered.nodes.reverse(); reordered.edges.reverse();
    const a = compileGraph(graph, { seed: 32 }), b = compileGraph(reordered, { seed: 32 });
    expect(a.signature).toBe(b.signature); expect(a.structureSignature).toBe(b.structureSignature); expect(a.glsl).toBe(b.glsl);
    for (const dir of directions) { expect(a.evaluate(dir)).toEqual(b.evaluate(dir)); expect(a.evaluate(dir.map(v => v * 10)).height).toBeCloseTo(a.evaluate(dir).height, 10); }
    expect(() => a.evaluate([0, 0, 0])).toThrow(/direction/); expect(() => a.evaluate([Infinity, 0, 1])).toThrow(/direction/);
  });
  it('produces continuous values across all cube seams and at the poles', () => {
    const p = compileGraph(createRecipe('mix'), { seed: 42 });
    for (const dir of [[1, 1, 0.2], [1, -1, 0.2], [1, 0.3, 1], [-1, 0.3, 1], [0.3, 1, 1], [0, 1, 0], [0, -1, 0]]) {
      const base = p.evaluate(dir).height;
      expect(p.evaluate(dir.map((v, i) => v + (i === 0 ? 1e-7 : 0))).height).toBeCloseTo(base, 5);
    }
  });
  it('matches analytic gradients to tangent finite differences through Noise, Mix, Remap and Current Terrain', () => {
    const graph = createRecipe('mix'); graph.nodes.push(createNode('remap', 'remap', { inMin: -1, inMax: 2, outMin: 0, outMax: 1, clamp: false })); graph.edges = graph.edges.filter(e => e.target !== 'output'); graph.edges.push(edge('mix', 'remap'), edge('remap', 'output'));
    for (const g of [graph, createInitialGraph({ octaves: 4, craters: 0.5 })]) {
      const p = compileGraph(g, { seed: 14 }), dir = directions[4], normal = new Vector3(...dir), tangent = new Vector3(0.7, 0.2, -0.3).addScaledVector(normal, -normal.dot(new Vector3(0.7, 0.2, -0.3))).normalize();
      const eps = 1e-5, gradient = p.evaluate(dir).gradient;
      const plus = normal.clone().addScaledVector(tangent, eps), minus = normal.clone().addScaledVector(tangent, -eps);
      const finite = (p.evaluate(plus).height - p.evaluate(minus).height) / (2 * eps), analytic = new Vector3(...gradient).dot(tangent);
      expect(Math.abs(finite - analytic)).toBeLessThan(0.01);
    }
  });
  it('clamps output and clears gradients, with remap identity preserving surface auxiliaries', () => {
    for (const value of [-2, 2]) expect(compileGraph(constantGraph(value)).evaluate([1, 0, 0])).toMatchObject({ height: value < 0 ? 0 : 1, gradient: [0, 0, 0] });
    const original = createInitialGraph(), remapped = structuredClone(original); remapped.nodes.push(createNode('remap', 'remap')); remapped.edges = [edge('terrain', 'remap'), edge('remap', 'output')];
    const a = compileGraph(original), b = compileGraph(remapped);
    for (const dir of directions) expect(b.evaluate(dir)).toEqual(a.evaluate(dir));
    const clamped = createRecipe('noise'); clamped.nodes[1].params = { inMin: -2, inMax: -1, outMin: 0.2, outMax: 0.8, clamp: true };
    expect(compileGraph(clamped).evaluate(directions[4])).toMatchObject({ height: 0.8, gradient: [0, 0, 0] });
  });
  it('propagates Current Terrain auxiliaries independently through Mix endpoints', () => {
    const graph = createRecipe('mix'); graph.nodes[0] = createNode('currentTerrain', 'noiseA'); graph.nodes[1] = createNode('currentTerrain', 'noiseB', { noiseScale: 4.5, octaves: 3, ridge: 0.9 });
    for (const factor of [0, 1]) {
      graph.nodes[2].params.factor = factor;
      const single = createInitialGraph(graph.nodes[factor].params), a = compileGraph(single, { seed: 121 }), b = compileGraph(graph, { seed: 121 });
      for (const dir of directions) expect(b.evaluate(dir)).toEqual(a.evaluate(dir));
      expect(b.glsl).toContain('pp_g1_heightField'); expect(b.glsl).toContain('pp_g2_heightField');
      const currentUniforms = Object.keys(b.uniforms).filter(key => key.endsWith('_noiseScale')); expect(currentUniforms).toHaveLength(2);
    }
  });
  it('uses uniforms for scalar edits and source offsets, distinguishing structural octave edits', () => {
    const graph = createRecipe('noise'), original = compileGraph(graph, { seed: 1 });
    graph.nodes[0].params.frequency = 7; const changed = compileGraph(graph, { seed: 1 });
    expect(changed.structureSignature).toBe(original.structureSignature); expect(changed.glsl).toBe(original.glsl); expect(changed.signature).not.toBe(original.signature);
    const seed = compileGraph(graph, { seed: 2 }); expect(seed.structureSignature).toBe(changed.structureSignature); expect(seed.glsl).toBe(changed.glsl); expect(seed.evaluate(directions[4]).height).not.toBe(changed.evaluate(directions[4]).height);
    graph.nodes[0].params.octaves = 3; expect(compileGraph(graph).structureSignature).not.toBe(original.structureSignature);
    graph.nodes.push(createNode('constant', 'loose')); expect(compileGraph(graph).glsl).not.toContain('loose');
  });
  it('owns input snapshots and isolates independent programs', () => {
    const graph = constantGraph(0.2), a = compileGraph(graph), b = compileGraph(constantGraph(0.7));
    graph.nodes[0].params.value = 0.9; expect(a.evaluate([1, 0, 0]).height).toBe(0.2); expect(b.evaluate([1, 0, 0]).height).toBe(0.7);
    expect(a.glsl).toContain('terrainHeight'); expect(a.glsl).toContain('heightOnly'); expect(a.glsl).toContain('ppClassicHeightField');
  });
});
