// Entities: the few stateful, changing, interactive, saved objects in a game - planted saplings, campfires, chests, traps, placed furniture.
// Unlike vegetation (thousands of seed-derived instances, never saved individually), each entity is its own object (tens to hundreds).
//
//   engine.use(entities());                 // needs the world module (included by openWorld)
//   engine.entities.define('sapling', {
//     create: (engine, data) => makeSaplingMesh(),         // returns a THREE.Object3D (the model comes from the game / style pack)
//     state: { watered: false },                           // default state (merged with data.state at spawn)
//     stages: [                                            // optional: growth stages (seed -> sapling -> tree)
//       { name: 'seed',    duration: 60,  scale: 0.2 },    // duration: game seconds spent in this stage
//       { name: 'sapling', duration: 120, scale: 0.5 },
//       { name: 'tree',    model: (engine, ent) => makeTree() },   // no duration on the last stage = stays there forever; model swaps the model
//     ],
//     update(dt, ent, engine) {},                          // optional: per fixed step (runs only near the player; far entities just catch up on growth)
//     interact: { label: 'entities.water', action: 'interact', radius: 2.5, enabled: ent => true, onUse: ent => ent.set('watered', true) },
//     collider: 0.4,                                       // optional: circular collision radius (needs the collision module; built with the model, so near only)
//     save: false,                                         // optional: exclude from saves (temporary things, cleared on load); default true
//   });
//   const ent = engine.entities.spawn('sapling', { position: [10, 0, 5], rotation: 0 });   // position as { x, z } (no y) snaps to ground
//   ent.object  // three.js root (Group) with the model ent.visual under it; exists only when near, null when far. Built the frame after spawn; call engine.world.refresh() to get it immediately.
//   ent.state.stage  // current stage index; ent.stageName  // 'seed'
//   ent.set('watered', true);  ent.remove();
//   engine.entities.get(ent.id);  engine.entities.byType('sapling');  engine.entities.remove(id);   // ids without spawn({ id }) look like 'entity:sapling-3'
//   engine.entities.nearest(position, { radius, type })  // nearest entity
//
// Data and presentation are separate (see modules/world): an entity's facts (position, rotation, state, extra, stage) are a plain record in engine.world,
// with kind 'entity:<type>' (one kind per type, usable by world.query / present / simulate); the id is the entity id; saved with world.
// Model, interaction and collision are built only near the player (world.radius, default 60 m) and torn down when far (def.dispose is called then); rebuilt for the current stage on return.
// ent is a wrapper "view": x / y / z / rotation / state / data read world data by id (still valid after a load swaps the data); ent.object / ent.visual exist only when near.
// Changing state: ent.set, setStage and stage changes go through world.set (emits world:change, see world's mutation rules); fields changed every step in update can be written to ent.state directly and are still saved.
// Growth and update are world.simulate: every fixed step when near, caught up in game seconds when far (grows without a model, may cross several stages at once; canGrow is asked both near and far).
//
// Events: entity:spawn / entity:remove / entity:state { ent, key, value, prev } / entity:stage { ent, stage, name }
// Clock: growth uses engine.clock.now (game seconds, follows clock.timeScale and saves).
// Interaction text: interact.label may be an i18n key (translated if it exists), plain text, or a function ent => text.
// Appearance: the engine ships no default models - the game supplies create(), usually from an asset pack (engine.assets.model / cached).
import { xzOf } from '../../core/math.js';
import { checkOptions, checkOptionsArg, missingText, warnOnce, freezeDef } from '../../core/validate.js';

const DEF_KEYS = ['create', 'state', 'stages', 'update', 'interact', 'collider', 'colliderHeight', 'save', 'dispose', 'canGrow'];
const SPAWN_KEYS = ['id', 'position', 'rotation', 'state', 'extra'];
const KIND = 'entity:';   // kind prefix of world data: one kind per type, so present / simulate can register per type

