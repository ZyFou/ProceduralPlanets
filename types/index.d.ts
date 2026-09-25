// Type declarations for procedural-planets.
// Parameter keys live in ./params.d.ts (generated from the engine defaults).

import type {
  Object3D, Vector3, WebGLRenderer, WebGLRenderTarget, PerspectiveCamera, Group,
  Raycaster, Intersection,
} from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlanetParams, ResolvedPlanetParams, ColorInput } from './params';

export type { PlanetParams, ResolvedPlanetParams, ColorInput };

/** Public body types. */
export type PlanetType = 'terrestrial' | 'gas' | 'star';
/** Internal render modes (the `mode` parameter). */
export type PlanetMode = 'planet' | 'gas' | 'star';

export type TerrestrialPresetName =
  | 'terran' | 'desert' | 'ice' | 'moon' | 'lava' | 'ocean' | 'mars' | 'swamp' | 'alien' | 'ashen' | 'candy';
export type GasPresetName = 'gasGiant' | 'ringed' | 'iceGiant' | 'toxic' | 'nebular';
export type StarPresetName = 'sun' | 'redGiant' | 'blueGiant' | 'whiteDwarf' | 'ember' | 'eldritch';
export type PresetName = TerrestrialPresetName | GasPresetName | StarPresetName;

/** Where a planet's sunlight comes from. */
export type LightSource = Object3D | Vector3 | null;

export interface PlanetOptions extends PlanetParams {
  /** Body type (default: the preset's type, else 'terrestrial'). */
  type?: PlanetType;
  /** Named look (see listPresets()). */
  preset?: PresetName;
  /** A parameter object (e.g. from the studio). Flat keys on the options override it. */
  params?: PlanetParams;
  /**
   * Light direction: an Object3D (a Planet star, a DirectionalLight, any object: the
   * light comes from its world position), a world-space Vector3 pointing toward the
   * sun, or null to use the sunAzimuth / sunElevation parameters (planet-local).
   */
  lightSource?: LightSource;
  /** Custom starSurface() GLSL body (stars). */
  starShader?: string;
  name?: string;
}

export interface SerializedPlanet {
  app: 'procedural-planets';
  version: 1;
  mode: PlanetMode;
  params: ResolvedPlanetParams;
}

export interface ShaderResult { ok: boolean; error?: string }

/**
 * A procedural terrestrial planet, gas giant or star. It is a THREE.Object3D:
 * add it to your scene, position / rotate / (uniformly) scale / parent it
 * like any object. It draws nothing through renderer.render(); a
 * PlanetRenderer draws it.
 */
export class Planet extends Object3D {
  constructor(options?: PlanetOptions);
  readonly isPlanet: true;
  /** 'terrestrial' | 'gas' | 'star' (Object3D.type is 'Planet'). */
  readonly planetType: PlanetType;
  /** Current parameters (treat as read-only; use set()). */
  readonly params: ResolvedPlanetParams;
  /** Light direction source, see PlanetOptions.lightSource. */
  lightSource: LightSource;
  /** Shader clock in seconds (waves, star surface, gas flow). */
  time: number;
  /** Integrated cloud clock. */
  cloudTime: number;
  /** Radius (local units) of a sphere containing everything the planet draws. */
  readonly boundingRadius: number;
  /** Radius (local units) of the solid / liquid surface used for picking. */
  readonly surfaceRadius: number;
  /** starSurface() GLSL body in use. */
  readonly starShaderBody: string;

  get<K extends keyof ResolvedPlanetParams>(key: K): ResolvedPlanetParams[K];
  /** Set parameters live (validated; colours accept any ColorInput). */
  set(patch: PlanetParams): this;
  set<K extends keyof PlanetParams>(key: K, value: PlanetParams[K]): this;
  /** Low-level, unvalidated single-key setter. */
  setParam<K extends keyof ResolvedPlanetParams>(key: K, value: ResolvedPlanetParams[K]): void;
  /** Apply a named preset (switches the body type unless setType: false). */
  applyPreset(name: PresetName, options?: { setType?: boolean }): this;
  /** Pick a new random seed; returns it. */
  randomizeSeed(): number;
  /** Replace the star surface shader (compile-checked when a renderer is known). */
  setStarShader(glslBody: string, renderer?: WebGLRenderer | null): ShaderResult;

