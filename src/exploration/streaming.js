import { desiredBodies, nearbySystems } from './world.js';

// Descriptor discovery is independent of GPU allocation. Reconcile a bounded
// set; create at most one body per tick and discard obsolete work before creation.
export class SystemStream {
  constructor(seed, { create, release }) {
    this.seed = seed;
    this.create = create;
    this.release = release;
    this.systems = [];
    this.entries = new Map();
    this.queue = [];
    this.disposed = false;
  }
  discover(player, target = null) {
    if (this.disposed) return;
    this.systems = nearbySystems(this.seed, player);
    const desired = desiredBodies(this.systems, player, target);
    const ids = new Set(desired.map(entry => entry.body.id));
    for (const [id, entry] of this.entries) {
      if (!ids.has(id)) { this.release(entry.resource); this.entries.delete(id); }
    }
    this.queue = desired.filter(entry => !this.entries.has(entry.body.id))
      .sort((a, b) => Number(b.body.type === 'star') - Number(a.body.type === 'star') || a.distance - b.distance);
  }
  tick() {
    if (this.disposed || !this.queue.length) return;
    const entry = this.queue.shift();
    const resource = this.create(entry.body, entry.system, this.entries);
    this.entries.set(entry.body.id, { ...entry, resource });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    for (const entry of this.entries.values()) this.release(entry.resource);
    this.entries.clear();
    this.systems.length = 0;
  }
}
