import type { Vector3 } from 'three';
import type { PlanetParams } from './params';

export type HeightNodeType = 'currentTerrain' | 'noise3d' | 'constant' | 'mix' | 'remap' | 'heightOutput';
export interface HeightNode { id: string; type: HeightNodeType; params: Record<string, number | boolean>; [key: string]: unknown }
export interface HeightEdge { id: string; source: string; sourcePort: string; target: string; targetPort: string; [key: string]: unknown }
export interface HeightGraph {
  format: 'procedural-planets-height-graph';
  version: 1;
  nodes: HeightNode[];
  edges: HeightEdge[];
  outputId: string;
  [key: string]: unknown;
}
/** The applied graph is retained when mode is procedural. */
export interface TerrainConfiguration { mode: 'procedural' | 'nodes'; graph: HeightGraph | null }
export interface GraphDiagnostic { code: string; message: string; nodeId?: string }
export interface GraphValidation { valid: boolean; diagnostics: GraphDiagnostic[]; order: string[]; activeNodes: string[] }
export interface TerrainResult { ok: boolean; revision: number; compiled?: boolean; obsolete?: boolean; error?: string; diagnostics?: GraphDiagnostic[] }
export interface HeightSample { height: number; gradient: [number, number, number]; cLow: number; mtn: number }
export interface HeightProgram {
  graph: HeightGraph;
  glsl: string;
  uniforms: Record<string, { value: unknown }>;
  signature: string;
  structureSignature: string;
  identityParams?: PlanetParams;
  evaluate(direction: Vector3 | [number, number, number]): HeightSample;
}
export interface GraphPort { id: string; label: string; type: 'height' }
export interface GraphField { key: string; label: string; type: 'number' | 'boolean'; min?: number; max?: number; step?: number; structural?: boolean }
export interface GraphNodeDefinition { label: string; category: string; color: string; protected?: boolean; inputs: GraphPort[]; outputs: GraphPort[]; fields: GraphField[]; defaults: Record<string, number | boolean> }
export const GRAPH_FORMAT: 'procedural-planets-height-graph';
export const GRAPH_VERSION: 1;
export const GRAPH_BUDGETS: Readonly<{ nodes: number; edges: number; sourceCost: number; shaderBytes: number }>;
export const GRAPH_REGISTRY: Record<HeightNodeType, GraphNodeDefinition>;
export const TERRAIN_KEYS: string[];
export function createNode(type: HeightNodeType, id: string, params?: Record<string, number | boolean>): HeightNode;
export function cloneGraph(graph: HeightGraph): HeightGraph;
export function createInitialGraph(params?: PlanetParams): HeightGraph;
export function createRecipe(name: 'current' | 'currentTerrain' | 'terrain' | 'noise' | 'noise-remap' | 'mix' | 'two-noises', params?: PlanetParams): HeightGraph;
export function validateGraph(graph: unknown): GraphValidation;
export function connectGraph(graph: HeightGraph, connection: Omit<HeightEdge, 'id'> & { id?: string }): HeightGraph;
/** Throws an Error with diagnostics when a graph is invalid or exceeds shader budgets. */
export function compileGraph(graph: HeightGraph, projectParams?: PlanetParams): HeightProgram;