  /** Terrain radius (local units) along a LOCAL direction (CPU height mirror). */
  getSurfaceRadius(direction: Vector3): number;
  /** World-space point on the surface (terrain or sea) along a LOCAL direction. */
  getSurfacePoint(direction: Vector3, target?: Vector3): Vector3;
  raycast(raycaster: Raycaster, intersects: Intersection[]): void;

  /** Advance the planet clocks (PlanetRenderer does this unless autoUpdate is off). */
  update(delta: number): void;

  /** Plain JSON, same shape as the studio's planet_preset.json. */
  serialize(): SerializedPlanet;
  /** From a studio export / project / parameter object (older studio params are migrated). */
  static fromJSON(json: string | SerializedPlanet | { params: PlanetParams } | PlanetParams, options?: PlanetOptions): Planet;
  /** Free the planet's GPU resources. */
  dispose(): void;
}

export interface PlanetRendererOptions {
  /** 'transparent' (default): composite over your frame. 'stars': the farthest planet owns the frame, opaque, with a starfield. */
  background?: 'transparent' | 'stars';
  /**
   * 'auto' (default): 'display' for the canvas and sRGB render targets, 'linear' for linear targets.
   * 'display': ACES tone mapped (sRGB encoded, or linear into an sRGB target that encodes on write).
   * 'linear': premultiplied linear HDR for HDR / composer pipelines.
   */
  output?: 'auto' | 'display' | 'linear';
  /** Depth-test planets against your depth buffer (default true). */
  depthTest?: boolean;
  /** Write planet surfaces into your depth buffer (default true). */
  depthWrite?: boolean;
  /** Shade only each planet's screen rectangle (default true). */
  scissor?: boolean;
  /** Advance planet clocks from an internal clock when no delta is passed (default true). */
  autoUpdate?: boolean;
  /** Clamp for the internal clock step, seconds (default 0.05). */
  maxDelta?: number;
}

export interface PlanetRenderOptions {
  /** Output target (default: the renderer's current render target). Needs a depth buffer for occlusion. */
  target?: WebGLRenderTarget | null;
  /** Seconds to advance the planets' clocks (default: internal clock if autoUpdate). */
  delta?: number;
}

/** Draws Planet objects with your WebGLRenderer (WebGL2). One per renderer. */
export class PlanetRenderer {
  constructor(renderer: WebGLRenderer, options?: PlanetRendererOptions);
  readonly renderer: WebGLRenderer;
  readonly options: Required<PlanetRendererOptions>;
  /** Stats of the last render(). */
  readonly info: { planets: number; culled: number };
  setOptions(options: PlanetRendererOptions): this;
  /**
   * Draw every visible Planet in `planets` (an object tree to traverse, a Planet or an
   * array). Call after rendering your opaque scene into the same target.
   */
  render(planets: Object3D | Planet | Planet[], camera: PerspectiveCamera, options?: PlanetRenderOptions): void;
  /** Pre-compile shaders (avoids a first-frame stall). */
  compile(planets: Planet | Planet[], camera?: PerspectiveCamera): Promise<void>;
  dispose(): void;
}

export interface PlanetStats { fps: number; triangles: number; drawCalls: number; chunks: number }

export interface PlanetViewerOptions {
  /** Canvas to render into... */
  canvas?: HTMLCanvasElement;
  /** ...or an element to create a full-size canvas in. */
  container?: HTMLElement;
  /** A Planet (not disposed by the viewer) or Planet options (default: terran). */
  planet?: Planet | PlanetOptions;
  /** OrbitControls (default true). */
  controls?: boolean;
  /** Start the render loop (default true). */
  autoStart?: boolean;
  /** Max device pixel ratio (default 2). */
  pixelRatio?: number;
  onStats?: (stats: PlanetStats) => void;
}

