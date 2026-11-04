// Vegetation on any ground (no terrain module): a level model, a code-built ground, the flat default. Chunks of the same shape as the terrain's
// ({ cx, cz, state, plants, colliders, ring, inView, ... }), streamed around every engine.stream source, placed by the same rule code
// (core/scatter.js) over engine.surface / slope / groundType -- whoever provides the ground. Data only: the vegetation drawing draws c.plants.
//
// Why the main thread and not a worker: a ground provider is arbitrary main-thread code (a level heightfield, a game's closure), not
// serializable data like a terrain generator. Placement is cheap (a few height lookups per attempt) and runs under a per-frame budget.
// Collision circles take effect at the tick engine.commits sets (lag by ring, built on the spot if still pending): machine speed never
// changes whether the player bumps into a tree, the same contract as terrain chunks.
// The ground changing (setGround, a level loaded or switched: ground.staticVersion) rebuilds every chunk.
import * as THREE from 'three';
import { makePlacer, makeNoise } from '../../core/scatter.js';
import { xzOf } from '../../core/math.js';
import { ChunkStream } from '../../core/chunkStream.js';

const COLLIDER_LAG = 30;   // fixed steps before a chunk's tree collision counts, times (1 + ring); ring 1 counts at once while loading

export class GroundChunks {
  /** opts: chunkSize (m), viewChunks (rings drawn), density, area { min: [x, z], max: [x, z] } or null (a level's walkable bounds when a level provides the ground, else unbounded), seed */
  constructor(engine, veg, { chunkSize = 32, viewChunks = 3, density = 1, area = null, seed = 1 } = {}) {
    this.engine = engine; this.veg = veg;
    this.chunkSize = chunkSize; this.viewChunks = viewChunks; this.density = density; this.area = area; this.seed = seed;
    this.chunks = new Map();
    this.applyBudgetMs = 3;    // max ms per frame spent placing and uploading chunks once playing (loading builds ring 1 at once)
    this.gen = 0;
    this.stats = { loaded: 0, visible: 0, instances: 0, queued: 0 };
    this._want = []; this._ground = null; this._groundVer = undefined;
    // which chunks the sources need, ring, culling: the same helper as the terrain chunks (core/chunkStream.js), so both rings mean the same
    this._stream = new ChunkStream(this, { show: (c, v) => this.veg._emit('show', c, v), level: (c, ring) => this._setLevel(c, ring),
      count: (c, ring) => { let n = 0; for (const k in c.plants) { const sp = this.veg.get(k); if (sp && ring <= sp.maxRing) n += c.plants[k].n; } return n; },
      inArea: (cx, cz) => this._inArea(cx, cz) });
    const e = engine, { fbm } = makeNoise(seed);
    this._place = makePlacer({ chunk: chunkSize, seed, fbm,
      surface: (x, z) => e.surface(x, z), slope: (x, z) => e.slope(x, z), typeAt: (x, z) => e.groundType(x, z) });
  }

  get CHUNK() { return this.chunkSize; }
  /**
   * @internal vegetation plumbing: a species was added or defined again. Only its plants are placed again on the loaded chunks; the other
   * species and their collision stay (dropping every chunk left the whole map without trees and tree collision until rebuilt)
   */
  registerSpecies(name) {
    const sp = this.veg.get(name);
    if (!sp) return;
    for (const c of this.chunks.values()) {
      if (c.state !== 'ready') continue;
      if (!sp.nearOnly || this._ring(c) <= sp.maxRing) { this._grow(c, sp); this._bound(c); }
      else this.veg.unmount(c, name);   // a redefined near-only species outside its ring: the next ring change places it again
    }
  }
  /** @internal vegetation / settings plumbing */
  refreshLevels() { for (const c of this.chunks.values()) c.level = -1; }
  /** Rings of chunks drawn around each stream source (the settings page's view distance); the next update loads / releases chunks to match */
  setViewChunks(n) { this.viewChunks = n; this.refreshLevels(); }
  /** Drop every chunk; they are placed again around the stream sources (call it after changing the ground behind the same provider) */
  rebuild() {
    this._stream.drop();
    this.gen++;
  }
  /**
   * Vegetation density multiplier: the loaded chunks are placed again in place, each species replacing its own plants and collision circles,
   * so trees never go missing in between (dropping the chunks left them without collision until rebuilt)
   */
  setDensity(d) {
    this.density = d;
    for (const c of this.chunks.values()) if (c.state === 'ready') for (const sp of this.veg.list()) if (!sp.nearOnly || c.plants[sp.name]) this._grow(c, sp);
  }

  _inArea(cx, cz) {
    // no area given: a level that provides the ground bounds it (its walkable meshes), so plants never grow past the model's edge onto the
    // flat fallback ground around it; with no level (setGround / flat default) the ground is unbounded and so is the vegetation
    const b = this.area ? null : this.engine.level?.heightfield?.bounds;
    const a = this.area ?? (b && !b.isEmpty() ? { min: [b.min.x, b.min.z], max: [b.max.x, b.max.z] } : null);
    if (!a) return true;
    const CH = this.chunkSize;
    return (cx + 1) * CH > a.min[0] && cx * CH < a.max[0] && (cz + 1) * CH > a.min[1] && cz * CH < a.max[1];
  }
  _ring(c) { return this._stream.ring(c); }

