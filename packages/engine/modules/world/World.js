// World data, engine.world: anything the game must remember or keep changing while far away is a plain record here (stable id, kind, position, your own fields);
// a model is only what gets built while the record is near the camera. It knows nothing about NPCs, zombies or crops: the game (or a larger module) tells them apart by kind and writes its own present / simulate.
// Usage, examples, the update convention (set / move), saves, near / far and zone: see packages/engine/docs/recipes/18-world.md; the save rules are at the top of persist.js.
// Data must be plain values (putting a three.js object or a function in it throws in dev); position is a plain { x, y, z }. Don't hold on to rec: loading a save swaps in new objects, so keep the id and use world.get(id).
import { DEV, checkOptionsArg } from '../../core/validate.js';
import { Views } from './views.js';
import { Sim } from './sim.js';
import { saveWorld, loadWorld, checkPlain } from './persist.js';
import { Cells } from './cells.js';
import { putPos, centerOf } from './pos.js';

const STRINGS = {
  noKind: 'world.add() needs a kind (what sort of thing this is), e.g. world.add({ kind: "crate", position: [0, 0, 0] })',
  dupId: 'world.add(): id "{id}" already exists. Omit id to auto-number; to change an existing record use world.set("{id}", { … })',
  initialId: 'world.add(def, { initial: true }) needs a stable id (saves match content by id), e.g. world.add({ id: "chest_1", kind: "{kind}", … }, { initial: true })',
  noId: 'world.{fn}(): no record with id "{id}" (world.query({ kind }) lists what exists)',
  setKey: 'world.set("{id}", patch): patch must not contain id / kind (they are the identity of the record). To change the kind, remove then add',
  anchor: 'world.anchor must be null, an Object3D, a Vector3 / { x, z } or [x, y, z]; got {got}',
};
const fmt = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m);

/** World data (see the top of the file) */
export class World {
  /**
   * @param {any} engine
   * @param {{ cellSize?: number, radius?: number, farEvery?: number, farMaxPerTick?: number, buildPerFrame?: number }} [opts]
   */
  constructor(engine, opts = {}) {
    const { cellSize = 32, radius = 60, farEvery = 1, farMaxPerTick = 500, buildPerFrame = 8 } = opts;
    /** @internal */ this.engine = engine;
    /** All records: id → record (read-only; use set to change fields, move to change position) @type {Map<string, WorldRecord>} */
    this.records = new Map();
    /** Default distance (meters) for building models and counting as near; present / simulate can override it. Changing it at runtime affects those without their own radius @type {number} */
    this.radius = radius;
    /** Default interval (seconds) between far simulations, same unit as dt @type {number} */
    this.farEvery = farEvery;
    /** Max far simulations per fixed step; the rest queue for the next step (dt accumulates, no time is lost). Counted by records, not milliseconds, so results do not depend on machine speed @type {number} */
    this.farMaxPerTick = farMaxPerTick;
    /** Max models built per frame; the rest continue next frame (ready waits for all of them; loading is not limited) @type {number} */
    this.buildPerFrame = buildPerFrame;
    /** @internal */ this._anchor = null;
    /** @internal id of the record whose model build() is running right now (sync part only), else null */ this._building = null;
    /** @internal */ this._zone = null;
    /** @internal */ this._cells = new Cells(cellSize);
    /** @internal */ this._seq = 0;
    /** @internal */ this._base = new Map();     // initial record id → original content (saves diff against it; kept after removal so old saves can restore)
    /** @internal */ this._removed = new Set();  // ids of removed initial records (tombstones, saved)
    /** @internal */ this._pending = new Map();  // changes from a save whose content has not been added yet: id → { set: changed fields, del: removed fields }
    /** @internal */ this._unsaved = new Set();  // ids added with save: false
    /** @internal */ this._origin = new Map();   // dev only: id → where the record comes from (world.origin); empty in release builds
    /** @internal */ this._levels = new Set();   // levels whose nodes were registered (setOrigin { level }): `<level>/<node>` diffs count as orphans only after that
    /** @internal */ this._v = new Views(this);
    /** @internal */ this._s = new Sim(this);
  }