/** A self-contained single-planet view: renderer, camera, controls, loop, starfield. */
export class PlanetViewer {
  constructor(options: PlanetViewerOptions);
  readonly renderer: WebGLRenderer;
  readonly planetRenderer: PlanetRenderer;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls | null;
  readonly canvas: HTMLCanvasElement;
  readonly planet: Planet;
  readonly running: boolean;
  setPlanet(planet: Planet | PlanetOptions): Planet;
  /** Reset the camera to the default 3/4 view. */
  frame(): this;
  start(): this;
  stop(): this;
  /** One frame without advancing time. */
  renderOnce(): void;
  /** PNG data URL of a w x h frame. */
  screenshot(width?: number, height?: number): string;
  dispose(): void;
}

export interface BakeOptions extends PlanetOptions {
  /** Bake this planet instead of creating one from the other options. */
  planet?: Planet;
  /** Quads per cube-face side (terrestrial) / sphere segments (default 128). */
  meshResolution?: number;
  /** Texture size per face / equirect width (default 1024). */
  textureSize?: number;
  /** Translucent ocean shell (default true). */
  water?: boolean;
  /** Fresnel atmosphere / corona rim shell (default true). */
  atmosphere?: boolean;
  /** Gas giant rings (default true). */
  rings?: boolean;
  /** Fold a fixed sun into the textures (default false: your lights shade the meshes). */
  bakeLighting?: boolean;
  /** Star surface material: 'basic' unlit (default) or 'standard' emissive. */
  starMaterial?: 'basic' | 'standard';
  onProgress?: (message: string) => void;
}

export interface BakedPlanet extends Group {
  userData: { params: ResolvedPlanetParams; [key: string]: unknown };
  /** Dispose every geometry, material and texture of the group. */
  dispose(): void;
}

/** Bake a planet into static standard-material meshes (lit by your scene). */
export function bakePlanet(renderer: WebGLRenderer, options?: BakeOptions): Promise<BakedPlanet>;

export interface PlanetPassOptions extends PlanetRendererOptions {
  /** Reuse an existing PlanetRenderer. */
  planetRenderer?: PlanetRenderer;
}

/** EffectComposer pass: put it right after RenderPass (never last; add an OutputPass). */
export class PlanetPass extends Pass {
  constructor(scene: Object3D | Planet[], camera: PerspectiveCamera, options?: PlanetPassOptions);
  scene: Object3D | Planet[];
  camera: PerspectiveCamera;
  planetRenderer: PlanetRenderer | null;
}

export interface ParamDoc {
  domain: PlanetMode;
  group: string;
  label: string;
  type: 'number' | 'boolean' | 'color' | 'string';
  default: number | boolean | string | [number, number, number];
  description: string;
  min?: number;
  max?: number;
  step?: number;
  structural?: boolean;
}

/** Metadata for every parameter (for building UIs, validation, docs). */
export const PARAM_DOCS: Record<keyof ResolvedPlanetParams, ParamDoc>;

export interface PresetDef { label: string; patch: PlanetParams }
export const PLANET_PRESETS: Record<TerrestrialPresetName, PresetDef>;
export const GAS_PRESETS: Record<GasPresetName, PresetDef>;
export const STAR_PRESETS: Record<StarPresetName, PresetDef>;
export const DEFAULT_PARAMS: ResolvedPlanetParams;
export const GAS_DEFAULTS: Partial<ResolvedPlanetParams>;
export const STAR_DEFAULTS: Partial<ResolvedPlanetParams>;
export const DEFAULT_STAR_BODY: string;
export const PLANET_TYPES: Readonly<Record<'terrestrial' | 'planet' | 'gas' | 'star', PlanetMode>>;
export const VERSION: string;

export function listPresets(): Record<PlanetType, string[]>;
export function findPreset(name: string): { mode: PlanetMode; preset: PresetDef } | null;
export function validateParams(patch: Record<string, unknown>): { params: PlanetParams; unknown: string[]; invalid: string[] };
export function normalizeParam(key: string, value: unknown): { ok: boolean; value?: unknown; reason?: 'unknown' | 'invalid' };
export function resolvePlanetParams(options?: PlanetOptions): ResolvedPlanetParams;
export function migrateParams(params: PlanetParams, presetKey?: TerrestrialPresetName, modePreset?: Partial<Record<PlanetMode, string>>): PlanetParams;