  /** @internal module frame hook: follow the ground, queue / release chunks around the sources, build within budget, LOD and culling */
  update(sources, camera) {
    const e = this.engine, G = e.ground, ver = G.staticVersion?.();
    if (G !== this._ground || ver !== this._groundVer) { this._ground = G; this._groundVer = ver; this.rebuild(); }
    this._stream.follow(sources, this.chunkSize, this.viewChunks);   // queue what a source needs, release what is far from all
    const t0 = performance.now(), loading = !e.ready;   // measure: placement budget
    while (this._want.length) {
      const c = this._want[0];
      if (c.state !== 'queued' || this.chunks.get(c.key) !== c) { this._want.shift(); continue; }
      if (performance.now() - t0 >= this.applyBudgetMs && !(loading && this._ring(c) <= 1)) break;   // measure
      this._want.shift(); this._build(c);
    }
    this.stats.queued = this._want.length;
    const { visible, instances } = this._stream.cull(camera);
    const st = this.stats; st.loaded = this.chunks.size; st.visible = visible; st.instances = instances;
  }

  _queue(cx, cz, key) {
    const c = { cx, cz, key, state: 'queued', plants: {}, colliders: {}, collidersAll: {}, inView: true, level: -1, sphere: null, solid: false, gen: this.gen };
    this.chunks.set(key, c);
    c.ticket = this.engine.commits.request({
      lag: !this.engine.ready && this._ring(c) <= 1 ? 0 : COLLIDER_LAG * (1 + this._ring(c)),
      apply: () => { c.solid = true; },
      fallback: () => { if (c.state !== 'ready') this._build(c); return true; },   // due before the budget got to it: place it now, same result
      valid: () => this.chunks.get(c.key) === c && c.gen === this.gen,
    });
    return c;
  }

  // place every species that this ring shows (near-only ones only within their ring)
  _build(c) {
    const CH = this.chunkSize;
    c.state = 'ready'; c.lo = Infinity; c.hi = -Infinity;
    const ring = this._ring(c);
    for (const sp of this.veg.list()) if (!sp.nearOnly || ring <= sp.maxRing) this._grow(c, sp);
    if (c.lo > c.hi) { c.lo = c.hi = this.engine.surface(c.cx * CH + CH / 2, c.cz * CH + CH / 2); }
    this._bound(c);
  }
  // culling sphere around the plants placed so far (a species added later can raise the top)
  _bound(c) {
    const CH = this.chunkSize;
    c.sphere ??= new THREE.Sphere();
    c.sphere.center.set(c.cx * CH + CH / 2, (c.lo + c.hi) / 2 + 3, c.cz * CH + CH / 2);
    c.sphere.radius = Math.hypot(CH / 2, CH / 2, (c.hi - c.lo) / 2 + 8);
  }
  _grow(c, sp) {
    const r = this._place(c.cx, c.cz, sp.rule, this.density);
    for (let i = 0; i < r.n; i++) { const y = r.m[i * 16 + 13]; if (y < c.lo) c.lo = y; if (y > c.hi) c.hi = y; }
    this.veg.mount(c, sp.name, r);
  }

  _setLevel(c, ring) {
    if (c.level === ring) return;
    c.level = ring;
    for (const sp of this.veg.list()) {
      if (!sp.nearOnly) continue;
      const has = !!c.plants[sp.name];
      if (ring <= sp.maxRing && !has) this._grow(c, sp);
      else if (ring > sp.maxRing + 1 && has) this.veg.unmount(c, sp.name);
    }
    this.veg.ring(c, ring);
  }

  _dispose(c) {
    if (c.state === 'ready') this.veg.drop(c);
  }
  dispose() { this.rebuild(); }

  /** @internal Collision circles of solid chunks near (x, z): fn(x, z, r). Joined into engine.ground.forEachCollider (collision, path planning) */
  forEachCollider(x, z, range, fn) {
    const CH = this.chunkSize;
    for (let cz = Math.floor((z - range) / CH); cz <= Math.floor((z + range) / CH); cz++)
      for (let cx = Math.floor((x - range) / CH); cx <= Math.floor((x + range) / CH); cx++) {
        const c = this.chunks.get(cx + ',' + cz);
        if (!c?.solid) continue;
        for (const n in c.colliders) {
          const k = c.colliders[n];
          for (let i = 0; i < k.length; i += 3) { const dx = k[i] - x, dz = k[i + 1] - z, rr = range + k[i + 2]; if (dx * dx + dz * dz < rr * rr) fn(k[i], k[i + 1], k[i + 2]); }
        }
      }
  }

  /** Whether chunks within `rings` (default 1) of a position are placed (loading screen / stream ready check) */
  isReadyAround(position, { rings = 1 } = {}) {
    const [x, z] = xzOf(position), CH = this.chunkSize, pcx = Math.floor(x / CH), pcz = Math.floor(z / CH);
    for (let dz = -rings; dz <= rings; dz++) for (let dx = -rings; dx <= rings; dx++) {
      if (!this._inArea(pcx + dx, pcz + dz)) continue;
      const c = this.chunks.get((pcx + dx) + ',' + (pcz + dz));
      if (!c || c.state !== 'ready') return false;
    }
    return true;
  }
}