// Developer message: data uses a feature of a module that is not installed (optional dependencies must not be skipped silently, see core/modules.js)
const DEV_STRINGS = { noInteract: 'Entity "{id}" sets interact but the interactions() module is not installed: the entity cannot be interacted with. Install interactions().' };
const STRINGS = {
  'zh-CN': { 'entities.use': '使用' },
  en: { 'entities.use': 'Use' },
};

export class Entities {
  constructor(engine) {
    this.engine = engine;
    this.types = new Map();
    this._views = new Map();       // id -> ent view (just a shell: getters read data by id, plus presentation state while a model exists; holds no facts)
    this._hooks = new Map();       // type -> world.present / simulate registrations; the old ones are removed on re-define
    engine.i18n.add(STRINGS);
    // data gone, view dropped with it (not in the save after a load, or deleted directly by world.remove)
    engine.events.on('world:remove', ({ id }) => this._views.delete(id));
    engine.events.on('world:load', () => { for (const id of this._views.keys()) if (!this.world.get(id)) this._views.delete(id); });
  }

  get now() { return this.engine.clock.now; }
  get world() { return this.engine.world; }

  define(type, def) {
    checkOptions(`entities.define('${type}')`, def, DEF_KEYS, { loose: true });   // games may add their own fields; only warn on near-miss spellings
    for (const s of def.stages || []) checkOptions(`entities.define('${type}') stages`, s, ['name', 'duration', 'scale', 'model']);
    checkOptions(`entities.define('${type}') interact`, def.interact, ['label', 'action', 'radius', 'height', 'enabled', 'onUse']);
    this._hooks.get(type)?.forEach(h => h.remove());
    const full = freezeDef({ state: {}, ...def }), kind = KIND + type, w = this.world, hooks = [];
    this.types.set(type, full);
    hooks.push(w.present(kind, {
      build: rec => this._build(this._ent(rec)),
      update: rec => this._refresh(this._ent(rec)),
      dispose: (rec, obj) => this._unbuild(this._ent(rec), obj),
    }));
    if (full.stages || full.update) {
      hooks.push(w.simulate(kind, {
        near: (rec, dt) => { const ent = this._ent(rec); this._grow(ent); full.update?.(dt, ent, this.engine); },
        far: rec => this._grow(this._ent(rec)),   // far: only catch up on growth (in game seconds); update is near-only logic
      }));
    }
    this._hooks.set(type, hooks);
    return this;
  }

  spawn(type, data = {}) {
    const e = this.engine, def = this.types.get(type);
    if (!def) { console.error(missingText('entityType', type, [...this.types.keys()])); return null; }
    checkOptions(`entities.spawn('${type}')`, data, SPAWN_KEYS);
    const id = data.id;   // none given: world numbers it (entity:<type>#<n>); the counter is saved with world, so a removed entity's id is never handed out again
    if (id != null && this.world.get(id)) this.remove(id);
    const pos = data.position ?? { x: 0, z: 0 }, [x, z] = xzOf(pos);
    const y = pos.isObject3D ? pos.position.y : Array.isArray(pos) ? (pos[1] ?? null) : (pos.y ?? null);   // no y given = snap to ground
    const state = { ...structuredClone(def.state || {}), ...(data.state || {}) };
    if (def.stages) { state.stage ??= 0; state.stageAt ??= this.now; }   // stage without stageAt starts from now, otherwise NaN and it never grows
    const rec = this.world.add({ id, kind: KIND + type, position: { x, y: y ?? e.surface(x, z), z }, rotation: data.rotation ?? 0, state, extra: data.extra || {} }, { save: def.save ?? true });
    if (def.interact && !e.interactions) warnOnce(DEV_STRINGS.noInteract.replace('{id}', id));
    const ent = this._ent(rec);
    e.events.emit('entity:spawn', ent);
    return ent;
  }

