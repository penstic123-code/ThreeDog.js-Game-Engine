// Presentation layer of world: build / tear down models by distance from the full-detail stream sources (engine.stream sources: player, camera focus, teleport
// destination...),
// sync positions, decide ready. The public API is in World.js (present / view / ready / refresh); this is the implementation.
// It only decides "which records have a model" and never affects gameplay: simulation follows the gameplay anchor (sim.js), and how fast models are built, or
// whether they are built, does not change simulation results.
import { reportError } from '../../core/errors.js';
import { DEV, checkOptionsArg, warnOnce } from '../../core/validate.js';

const STRINGS = {
  noBuild: 'world.present(\'{kind}\', { build }) needs build: rec => three.js object',
  nullBuild: 'build of world.present(\'{kind}\') returned {got} (record {id}): build must return a three.js object; to have no model for this record for now, write show: rec => false',
  failed: 'build of world.present(\'{kind}\')',
  disposeFailed: 'dispose(rec, obj) callback of world.present(\'{kind}\')',
  disposeArgs: 'dispose of world.present(\'{kind}\') declares only one parameter: the parameters are (rec, obj), record first and model second. Example: dispose: (rec, obj) => engine.remove(obj)',
  positionFrom: 'positionFrom of world.present(\'{kind}\') must be \'record\' (the model follows the record, default) or \'view\' (the model moves itself, the record follows the model)',
};
const say = (s, kind, id = '', got = '') => s.replace(/\{kind\}/g, kind).replace('{id}', id).replace('{got}', got);
const OPTS = ['build', 'update', 'dispose', 'show', 'radius', 'positionFrom'];
const FULL = { detail: 'full' };

/** @internal */
export class Views {
  /** @param {import('./World.js').World} w */
  constructor(w) {
    this.w = w;
    this.presenters = new Map();   // kind → { build, update, dispose, radius, positionFrom, show }
    this.map = new Map();          // id → { obj, pending, p }; obj null and not pending = build failed (retried when you leave and come back)
    this.byObj = new WeakMap();    // built model → record id (world.idOf: a ray hit on the model names its record)
    this.radii = new Map();        // presentation → radius at the last refresh (used to decide whether a moving record needs another refresh)
    this.moving = new Set();       // ids of built positionFrom 'view' models (each fixed step scans only these, not thousands of props)
    // models need to be re-decided (a record crossed the build / teardown distance, zone changed, new registration, last frame unfinished)
    this.dirty = true;
    this.memo = {};                // stream sources at the last refresh (memo.at: [{ x, z, s }])
    this.waiters = [];
  }

  present(kind, opts) {
    if (typeof opts?.build !== 'function') throw new Error(say(STRINGS.noBuild, kind));
    if (DEV) {
      checkOptionsArg(`world.present('${kind}', opts)`, opts, OPTS);
      if (opts.positionFrom != null && opts.positionFrom !== 'record' && opts.positionFrom !== 'view') throw new Error(say(STRINGS.positionFrom, kind));
      if (opts.dispose?.length === 1) warnOnce(say(STRINGS.disposeArgs, kind));
    }
    const old = this.presenters.get(kind);
    if (old) this.forget(old);   // registering the same kind again: tear down old models with the old dispose, rebuild with the new one
    const p = { positionFrom: 'record', ...opts };
    this.presenters.set(kind, p);
    this.dirty = true;
    return { remove: () => { if (this.presenters.get(kind) !== p) return; this.presenters.delete(kind); this.forget(p); } };
  }
  forget(p) { for (const [id, v] of this.map) if (v.p === p) this.unview(id); }
  /**
   * Distance for building models: a number, or a function (asked at each refresh; write it as a function for distances that change at runtime, like terrain
   * view distance)
   */
  radius(p) { const r = p.radius; return typeof r === 'function' ? r() : r ?? this.w.radius; }
  /** A source was added / removed or moved more than min(cell / 4, 8 m) since the last refresh: refresh (that is the error of "build within radius") */
  moved() { return this.w.engine.stream.changed(this.memo, Math.min(this.w._cells.size / 4, 8), FULL, false); }
  /** Radius of presentation p for source s (a source radius caps it) */
  reach(p, s) { return s.reach(this.radii.get(p) ?? this.radius(p)); }
  /** Squared distance from rec to the nearest source of the last refresh, measured in units of each source's reach (≤ 1 = inside) */
  near(rec, p) {
    let best = Infinity;
    for (const a of this.memo.at ?? []) {
      const r = this.reach(p, a.s), dx = rec.position.x - a.x, dz = rec.position.z - a.z;
      best = Math.min(best, (dx * dx + dz * dz) / (r * r));
    }
    return best;
  }
  /**
   * A record moved: if it crossed the build / teardown distance (zone changed, or show changed via set) make the next frame refresh. Called on every move,
   * costs a few multiplications
   */
  track(rec) {
    if (this.dirty) return;
    const p = this.presenters.get(rec.kind); if (!p) return;
    const k = this.near(rec, p);
    if (this.map.has(rec.id)) { if (k > 1.5625 && !(p.positionFrom === 'view' && this.w._s.isNear(rec.id))) this.dirty = true; }
    else if (k <= 1 && (!p.show || p.show(rec))) this.dirty = true;
  }

  get ready() {
    if (!this.presenters.size) return true;
    if (this.dirty || this.moved()) return false;   // not yet refreshed for the current stream sources
    for (const v of this.map.values()) if (v.pending) return false;
    return true;
  }
  get whenReady() { return this.ready ? Promise.resolve() : new Promise(r => this.waiters.push(r)); }