  /**
   * Gameplay simulation center (near / far is measured from it): null (default) = where engine.actor is (engine.actorPosition(): the player, or engine.focus when there is no player). The built-in stream source engine.stream.player follows the player too (models and colliders around it); the camera source engine.stream.camera adds models only.
   * For another center (a strategy game's base) set a Vector3 / object / { x, z } / [x, y, z]; set null to restore. Read once at the start of each fixed step
   * @example engine.world.anchor = baseObject
   * @type {any}
   */
  get anchor() { return this._anchor; }
  set anchor(a) {
    const ok = a == null || a.isObject3D || (Array.isArray(a) ? a.length === 3 && a.every(Number.isFinite) : Number.isFinite(a.x) && Number.isFinite(a.z));
    if (!ok) throw new Error(fmt(STRINGS.anchor, { got: JSON.stringify(a) }));
    this._anchor = a ?? null;
  }
  /** @internal The record whose build() is running (sync part): interactions.add inside it takes this id when none is given */
  get buildingId() { return this._building; }

  /** Current zone (e.g. level name, set by the level module on level change): once set, records of another zone get no model and no near simulation; null = no zoning @type {string | null} */
  get zone() { return this._zone; }
  set zone(z) { if (z !== this._zone) { this._zone = z; this._v.dirty = true; } }   // a zone change must re-decide which models to build (otherwise nothing refreshes while the focus stays still)

