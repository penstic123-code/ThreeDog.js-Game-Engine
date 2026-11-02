// Spatial stream-in, engine.stream: entries are only registered, not built at once; build is called only near a full-detail stream source (the player, the
// camera focus, a teleport destination)
// and the result unloads when far from all of them. Ten thousand entries build only the nearby ones.
// const h = engine.stream.add({ position: [40, 0, -20], radius: 8, build: () => makeHouse() }); // the object build returns is added to the scene automatically
// engine.stream.setRadius(200); // how far from each stream source to build (meters); defaults to the terrain view distance, or the fog distance engine.fogFar
// without terrain
//   h.remove();                     // no longer needed (a built one is unloaded)
// Stream sources (stream.player, stream.camera, stream.source(...), stream.teleport(...)) are the one list every distance-based loader reads: stream entries,
// world models, terrain chunks, hlod and rigid colliders (the Source class is in streamSources.js).
// build runs in engine.jobs spread over frames (nearest first); when build returns an object synchronously it is attached to the scene on the spot inside that
// job (built / ready are already correct when engine.step returns),
// and a returned Promise is awaited before attaching. Unloads only beyond radius x unloadFactor (walking back and forth does not rebuild); keep: true never
// unloads.
// At startup start() waits for everything registered within radius to finish building before the loading screen goes away. The grid cell size cellSize is
// shared with hlod.
/** @import { StreamEntryOptions, StreamHandle, StreamSource, StreamSourceOptions } from '../types/core' */
import { readParams, keysSchema } from './params.js';
import { xzOf } from './math.js';
import { reportError } from './errors.js';
import { codedError } from './errorHints.js';
import { Source, SOURCE_KEYS, SOURCE_STRINGS } from './streamSources.js';

const KEYS = ['position', 'radius', 'build', 'dispose', 'keep', 'priority'];
const FULL = { detail: 'full' };

