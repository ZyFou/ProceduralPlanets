import { Vector3, Euler } from 'three';
import { AXES, MIN_SPEED, SECTOR_SIZE, clearanceRadius, length, relative, translate } from './world.js';

// No travel-speed policy ceiling. Saturate only at IEEE-754 finite range;
// spatial steps have a separate safe-integer coordinate boundary below.
export const clampSpeed = speed => Number.isNaN(Number(speed)) ? MIN_SPEED : Math.min(Number.MAX_VALUE, Math.max(MIN_SPEED, Number(speed)));
export const wheelSpeed = (speed, delta) => clampSpeed(speed * Math.pow(2, -Math.max(-4, Math.min(4, delta / 120))));
export function coordinateTravelBudget(player, direction) {
  let budget = Infinity;
  // Keep neighbouring-sector discovery representable as well. The margin
  // also protects the normalisation arithmetic at the last integer cell.
  const limit = Number.MAX_SAFE_INTEGER - 16;
  for (const axis of AXES) {
    const d = direction[axis];
    if (!d) continue;
    const sectors = d > 0 ? limit - player.sector[axis] : limit + player.sector[axis];
    const available = Math.max(0, sectors * SECTOR_SIZE - Math.sign(d) * player.offset[axis]);
    budget = Math.min(budget, available / Math.abs(d));
  }
  return budget * (1 - Number.EPSILON * 8);
}
export function movement(keys, layout = 'wasd') {
  return new Vector3(
    Number(keys.has('KeyD')) - Number(keys.has(layout === 'azerty' ? 'KeyQ' : 'KeyA')),
    Number(keys.has('Space')) - Number(keys.has('ControlLeft') || keys.has('ControlRight')),
    Number(keys.has('KeyS')) - Number(keys.has(layout === 'azerty' ? 'KeyZ' : 'KeyW')),
  ).normalize();
}
// Stop at the first sphere along the entire travel segment, including at warp
// speeds. Testing only the final position would allow tunnelling through stars.
export function safeTravel(player, delta, bodies) {
  const distance = length(delta);
  if (!distance) return player;
  const direction = new Vector3(delta.x, delta.y, delta.z).divideScalar(distance);
  let travel = distance;
  for (const body of bodies) {
    const centre = relative(body.position, player);
    const v = new Vector3(centre.x, centre.y, centre.z);
    const radius = clearanceRadius(body);
    const d = v.length();
    const projection = v.dot(direction);
    if (d < radius && projection > 0) { travel = 0; continue; }
    const perpendicular = v.clone().addScaledVector(direction, -projection);
    const discriminant = radius * radius - perpendicular.lengthSq();
    if (discriminant < 0 || projection < 0) continue;
    const hit = projection - Math.sqrt(discriminant);
    if (hit >= 0) travel = Math.min(travel, Math.max(0, hit - 0.001));
  }
  return translate(player, Object.fromEntries(AXES.map(a => [a, direction[a] * travel])));
}

export class Flight {
  constructor(player, camera) {
    this.position = player;
    this.camera = camera;
    this.speed = 100;
    this.actualSpeed = 0;
    this.keys = new Set();
    this.layout = 'wasd';
    this.look = new Euler(0, 0, 0, 'YXZ');
    this.approaching = null;
    this.limited = false;
    this.blocked = false;
    this.coordinateLimited = false;
  }
  aim(body) {
    const v = relative(body.position, this.position);
    this.camera.lookAt(v.x, v.y, v.z);
    this.look.setFromQuaternion(this.camera.quaternion, 'YXZ');
  }
  mouse(dx, dy) {
    this.approaching = null;
    this.look.y -= dx * 0.002;
    this.look.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.look.x - dy * 0.002));
    this.camera.quaternion.setFromEuler(this.look);
  }
  clear() { this.keys.clear(); this.actualSpeed = 0; this.approaching = null; }
  step(dt, bodies) {
    dt = Math.min(0.05, Math.max(0, dt));
    this.actualSpeed = 0;
    this.limited = false;
    this.blocked = false;
    this.coordinateLimited = false;
    if (!dt) return;
    const manual = movement(this.keys, this.layout);
    if (manual.lengthSq()) this.approaching = null;
    let delta;
    if (this.approaching) {
      const body = this.approaching;
      const vector = relative(body.position, this.position);
      const distance = length(vector);
      const stop = body.radius * (body.type === 'star' ? 5 : 2.6);
      const remaining = Math.max(0, distance - stop);
      if (remaining < Math.max(0.001, stop * 0.001)) { this.approaching = null; return; }
      this.aim(body);
      const travel = remaining * (1 - Math.exp(-dt * 1.5));
      delta = new Vector3(vector.x, vector.y, vector.z).multiplyScalar(travel / distance);
    } else {
      if (!manual.lengthSq()) return;
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const requested = clampSpeed(this.speed * (boost ? 20 : 1));
      let speed = requested;
      if (!boost) for (const body of bodies) {
        const distance = length(relative(body.position, this.position));
        if (distance < body.radius * 100) {
          speed = Math.min(speed, Math.max(MIN_SPEED, (distance - clearanceRadius(body)) * 0.5));
        }
      }
      this.limited = speed < requested;
      const direction = manual.applyQuaternion(this.camera.quaternion);
      const travel = Math.min(speed * dt, coordinateTravelBudget(this.position, direction));
      this.coordinateLimited = travel < speed * dt;
      delta = direction.multiplyScalar(travel);
    }
    const next = safeTravel(this.position, delta, bodies);
    const travelled = length(relative(next, this.position));
    this.blocked = travelled < delta.length() * 0.999;
    if (this.blocked) this.approaching = null;
    this.actualSpeed = travelled / dt;
    this.position = next;
  }
}

