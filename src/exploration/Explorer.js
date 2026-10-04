import * as THREE from 'three';
import { Planet, PlanetRenderer } from 'procedural-planets';
import { Flight, bindFlightInput } from './flight.js';
import { SystemStream } from './streaming.js';
import { generateSystem, length, relative, translate } from './world.js';

export class Explorer {
  constructor(canvas, seed, callbacks = {}) {
    this.callbacks = callbacks;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor('#02040a');
    this.planets = new PlanetRenderer(this.renderer, { impostorUpdates: 1, impostorAtlasSize: 1024, impostorRefresh: 2 });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.0001, 1e15);
    const home = generateSystem(seed, { x: 0, y: 0, z: 0 });
    const first = home.bodies[1];
    const sunward = relative(home.star.position, first.position);
    const offset = new THREE.Vector3(sunward.x, sunward.y, sunward.z).normalize().multiplyScalar(first.radius * 2.8);
    offset.y += first.radius * 0.4;
    this.flight = new Flight(translate(first.position, offset), this.camera);
    this.flight.aim(first);
    this.target = first;
    this.stream = new SystemStream(seed, {
      create: (body, system, entries) => {
        // Keep shader dimensions in the package's comfortable local range;
        // uniform Object3D scale supplies the physical radius in kilometres.
        const planet = new Planet({
          type: body.type, preset: body.preset, name: body.name, seed: body.seed, radius: 2000,
          chunkRes: 32, maxDepth: 9, splitFactor: 12, octaves: 5, cloudQuality: 24, cloudResolution: 0.5,
          atmoHeight: Math.min(0.03, 100 / body.radius),
          cloudAltitude: 4 / body.radius, cloudThickness: 8 / body.radius,
          ambient: 0.04,
          // At physical relief (a few km rather than a stylised 4% of radius),
          // keep ocean clarity shallow and ripples below kilometre scales.
          waterClarity: 0.005, waveSize: 0.01,
          ...body.params,
          lightSource: entries.get(system.star.id)?.resource ?? null,
        });
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
    this.unbind = bindFlightInput(canvas, this.flight, {
      onLock: callbacks.onLock, onSpeed: callbacks.onSpeed, onError: callbacks.onError,
      onPick: () => this.pick(),
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
    this.resize();
    this.renderer.setAnimationLoop(() => {
      try { this.frame(); } catch (error) { this.pause(); callbacks.onError?.(error.message); }
    });
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  select(body) { this.target = body; this.flight.approaching = null; this.flight.aim(body); this.nextDiscovery = 0; }
  approach() { if (this.target) this.flight.approaching = this.target; }
  pause() { this.running = false; this.flight.clear(); this.renderer.setAnimationLoop(null); }
  pick() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    let best = null, dot = 0.995;
    for (const system of this.stream.systems) for (const body of system.bodies) {
      const v = relative(body.position, this.flight.position);
      const vector = new THREE.Vector3(v.x, v.y, v.z).normalize();
      const alignment = vector.dot(direction);
      if (alignment > dot) { dot = alignment; best = body; }
    }
    if (best) { this.target = best; this.nextDiscovery = 0; }
  }
  frame() {
    if (!this.running || this.disposed) return;
    const now = performance.now();
    const dt = this.clock.getDelta();
    const bodies = this.stream.systems.flatMap(system => system.bodies);
    if (!document.hidden) this.flight.step(dt, bodies);
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
    this.planets.render(this.scene, this.camera, { delta: Math.min(dt, 0.05) });
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
        speed: this.flight.actualSpeed, limited: this.flight.limited, blocked: this.flight.blocked, position: this.flight.position,
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
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.stream.dispose();
    this.planets.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