  frame(dt) {
    const W = this.w;
    // build at most buildPerFrame per frame, the rest next frame (not limited while loading: the loading screen is waiting anyway)
    if (this.presenters.size && (this.dirty || this.moved())) this.refresh(W.engine.ready ? W.buildPerFrame : Infinity);
    for (const [id, v] of this.map) {
      if (!v.obj) continue;
      const rec = W.records.get(id);
      if (v.p.positionFrom !== 'view') v.obj.position.copy(rec.position);   // 'view' position is copied back to the record at the end of the fixed step (pull)
      v.p.update?.(rec, v.obj, dt);
    }
    this.wake();
  }
  /** Resolve whenReady waiters once ready. Also called when an async build settles: a paused engine (tests, engine.step) runs no frame,
   *  so waiting only in frame() would never resolve; builds still owed (per-frame limit) are done right here, like world.refresh() */
  wake() {
    if (!this.waiters.length) return;
    if (this.presenters.size && (this.dirty || this.moved()) && this.w.engine.paused) this.refresh();
    if (this.ready) for (const r of this.waiters.splice(0)) r();
  }
  /** End of fixed step: models that move themselves (positionFrom 'view') copy their position back to the record, so later gameplay in this step and saves read this step's result.
   *  Ones not simulated near this step (focus and gameplay anchor apart: model still exists but counts as far) go the other way: the record rules, the model follows */
  pull() {
    const W = this.w, S = W._s;
    for (const id of this.moving) {
      const rec = W.records.get(id), o = this.map.get(id).obj.position;
      if (S.sims.get(rec.kind)?.near && !S.isNear(id)) { o.copy(rec.position); continue; }
      rec.position.x = o.x; rec.position.y = o.y; rec.position.z = o.z; W._index(rec);
    }
  }
  /** Build models that should exist near any full-detail source (at most limit);
   *  tear down those far from all of them, in another zone, or that show says no to */
  refresh(limit = Infinity) {
    const W = this.w, L = W.engine.stream;
    L.changed(this.memo, 0, FULL); this.dirty = false;
    let maxR = W.radius, n = 0;
    for (const p of this.presenters.values()) { const r = this.radius(p); this.radii.set(p, r); if (r > maxR) maxR = r; }
    for (const a of this.memo.at) W._cells.forEach(a, a.s.reach(maxR), (rec, d2) => {
      const p = this.presenters.get(rec.kind);
      if (!p || this.map.has(rec.id) || !W._inZone(rec)) return;
      const r = this.reach(p, a.s);
      if (d2 > r * r || p.show && !p.show(rec)) return;
      if (n >= limit) { this.dirty = true; return; }   // enough built this frame: continue next frame, ready still waits
      n++; this.build(rec, p);
    });
    for (const [id, v] of this.map) {   // teardown distance is widened to 1.25×: walking back and forth on the boundary does not build and tear down repeatedly
      const rec = W.records.get(id);
      const keep = this.near(rec, v.p) <= 1.5625 || v.p.positionFrom === 'view' && W._s.isNear(id);   // keep models that near simulation needs
      if (!keep || !W._inZone(rec) || v.p.show && !v.p.show(rec)) this.unview(id);
    }
  }
  /**
   * Build one model. Sync throw, async failure, or a non-object result: reported once (once per kind) and marked "stop waiting", ready is not blocked; retried
   * when you leave and come back
   */
  build(rec, p) {
    const v = { obj: null, pending: true, p }, e = this.w.engine;
    this.map.set(rec.id, v);
    const fail = err => { if (this.map.get(rec.id) === v) v.pending = false; reportError(e, err, say(STRINGS.failed, rec.kind), { soft: true }); };
    const done = obj => {
      if (!obj?.isObject3D) throw new Error(say(STRINGS.nullBuild, rec.kind, rec.id, String(obj)));
      if (this.map.get(rec.id) !== v) { this.drop(rec, p, obj); return; }   // no longer wanted by the time it was built
      v.obj = obj; v.pending = false; this.byObj.set(obj, rec.id);
      if (p.positionFrom === 'view') this.moving.add(rec.id);
      obj.position.copy(rec.position);
      if (!obj.parent) e.add(obj);
    };
    let out;
    this.w._building = rec.id;   // interactions.add inside build takes this as its stable id (the interaction.use op names it)
    try { out = p.build(rec); if (typeof out?.then !== 'function') { done(out); return; } } catch (err) { fail(err); return; } finally { this.w._building = null; }
    out.then(done).catch(fail).then(() => this.wake());   // an async build settled: waiters of a paused engine resolve here (see wake)
  }
  unview(id) {
    const v = this.map.get(id); if (!v) return;
    this.map.delete(id); this.moving.delete(id);
    if (v.obj) this.byObj.delete(v.obj);
    if (v.obj) this.drop(this.w.records.get(id), v.p, v.obj);
  }
  /**
   * Tear down a model. A dispose error is reported on its own (naming the kind's dispose) and not thrown outward — otherwise loading a save would report it as
   * "world load failed"
   */
  drop(rec, p, obj) {
    if (!p.dispose) { this.w.engine.remove(obj); return; }
    try { p.dispose(rec, obj); } catch (err) { reportError(this.w.engine, err, say(STRINGS.disposeFailed, rec.kind), { soft: true }); }
  }
  clear() { for (const id of [...this.map.keys()]) this.unview(id); this.dirty = true; }
}
