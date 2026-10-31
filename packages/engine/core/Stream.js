// Spatial stream-in, engine.stream: entries are only registered, not built at once; build is called only near a full-detail load source (engine.load: the player, the camera focus, a teleport destination)
// and the result unloads when far from all of them. Ten thousand entries build only the nearby ones.
//   const h = engine.stream.add({ position: [40, 0, -20], radius: 8, build: () => makeHouse() });   // the object build returns is added to the scene automatically
//   engine.stream.setRange(200);   // how far from each load source to build (meters); defaults to the terrain view distance, or the fog distance engine.fogFar without terrain
//   h.remove();                    // no longer needed (a built one is unloaded)
// build runs in engine.jobs spread over frames (nearest first); when build returns an object synchronously it is attached to the scene on the spot inside that job (built / ready are already correct when engine.step returns),
// and a returned Promise is awaited before attaching. Unloads only beyond range x unloadFactor (walking back and forth does not rebuild); keep: true never unloads.
// At startup start() waits for everything registered within range to finish building before the loading screen goes away. The grid cell size cellSize is shared with hlod: cellKey(x, z).
/** @import { StreamEntryOptions, StreamHandle } from '../types/core' */
import { checkOptions } from './validate.js';
import { xzOf } from './math.js';
import { reportError } from './errors.js';

const KEYS = ['position', 'radius', 'build', 'dispose', 'keep', 'priority'];
const FULL = { detail: 'full' };

