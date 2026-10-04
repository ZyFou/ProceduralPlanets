import * as THREE from 'three';
import { PlanetPaintPicker } from './PlanetPaintPicker.js';
import { PlanetPaintBrushCursor } from './PlanetPaintBrushCursor.js';
import { sphericalDistance, tangentFrame, clamp } from './sphericalPaintMapping.js';

export const DEFAULT_PAINT_STATE = Object.freeze({ enabled: false, tool: 'raise', brushSize: 120, strength: 0.35,
  falloff: 0.75, brushShape: 'round', brushRotation: 0, brushScatter: 0.55, brushSpacing: 0.35,
  targetElevation: 80, material: 'sand', pickHeight: false });

/** Input/editor controller; runtime layers belong to Planet, never to this mode. */
export class PlanetPaintModeManager {
  constructor({ planet, camera, domElement, controls, renderer, onChange, onStrokeStart, onStrokeEnd } = {}) {
    Object.assign(this, { planet, camera, domElement, controls, renderer, onChange, onStrokeStart, onStrokeEnd });
    this.state = { ...DEFAULT_PAINT_STATE };
    this.picker = new PlanetPaintPicker({ planet, camera, domElement });
    this.cursor = new PlanetPaintBrushCursor(planet);
    this.queue = []; this.isPainting = false; this.pointerId = null;
    this._listeners = [];
    this._cameraPosition = new THREE.Vector3(); this._cameraQuaternion = new THREE.Quaternion();
    const listen = (target, type, handler, options) => { target.addEventListener(type, handler, options); this._listeners.push(() => target.removeEventListener(type, handler, options)); };
    listen(domElement, 'pointerdown', (e) => this._down(e), true);
    listen(domElement, 'pointermove', (e) => this._move(e), true);
    listen(domElement, 'pointerleave', () => { if (!this.isPainting) { this.hit = null; this.lastPointer = null; this.cursor.setVisible(false); } });
    listen(domElement, 'lostpointercapture', () => this.finish());
    listen(window, 'pointerup', (e) => { if (e.pointerId === this.pointerId) { this.queue.push({ clientX: e.clientX, clientY: e.clientY }); this.finish(); } }, true);
    listen(window, 'pointercancel', (e) => { if (e.pointerId === this.pointerId) this.finish(); }, true);
    listen(window, 'blur', () => this.finish());
    listen(domElement, 'wheel', (e) => {
      if (!this.state.enabled || !e.shiftKey) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.setState({ brushSize: this.state.brushSize * (e.deltaY > 0 ? 0.9 : 1.1) });
    }, { capture: true, passive: false });
    listen(domElement, 'contextmenu', (e) => { if (this.state.enabled) e.preventDefault(); });
  }
  _emit() { this.onChange?.({ ...this.state }); }
  setState(patch) {
    const accepted = { ...patch };
    for (const key of ['brushSize', 'strength', 'falloff', 'brushRotation', 'brushScatter', 'brushSpacing', 'targetElevation']) {
      if (key in accepted && !Number.isFinite(accepted[key])) delete accepted[key];
    }
    if ('tool' in accepted && !['raise','lower','smooth','flatten','material','erase'].includes(accepted.tool)) delete accepted.tool;
    if ('brushShape' in accepted && !['round','ellipse','organic','scatter','ribbon'].includes(accepted.brushShape)) delete accepted.brushShape;
    Object.assign(this.state, accepted);
    const R = this.planet.params.radius;
    this.state.brushSize = clamp(this.state.brushSize, R * 4 / this.planet.paintLayers.resolution, R * 0.45);
    this.state.strength = clamp(this.state.strength, 0.01, 1);
    this.state.falloff = clamp(this.state.falloff, 0, 1);
    this.state.brushSpacing = clamp(this.state.brushSpacing, 0.08, 1);
    this.state.brushScatter = clamp(this.state.brushScatter, 0.05, 0.75);
    this.cursorDirty = true;
    this._emit();
  }
  enable() {
    if (this.state.enabled || this.planet.params.mode !== 'planet') return false;
    this.state.enabled = true;
    if (this.controls) {
      this.previousControls = { buttons: { ...this.controls.mouseButtons }, autoRotate: this.controls.autoRotate, enabled: this.controls.enabled };
      this.controls.mouseButtons.LEFT = null;
      this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      this.controls.enabled = true; this.controls.autoRotate = false;
    }
    // A project may have changed radius or paint resolution since last use.
    this.setState({}); return true;
  }
  disable() {
    if (!this.state.enabled) return;
    this.finish(); this.state.enabled = false; this.state.pickHeight = false;
    this.queue = []; this.hit = null; this.lastPointer = null; this.cursor.setVisible(false);
    if (this.controls && this.previousControls) {
      Object.assign(this.controls.mouseButtons, this.previousControls.buttons);
      this.controls.enabled = this.previousControls.enabled;
      this.controls.autoRotate = this.previousControls.autoRotate;
    }
    this._emit();
  }
  setEnabled(value) { return value ? this.enable() : this.disable(); }
  _down(e) {
    if (!this.state.enabled || e.button !== 0 || this.isPainting) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (this.controls?.enableDamping) {
      this.controls.enableDamping = false; this.controls.update?.(); this.controls.enableDamping = true;
    }
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
    this.hit = this.picker.pickEvent(e);
    if (!this.hit) return;
    if (this.state.pickHeight) { this.setState({ targetElevation: this.hit.elevation, pickHeight: false }); return; }
    this.isPainting = true; this.pointerId = e.pointerId;
    this.lastStamp = null; this.strokeChanged = false;
    this.strokeState = { ...this.state };
    this.baseCache = new Map();
    this.strokeTangent = tangentFrame(this.hit.direction).east;
    this.onStrokeStart?.();
    this.domElement.setPointerCapture?.(e.pointerId);
    this._stamp(this.hit.direction); this.cursorDirty = true;
  }
  _move(e) {
    if (!this.state.enabled) return;
    if (this.isPainting && e.pointerId !== this.pointerId) return;
    // Events are consumed in order once per animation frame, not uploaded per event.
    if (this.isPainting) { e.preventDefault(); e.stopImmediatePropagation(); }
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
    this.queue.push(this.lastPointer);
    if (!this.isPainting) this.queue = this.queue.slice(-1);
  }
  _stamp(direction) {
    const s = this.strokeState;
    this.strokeChanged = this.planet.paintLayers.stamp({ direction, radius: s.brushSize, planetRadius: this.planet.params.radius,
      tool: s.tool, strength: s.strength, falloff: s.falloff, shape: s.brushShape, rotation: s.brushRotation * Math.PI / 180,
      tangent: this.strokeTangent, scatter: s.brushScatter, targetElevation: s.targetElevation, material: s.material,
      amount: this.planet.params.heightScale > 0 ? this.planet.params.heightScale * 0.2 : this.planet.params.radius * 0.005,
      baseHeightAt: (d) => {
        const key = `${d.x.toFixed(8)},${d.y.toFixed(8)},${d.z.toFixed(8)}`;
        if (!this.baseCache.has(key)) this.baseCache.set(key, this.planet.getBaseElevation(d));
        return this.baseCache.get(key);
      } }) || this.strokeChanged;
    this.lastStamp = direction.clone();
  }
  update() {
    if (!this.state.enabled) return;
    if (this.planet.params.mode !== 'planet') { this.disable(); return; }
    const events = this.queue.splice(0);
    const moved = this._cameraPosition.distanceToSquared(this.camera.position) > 1e-10 || 1 - Math.abs(this._cameraQuaternion.dot(this.camera.quaternion)) > 1e-10;
    if (!events.length && moved && this.lastPointer && !this.isPainting) events.push(this.lastPointer);
    this._cameraPosition.copy(this.camera.position); this._cameraQuaternion.copy(this.camera.quaternion);
    for (const event of events) {
      this.hit = this.picker.pickEvent(event); this.cursorDirty = true;
      if (!this.isPainting) continue;
      if (!this.hit) { this.lastStamp = null; continue; }
      const d = this.hit.direction;
      if (!this.lastStamp) { this._stamp(d); continue; }
      const spacing = this.strokeState.brushSize * this.strokeState.brushSpacing;
      const start = this.lastStamp.clone(), distance = sphericalDistance(start, d, this.planet.params.radius);
      const angle = distance / this.planet.params.radius;
      // Retain unconsumed distance; geodesic interpolation prevents gaps at speed.
      for (let i = 1, count = Math.floor(distance / spacing); i <= count; i++) {
        const t = i * spacing / distance;
        const q = angle < 1e-8 ? d.clone() : start.clone().multiplyScalar(Math.sin((1 - t) * angle) / Math.sin(angle)).addScaledVector(d, Math.sin(t * angle) / Math.sin(angle)).normalize();
        this._stamp(q);
      }
    }
    if (this.cursorDirty) { this.cursor.update(this.hit, this.state, this.isPainting ? this.strokeTangent : null); this.cursorDirty = false; }
    if (this.renderer) this.planet.paintLayers.flushUploads(this.renderer);
  }
  finish() {
    if (!this.isPainting) return;
    if (this.planet.params.mode === 'planet') this.update();
    else this.queue = [];
    const id = this.pointerId;
    this.isPainting = false; this.pointerId = null; this.lastStamp = null;
    if (this.domElement.hasPointerCapture?.(id)) this.domElement.releasePointerCapture(id);
    if (this.strokeChanged) this.onStrokeEnd?.(this.planet.paint);
    this.strokeChanged = false; this.baseCache = null;
  }
  clear() { this.finish(); this.onStrokeStart?.(); this.planet.paintLayers.clear(); this.onStrokeEnd?.(this.planet.paint); this.cursorDirty = true; }
  dispose() { this.disable(); this._listeners.forEach((remove) => remove()); this.cursor.dispose(); }
}
