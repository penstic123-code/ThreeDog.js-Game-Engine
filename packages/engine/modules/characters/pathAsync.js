// engine.characters.findPathAsync: many paths off the main thread, answered on a fixed step (part of the characters module).
// Requests queue up; each fixed step at most pathsPerStep of them leave as one batch (counted in requests, not milliseconds, so the result never depends on machine speed).
// A batch runs in an engine.threads lane (pathWorker.js) and lands PATH_LAG steps later through engine.commits; late or no workers -> the same
// solveBatch runs here at the due step. The batch is tagged with the walkable state it was computed on (navmesh revision or collision version);
// if that changed before it lands, it is recomputed here on the current state, so threads on / off / slow / crashed give identical paths.
// A request belongs to the world it was asked in, like any background result: one still queued when a save load, new game or level change
// invalidates engine.commits is dropped (its done never runs), the same as a batch already sent.
import { xzOf } from '../../core/math.js';
import { solveBatch, pathHandler, astarDefaults, RES, TILE, tileOf } from './pathJob.js';
import { codedError } from '../../core/errorHints.js';

/** Steps between sending a batch and its answers taking effect (4 = 67 ms): enough for a worker round trip, short enough that an NPC barely waits */
const PATH_LAG = 4;
/** A cached ground raster tile is reused for this many fixed steps (5 s), then sampled again: streamed terrain may have added trees meanwhile */
const TILE_TTL = 300;
const NO_DONE = 'characters.findPathAsync(from, to, done): done must be a function (path, status) => { ... }; it runs on a fixed step when the path is ready';