// All input belongs to the captured canvas. Unlocking, blurring or hiding the
// tab cancels movement/approach so a missed keyup cannot leave the ship flying.
export function bindFlightInput(canvas, flight, { enabled = () => true, onLock = () => {}, onSpeed = () => {}, onPick = () => {}, onTeleport = () => {}, onError = () => {} } = {}) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const locked = () => doc.pointerLockElement === canvas;
  const key = event => {
    if (!enabled()) return;
    if (event.code === 'Escape' && event.type === 'keydown') {
      flight.clear();
      if (locked()) doc.exitPointerLock();
      return;
    }
    if (!locked()) return;
    // KeyboardEvent.code names the physical QWERTY position even on AZERTY.
    // Letter keys follow the explicitly selected layout; modifiers use code.
    const letter = event.key?.toLowerCase();
    const code = ['w', 'a', 's', 'd', 'z', 'q'].includes(letter) ? `Key${letter.toUpperCase()}` : event.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight'].includes(code)) {
      event.preventDefault();
      if (event.type === 'keydown') flight.keys.add(code);
      else flight.keys.delete(code);
    }
    if (event.code === 'KeyF' && event.type === 'keydown' && !event.repeat) onPick();
  };
  const mouse = event => { if (enabled() && locked()) flight.mouse(event.movementX, event.movementY); };
  const wheel = event => {
    if (!enabled()) return;
    event.preventDefault();
    flight.speed = wheelSpeed(flight.speed, event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1));
    onSpeed(flight.speed);
  };
  const lock = () => { flight.clear(); onLock(locked()); };
  const blur = () => { flight.clear(); if (locked()) doc.exitPointerLock(); };
  const visibility = () => { if (doc.hidden) blur(); };
  const error = () => onError('Mouse capture unavailable. Try clicking the flight view again.');
  let clickedBody;
  const click = event => {
    if (!enabled()) return;
    // Retain the first click's body: acquiring pointer lock recentres the
    // cursor before the second click of an unlocked double-click.
    if (event.detail !== 2) clickedBody = onPick(locked() ? undefined : event);
    if (!locked()) {
      try { canvas.requestPointerLock()?.catch(error); } catch { error(); }
    }
  };
  const doubleClick = event => {
    if (!enabled()) return;
    const body = clickedBody === undefined ? onPick(locked() ? undefined : event) : clickedBody;
    if (body) onTeleport(body);
    clickedBody = undefined;
  };
  const listeners = [[doc, 'keydown', key], [doc, 'keyup', key], [doc, 'mousemove', mouse],
    [doc, 'pointerlockchange', lock], [doc, 'pointerlockerror', error], [doc, 'visibilitychange', visibility],
    [win, 'blur', blur], [canvas, 'wheel', wheel, { passive: false }], [canvas, 'click', click], [canvas, 'dblclick', doubleClick]];
  for (const [node, type, callback, options] of listeners) node.addEventListener(type, callback, options);
  return () => {
    for (const [node, type, callback, options] of listeners) node.removeEventListener(type, callback, options);
    blur();
  };
}
