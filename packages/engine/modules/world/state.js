// Internal half of World (World.js copies these onto World.prototype; a mixin, not a base class, so the generated World.d.ts needs no import of this file): state tables, the hooks the engine calls, and the helpers other world files use.
// Split by responsibility: World.js keeps the public API and its documentation; nothing here is public.
import { DEV, fmt } from '../../core/base/validate.js';
import { STRINGS as RECORD_STRINGS, restRecord, orphanIds } from './records.js';
import { saveWorld, loadWorld, renamePending, isPlain } from './persist.js';
import { Cells } from '../../core/stream/cells.js';
import { centerOf } from './pos.js';
import { codedError } from '../../core/base/errorHints.js';

export function initState(w, cellSize) {
  /** @internal */ w._anchor = null;
  /** @internal id of the record whose model build() is running right now (sync part only), else null */ w._building = null;
  /** @internal */ w._zone = null;
  /** @internal */ w._cells = new Cells(cellSize);
  /** @internal */ w._seq = 0;
  /** @internal */ w._base = new Map();     // initial record id → original content (saves diff against it; kept after removal so old saves can restore)
  /** @internal */ w._removed = new Set();  // ids of removed initial records (tombstones, saved)
  /** @internal */ w._pending = new Map();  // changes from a save whose content has not been added yet: id → { set: changed fields, del: removed fields }
  /** @internal */ w._unsaved = new Set();  // ids added with save: false
  /** @internal */ w._origin = new Map();   // dev only: id → where the record comes from (world.origin); empty in release builds
  // content/renames.js: old authored id → new id (null = deleted on purpose); applied to every save this world loads
  /** @internal */ w._renames = new Map();
  // levels whose nodes were registered (setOrigin { level }): `<level>/<node>` diffs count as orphans only after that
  /** @internal */ w._levels = new Set();
}

class Internals {
  /** @internal The record whose build() is running (sync part): interactions.add inside it takes this id when none is given */
  get buildingId() { return this._building; }
  /**
   * @internal An authored record's resting place, known only once its model is built (a physics body lifted to sit on the ground): when the record is
   * still where its content put it (within tolerance meters), the content position moves there too, so the record stays out of the save. A record that was
   * moved is left alone.
   */
  rest(id, position, tolerance = 0) { restRecord(this, id, position, tolerance); }
  /**
   * @internal The dev editor changed the design itself: the entry's old content is gone, not removed in play, so no baseline and no "removed" mark stay behind for
   * the save to pin. The record is already gone (thing.remove); the content loader puts the new one in as an authored record again.
   */
  forget(id) { this._base.delete(id); this._removed.delete(id); this._origin.delete(id); }
  /** @internal Content / level loaders say where an authored record was defined (dev only; merged into what is there) */
  setOrigin(id, info) {
    if (info?.level != null) this._levels.add(info.level);
    if (DEV) this._origin.set(id, { ...this._origin.get(id), ...info });
  }
  /**
   * @internal Saved changes or removals whose id no authored entry produces any more (content renamed or deleted it). They are kept in the save
   * (a reverted content change gets its data back); a `<level>/<node>` id counts only after that level has been shown.
   * @returns {string[]}
   */
  orphans() { return orphanIds(this); }
  /**
   * @internal content/renames.js (content.load calls this before it adds placements): saved changes, removals and owed time under an old authored id
   * move to the new id; null drops them. Kept, so a save loaded later is renamed the same way (loadWorld). Returns the old ids that could not move,
   * each with the reason (still authored, or the new id has saved data of its own), for the dev warning.
   * @param {Record<string, string | null>} map
   * @returns {string[]}
   */
  renameIds(map) {
    for (const [a, b] of Object.entries(map)) this._renames.set(a, b);
    return renamePending(this);
  }
  /** @internal Whether id is an authored (content) record, removed or not: thing.remove's undo puts such a record back without a world.add */
  authored(id) { return this._base.has(id); }
  /**
   * @internal Undo of a removal (thing.remove): an authored record loses its tombstone and comes back as it was; a runtime record is added again.
   * @param {any} rec  the record as it was (a copy) @param {boolean} authored
   */
  restore(rec, authored) {
    if (!authored) { const { id, kind, ...rest } = rec; this.add({ id, kind, ...rest }); return; }
    this._removed.delete(rec.id); this._insert(structuredClone(rec), true);
  }
  /** @internal whether some code already called present(kind) (content templates refuse to take over a kind with its own presenter) @param {string} kind */
  presents(kind) { return this._v.presenters.has(kind); }
  /** @internal The gameplay anchor in effect (anchor, else engine.actorPosition(), else engine.focus) */
  get center() { return this.anchor ?? this.engine.actorPosition() ?? this.engine.focus; }

  // ---------- called by the engine ----------
  /** Fixed step: read this step's simulation center → simulate → copy model-driven positions back to the data @internal */
  fixed(dt) {
    const a = this.center;
    this._s.fixed(dt, centerOf(a));
    this._v.pull();
  }
  /** Every frame: build / tear down models by stream sources, sync positions, call update @internal */
  frame(dt) { this._v.frame(dt); }
  /** Save content (rules at the top of persist.js) @internal */
  toJSON() { return saveWorld(this); }
  /** Load a save, then emit world:load @internal */
  fromJSON(d) { loadWorld(this, d); }
  /** Tear down all models (called by engine.dispose) @internal */
  dispose() { this._v.clear(); }

  /** @internal whether a value can go into a save, for a module that sorts its options (npcs.add) */
  isPlain(v) { return isPlain(v); }
  /** @internal */
  inZone(rec) { return this.zone == null || rec.zone == null || rec.zone === this.zone; }
  /** @internal */
  _need(id, fn) { const r = this.records.get(id); if (!r) throw codedError('world-record', fmt(RECORD_STRINGS.noId, { fn, id })); return r; }
  /** Copy the original initial record and apply the changes from the save @internal */
  _fromBase(id, base) {
    const rec = structuredClone(base), d = this._pending.get(id);
    if (d) { this._pending.delete(id); Object.assign(rec, d.set); for (const k of d.del ?? []) delete rec[k]; }
    return rec;
  }
  /** Put into the data table, cells and simulation table @internal */
  _insert(rec, emit = false) {
    this.records.set(rec.id, rec);
    this._index(rec);
    this._s.added(rec);
    if (emit) this.engine.events.emit('world:add', { id: rec.id, kind: rec.kind });
    return rec;
  }
  /** Position changed: update the cell; if it crosses the build / teardown distance, make the presentation layer refresh next frame @internal */
  _index(rec) { this._cells.put(rec); this._v.track(rec); }
}

/** Copy the internal methods onto World.prototype (getters stay getters) */
export function mixInternals(World) {
  const d = Object.getOwnPropertyDescriptors(Internals.prototype);
  delete d.constructor;
  Object.defineProperties(World.prototype, d);
}