/** @internal */
export class AsyncPaths {
  constructor(e) {
    this.e = e;
    this.queue = [];
    this.perStep = 32;
    this.lane = null;
    this.sent = { rev: -1, ver: -1 };   // what the workers mirror
    this.tiles = new Map();             // 'tx:tz' -> { data, trees, at }
  }
  request(from, to, done, o = {}) {
    if (typeof done !== 'function') throw codedError('character-option', NO_DONE);
    const [sx, sz] = xzOf(from), [gx, gz] = xzOf(to);
    const h = { sx, sz, gx, gz, o, done, epoch: this.e.commits.epoch, canceled: false, remove() { h.canceled = true; } };
    this.queue.push(h);
    return h;
  }
  /** Which walkable state answers now: navmesh revision, collision version, or nothing */
  key() { const e = this.e; return e.nav?.ready ? 'n' + e.nav.revision : e.collision ? 'g' + e.collision.version : '-'; }
  /** End of each fixed step: send up to perStep queued requests as one batch */
  flush() {
    const list = [];
    const epoch = this.e.commits.epoch;
    while (this.queue.length && list.length < this.perStep) { const h = this.queue.shift(); if (!h.canceled && h.epoch === epoch) list.push(h); }
    if (!list.length) return;
    const e = this.e, T = e.threads, batch = this.build(list);
    const t = e.commits.request({ lag: PATH_LAG, fallback: () => null, apply: r => this.land(batch, list, r) });
    if (!T.size || batch.key === '-') return;
    this.mirror(batch.key);
    this.lane.run(batch).then(r => t.resolve(r), () => {});   // a failed run is ignored: land() computes the same answer here
  }
  /** Plain-data batch: everything the solver needs that the worker does not mirror */
  build(list) {
    const e = this.e, key = this.key(), mode = key[0] === 'n' ? 'nav' : key[0] === 'g' ? 'grid' : 'none', tiles = {}, trees = [], seen = new Set();
    const take = (tk, tx, tz) => {
      if (tiles[tk]) return;
      const c = this.tile(tk, tx, tz); tiles[tk] = c.data;
      for (let i = 0; i < c.trees.length; i += 3) { const id = c.trees[i] + ',' + c.trees[i + 1]; if (!seen.has(id)) { seen.add(id); trees.push(c.trees[i], c.trees[i + 1], c.trees[i + 2]); } }
    };
    const reqs = list.map(({ sx, sz, gx, gz, o }) => {
      if (mode === 'nav') return { mode, s: { x: sx, y: e.surface(sx, sz), z: sz }, g: { x: gx, y: e.surface(gx, gz), z: gz }, reach: e.nav.reach(o.radius) };
      if (mode === 'none') return { mode };
      const radius = o.radius ?? e.movement.radius, dflt = astarDefaults(radius), step = o.step ?? dflt.step, maxNodes = o.maxNodes ?? dflt.maxNodes;
      // A* may wander this far beyond the start-goal box; bounded by how far maxNodes cells can reach
      const m = Math.min(step * Math.sqrt(maxNodes / Math.PI), 16 + Math.hypot(gx - sx, gz - sz) / 2);
      for (let tx = tileOf(Math.min(sx, gx) - m); tx <= tileOf(Math.max(sx, gx) + m); tx++)
        for (let tz = tileOf(Math.min(sz, gz) - m); tz <= tileOf(Math.max(sz, gz) + m); tz++) take(tx + ':' + tz, tx, tz);
      return { mode, s: { x: sx, z: sz }, g: { x: gx, z: gz }, radius, step, maxNodes, navPending: !!e.nav };
    });
    return { type: 'batch', key, reqs, tiles, trees };
  }
  /**
   * One tile of the ground, sampled here (height / water / slope and terrain trees are main-thread functions) and cached for TILE_TTL steps:
   * data = ground shape raster, trees = [x, z, r, ...] of the ground's colliders around the tile
   */
  tile(k, tx, tz) {
    const e = this.e, c = this.tiles.get(k);
    const bv = e.collision.blockedVersion;
    if (c && c.bv === bv && e.tick - c.at < TILE_TTL) return c;
    const data = new Uint8Array(TILE * TILE), col = e.collision, trees = [], span = TILE * RES, blocked = col._blocked.length > 0;
    // addBlocked fields are functions and cannot go to a worker: they are sampled into this same raster (the worker sees blocked cells as unwalkable).
    // A cell counts as blocked if fn is true at its centre or on a ring of half a cell (blockedAt), so a 1 m cell never hides a thin river; bounds skip the sampling outside.
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const x = (tx * TILE + i) * RES, z = (tz * TILE + j) * RES;
      data[j * TILE + i] = col.groundWalkable(x, z) && !(blocked && col.blockedAt(x, z, RES / 2)) ? 1 : 0;
    }
    // every collider that can touch a point of the tile: half diagonal + the largest character radius we expect + 1 (the same reach walkableAt uses)
    e.ground.forEachCollider?.((tx + 0.5) * span, (tz + 0.5) * span, span * 0.71 + 3, (x, z, r) => { trees.push(x, z, r); });
    const v = { data, trees, at: e.tick, bv };
    this.tiles.set(k, v);
    if (this.tiles.size > 4096) for (const [kk, o] of this.tiles) if (e.tick - o.at >= TILE_TTL) this.tiles.delete(kk);
    return v;
  }
  /** Forget cached tiles overlapping a world box (ground:change) */
  dropTiles({ x0, z0, x1, z1 }) {
    const span = TILE * RES;
    for (const [k, v] of this.tiles) {
      const [tx, tz] = k.split(':').map(Number);
      if ((tx + 1) * span + 3 >= x0 && tx * span - 3 <= x1 && (tz + 1) * span + 3 >= z0 && tz * span - 3 <= z1) this.tiles.delete(k);
    }
  }
  /** Bring the workers' mirror up to the state this batch is tagged with (broadcasts arrive before the batch: one message queue per worker) */
  mirror(key) {
    const e = this.e;
    this.lane ??= e.threads.lane({ create: () => new Worker(new URL('./pathWorker.js', import.meta.url), { type: 'module' }), local: pathHandler });
    if (key[0] === 'n' && this.sent.rev !== e.nav.revision) { this.sent.rev = e.nav.revision; this.lane.broadcast({ type: 'mesh', data: e.nav.exportMesh() }, 'mesh'); }
    if (key[0] === 'g' && this.sent.ver !== e.collision.version) {
      this.sent.ver = e.collision.version;
      const items = [];
      e.collision.forEachStatic((type, o) => items.push(type === 'box' ? { x: o.x, z: o.z, r: o.r, c: o.c, s: o.s, hw: o.hw, hd: o.hd, box: true } : { x: o.x, z: o.z, r: o.r, box: false }));
      this.lane.broadcast({ type: 'colliders', items }, 'colliders');
    }
  }
  /** Due step: worker answer if it arrived and the walkable state is unchanged, else the same solver here on the current state */
  land(batch, list, r) {
    const e = this.e, key = this.key();
    if (!r || key !== batch.key) r = solveBatch(key === batch.key ? batch : this.build(list), { query: e.nav?.query, grid: e.collision?.grid });
    list.forEach((h, i) => { if (!h.canceled) h.done(r[i].path, r[i].status); });
  }
}