/** engine.stream builds on demand by space: only entries near the focus get built. */
export class Stream {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** Build range in meters around each full-detail load source (a source radius caps it); null = follow the terrain view distance (the fog distance engine.fogFar without terrain) @type {number | null} */
    this.range = null;
    /** Grid cell edge in meters, shared with hlod, default 64 */
    this.cellSize = 64;
    /** Unload only beyond range x this (walking back and forth does not rebuild), default 1.25 */
    this.unloadFactor = 1.25;
    /** @internal */ this.entries = new Set();
    /** @internal 'cx,cz' -> Set<handle> */ this.cells = new Map();
    /** @internal Handles that are built or queued */ this.live = new Set();
    /** @internal Number of queued builds */ this.queued = 0;
    /** @internal */ this._cs = this.cellSize;
    /** @internal Largest radius among entries (recomputed when the largest is removed) */ this._maxRadius = 0;
    /** @internal */ this._radiusDirty = false;
    /** @internal what engine.load looked like at the last check */ this._memo = {};
    /** @internal */ this._dirty = true;
    engine.load.readyCheck('stream', s => s.detail !== 'full' || this.ready);
  }
  /** The build range actually in use, in meters @returns {number} */
  get activeRange() {
    return this.range ?? this.engine.ground.viewRange?.() ?? this.engine.fogFar;   // the ground's view range (terrain sets it), else the fog distance
  }
  /** Key 'cx,cz' of the cell containing (x, z) (hlod and others share the same grid) @param {number} x @param {number} z @returns {string} */
  cellKey(x, z) { return Math.floor(x / this.cellSize) + ',' + Math.floor(z / this.cellSize); }

  /**
   * Register something to stream in (not built at once); an object returned by build with no parent is added to the scene automatically.
   * @param {StreamEntryOptions} def
   * @returns {StreamHandle}
   * @example engine.stream.add({ position: [40, 0, 12], radius: 6, build: () => makeHouse() });
   */
  add(def) {
    checkOptions('stream.add()', def, KEYS);
    const [x, z] = xzOf(def.position);
    /** @type {any} */
    const h = { def, x, z, object: null, built: false, want: false, cell: null, remove: () => this._remove(h) };
    this.entries.add(h);
    this._insert(h);
    this._maxRadius = Math.max(this._maxRadius, def.radius ?? 0);
    this._dirty = true;
    return h;
  }
  /** @internal Clear all entries (called by engine.dispose; built objects are released with the scene) */
  dispose() { this.entries.clear(); this.cells.clear(); this.live.clear(); this.queued = 0; }
  /** Set the build range in meters @param {number} m */
  setRange(m) { this.range = m; this._dirty = true; }
  /** Everything registered within range is built (start() waits for it before the loading screen goes away) @returns {boolean} */
  get ready() { return this.queued === 0; }
  /** entries is the registered count, built the built count, queued the queued count @returns {{ entries: number, built: number, queued: number }} */
  get stats() { return { entries: this.entries.size, built: this.live.size - this.queued, queued: this.queued }; }

  /** @internal */
  _insert(h) {
    h.cell = this.cellKey(h.x, h.z);
    let s = this.cells.get(h.cell); if (!s) this.cells.set(h.cell, s = new Set());
    s.add(h);
  }
  /** @internal */
  _remove(h) {
    if (!this.entries.delete(h)) return;
    this.cells.get(h.cell)?.delete(h);
    if ((h.def.radius ?? 0) >= this._maxRadius) this._radiusDirty = true;
    this._unload(h);
  }

  /** Called by the engine each frame (after the frame hooks, before jobs). Skips re-checking while no load source moved more than 1/8 of a cell. */
  update() {
    if (this._cs !== this.cellSize) { this._cs = this.cellSize; this.cells.clear(); for (const h of this.entries) this._insert(h); this._dirty = true; }
    if (!this.entries.size) return;
    if (this._radiusDirty) {
      this._radiusDirty = false; this._maxRadius = 0;
      for (const h of this.entries) this._maxRadius = Math.max(this._maxRadius, h.def.radius ?? 0);
    }
    const L = this.engine.load, cs = this.cellSize;
    if (!L.changed(this._memo, cs / 8, FULL) && !this._dirty) return;
    this._dirty = false;
    // full-detail sources only: a 'simple' source (far view) gets terrain and hlod proxies, not props
    const src = L.list(FULL), R = this.activeRange;
    // distance past each source's reach, shifted so it compares against R (a source radius below R shrinks its reach)
    const dist = h => { let d = Infinity; for (const s of src) d = Math.min(d, Math.hypot(h.x - s.x, h.z - s.z) - (h.def.radius ?? 0) - L.reach(s, R) + R); return d; };
    // unload what is far from every source
    for (const h of this.live) if (!h.def.keep && dist(h) > R * this.unloadFactor) this._unload(h);
    // build what is near: look only at cells within each source's reach
    for (const s of src) {
      const r = L.reach(s, R), n = Math.ceil((r + this._maxRadius) / cs), cx = Math.floor(s.x / cs), cz = Math.floor(s.z / cs);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const cell = this.cells.get((cx + i) + ',' + (cz + j)); if (!cell) continue;
        for (const h of cell) if (!h.want) { const d = dist(h); if (d < R) this._build(h, d / R); }
      }
    }
  }

  /** @internal */
  _build(h, near) {
    h.want = true;
    if (this.live.has(h)) return;   // still queued (was cancelled earlier, then came back in range)
    this.live.add(h); this.queued++;
    // a failed build is tried again the next time a load source moves (want goes back to false); reported once, the game goes on without it
    const fail = err => { this.queued--; this.live.delete(h); h.want = false; reportError(this.engine, err, 'stream build', { soft: true }); };
    this.engine.jobs.add(() => {
      if (!h.want || !this.entries.has(h)) return this._built(h, null);
      const r = h.def.build();
      if (r && typeof r.then === 'function') return r.then(obj => this._built(h, obj), fail);
      this._built(h, r);   // synchronous build: attach to the scene on the spot
    }, { priority: (h.def.priority ?? 0) - near }).catch(fail);
  }
  /** @internal Build finished (obj null means nothing was built): discard it if no longer wanted, otherwise attach to the scene */
  _built(h, obj) {
    this.queued--;
    if (!h.want || !this.entries.has(h)) { if (obj) this._dispose(h, obj); this.live.delete(h); return; }
    h.object = obj; h.built = true;
    if (obj && !obj.parent) this.engine.add(obj);
  }
  /** @internal */
  _unload(h) {
    h.want = false;
    if (!h.built) return;   // still queued: discard it when the build finishes and it is found unwanted
    const obj = h.object; h.object = null; h.built = false;
    this.live.delete(h);
    if (obj) this._dispose(h, obj);
  }
  /** @internal */
  _dispose(h, obj) { if (h.def.dispose) h.def.dispose(obj); else this.engine.remove(obj); }
}
