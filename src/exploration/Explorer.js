import * as THREE from 'three';
import { SurfaceWalker } from '../engine/SurfaceWalker.js';
import { Planet, PlanetRenderer } from 'procedural-planets';
import { Flight, bindFlightInput } from './flight.js';
import { SystemStream } from './streaming.js';
import { length, relative, translate } from './world.js';
import { generateSolarSystem } from './solarSystem.js';
import { DEFAULT_SETTINGS, normalizeSettings, bodySettings } from './settings.js';

export class Explorer {
  constructor(canvas, seed, callbacks = {}, settings = DEFAULT_SETTINGS) {
    this.callbacks = callbacks;
    this.canvas = canvas;
    this.settings = normalizeSettings(settings);
    this.photo = false;
    this.capturing = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor('#02040a');
    this.planets = new PlanetRenderer(this.renderer, { impostorUpdates: 1, impostorAtlasSize: 1024, impostorRefresh: 2 });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.0001, 1e15);
    const home = generateSolarSystem();
    const first = home.bodies.find(body => body.name === 'Earth');
    const sunward = relative(home.star.position, first.position);
    const offset = new THREE.Vector3(sunward.x, sunward.y, sunward.z).normalize().multiplyScalar(first.radius * 2.8);
    offset.y += first.radius * 0.4;
    this.flight = new Flight(translate(first.position, offset), this.camera);
    this.flight.aim(first);
    this.target = first;
    this.stream = new SystemStream(seed, {
      create: (body, system) => {
        // Keep shader dimensions in the package's comfortable local range;
        // uniform Object3D scale supplies the physical radius in kilometres.
        const planet = new Planet({
          type: body.type, preset: body.preset, name: body.name, seed: body.seed, radius: 2000,
          chunkRes: 32, maxDepth: 9, splitFactor: 4, octaves: 5, cloudQuality: 24, cloudResolution: 0.5,
          atmoHeight: Math.min(0.03, 100 / body.radius),
          cloudAltitude: 4 / body.radius, cloudThickness: 8 / body.radius,
          ambient: 0.04,
          // At physical relief (a few km rather than a stylised 4% of radius),
          // keep ocean clarity shallow and ripples below kilometre scales.
          waterClarity: 0.005, waveSize: 0.01,
          analyticTerrainDepth: true,
          ...body.params,
          // A static world-space direction works even when the star isn't resident.
          lightSource: new THREE.Vector3(...Object.values(relative(system.star.position, body.position))).normalize(),
        });
        planet.userData.explorationIntrinsic = Object.fromEntries(['cloudsEnabled', 'atmoEnabled', 'gasAtmoStrength', 'starBloom'].map(key => [key, planet.params[key]]));
        planet.set(bodySettings(this.settings, planet.userData.explorationIntrinsic));
        planet.scale.setScalar(body.radius / 2000);
        this.scene.add(planet);
        return planet;
      },
      release: planet => {
        this.planets.release(planet);
        this.scene.remove(planet);
        planet.dispose();
      },
    });
    this.stream.discover(this.flight.position, first.id);
    this.walker = new SurfaceWalker(this.camera, canvas, active => {
      this.flight.clear();
      if (!active && this.walkOrigin) {
        this.flight.position = this.walkOrigin;
        this.camera.position.set(0, 0, 0);
        this.camera.up.set(0, 1, 0);
        this.flight.look.setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.walkBody = null;
      }
    });
    this.unbind = bindFlightInput(canvas, this.flight, {
      enabled: () => !this.walker.active,
      onLock: callbacks.onLock, onSpeed: callbacks.onSpeed, onError: callbacks.onError,
      onPick: event => this.pick(event), onTeleport: body => { if (!this.photo) this.teleport(body); },
    });
    this.clock = new THREE.Clock();
    this.nextDiscovery = 0;
    this.nextLoad = 0;
    this.nextHud = 0;
    this.running = true;
    this.disposed = false;
    this.contextLost = event => { event.preventDefault(); this.pause(); callbacks.onError?.('WebGL context lost. Return to the studio and reopen Explore.'); };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.setSettings(this.settings);
    this.renderer.setAnimationLoop(() => {
      try { this.frame(); } catch (error) { this.pause(); callbacks.onError?.(error.message); }
    });
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const requested = this.capturePixelRatio ?? Math.min(2, window.devicePixelRatio || 1) * this.settings.renderScale;
    const textureLimit = this.renderer.capabilities.maxTextureSize;
    this.renderer.setPixelRatio(Math.min(requested, textureLimit / w, textureLimit / h, Math.sqrt(16_777_216 / (w * h))));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  toggleWalk() {
    if (this.walker.active) { this.walker.exit(); return true; }
    const body = this.pick();
    const resource = body && this.stream.entries.get(body.id)?.resource;
    if (!resource || resource.params.mode !== 'planet') return false;
    const v = relative(body.position, this.flight.position);
    resource.position.set(v.x, v.y, v.z);
    this.walkOrigin = this.flight.position;
    this.walkBody = body;
    // Exploration world units are kilometres; keep eye height and pace in metres.
    const scale = body.radius / resource.params.radius;
    this.walker.eyeHeight = .0017 / scale;
    this.walker.speed = .0035 / scale;
    if (!this.walker.enter(resource)) { this.walkBody = null; return false; }
    this.flight.position = translate(body.position, this.walker.localPosition.clone().multiplyScalar(body.radius / resource.params.radius));
    this.camera.position.set(0, 0, 0);
    this.nextDiscovery = this.nextHud = 0;
    return true;
  }
  setSettings(settings) {
    this.settings = normalizeSettings(settings);
    this.flight.layout = this.settings.layout;
    this.camera.fov = this.settings.fov;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * this.settings.renderScale);
    for (const { resource } of this.stream.entries.values()) {
      const patch = bodySettings(this.settings, resource.userData.explorationIntrinsic);
      const changes = Object.fromEntries(Object.entries(patch).filter(([key, value]) => resource.params[key] !== value));
      if (Object.keys(changes).length) {
        this.planets.release(resource);
        resource.set(changes);
      }
    }
    this.resize();
  }
  setPhoto(enabled) {
    this.photo = enabled;
    this.flight.clear();
    this.walker.clear();
    if (this.canvas.ownerDocument.pointerLockElement === this.canvas) this.canvas.ownerDocument.exitPointerLock();
  }
  async takePhoto(scale = 1) {
    if (this.capturing || this.disposed) return null;
    this.capturing = true;
    const previous = this.renderer.getPixelRatio();
    try {
      const ratio = Math.min(previous * scale, 4096 / this.canvas.clientWidth, 2160 / this.canvas.clientHeight);
      this.capturePixelRatio = ratio; this.resize(); this.frame(0);
      const blob = await new Promise((resolve, reject) => this.canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image capture failed')), 'image/png'));
      const image = { blob, width: this.canvas.width, height: this.canvas.height };
      return image;
    } finally {
      this.capturing = false; this.capturePixelRatio = null;
      if (!this.disposed) { this.renderer.setPixelRatio(previous); this.resize(); }
    }
  }
  visitSolarSystem() {
    this.walker.exit();
    const home = generateSolarSystem();
    const earth = home.bodies.find(body => body.name === 'Earth');
    const direction = relative(home.star.position, earth.position);
    const offset = new THREE.Vector3(direction.x, direction.y, direction.z).normalize().multiplyScalar(earth.radius * 2.8);
    offset.y += earth.radius * .4;
    this.flight.clear(); this.flight.position = translate(earth.position, offset);
    this.select(earth); this.stream.discover(this.flight.position, earth.id);
  }
  select(body) { this.walker.exit(); this.target = body; this.flight.approaching = null; this.flight.aim(body); this.nextDiscovery = 0; }
  approach() { this.walker.exit(); if (this.target) this.flight.approaching = this.target; }
  teleport(body) {
    if (!body || this.disposed) return;
    this.walker.exit();
    const v = relative(this.flight.position, body.position);
    const offset = new THREE.Vector3(v.x, v.y, v.z);
    if (!offset.lengthSq()) offset.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
    offset.normalize().multiplyScalar(body.radius * (body.type === 'star' ? 5 : 2.8));
    this.flight.clear();
    this.flight.position = translate(body.position, offset);
    this.flight.limited = this.flight.blocked = this.flight.coordinateLimited = false;
    this.select(body);
    this.stream.discover(this.flight.position, body.id);
    this.nextLoad = this.nextHud = 0;
  }
  pause() { this.running = false; this.flight.clear(); this.walker.clear(); this.renderer.setAnimationLoop(null); }
  pick(event) {
    const direction = new THREE.Vector3();
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const rect = this.canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
        1 - (event.clientY - rect.top) / rect.height * 2);
      this.camera.updateMatrixWorld();
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, this.camera);
      direction.copy(raycaster.ray.direction);
    } else this.camera.getWorldDirection(direction);
    let best = null, nearest = Infinity;
    const tolerance = 6 * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / this.canvas.clientHeight;
    for (const system of this.stream.systems) for (const body of system.bodies) {
      const v = relative(body.position, this.flight.position);
      const vector = new THREE.Vector3(v.x, v.y, v.z);
      const distance = vector.length();
      vector.normalize();
      const alignment = vector.dot(direction);
      const angle = Math.max(Math.asin(Math.min(1, body.radius / distance)), tolerance);
      const near = distance - body.radius;
      if (alignment > Math.cos(angle) && near < nearest) { nearest = near; best = body; }
    }
    if (best) { this.target = best; this.nextDiscovery = 0; }
    return best;
  }
  frame(forcedDelta) {
    if (!this.running || this.disposed) return;
    const now = performance.now();
    const dt = forcedDelta ?? this.clock.getDelta();
    const bodies = this.stream.systems.flatMap(system => system.bodies);
    if (!document.hidden && !this.capturing) {
      if (this.walker.active) {
        const previous = this.flight.position;
        this.walker.step(this.photo ? 0 : dt);
        const planet = this.walker.planet;
        this.flight.position = translate(this.walkBody.position, this.walker.localPosition.clone().multiplyScalar(this.walkBody.radius / planet.params.radius));
        this.flight.actualSpeed = dt > 0 ? length(relative(this.flight.position, previous)) / dt : 0;
        this.camera.position.set(0, 0, 0);
      } else this.flight.step(dt, bodies);
    }
    if (now >= this.nextDiscovery) {
      this.stream.discover(this.flight.position, this.target?.id);
      this.nextDiscovery = now + 500;
    }
    if (now >= this.nextLoad) { this.stream.tick(); this.nextLoad = now + 100; }
    for (const { body, resource } of this.stream.entries.values()) {
      const v = relative(body.position, this.flight.position);
      resource.position.set(v.x, v.y, v.z);
      // Sub-pixel bodies remain discoverable through the navigation catalogue.
      // Avoid full star passes across the whole screen for invisible distant suns.
      resource.visible = body.radius / Math.max(1, length(v)) > 0.00002;
    }
    this.renderer.render(this.scene, this.camera);
    this.planets.render(this.scene, this.camera, { delta: this.photo || this.capturing ? 0 : Math.min(dt, 0.05) });
    if (now >= this.nextHud) {
      const targetVector = this.target && relative(this.target.position, this.flight.position);
      let marker = null;
      if (targetVector) {
        const v = new THREE.Vector3(targetVector.x, targetVector.y, targetVector.z);
        const view = v.clone().applyQuaternion(this.camera.quaternion.clone().invert());
        if (view.z < 0) {
          v.project(this.camera);
          if (Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95) marker = { x: (v.x + 1) * 50, y: (1 - v.y) * 50 };
        }
      }
      this.callbacks.onHud?.({
        walking: this.walker.active,
        coordinateLimited: this.flight.coordinateLimited, speed: this.flight.actualSpeed, limited: this.flight.limited, blocked: this.flight.blocked, position: this.flight.position,
        systems: this.stream.systems, loaded: this.stream.entries.size, queued: this.stream.queue.length,
        pending: this.planets.pending, target: this.target,
        distance: targetVector ? Math.max(0, length(targetVector) - this.target.radius) : 0,
        approaching: !!this.flight.approaching, marker,
      });
      this.nextHud = now + 150;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.unbind();
    this.walker.dispose();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.stream.dispose();
    this.planets.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
