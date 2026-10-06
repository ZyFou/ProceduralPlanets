import { Quaternion, Ray, Sphere, Vector3 } from 'three';
import { pickPlanetRay } from '../paint/PlanetPaintPicker.js';

// Store movement in planet-local coordinates so floating origins do not affect it.
export class SurfaceWalker {
  constructor(camera, canvas, onChange = () => {}) {
    Object.assign(this, { camera, canvas, onChange, active: false, pitch: 0, eyeHeight: 1.7, speed: 3.5, speedMultiplier: 1 });
    this.direction = new Vector3(); this.heading = new Vector3(); this.keys = new Set();
    this.clear();
    const doc = canvas.ownerDocument, win = doc.defaultView;
    let drag = null;
    const clear = () => { this.clear(); drag = null; };
    const key = e => {
      if (!this.active || e.target.closest?.('input,textarea,select,[contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Escape') { this.unfocus(); return; }
      if (!this.focused && !this.touchControls) return;
      const code = e.key?.toLowerCase();
      if (!['w','a','s','d','z','q','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(code)) return;
      e.preventDefault();
      if (e.type === 'keydown') this.keys.add(code); else this.keys.delete(code);
    };
    const down = e => {
      if (!this.active || e.pointerType === 'touch' || e.button !== 0) return;
      this.focus();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
    };
    const mouse = e => {
      if (!this.active) return;
      if (!this.focused && drag?.id === e.pointerId) {
        this.turn((e.clientX - drag.x) * .004, (e.clientY - drag.y) * .004);
        drag.x = e.clientX; drag.y = e.clientY;
      }
    };
    const lockedMouse = e => {
      if (this.active && this.focused) this.turn(e.movementX * .002, e.movementY * .002);
    };
    const wheel = e => {
      if (!this.active) return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
      this.speedMultiplier = Math.max(.1, Math.min(10000, this.speedMultiplier * Math.exp(-Math.max(-1000, Math.min(1000, delta)) * .002)));
    };
    const up = () => { drag = null; };
    const visibility = () => { if (doc.hidden) clear(); };
    const listeners = [[doc,'keydown',key],[doc,'keyup',key],[doc,'mousemove',lockedMouse],[win,'blur',clear],
      [doc,'visibilitychange',visibility],[doc,'pointerlockchange',clear],
      [canvas,'pointerdown',down],[canvas,'pointermove',mouse],[canvas,'pointerup',up],
      [canvas,'pointercancel',up],[canvas,'lostpointercapture',up],[canvas,'wheel',wheel,{ passive: false }]];
    for (const [el,type,fn,options] of listeners) el.addEventListener(type,fn,options);
    this.dispose = () => { this.exit(); for (const [el,type,fn,options] of listeners) el.removeEventListener(type,fn,options); };
  }
  get focused() { return this.canvas.ownerDocument.pointerLockElement === this.canvas; }
  focus() {
    if (!this.active || this.focused || this.touchControls) return;
    try { this.canvas.requestPointerLock?.()?.catch(() => {}); } catch { /* Drag remains available if capture fails. */ }
  }
  unfocus() {
    this.clear();
    if (this.focused) this.canvas.ownerDocument.exitPointerLock();
  }
  enter(planet) {
    if (planet.params.mode !== 'planet') return false;
    this.camera.updateMatrixWorld();
    const ray = new Ray(this.camera.position.clone(), this.camera.getWorldDirection(new Vector3()));
    let hit = pickPlanetRay(planet, ray);
    if (planet.params.waterEnabled) {
      const localRay = ray.clone().applyMatrix4(planet.matrixWorld.clone().invert());
      const sea = localRay.intersectSphere(new Sphere(new Vector3(), planet.uniforms.uSeaRadius.value), new Vector3());
      if (sea) {
        const world = sea.clone().applyMatrix4(planet.matrixWorld);
        if (!hit || ray.origin.distanceTo(world) < hit.distance) hit = { direction: sea.normalize() };
      }
    }
    if (!hit) return false;
    this.saved = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), up: this.camera.up.clone(), near: this.camera.near, surfaceWalk: this.camera.userData.surfaceWalk };
    this.planet = planet; this.direction.copy(hit.direction);
    const forward = this.camera.getWorldDirection(new Vector3()).transformDirection(planet.matrixWorld.clone().invert());
    this.heading.copy(forward).addScaledVector(this.direction, -forward.dot(this.direction));
    if (this.heading.lengthSq() < 1e-8) this.heading.set(0,1,0).addScaledVector(this.direction, -this.direction.y);
    if (this.heading.lengthSq() < 1e-8) this.heading.set(1,0,0).addScaledVector(this.direction, -this.direction.x);
    this.heading.normalize(); this.pitch = 0; this.clear(); this.active = true;
    this.speedMultiplier = 1;
    this.touchControls = this.canvas.ownerDocument.defaultView.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.camera.userData.surfaceWalk = true;
    this.place(); this.onChange(true); this.focus(); return true;
  }
  clear() { this.keys.clear(); this.move = { x: 0, y: 0 }; this.look = { x: 0, y: 0 }; }
  exit() {
    if (!this.active) return;
    this.unfocus();
    this.active = false; this.clear();
    this.camera.position.copy(this.saved.position); this.camera.quaternion.copy(this.saved.quaternion);
    this.camera.up.copy(this.saved.up); this.camera.near = this.saved.near; this.camera.updateProjectionMatrix();
    if (this.saved.surfaceWalk === undefined) delete this.camera.userData.surfaceWalk;
    else this.camera.userData.surfaceWalk = this.saved.surfaceWalk;
    this.onChange(false);
  }
  turn(yaw, pitch) {
    this.heading.applyAxisAngle(this.direction, -yaw);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - pitch));
  }
  step(dt) {
    if (!this.active) return;
    if (this.planet.params.mode !== 'planet') { this.exit(); return; }
    dt = Math.min(.05, Math.max(0, dt));
    this.turn(this.look.x * dt * 1.8, this.look.y * dt * 1.8);
    const k = this.keys;
    const x = this.move.x + Number(k.has('d') || k.has('arrowright')) - Number(k.has('a') || k.has('q') || k.has('arrowleft'));
    const y = -this.move.y + Number(k.has('w') || k.has('z') || k.has('arrowup')) - Number(k.has('s') || k.has('arrowdown'));
    const tangent = new Vector3().crossVectors(this.heading, this.direction).normalize().multiplyScalar(x).addScaledVector(this.heading, y);
    if (tangent.lengthSq()) {
      tangent.multiplyScalar(1 / Math.max(1, tangent.length()));
      const previous = this.direction.clone();
      const speed = this.speed * this.speedMultiplier * (k.has('shift') ? 3 : 1);
      this.direction.addScaledVector(tangent, speed * dt / this.planet.params.radius).normalize();
      this.heading.applyQuaternion(new Quaternion().setFromUnitVectors(previous, this.direction)).normalize();
    }
    this.place();
  }
  place() {
    const p = this.planet, clearance = this.eyeHeight;
    const point = p.getSurfacePoint(this.direction, new Vector3());
    const up = this.direction.clone().transformDirection(p.matrixWorld);
    const forward = this.heading.clone().transformDirection(p.matrixWorld).multiplyScalar(Math.cos(this.pitch)).addScaledVector(up, Math.sin(this.pitch));
    this.localPosition = this.direction.clone().multiplyScalar(point.clone().applyMatrix4(p.matrixWorld.clone().invert()).length() + clearance);
    this.camera.position.copy(point).addScaledVector(up, clearance * p.matrixWorld.getMaxScaleOnAxis());
    this.camera.up.copy(up); this.camera.lookAt(this.camera.position.clone().add(forward));
    this.camera.near = Math.max(.00001, clearance * p.matrixWorld.getMaxScaleOnAxis() * .1);
    this.camera.updateProjectionMatrix();
  }
}