  get(id) { const rec = this.world.get(id); return rec?.kind.startsWith(KIND) ? this._ent(rec) : null; }
  byType(type) { return this.world.query({ kind: KIND + type }).map(r => this._ent(r)); }
  list() { return this.world.query({ where: r => r.kind.startsWith(KIND) }).map(r => this._ent(r)); }
  /** Nearest entity within radius meters (default 3) of position; type restricts to one type. */
  nearest(position, opts = {}) {
    checkOptionsArg('entities.nearest()', opts, ['radius', 'type']);
    const [x, z] = xzOf(position), { radius = 3, type = null } = typeof opts === 'object' && opts ? opts : {};
    const rec = this.world.query({ near: position, radius, where: r => type ? r.kind === KIND + type : r.kind.startsWith(KIND) })
      .find(r => (r.position.x - x) ** 2 + (r.position.z - z) ** 2 < radius * radius);   // query includes the boundary; keep the original strict less-than here
    return rec ? this._ent(rec) : null;
  }
  remove(id) {
    const ent = this.get(id);
    if (!ent) return false;
    this.engine.events.emit('entity:remove', ent);   // emit first: ent.x / ent.state are still readable and the model still exists
    this.world.remove(id);                           // data removed, model torn down with it (def.dispose runs in _unbuild)
    return true;
  }
  /** Remove every entity (records and models). Loading a save does not need it: world replaces its records itself. */
  clear() { for (const ent of this.list()) this.remove(ent.id); }

  /** Jump straight to a growth stage. */
  setStage(ent, i) {
    const st = ent.def.stages; if (!st) return;
    i = Math.max(0, Math.min(st.length - 1, i));
    const s = ent.state; s.stage = i; s.stageAt = this.now;
    this.world.set(ent.id, { state: s });
    this.engine.events.emit('entity:stage', { ent, stage: i, name: st[i].name });   // with a model, _refresh updates the look next frame
  }