  /**
   * Add a record and return it (a plain object). kind is required; without id one is numbered automatically (kind-1, kind-2…, saved).
   * opts.initial: initial record written in content (needs an id); saves only keep its changes and removal; if the id already exists the existing one is returned (content may load twice);
   * returns null if the save removed it (it is not added back). opts.save: false: not saved (temporary things).
   * @example engine.world.add({ id: 'shop_owner', kind: 'npc', position: [12, 0, -30], name: '店主', mood: 'calm' }, { initial: true })
   * @param {{ kind: string, id?: string, position?: any, [field: string]: any }} def
   * @param {{ initial?: boolean, save?: boolean }} [opts]
   * @returns {WorldRecord | null}
   */
  add(def, opts) {
    DEV && this.engine.ops.guard('world.add');
    if (!def?.kind) throw new Error(STRINGS.noKind);
    if (DEV) { checkOptionsArg('world.add(def, opts)', opts, ['initial', 'save']); checkPlain({ ...def, position: undefined }, def.kind); }
    const { id: given, kind, position, ...rest } = def, initial = !!opts?.initial;
    if (initial && given == null) throw new Error(fmt(STRINGS.initialId, { kind }));
    const id = given ?? `${kind}-${++this._seq}`, have = this.records.get(id), p = { x: 0, y: 0, z: 0 };
    if (position) putPos('world.add()', position, p);
    const rec = { id, kind, position: p, ...rest };
    if (initial) {
      if (!this._base.has(id)) this._base.set(id, structuredClone(rec));
      if (have) return have;
      if (this._removed.has(id)) return null;
      return this._insert(this._fromBase(id, this._base.get(id)), true);
    }
    if (have) throw new Error(fmt(STRINGS.dupId, { id }));
    if (opts?.save === false) this._unsaved.add(id);
    if (DEV) this._origin.set(id, { spawned: { op: this.engine.ops.running, tick: this.engine.tick } });   // who made it (inspect / pick)
    return this._insert(rec, true);
  }
  /**
   * Where a record comes from (filled in dev and test builds; null in release): { definedAt: 'content/props.js:14' } for a content entry,
   * { level, node } for a level-model node, { template } when it is a template instance, { spawned: { op, tick } } for a record created during play.
   * engine.inspect(id) and engine.pick(...).thing show it, so you know which file to edit to change the level for good.
   * @example engine.world.origin('chest-home')   // { definedAt: 'content/props.js:14', template: 'chest' }
   * @param {string} id
   * @returns {{ definedAt?: string, level?: string, node?: string, template?: string, spawned?: { op: string | null, tick: number } } | null}
   */
  origin(id) { return this._origin.get(id) ?? null; }
  /**
   * @internal An authored record's resting place, known only once its model is built (a physics body lifted to sit on the ground): when the record is
   * still where its content put it (within tolerance meters), the content position moves there too, so the record stays out of the save. A record that was moved is left alone.
   */
  rest(id, position, tolerance = 0) {
    const rec = this.records.get(id), base = this._base.get(id); if (!rec) return;
    const a = rec.position, b = base?.position;
    const same = !!b && Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.z - b.z) <= tolerance;
    putPos(`world.rest("${id}")`, position, rec.position); this._index(rec);
    if (same) base.position = { ...rec.position };
  }
  /** @internal Content / level loaders say where an authored record was defined (dev only; merged into what is there) */
  setOrigin(id, info) {
    if (info?.level != null) this._levels.add(info.level);
    if (DEV) this._origin.set(id, { ...this._origin.get(id), ...info });
  }
  /**
   * The id of the record whose model contains obj (obj itself or one of its parents is a built model), else null. A ray hit on a model names its record this way.
   * @example const h = engine.pick(0, 0); const id = h && engine.world.idOf(h.object);
   * @param {any} obj  a THREE.Object3D (a mesh of the model is fine)
   * @returns {string | null}
   */
  idOf(obj) {
    for (let o = obj; o; o = o.parent) { const id = this._v.byObj.get(o); if (id !== undefined) return id; }
    return null;
  }
  /**
   * @internal Saved changes or removals whose id no authored entry produces any more (content renamed or deleted it). They are kept in the save
   * (a reverted content change gets its data back); a `<level>/<node>` id counts only after that level has been shown.
   * @returns {string[]}
   */
  orphans() {
    const out = [], known = id => this._base.has(id) || this.records.has(id);
    const due = id => { const i = id.indexOf('/'); return i < 0 || this._levels.has(id.slice(0, i)); };
    for (const id of this._pending.keys()) if (!known(id) && due(id)) out.push(id);
    for (const id of this._removed) if (!known(id) && !this._base.has(id) && due(id)) out.push(id);
    return out;
  }
  /**
   * Get a record by id (undefined if missing, like a Map)
   * @param {string} id
   * @returns {WorldRecord | undefined}
   */
  get(id) { return this.records.get(id); }
  /**
   * Merge fields into a record and emit the world:change event; a position in patch also moves it. Returns the record.
   * For discrete changes (chest opened, growth stage, picked up); if present has show, it is re-evaluated after the change. id / kind cannot be changed
   * @example engine.world.set('crate_1', { opened: true })
   * @param {string} id
   * @param {Record<string, any>} patch
   * @returns {WorldRecord}
   */
  set(id, patch) {
    DEV && this.engine.ops.guard('world.set');
    const rec = this._need(id, 'set');
    if (DEV) { if ('id' in patch || 'kind' in patch) throw new Error(fmt(STRINGS.setKey, { id })); checkPlain({ ...patch, position: undefined }, id); }
    const { position, ...rest } = patch;
    Object.assign(rec, rest);
    if (position) this.move(id, position);
    if (this._v.presenters.get(rec.kind)?.show) this._v.dirty = true;
    this.engine.events.emit('world:change', { id, kind: rec.kind, keys: Object.keys(patch) });
    return rec;
  }
  /**
   * Move a record (no event; use it in simulate for things that move every step); still saved (saves diff against content).
   * The model of a positionFrom 'record' (default) record follows this frame; to do something else with the position in presentation, compare in update
   * @example engine.world.move(rec.id, { x: rec.position.x + 1, z: rec.position.z })
   * @param {string} id
   * @param {any} position  Vector3 / object / [x, y, z] / { x, z } (y stays unchanged if omitted)
   * @returns {void}
   */
  move(id, position) {
    DEV && this.engine.ops.guard('world.move');
    const rec = this._need(id, 'move');
    putPos(`world.move("${id}")`, position, rec.position);
    this._index(rec);
  }
  /**
   * Remove a record (its model is torn down too) and emit the world:remove event. Does nothing if the id does not exist. Removing an initial record is saved, so it stays gone after loading
   * @param {string} id
   * @returns {void}
   */
  remove(id) {
    DEV && this.engine.ops.guard('world.remove');
    const rec = this.records.get(id); if (!rec) return;
    this._v.unview(id);
    this._cells.delete(rec);
    this.records.delete(id);
    this._s.removed(id);
    this._unsaved.delete(id);
    if (this._base.has(id)) this._removed.add(id); else this._origin.delete(id);
    this.engine.events.emit('world:remove', { id, kind: rec.kind });
  }
  /**
   * Query records; returns an array. With near only nearby cells are scanned and results are sorted nearest first (radius defaults to 30 m); where filters further. For neighbor queries every step use forEachNear
   * @example engine.world.query({ kind: 'zombie', near: engine.player, radius: 30, where: z => !z.dead })
   * @param {{ kind?: string, near?: any, radius?: number, where?: (rec: WorldRecord) => boolean, zone?: string | null }} [opts]
   * @returns {WorldRecord[]}
   */
  query(opts = {}) {
    const { kind, near, radius = 30, where, zone } = opts, out = [];
    const ok = r => (!kind || r.kind === kind) && (zone === undefined || (r.zone ?? null) === zone) && (!where || where(r));
    if (near) {
      this._cells.forEach(centerOf(near), radius, (r, d2) => { if (ok(r)) out.push([d2, r]); });
      return out.sort((a, b) => a[0] - b[0]).map(a => a[1]);
    }
    if (!kind) return [...this.records.values()].filter(ok);
    for (const e of this._s.kinds.get(kind)?.set ?? []) if (ok(e.rec)) out.push(e.rec);   // table grouped by kind: no full scan
    return out;
  }
  /**
   * Call fn(rec, d2) for each record within radius meters (horizontal distance) of center; d2 is the squared distance. Unsorted, no allocation: use it for per-step neighbor queries (hundreds of zombies avoiding each other).
   * Don't add / remove / move in the callback (moving into a cell not yet visited visits it again): record the change and apply it after the loop
   * @example engine.world.forEachNear(rec.position, 5, (o, d2) => { if (o !== rec && o.kind === 'zombie') n++; })
   * @param {any} center  Vector3 / object / { x, z }
   * @param {number} radius
   * @param {(rec: WorldRecord, d2: number) => void} fn
   * @returns {void}
   */
  forEachNear(center, radius, fn) { this._cells.forEach(centerOf(center), radius, fn); }

  /**
   * Register how a kind of thing looks: models are built automatically within radius meters of any full-detail stream source (engine.stream: player, camera focus, teleport destination) and torn down when far from all of them (radius × 1.25); tearing down never touches the record. Callbacks:
   *   build(rec) → three.js object (may be async). world adds it to the scene and places it at rec.position; if it throws / fails / returns a non-object: reported once, does not block ready, retried when you leave and come back.
   *   update(rec, obj, dt): called every frame for records that have a model (change the look from the data, e.g. an opened chest swaps texture).
   *   dispose(rec, obj): called on teardown (record first, model second); if omitted, engine.remove(obj).
   *   show(rec) → false: this record has no model right now (picked up, waiting to respawn); re-evaluated when world.set changes records of this kind.
   * radius: meters, or a function (for distances that change, like terrain view distance); defaults to world.radius. Registering the same kind again: old models are torn down with the old dispose and rebuilt with the new one.
   * positionFrom: 'record' (default, the model follows the record every frame) or 'view' (the model moves itself, e.g. driven by a character mover; model position is copied back to the record at the end of each fixed step).
   * @example engine.world.present('chest', { build: rec => new THREE.Mesh(boxGeo, makeMaterial('prop')), dispose: (rec, obj) => engine.remove(obj), show: rec => !rec.looted })
   * @param {string} kind
   * @param {{ build: (rec: WorldRecord) => any, update?: (rec: WorldRecord, obj: any, dt: number) => void, dispose?: (rec: WorldRecord, obj: any) => void, show?: (rec: WorldRecord) => boolean, radius?: number | (() => number), positionFrom?: 'record' | 'view' }} opts
   * @returns {{ remove(): void }}
   */
  present(kind, opts) { return this._v.present(kind, opts); }
  /** @internal whether some code already called present(kind) (content templates refuse to take over a kind with its own presenter) @param {string} kind */
  presents(kind) { return this._v.presenters.has(kind); }
  /**
   * The current model of this record (only exists nearby; null if not built yet or far away)
   * @param {string} id
   * @returns {any}
   */
  view(id) { return this._v.map.get(id)?.obj ?? null; }
  /** All models that should exist near the stream sources are built (async ones too; failed builds do not count as pending). The loading screen waits for it; to wait yourself, await world.whenReady @type {boolean} */
  get ready() { return this._v.ready; }
  /** Promise that resolves when ready becomes true @type {Promise<void>} */
  get whenReady() { return this._v.whenReady; }
  /**
   * Build / tear down models for the stream sources right now (normally automatic every frame, with a per-frame limit). Use it right after add when you need the model: sync builds are available via view(id) after the call, for async ones also await world.whenReady
   * @example engine.world.add({ id: 'gate', kind: 'gate', position: p }); engine.world.refresh(); engine.world.view('gate')
   * @returns {void}
   */
  refresh() { this._v.refresh(); }
  /**
   * Register how a kind of thing changes (gameplay logic goes here, runs in the fixed step); near / far is split by distance from world.anchor (default: the player):
   * near(rec, dt, obj): within radius, once per fixed step (obj is the model, may be null if not built yet; gameplay must not depend on it);
   * far(rec, dt): farther away, once every farEvery seconds; dt is the seconds accumulated since the last simulation (can catch up a long time at once); on the far → near step, far runs first to pay back the owed time.
   * With only far (crops), near also advances via far; with only near, far records are not simulated and owed time is not made up.
   * Both dt are accumulated fixed-step seconds (not multiplied by clock.timeScale). For things measured in game clock (grows over days) store engine.clock.now and compare.
   * radius defaults to the present radius ('view' widened by 1.25), or world.radius without present; may also be a function.
   * worker: true (experimental) runs far in engine.threads workers (batched per step, written back 4 steps later, bit-identical with threads off). far must then be self-contained:
   * it is recompiled from source and sees only (rec, dt) and globals like Math; an outside variable throws naming it (threads on or off alike).
   * @example engine.world.simulate('zombie', { near: (rec, dt) => chase(rec, dt), far: (rec, dt) => wander(rec, dt), farEvery: 2 })
   * @example engine.world.simulate('crop', { far: (rec, dt) => { rec.growth = Math.min(1, rec.growth + dt / 600); }, worker: true })
   * @param {string} kind
   * @param {{ near?: (rec: WorldRecord, dt: number, obj: any) => void, far?: (rec: WorldRecord, dt: number) => void, farEvery?: number, radius?: number | (() => number), worker?: boolean }} opts
   * @returns {{ remove(): void }}
   */
  simulate(kind, opts) { return this._s.simulate(kind, opts); }
  /** @internal The gameplay anchor in effect (anchor, else engine.actorPosition(), else engine.focus) */
  get center() { return this.anchor ?? this.engine.actorPosition() ?? this.engine.focus; }
  /** Number of fixed steps simulated */ get steps() { return this._s.n; }

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

  /** @internal */
  _inZone(rec) { return this.zone == null || rec.zone == null || rec.zone === this.zone; }
  /** @internal */
  _need(id, fn) { const r = this.records.get(id); if (!r) throw new Error(fmt(STRINGS.noId, { fn, id })); return r; }
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

/**
 * One world record: id, kind and position are fixed fields, the rest are yours (plain values only)
 * @typedef {{ id: string, kind: string, position: { x: number, y: number, z: number }, zone?: string, [field: string]: any }} WorldRecord
 */
