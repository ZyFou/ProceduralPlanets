// Type declarations for procedural-planets/export.
import type { WebGLRenderer, Object3D } from 'three';
import type { Planet } from './index';

export interface ExportOptions {
  /** 'glb' (default) or 'obj' (+ PNG textures). */
  format?: 'glb' | 'obj';
  /** Quads per cube-face side / sphere segments (default 128). */
  meshResolution?: number;
  /** Texture size (default 1024). */
  textureSize?: number;
  /** Include a translucent ocean shell (default false). */
  water?: boolean;
  /** Fold a fixed sun into the textures (default false). */
  bakeLighting?: boolean;
  /** Include the mesh (default true); false = parameters only. */
  includeMesh?: boolean;
  /** Bake colour textures (default true). */
  bakeColor?: boolean;
  /** Include the parameter preset JSON (default true). */
  preset?: boolean;
  onProgress?: (message: string) => void;
}

export interface PlanetArchive {
  /** The ZIP. */
  blob: Blob;
  /** Suggested file name, e.g. planet_export-1337.zip. */
  filename: string;
  /** Its contents by path. */
  files: Record<string, Uint8Array>;
}

/** Bake + package a planet like the studio's Export button. */
export function createPlanetArchive(renderer: WebGLRenderer, planet: Planet, options?: ExportOptions): Promise<PlanetArchive>;
/** createPlanetArchive + browser download. */
export function downloadPlanetArchive(renderer: WebGLRenderer, planet: Planet, options?: ExportOptions & { filename?: string }): Promise<PlanetArchive>;
/** Bake a planet to a binary glTF. Options as bakePlanet(). */
export function exportPlanetGLB(renderer: WebGLRenderer, planet: Planet, options?: import('./index').BakeOptions): Promise<Uint8Array | null>;
/** Binary glTF of any object. */
export function toGLB(object: Object3D): Promise<Uint8Array | null>;
export function downloadBlob(blob: Blob, filename: string): void;