  // ---------- internals ----------
  /** data -> ent view (same id is always the same view). Getters read data by id (never hold rec: a load swaps in new objects); _root / visual / _handles exist only while a model exists. */
  _ent(rec) {
    let ent = this._views.get(rec.id);
    if (ent) return ent;
    const self = this, id = rec.id, type = rec.kind.slice(KIND.length), W = this.world;
    ent = {
      id, type,
      get def() { return self.types.get(type); },   // follows re-define
      get x() { return W.get(id)?.position.x; }, get y() { return W.get(id)?.position.y; }, get z() { return W.get(id)?.position.z; },
      get rotation() { return W.get(id)?.rotation; },
      get state() { return W.get(id)?.state; },
      get data() { return W.get(id)?.extra; },
      get object() { return this._root; },
      get stageName() { return this.def?.stages?.[W.get(id)?.state.stage]?.name ?? null; },
      set: (k, v) => self._set(ent, k, v),
      remove: () => self.remove(id),
      _root: null, visual: null, _baseScale: 1, _modelStage: -1, _shownStage: -1, _handles: [],
    };
    this._views.set(id, ent);
    return ent;
  }
  _label(label, ent) {
    if (typeof label === 'function') return label(ent, this.engine);
    if (!label) return this.engine.t('entities.use');
    return this.engine.i18n.has(label) ? this.engine.t(label, { name: ent.stageName ?? ent.type }) : label;
  }
  _set(ent, k, v) {
    const prev = ent.state[k];
    if (prev === v) return;
    const s = ent.state; s[k] = v;
    this.world.set(ent.id, { state: s });   // via world.set: emits world:change and, in dev, checks the value is plain data
    this.engine.events.emit('entity:state', { ent, key: k, value: v, prev });
  }
  // ent.object is an empty root (rotation and interactions hang on it; position is set by world each frame); the model ent.visual is its child, so a stage model swap replaces only the child
  _build(ent) {
    const e = this.engine, def = ent.def, rec = this.world.get(ent.id), root = new e.THREE.Group();
    rec.position.y ??= e.surface(rec.position.x, rec.position.z);   // initial world records may omit y (snap to ground); computed when the model is first built
    root.position.set(rec.position.x, rec.position.y, rec.position.z);
    root.rotation.y = rec.rotation;
    root.userData.entity = ent.id;
    root.userData.budgetTag = 'entities';
    ent._root = root; ent.visual = null; ent._modelStage = -1; ent._shownStage = -1;
    this._setVisual(ent, def.create(e, ent));
    this._refresh(ent);
    if (def.interact && e.interactions) {
      const it = def.interact;
      ent._handles.push(e.interactions.add(root, {
        id: ent.id,   // the interaction.use op names it the same in every run (an async create would otherwise get a load-order number)
        label: () => this._label(it.label, ent), radius: it.radius ?? 2.5, action: it.action, height: it.height,
        enabled: () => !!this.world.get(ent.id) && (it.enabled ? it.enabled(ent, e) : true),
        onUse: () => it.onUse?.(ent, e),
      }));
    }
    if (def.collider && e.collision) ent._handles.push(e.collision.addCircle({ x: rec.position.x, z: rec.position.z }, { radius: def.collider, height: def.colliderHeight ?? 3 }));
    return root;
  }
  // going far / removed: interaction, collision and model torn down together (geometry and materials disposed); data untouched
  _unbuild(ent, obj) {
    for (const h of ent._handles) h.remove();
    ent._handles = [];
    this.engine.remove(obj);
    ent._root = null; ent.visual = null;
    ent.def.dispose?.(ent, this.engine);
  }
  _setVisual(ent, obj) {
    if (ent.visual) this.engine.remove(ent.visual);   // stage model swap: old model fully removed (geometry/materials shared via assets are skipped)
    ent.visual = obj || null;
    if (obj) { ent._baseScale = obj.scale.x; ent._root.add(obj); }
  }
  // Per frame (with a model): update the look when the stage changed. scale multiplies the model's original size; model swaps the model (once per stage).
  _refresh(ent) {
    const stage = this.world.get(ent.id)?.state.stage;
    if (!ent._root || stage === ent._shownStage) return;
    ent._shownStage = stage;
    const s = ent.def.stages?.[stage];
    if (!s) return;
    if (s.model && ent._modelStage !== stage) { this._setVisual(ent, s.model(this.engine, ent)); ent._modelStage = stage; }
    ent.visual?.scale.setScalar(ent._baseScale * (s.scale ?? 1));
  }
  // Growth: caught up from clock.now, may cross several stages at once (load, return from far, long fast-forward); near and far both come through here
  _grow(ent) {
    const st = ent.def.stages; if (!st) return;
    const s = ent.state, now = this.now;
    const from = s.stage;
    while (s.stage < st.length - 1 && st[s.stage].duration != null && now - s.stageAt >= st[s.stage].duration) {
      if (ent.def.canGrow && !ent.def.canGrow(ent, this.engine)) break;   // ask canGrow first; if not, stay in the current stage
      s.stageAt += st[s.stage].duration; s.stage++;
    }
    if (s.stage === from) return;   // asked every step: stage unchanged means no set and no event
    this.world.set(ent.id, { state: s });
    this.engine.events.emit('entity:stage', { ent, stage: s.stage, name: st[s.stage].name });
  }
}

/** Entities module. Installs engine.entities. Data lives in engine.world (needs the world module, included by openWorld). */
export function entities(opts = {}) {
  checkOptions('entities()', opts, []);   // takes no options: what an entity is and does goes in entities.define(type, {...})
  let ents = null;
  return {
    name: 'entities', label: 'Entities', requires: ['world'], optional: ['sky', 'interactions', 'collision'], stage: 'gameplay', after: ['interactions', 'dialogue', 'triggers'],
    install(e) {
      ents = new Entities(e);
      return ents;
    },
    describe(e, ctx) {
      // Report only nearby ones: far entities have data but do not show up in "what's around". Uses the model as the locator so it merges with what the interactions module reports for the same object
      for (const rec of ents.world.query({ near: ctx.center, radius: ctx.radius, where: r => r.kind.startsWith(KIND) })) {
        const ent = ents._ent(rec);
        ctx.near(ent.object ?? rec.position, { name: ent.id, kind: 'entity', type: ent.type, stage: ent.stageName });
      }
      return { count: ents.list().length };
    },
  };
}