/** engine.stream builds on demand by space: only entries near the focus get built. */
export class Stream {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /**
     * Build radius in meters around each full-detail stream source (a source radius caps it); null = follow the terrain view distance (the fog distance
     * engine.fogFar without terrain) @type {number | null}
     */
    this.radius = null;
    /** Grid cell edge in meters, shared with hlod, default 64 */
    this.cellSize = 64;
    /** Unload only beyond radius x this (walking back and forth does not rebuild), default 1.25 */
    this.unloadFactor = 1.25;
    /** @internal */ this.entries = new Set();
    /** @internal 'cx,cz' -> Set<handle> */ this.cells = new Map();
    /** @internal Handles that are built or queued */ this.live = new Set();
    /** @internal Number of queued builds */ this.queued = 0;
    /** @internal */ this._cs = this.cellSize;
    /** @internal Largest radius among entries (recomputed when the largest is removed) */ this._maxRadius = 0;
    /** @internal */ this._radiusDirty = false;
    /** @internal what the sources looked like at the last check */ this._memo = {};
    /** @internal */ this._dirty = true;
    /** @internal */ this._sources = new Set();
    /** @internal Bumps when a source is added, removed or moved with at() */ this._version = 0;
    /** @internal name -> (source) => boolean */ this._checks = new Map();
    /** Built-in source at the gameplay anchor (world.anchor, else the player, else engine.focus): full detail and physics @type {StreamSource} */
    this.player = this.source(() => engine.player?.position ?? engine.focus, { name: 'player' });
    /** Built-in source at the camera focus engine.focus: full detail, no physics @type {StreamSource} */
    this.camera = this.source(engine.focus, { name: 'camera', physics: false });
    this.readyCheck('stream', s => s.detail !== 'full' || this.ready);
  }
  /** The build radius actually in use, in meters @returns {number} */
  get activeRadius() {
    return this.radius ?? this.engine.ground.viewRange?.() ?? this.engine.fogFar;   // the ground's view range (terrain sets it), else the fog distance
  }
  /** @internal Key 'cx,cz' of the cell containing (x, z) (hlod shares the same grid) @param {number} x @param {number} z @returns {string} */
  cellKey(x, z) { return Math.floor(x / this.cellSize) + ',' + Math.floor(z / this.cellSize); }

  /**
   * Register something to stream in (not built at once); an object returned by build with no parent is added to the scene automatically.
   * @param {StreamEntryOptions} def
   * @returns {StreamHandle}
   * @example engine.stream.add({ position: [40, 0, 12], radius: 6, build: () => makeHouse() });
   */
  add(def) {
    readParams('stream.add()', keysSchema(KEYS), def);
    const [x, z] = xzOf(def.position);
    /** @type {any} */
    const h = { def, x, z, object: null, built: false, want: false, cell: null, remove: () => this._remove(h) };
    this.entries.add(h);
    this._insert(h);
    this._maxRadius = Math.max(this._maxRadius, def.radius ?? 0);
    this._dirty = true;
    return h;
  }
  /** @internal Clear all entries and drop added sources (called by engine.dispose; built objects are released with the scene; the two built-in sources stay) */
  dispose() {
    this.entries.clear(); this.cells.clear(); this.live.clear(); this.queued = 0;
    for (const s of [...this._sources]) if (s !== this.player && s !== this.camera) s.remove();
    this._checks.clear();
  }
  /** Set the build radius in meters @param {number} m */
  setRadius(m) { this.radius = m; this._dirty = true; }
  /** Everything registered within radius is built (start() waits for it before the loading screen goes away) @returns {boolean} */
  get ready() { return this.queued === 0; }
  /** entries is the registered count, built the built count, queued the queued count @returns {{ entries: number, built: number, queued: number }} */
  get stats() { return { entries: this.entries.size, built: this.live.size - this.queued, queued: this.queued }; }

  /**
   * Add a stream source: the world around position is loaded (terrain chunks, colliders, nearby models, stream entries) until remove() or until.
   * position may be live (an Object3D or Vector3 that moves) or a function. detail 'simple' loads only terrain and hlod proxies (a far view);
   * physics defaults to true for 'full'; pass false for a camera that only needs a picture. radius caps every loader's range (default: each loader's own
   * range).
   * until: a Promise (removed when it settles) or a function checked every frame (removed when it returns true).
   * @example const dest = engine.stream.source([800, 0, 300], { radius: 64 }); await dest.whenReady; engine.player.placeAt([800, 0, 300]); dest.remove();
   * @example engine.stream.source(photoCam, { physics: false, until: () => !photoMode.active });   // follows a camera, no colliders
   * @param {any} position
   * @param {StreamSourceOptions} [opts]
   * @returns {StreamSource}
   * @experimental
   */
  source(position, opts = {}) {
    readParams('stream.source()', keysSchema(SOURCE_KEYS), opts);
    if (opts.detail != null && opts.detail !== 'full' && opts.detail !== 'simple') throw codedError('stream-option', SOURCE_STRINGS.detail.replace('{got}', JSON.stringify(opts.detail)));
    const s = new Source(this, position, opts);
    this._sources.add(s); this._version++;
    return /** @type {any} */ (s);
  }

  /**
   * Load the destination first, then move: resolves after the player (engine.focus without one) is placed. Until the destination is ready
   * (terrain chunks, collision, nearby models) the player stays where it is. move replaces the default placement (for a vehicle or a custom character).
   * timeout (seconds of frame time, default 60; Infinity waits forever): when the destination is still not ready, the Promise rejects (code stream-timeout,
   * naming the loaders still waiting) and the player is not moved.
   * @example await engine.stream.teleport([800, 0, 300]);
   * @example await engine.stream.teleport(door.target, { radius: 40, move: p => engine.player.placeAt(p) });
   * @param {any} position
   * @param {{ radius?: number, move?: (position: any) => void, timeout?: number }} [opts]
   * @returns {Promise<void>}
   * @experimental
   */
  async teleport(position, opts = {}) {
    readParams('stream.teleport()', keysSchema(['radius', 'move', 'timeout']), opts);
    const e = this.engine, s = this.source(position, { radius: opts.radius ?? 64, name: 'teleport' }), limit = opts.timeout ?? 60;
    let waited = 0;
    const watch = e.onFrame(dt => {
      if ((waited += dt) <= limit || s.ready) return;
      const checks = [...this._checks].filter(([, fn]) => !fn(s)).map(([n]) => n).join(', ') || 'one more frame';
      s._settle(codedError('stream-timeout', SOURCE_STRINGS.timeout.replace('{x}', s.x.toFixed(1)).replace('{z}', s.z.toFixed(1)).replace('{t}', String(limit)).replace('{checks}', checks)));
    });
    try {
      await s.whenReady;
      if (opts.move) opts.move(position);
      else if (e.player) e.player.placeAt(position);
      else { const [x, z] = xzOf(position); e.focus.set(x, e.surface(x, z), z); }
    } finally { watch.remove(); s.remove(); }   // the player (or camera) source covers the place from now on
  }

  /**
   * Register a readiness check for loaders: fn(source) returns whether this loader finished what that source asks for.
   * For module authors whose loader reads stream sources; games only read source.ready.
   * @example engine.stream.readyCheck('props', s => s.detail !== 'full' || props.queued === 0)
   * @param {string} name
   * @param {(source: StreamSource) => boolean} fn
   * @returns {{ remove(): void }}
   * @experimental
   */
  readyCheck(name, fn) { this._checks.set(name, fn); return { remove: () => { if (this._checks.get(name) === fn) this._checks.delete(name); } }; }

  /**
   * Sources with fresh positions, filtered: { detail: 'full' } for models and stream entries, { physics: true } for colliders, no filter for terrain
   * @param {{ detail?: 'full' | 'simple', physics?: boolean }} [pick]
   * @returns {StreamSource[]}
   * @experimental
   */
  sources(pick) {
    const out = [];
    for (const s of this._sources) {
      if (pick?.detail && s.detail !== pick.detail) continue;
      if (pick?.physics != null && s.physics !== pick.physics) continue;
      out.push(s.sync());
    }
    return /** @type {any} */ (out);
  }
  /**
   * @internal For loaders that skip work while nothing moves: true when the picked sources were added / removed or one moved more than eps since the last
   * marked call.
   * memo is the loader's own object; mark false only peeks (for a ready getter).
   */
  changed(memo, eps, pick, mark = true) {
    let diff = memo.v !== this._version || !memo.at, i = 0;
    if (!diff) for (const s of this._sources) {   // walks the sources in place: no array while nothing moved (every loader asks every frame)
      if ((pick?.detail && s.detail !== pick.detail) || (pick?.physics != null && s.physics !== pick.physics)) continue;
      const a = memo.at[i++]; s.sync();
      if (!a || (s.x - a.x) ** 2 + (s.z - a.z) ** 2 > eps * eps) { diff = true; break; }
    }
    if (!diff && i !== memo.at.length) diff = true;
    if (diff && mark) { memo.v = this._version; memo.at = this.sources(pick).map(s => ({ x: s.x, z: s.z, s })); }
    return diff;
  }

  /** @internal End of every frame (after loaders ran): until, readiness, whenReady. A source counts only after one full frame, so every loader has seen it. */
  _settle() {
    // snapshot because remove() / waiter callbacks change the set; the array is reused (this runs every frame), taken out while in use for re-entrancy
    const snap = this._snap || [];
    this._snap = null; snap.length = 0;
    for (const s of this._sources) snap.push(s);
    for (let i = 0; i < snap.length; i++) {
      const s = snap[i];
      if (typeof s.until === 'function' && s.until()) { s.remove(); continue; }
      if (s.age++ < 1) continue;
      s.sync();
      let ok = true;
      for (const fn of this._checks.values()) if (!fn(s)) { ok = false; break; }
      s._ready = ok;
      if (ok && s._waiters.length) s._settle(null);
    }
    snap.length = 0; this._snap = snap;
  }
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

  /** @internal Called by the engine each frame (after the frame hooks, before jobs). Skips re-checking while no stream source moved more than 1/8 of a cell. */
  _update() {
    if (this._cs !== this.cellSize) { this._cs = this.cellSize; this.cells.clear(); for (const h of this.entries) this._insert(h); this._dirty = true; }
    if (!this.entries.size) return;
    if (this._radiusDirty) {
      this._radiusDirty = false; this._maxRadius = 0;
      for (const h of this.entries) this._maxRadius = Math.max(this._maxRadius, h.def.radius ?? 0);
    }
    const cs = this.cellSize;
    if (!this.changed(this._memo, cs / 8, FULL) && !this._dirty) return;
    this._dirty = false;
    // full-detail sources only: a 'simple' source (far view) gets terrain and hlod proxies, not props
    const src = this.sources(FULL), R = this.activeRadius;
    // distance past each source's reach, shifted so it compares against R (a source radius below R shrinks its reach)
    const dist = h => { let d = Infinity; for (const s of src) d = Math.min(d, Math.hypot(h.x - s.x, h.z - s.z) - (h.def.radius ?? 0) - s.reach(R) + R); return d; };
    // unload what is far from every source
    for (const h of this.live) if (!h.def.keep && dist(h) > R * this.unloadFactor) this._unload(h);
    // build what is near: look only at cells within each source's reach
    for (const s of src) {
      const r = s.reach(R), n = Math.ceil((r + this._maxRadius) / cs), cx = Math.floor(s.x / cs), cz = Math.floor(s.z / cs);
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
    // a failed build is tried again the next time a stream source moves (want goes back to false); reported once, the game goes on without it
    const fail = err => { this.queued--; this.live.delete(h); h.want = false; reportError(this.engine, err, 'stream build', { soft: true }); };
    this.engine.jobs.add(() => {
      if (!h.want || !this.entries.has(h)) return this._built(h, null);
      const t0 = performance.now(), r = h.def.build();   // measure: the 'stream' stage of engine.budget.cost
      this.engine.budget.cost.end('stream', t0);
      if (r && typeof r.then === 'function') return r.then(obj => this._built(h, obj), fail);
      this._built(h, r);   // synchronous build: attach to the scene on the spot
    }, { priority: (h.def.priority ?? 0) - near }).catch(fail);
  }
  /** @internal Build finished (obj null means nothing was built): discard it if no longer wanted, otherwise attach to the scene */
  _built(h, obj) {
    this.queued--;
    if (!h.want || !this.entries.has(h)) { if (obj) this._dispose(h, obj); this.live.delete(h); return; }
    h.object = obj; h.built = true;
    if (obj && !obj.parent) this.engine.add(obj, { owner: 'stream' });
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
