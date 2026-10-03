import { Vector3 } from 'three';
import { NOISE_FUNCTIONS_GLSL } from '../noiseGLSL.js';
import { PlanetHeightSampler } from '../PlanetHeightSampler.js';
import { DEFAULT_PARAMS, seedToOffset } from '../presets.js';
import { GRAPH_REGISTRY, GRAPH_BUDGETS, TERRAIN_KEYS } from './GraphRegistry.js';
import { cloneGraph, validateGraph } from './GraphDocument.js';
import { add, scale, mix, clampD, dual, directionDual, fbmD, classicD } from './GraphMath.js';

const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const terrainUniforms = Object.fromEntries(TERRAIN_KEYS.filter(key => key !== 'octaves').map(key => [key, `u${key[0].toUpperCase()}${key.slice(1)}`]));
const helpers = [...new Set([...NOISE_FUNCTIONS_GLSL.matchAll(/(?:float|vec[234]|mat[234]|HeightLow)\s+(\w+)\s*\(/g)].map(m => m[1]))];
const privateNames = [...helpers, 'OCT_ROT', 'CONT_GAIN', 'RIDGE_BIAS', 'RIDGE_GAIN', 'CONT_LOW', 'HeightLow'];
const identifierRegex = names => new RegExp(`\\b(${names.join('|')})\\b`, 'g');

/** The compiler owns immutable snapshots; UI metadata never enters signatures. */
export function compileGraph(input, projectParams = {}) {
  const validation = validateGraph(input);
  if (!validation.valid) { const error = new Error(validation.diagnostics.map(d => d.message).join(' ')); error.diagnostics = validation.diagnostics; throw error; }
  const graph = cloneGraph(input), params = { ...DEFAULT_PARAMS, ...projectParams };
  if (!Number.isFinite(params.seed) || !Number.isInteger(params.seed)) throw new Error('Height graph requires a finite integer project seed.');
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const order = validation.order, active = new Set(order);
  const incoming = new Map(graph.edges.filter(e => active.has(e.target)).map(e => [`${e.target}\0${e.targetPort}`, e.source]));
  const canonicalNodes = order.map(id => nodes.get(id)).sort((a, b) => a.id.localeCompare(b.id));
  const canonicalEdges = graph.edges.filter(e => active.has(e.target)).map(({ source, sourcePort, target, targetPort }) => ({ source, sourcePort, target, targetPort })).sort((a, b) => stable(a).localeCompare(stable(b)));
  const nodeParams = new Map(canonicalNodes.map(node => [node.id, Object.fromEntries(Object.entries(GRAPH_REGISTRY[node.type].defaults).map(([key, value]) => [key, node.params?.[key] ?? value]))]));
  const outputSource = nodes.get(incoming.get(`${graph.outputId}\0height`));
  const identityParams = outputSource.type === 'currentTerrain' ? { ...params, ...nodeParams.get(outputSource.id), seed: params.seed } : undefined;
  const signature = stable({ seed: params.seed, nodes: canonicalNodes.map(node => ({ id: node.id, type: node.type, params: nodeParams.get(node.id) })), edges: canonicalEdges, outputId: graph.outputId });
  const structureSignature = stable({ identity: !!identityParams, nodes: canonicalNodes.map(node => ({ id: node.id, type: node.type, ...(['noise3d', 'currentTerrain'].includes(node.type) ? { octaves: nodeParams.get(node.id).octaves } : {}) })), edges: canonicalEdges, outputId: graph.outputId });
  const uniforms = {}, declarations = [], functions = [], calls = [], runtime = new Map();
  const symbols = new Map(canonicalNodes.map((node, i) => [node.id, `pp_g${i}`]));
  const uniform = (name, value, type = 'float') => { uniforms[name] = { value }; declarations.push(`uniform ${type} ${name};`); return name; };
  const seedOf = p => seedToOffset((params.seed + (p.seedOffset || 0)) >>> 0);

  for (const node of canonicalNodes) {
    const p = nodeParams.get(node.id), sym = symbols.get(node.id);
    if (node.type === 'currentTerrain') {
      const sourceSeed = seedOf(p), sourceParams = { ...params, ...p, seed: params.seed };
      const sampler = new PlanetHeightSampler(sourceParams, { uSeedOffset: { value: new Vector3(...sourceSeed) } });
      runtime.set(node.id, dir => { const value = classicD(dir, sourceParams, sourceSeed); value.field.v = sampler.height01(...dir); return value; });
      const replacements = new Map(privateNames.map(name => [name, `${sym}_${name}`]));
      replacements.set('OCTAVES', String(p.octaves));
      replacements.set('uSeedOffset', uniform(`${sym}_seed`, new Vector3(...sourceSeed), 'vec3'));
      for (const [key, name] of Object.entries(terrainUniforms)) replacements.set(name, uniform(`${sym}_${key}`, p[key]));
      // Every source owns its functions, constants, struct types and uniforms.
      const source = NOISE_FUNCTIONS_GLSL.replace(identifierRegex([...replacements.keys()]), name => replacements.get(name));
      functions.push(source);
    } else if (node.type === 'noise3d') {
      const seed = seedOf(p);
      const freq = uniform(`${sym}_frequency`, p.frequency), lac = uniform(`${sym}_lacunarity`, p.lacunarity), persistence = uniform(`${sym}_persistence`, p.persistence);
      const seedUniform = uniform(`${sym}_seed`, new Vector3(...seed), 'vec3');
      functions.push(`vec4 ${sym}_noise(vec3 dir, out float low) {
        vec3 q = dir * ${freq} + ${seedUniform}; mat3 J = mat3(${freq});
        float sum = 0.0, amp = 0.5, norm = 0.0; vec3 grad = vec3(0.0); low = 0.0;
        for (int i = 0; i < DYN(${p.octaves}); i++) {
          vec4 n = gnoised(q); sum += amp * n.x; grad += amp * (transpose(J) * n.yzw); norm += amp;
          if (i == 1) low = sum / norm;
          amp *= ${persistence}; q = OCT_ROT * q * ${lac}; J = OCT_ROT * J * ${lac};
        }
        low = 0.465 + low; return vec4(0.5 + 0.5 * sum / max(norm, 1e-5), 0.5 * grad / max(norm, 1e-5));
      }`);
      runtime.set(node.id, dir => { const q = directionDual(dir).map((v, i) => add(scale(v, p.frequency), seed[i])); const fbm = fbmD(q, p); return { field: add(0.5, scale(fbm.field, 0.5)), cLow: 0.465 + fbm.low, mtn: 0 }; });
    } else if (node.type === 'constant') uniform(`${sym}_value`, p.value);
    else if (node.type === 'mix') uniform(`${sym}_factor`, p.factor);
    else if (node.type === 'remap') { for (const key of ['inMin', 'inMax', 'outMin', 'outMax']) uniform(`${sym}_${key}`, p[key]); uniform(`${sym}_clamp`, p.clamp ? 1 : 0); }
  }
  for (const id of order) {
    const node = nodes.get(id), sym = symbols.get(id), from = port => symbols.get(incoming.get(`${id}\0${port}`));
    calls.push(`vec3 ${sym}_g = vec3(0.0); float ${sym}_h = 0.0, ${sym}_cl = 0.0, ${sym}_mt = 0.0;`);
    if (node.type === 'currentTerrain') calls.push(`${sym}_h = ${sym}_heightField(dir, ${sym}_g, ${sym}_cl, ${sym}_mt);`);
    else if (node.type === 'noise3d') calls.push(`vec4 ${sym}_n = ${sym}_noise(dir, ${sym}_cl); ${sym}_h = ${sym}_n.x; ${sym}_g = ${sym}_n.yzw;`);
    else if (node.type === 'constant') calls.push(`${sym}_h = ${sym}_value; ${sym}_cl = ${sym}_value;`);
    else if (node.type === 'mix') {
      const a = from('a'), b = from('b');
      for (const property of ['h', 'g', 'cl', 'mt']) calls.push(`${sym}_${property} = mix(${a}_${property}, ${b}_${property}, ${sym}_factor);`);
    } else if (node.type === 'remap') {
      const a = from('height');
      calls.push(`float ${sym}_t = (${a}_h - ${sym}_inMin) / (${sym}_inMax - ${sym}_inMin);
        ${sym}_g = ${a}_g * ((${sym}_outMax - ${sym}_outMin) / (${sym}_inMax - ${sym}_inMin));
        if (${sym}_clamp > 0.5) { if (${sym}_t <= 0.0 || ${sym}_t >= 1.0) ${sym}_g = vec3(0.0); ${sym}_t = clamp(${sym}_t, 0.0, 1.0); }
        ${sym}_h = mix(${sym}_outMin, ${sym}_outMax, ${sym}_t); ${sym}_cl = ${a}_cl; ${sym}_mt = ${a}_mt;`);
    } else if (node.type === 'heightOutput') {
      const a = from('height');
      calls.push(`grad = (${a}_h <= 0.0 || ${a}_h >= 1.0) ? vec3(0.0) : ${a}_g; cLow = ${a}_cl; mtn = ${a}_mt; return clamp(${a}_h, 0.0, 1.0);`);
    }
  }
  // Original helpers remain available to ocean, climate, gas and star code.
  // height01/terrainHeight are routed to the graph while optimized classic
  // helpers are retained for the material's identity path.
  const original = NOISE_FUNCTIONS_GLSL.replace(/\bheightField\b/g, 'ppClassicHeightField').replace('return ppClassicHeightField(dir, g, cl, mt);', 'return heightField(dir, g, cl, mt);');
  const glsl = `${declarations.join('\n')}\nfloat heightField(vec3 dir, out vec3 grad, out float cLow, out float mtn);\n${original}\n${functions.join('\n')}\nfloat heightField(vec3 dir, out vec3 grad, out float cLow, out float mtn) {\n${calls.join('\n')}\n}\nfloat heightOnly(vec3 dir) { vec3 g; float cl, mt; return heightField(dir, g, cl, mt); }`;
  if (glsl.length > GRAPH_BUDGETS.shaderBytes) throw new Error(`Height graph exceeds the ${GRAPH_BUDGETS.shaderBytes} byte shader budget.`);

  function evaluate(direction) {
    const raw = Array.isArray(direction) || ArrayBuffer.isView(direction) ? Array.from(direction).slice(0, 3) : [direction?.x, direction?.y, direction?.z];
    const length = Math.hypot(...raw);
    if (raw.length !== 3 || !raw.every(Number.isFinite) || !Number.isFinite(length) || length === 0) throw new Error('Height graph direction must be a finite nonzero vector.');
    const dir = raw.map(v => v / length), values = new Map();
    for (const id of order) {
      const node = nodes.get(id), p = nodeParams.get(id), get = port => values.get(incoming.get(`${id}\0${port}`));
      let result;
      if (runtime.has(id)) result = runtime.get(id)(dir);
      else if (node.type === 'constant') result = { field: dual(p.value), cLow: p.value, mtn: 0 };
      else if (node.type === 'mix') {
        const a = get('a'), b = get('b');
        result = { field: mix(a.field, b.field, p.factor), cLow: a.cLow * (1 - p.factor) + b.cLow * p.factor, mtn: a.mtn * (1 - p.factor) + b.mtn * p.factor };
      } else if (node.type === 'remap') {
        const a = get('height'), t = scale(add(a.field, -p.inMin), 1 / (p.inMax - p.inMin));
        result = { ...a, field: add(p.outMin, scale(p.clamp ? clampD(t) : t, p.outMax - p.outMin)) };
      } else if (node.type === 'heightOutput') { const a = get('height'); result = { ...a, field: clampD(a.field) }; }
      values.set(id, result);
    }
    const result = values.get(graph.outputId);
    return { height: result.field.v, gradient: [...result.field.g], cLow: result.cLow, mtn: result.mtn };
  }
  return { graph, signature, structureSignature, uniforms, glsl, evaluate, ...(identityParams ? { identityParams } : {}) };
}
