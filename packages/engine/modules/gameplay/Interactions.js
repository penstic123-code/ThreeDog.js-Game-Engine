// Interactions module: a prompt appears near an object ("E · Talk"), and the interact key fires a callback (dialogue, pickup, fishing, chopping...).
//
// engine.interactions.add(npc, { label: 'Talk to the fisher', onUse: () => engine.dialogue.start('老渔夫') });
// Using one is the op interaction.use { id?, action? } (recipes/23-ops.md): the interact key (in fixed), a click on the prompt, the dev bridge and tests all
// run it,
// so every use is logged and checked by the same can (exists, enabled, in range, input not locked). Without id it uses the one the actor would pick now.
// Who interacts is engine.actor (core/actor.js), measured with engine.actorPosition(): the player by default, a vehicle or squad member when the game says so;
// the op's ctx.actor (a net peer, an NPC) is handed to label / enabled / onUse as (object, { actor }).
// How the one in front of you is chosen is the pick option: 'nearest' | 'facing' | 'aim' | a function (see interactions()). Each action is picked on its own,
// so one object can carry "Open" and "Lock" as two interactions with different action names (each bound to the game's own key).
// The prompt is the UI part 'prompt' (default interactionPrompt.js, CSS class .threedog-prompt): replace it or turn it off with engine.ui.set('prompt', ...);
// prompt height style.ui.promptHeight (meters)
// hold: seconds turns the press into "keep it down": the engine counts progress on fixed steps and interrupts it on release, leaving reach, disabled or
// locked input, in one place, so no game re-writes a hold timer per verb; the prompt part gets progress 0-1 to draw.
// approach: true walks the actor's character there first (walkTo), then uses it: point-and-click, "talk to the shopkeeper across the room".
// Finding candidates goes through the shared xz index (core/cells.js) instead of measuring every interaction each frame: one on a world record's model
// (NPC, pickup, template) is found through world.forEachNear by its record's position, which moves with it; one at a fixed position sits in a Cells of its
// own; only one following a free Object3D (a vehicle, a hand-placed mesh) or reaching very far is measured every pass. Candidates are then measured exactly
// and ties go to the earlier added, so a pick equals a full scan of every item.
import * as THREE from 'three';
import { worldToScreen } from '../../ui/UI.js';
import { promptPart } from './interactionPrompt.js';

import { readParams, keysSchema } from '../../core/params.js';
import { codedError } from '../../core/errorHints.js';
import { vec3 } from '../../core/math.js';
import { Cells } from '../../core/cells.js';

const PICKS = ['nearest', 'facing', 'aim'];
// 'facing': within 60° either side of where the actor faces (wide enough for a gamepad stick, narrow enough that doors behind you stay dark)
const FACING_COS = 0.5;
const APPROACH_ARRIVE = 1.2;   // approach: meters from the target the walk stops at (inside the default 2.5 m reach, outside a body's radius)
const AIM_WIDTH = 0.75;   // 'aim': meters the object may sit off the screen-center ray (an object is a vertical segment from its base up to its prompt height)
const V = new THREE.Vector3(), W = new THREE.Vector3(), O = new THREE.Vector3(), D = new THREE.Vector3();
// index: reach above FAR is measured every pass (the query circle would cover too many cells); a record's model may stand up to SLACK m (xz) from its record
// between a fixed step moving the record and the frame placing the model, so record queries reach that much further
const FAR = 64, SLACK = 2, FIX_CELL = 16;

const SETUP_FIX = "e.g. engine.use(interactions({ ...presets.interactions.nearest })) (import { presets } from 'threedog'), or interactions({ pick: 'nearest' | 'facing' | 'aim' | fn, keys: ['KeyE'] })";

export class Interactions {
  constructor(engine, { action = 'interact', promptHeight, radius = 2.5, pick, keys } = {}) {
    // No default pick and no default key: which object counts as "in front of you" and which key uses it are the game's choices (genericity rule:
    // core carries no preset). presets.interactions.* bundle common pairs, so the fix is one spread.
    if (pick === undefined) throw codedError('interaction-setup', `interactions(): no pick given; ${SETUP_FIX}`);
    if (typeof pick !== 'function' && !PICKS.includes(pick)) throw codedError('interaction-setup', `interactions({ pick }): '${pick}' is not a pick mode. Use ${PICKS.map(p => `'${p}'`).join(' | ')} or a function (candidates, ctx) => candidate`);
    if (keys) engine.input.define(action, keys, 'input.interact');
    else if (!engine.input.actions.has(action)) throw codedError('interaction-setup', `interactions(): the '${action}' action has no keys; pass keys: ['KeyE'] (or bind it: createEngine({ bindings: { ${action}: ['KeyE'] } })); ${SETUP_FIX}`);
    this.engine = engine;
    this.action = action;
    this.radius = radius;
    this.promptHeight = promptHeight ?? engine.style.ui?.promptHeight ?? 2.4;
    /**
     * How the interaction in front of the actor is chosen; can be swapped at runtime (first person: 'aim', top-down: 'nearest') @type {'nearest' | 'facing' |
     * 'aim' | Function}
     */
    this.pickMode = pick;
    this.items = [];
    /** @internal where each item is found: _free measured every pass, _fixed (fixed positions) and _byRec (record id → items on its model) through indexes */
    this._free = []; this._fixed = new Cells(FIX_CELL); this._byRec = new Map(); this._fixR = 0; this._recR = 0;
    /** @internal candidates of the current query (reused) */ this._cand = [];
    this._onFixed = en => { this._cand.push(en.it); };
    this._onRec = rec => { const l = this._byRec.get(rec.id); if (l) for (let i = 0; i < l.length; i++) this._cand.push(l[i]); };
    /** The interaction the prompt shows (best over all actions), null if none */
    this.current = null;
    /** One best interaction per action this frame ([{ action, id, label }]) for a prompt that lists several keys */
    this.options = [];
    this._actions = new Set();
    this._seq = 0; this._order = 0;
    /** @internal non-zero during one fixed() / update() pass: each item's world position is computed once per pass, not once per action */ this._pass = 0;
    this._passes = 0;
    engine.input.touchButton(action, 'input.interact');
    engine.ui.define('prompt', promptPart);
    /** @internal clicking the prompt: the same op as the interact key */
    this._use = () => { if (this.current) engine.ops.run('interaction.use', { id: this.current.id }, { source: 'player' }); };
    this._shown = false;
    /** The hold in progress { id, action, seconds, progress (0-1) }, null when none. Read-only: releasing the key stops it @type {any} */
    this.holding = null;
  }

  /**
   * Add an interaction. target is a three.js object (followed) or a fixed position (Vector3 / [x, y, z] / { x, y, z }). label is text or a function returning
   * text
   * (put state-dependent text here: () => locked ? 'Unlock' : 'Open'); enabled returning false hides the prompt entirely; action defaults to 'interact';
   * radius defaults to interactions({ radius }) (2.5 m; Infinity = from anywhere, usually with approach). Add two with different actions to give one object
   * two verbs. hold: seconds the key must stay down (progress goes to the prompt; release, leaving reach or disabled interrupts it: interaction:interrupt).
   * approach: true walks the player there first (walkTo, stops 1.2 m away), then uses it. Returns a handle { remove() }.
   * label, enabled and onUse are called with (object, { actor }): actor is the world record id of who asks / uses it (engine.actor for the local user,
   * a net peer's or an NPC's id when they run interaction.use), so per-actor rules never read engine.player.
   * @example engine.interactions.add(door, { label: (o, { actor }) => owns(actor) ? 'Open' : 'Knock', onUse: (o, { actor }) => engine.ops.run('door.open', { id: o.name }, { actor }) });
   * @example engine.interactions.add(door, { label: 'Open', onUse: open });
   * engine.interactions.add(door, { label: 'Lock', action: 'lock', enabled: () => hasKey, onUse: lock }); // a second verb: define the 'lock' action's key
   * first
   * @example engine.interactions.add(well, { label: 'Pump', hold: 1.5, onUse: fill });                  // keep E down 1.5 s
   * engine.interactions.add(clerk, { label: 'Talk', radius: Infinity, approach: true, onUse: talk });   // from anywhere: walk over, then talk
   * @example // onUse may return a result; interaction.use hands it back as value. Returning { ok: false, code } (failure(code)) fails the op with that code:
   * const r = engine.ops.run('interaction.use'); if (!r.ok) say(r.code) // 'full' for a pickup in a full bag
   */
  add(target, opts = {}) {
    readParams('interactions.add()', keysSchema(['id', 'label', 'radius', 'action', 'onUse', 'enabled', 'height', 'hold', 'approach']), opts);
    const { label = '', radius = this.radius, action = this.action, onUse, enabled = () => true, height, hold = 0, approach = false } = opts;
    if (!(typeof hold === 'number' && hold >= 0)) throw codedError('interaction-option', `interactions.add(): hold is the seconds the key stays down (hold: 1.5), got ${JSON.stringify(hold)}`, TypeError);
    if (!(radius > 0)) throw codedError('interaction-option', `interactions.add(): radius is meters > 0 (Infinity = from anywhere), got ${radius}`, TypeError);
    // stable id for the interaction.use op: given, else the world record being built (pickup, NPC, entity), else a running number
    let id = opts.id ?? this.engine.world?.buildingId ?? 'interaction' + (++this._seq);
    if (this.get(id)) id += '#' + (++this._seq);
    let object = target;
    if (!target?.isObject3D) { object = new THREE.Object3D(); vec3(target, object.position); }
    // a fixed position never moves: its world position is known now; an object is measured once per pass (_at)
    const it = { id, object, label, radius, action, onUse, enabled, height, hold, approach: !!approach, _p: new THREE.Vector3(), _at: target?.isObject3D ? -1 : Infinity,
      _n: this._order++, _in: 'free', _rec: target?.isObject3D ? this.engine.world?.buildingId ?? null : null, _en: null };
    if (!target?.isObject3D) it._p.copy(object.position);
    this.items.push(it);
    if (!target?.isObject3D && radius <= FAR) {
      it._in = 'fixed'; it._en = { id: '#' + it._n, position: it._p, it };
      this._fixed.put(it._en); if (radius > this._fixR) this._fixR = radius;
    } else this._free.push(it);   // a record's model waits here until world shows it as that record's view (_promote)
    return { remove: () => { this.items = this.items.filter(x => x !== it); this._unindex(it); if (this.current === it) this.current = null; } };
  }
  /** @internal */
  _unindex(it) {
    if (it._in === 'fixed') this._fixed.delete(it._en);
    else if (it._in === 'rec') { const l = this._byRec.get(it._rec); l.splice(l.indexOf(it), 1); if (!l.length) this._byRec.delete(it._rec); }
    else { const i = this._free.indexOf(it); if (i >= 0) this._free.splice(i, 1); }
    it._in = null;
  }
  /** @internal An item on a record's model root moves to the record index once world shows that model (its root stands where the record is) */
  _promote(it, i) {
    const f = this._free; f[i] = f[f.length - 1]; f.pop();
    it._in = 'rec';
    let l = this._byRec.get(it._rec); if (!l) this._byRec.set(it._rec, l = []); l.push(it);
    if (it.radius > this._recR) this._recR = it.radius;
  }
  /** @internal Fill _cand with every item that may be within reach of pos (a superset; callers measure each exactly) */
  _gather(pos, action) {
    const C = this._cand, f = this._free, Wd = this.engine.world;
    C.length = 0;
    for (let i = f.length - 1; i >= 0; i--) {   // backwards: promoting swaps the last one into i
      const it = f[i];
      if (it._rec !== null && it.radius <= FAR && Wd?.view(it._rec) === it.object) this._promote(it, i);
      else if (action === undefined || it.action === action) C.push(it);
    }
    if (this._fixR) this._fixed.forEach(pos, this._fixR, this._onFixed);
    if (this._recR && Wd) Wd.forEachNear(pos, this._recR + SLACK, this._onRec);
    if (action !== undefined) { let k = 0; for (let i = 0; i < C.length; i++) if (C[i].action === action) C[k++] = C[i]; C.length = k; }
    return C;
  }

  /** The interaction with this id (null if none). @param {string} id */
  get(id) { return this.items.find(x => x.id === id) ?? null; }

  /** The interaction actor would use now for action (any action when omitted), by the pick mode; null if none in range. @internal */
  pick(actor = this.engine.actor, action) {
    const e = this.engine, p = e.actorPosition(actor);
    if (!p) return null;
    const pos = W.set(p.x, p.y ?? 0, p.z), mode = this.pickMode;
    if (typeof mode === 'function') return this._custom(mode, actor, pos, action);
    // 'aim' follows the camera, which only the local user looks through; anyone else aims where they face
    const aim = mode === 'aim' && actor === e.actor;
    // the actor's body, for its facing
    const obj = mode === 'nearest' || aim ? null : actor === 'player' && e.player ? e.player.root : e.world?.view(actor) ?? null;
    if (obj) { obj.getWorldDirection(D); D.y = 0; D.normalize(); }
    if (aim) { e.camera.getWorldPosition(O); e.camera.getWorldDirection(D); }
    let best = null, bestS = Infinity;
    const C = this._gather(pos, action);
    for (let i = 0; i < C.length; i++) {
      const it = C[i], q = this._where(it), d = q.distanceTo(pos);
      if (d >= it.radius || !it.enabled(it.object, { actor })) continue;
      let s = d;
      if (aim) s = this._offRay(q, it.height ?? this.promptHeight);
      else if (obj && d > 0.5) {   // standing on top of it counts as facing it
        const c = ((q.x - pos.x) * D.x + (q.z - pos.z) * D.z) / Math.hypot(q.x - pos.x, q.z - pos.z);
        if (c < FACING_COS) continue;
        s = d / it.radius + (1 - c);   // mostly "straight ahead", then "closer"
      }
      if (s < bestS || best && s === bestS && it._n < best._n) { best = it; bestS = s; }   // a tie goes to the earlier added (the order a full scan had)
    }
    return best;
  }
  /** @internal An item's world position: cached for the current pass, live outside one (ops run from a test or the dev bridge) */
  _where(it) {
    if (it._at === Infinity) return it._p;
    if (this._pass && it._at === this._pass) return it._p;
    it._at = this._pass;
    return it.object.getWorldPosition(it._p);
  }
  /** @internal 'aim': meters from the camera ray (O, D) to the object's vertical segment; Infinity when behind the camera or too far off */
  _offRay(q, h) {
    const t = (q.x - O.x) * D.x + (q.y - O.y) * D.y + (q.z - O.z) * D.z;
    if (t <= 0) return Infinity;
    const rx = O.x + D.x * t, ry = O.y + D.y * t, rz = O.z + D.z * t;
    const off = Math.hypot(rx - q.x, ry - Math.min(Math.max(ry, q.y), q.y + h), rz - q.z);
    return off <= AIM_WIDTH ? off : Infinity;
  }
  /** @internal A game's pick function gets the enabled ones in range, nearest first */
  _custom(fn, actor, pos, action) {
    const list = [], C = this._gather(pos, action);
    for (let i = 0; i < C.length; i++) {
      const it = C[i], distance = this._where(it).distanceTo(pos);
      if (distance < it.radius && it.enabled(it.object, { actor })) list.push({ id: it.id, object: it.object, action: it.action, label: it.label, distance, _n: it._n });
    }
    if (!list.length) return null;
    list.sort((a, b) => a.distance - b.distance || a._n - b._n);
    for (const c of list) delete c._n;
    const c = fn(list, { engine: this.engine, actor, position: pos, action });
    return c ? this.get(c.id) : null;
  }
  /** Fixed step: each action's key fires that action's pick (input snapshot, frame-rate independent; picked on the spot, not from last frame). @internal */
  fixed(dt) {
    const inp = this.engine.input;
    if (!inp.enabled) { if (this._hold) this._interrupt('inputLocked'); return; }
    this._pass = ++this._passes;
    this._actions.clear();
    for (const it of this.items) this._actions.add(it.action);
    if (this._hold) this._tickHold(dt);
    for (const a of this._actions) {
      if (!inp.pressed(a) || this._hold) continue;
      const b = this.pick(undefined, a);
      if (!b) continue;
      if (b.hold > 0) { this._hold = { it: b, action: a, t: 0 }; this._holdView(); this.engine.events.emit('interaction:hold', { id: b.id, action: a, seconds: b.hold }); }
      else this.engine.ops.run('interaction.use', { id: b.id }, { source: 'player' });
    }
    this._pass = 0;
  }
  /** @internal One fixed step of the hold: released / removed / disabled / out of reach interrupts it, else it counts; complete = the op interaction.use */
  _tickHold(dt) {
    const h = this._hold, it = h.it, e = this.engine, p = e.actorPosition();
    const why = !e.input.down(h.action) ? 'released' : !this.items.includes(it) ? 'removed' : !it.enabled(it.object, { actor: e.actor }) ? 'disabled'
      : !p || this._where(it).distanceTo(W.set(p.x, p.y ?? 0, p.z)) >= it.radius ? 'tooFar' : null;
    if (why) return this._interrupt(why);
    h.t += dt; this._holdView();
    if (h.t < it.hold) return;
    this._hold = this.holding = null;
    e.ops.run('interaction.use', { id: it.id }, { source: 'player' });
  }
  /** @internal */
  _holdView() { const h = this._hold; this.holding = { id: h.it.id, action: h.action, seconds: h.it.hold, progress: Math.min(1, h.t / h.it.hold) }; }
  /** @internal */
  _interrupt(reason) {
    const h = this._hold; this._hold = this.holding = null;
    this.engine.events.emit('interaction:interrupt', { id: h.it.id, action: h.action, reason, progress: Math.min(1, h.t / h.it.hold) });
  }

  /** Per frame: pick per action for options, and the prompt follows the best one. @internal */
  update() {
    this._pass = ++this._passes;
    try { this._update(); } finally { this._pass = 0; }
  }
  /** @internal */
  _update() {
    this.options.length = 0;
    this._actions.clear();
    for (const it of this.items) this._actions.add(it.action);
    const best = this.current = this._actions.size > 1 ? this._perAction() : this.pick();
    if (best && this._actions.size === 1) this.options.push({ action: best.action, id: best.id, label: labelOf(best, this.engine.actor) });
    const input = this.engine.input;
    const part = this.engine.ui.get('prompt');
    if (!best || !input.enabled || !part) { if (this._shown) part?.hide(); this._shown = false; return; }
    const label = labelOf(best, this.engine.actor), key = input.label(best.action);
    best.object.getWorldPosition(V); V.y += best.height ?? this.promptHeight;
    const s = worldToScreen(this.engine, V);
    // progress: the running hold on this one (0-1), 0 for a hold not started, null for a plain press
    const progress = this.holding?.id === best.id ? this.holding.progress : best.hold > 0 ? 0 : null;
    part.update({ id: best.id, action: best.action, key, label, text: `${key} · ${label}`, x: s.x, y: s.y, onScreen: s.onScreen, use: this._use, options: this.options, progress });
    this._shown = true;
  }
  /** @internal Several actions: fill options, return the default action's pick (else the first found) for the prompt */
  _perAction() {
    let main = null, first = null;
    for (const a of this._actions) {
      const b = this.pick(undefined, a);
      if (!b) continue;
      this.options.push({ action: a, id: b.id, label: labelOf(b, this.engine.actor) });
      if (a === this.action) main = b;
      first ??= b;
    }
    return main ?? first;
  }
}

// label / enabled / onUse all get (object, { actor }): who is asking is part of the question (a door that only its owner may open, a shop that greets each
// net peer by name), so a game never has to read engine.actor or engine.player inside them and they stay right for NPCs and peers
const labelOf = (it, actor) => typeof it.label === 'function' ? it.label(it.object, { actor }) : it.label;
// shortcut: approach walks only the player (actor 'player'); a squad / RTS game whose actor is an NPC gets 'cannotWalk' until NPC actors map to a Character
const walkerOf = (e, actor) => actor === 'player' && e.player?.walkTo ? e.player : null;

const INTERACTION_PARAMS = {
  action: { type: 'string', default: 'interact', desc: 'input action that uses the interaction' },
  pick: { type: 'any', optional: true, desc: "which one counts as in front of you: 'nearest' | 'facing' | 'aim' | a function (required; checked with a fix hint on install)" },
  keys: { type: 'array', optional: true, desc: "keys that use it, e.g. ['KeyE'] (required unless createEngine({ bindings }) binds the action)" },
  radius: { type: 'number', default: 2.5, min: 0, desc: 'reach in meters (add() can set its own)' },
  promptHeight: { type: 'number', optional: true, desc: 'prompt height above the target (meters)' },
};

/**
 * Interactions module. Installs engine.interactions.
 * pick and keys are required (the engine picks neither; presets.interactions.* bundle them). radius: default reach of add() in meters (2.5); pick: how the
 * interaction in front of the actor is chosen —
 * 'nearest' (top-down and third person), 'facing' (only what the actor faces, within 60°: souls-likes, the door behind you stays dark),
 * 'aim' (closest to the screen-center ray: first person and shooters), or a function (candidates, ctx) => one of candidates | null,
 * where candidates are the enabled ones in range ({ id, object, action, label, distance }, nearest first) and ctx is { engine, actor, position, action }.
 * keys: the action's keys (default action 'interact'); leave it out only when the game already bound the action (createEngine({ bindings })).
 * @example engine.use(interactions({ ...presets.interactions.nearest }));                       // E, the nearest one
 * engine.use(interactions({ pick: 'aim', keys: ['KeyF'], radius: 2 }));                           // first person
 * engine.use(interactions({ pick: (list) => list.find(c => c.id.startsWith('npc')) ?? list[0], keys: ['KeyE'] }));   // people before things
 * @param {{ action?: string, promptHeight?: number, radius?: number, pick: 'nearest' | 'facing' | 'aim' | ((candidates: any[], ctx: any) => any), keys?:
 * string[] }} opts
 */
export function interactions(opts) {
  const o = readParams('interactions', INTERACTION_PARAMS, opts ?? {});
  let i = null;
  return { name: 'interactions', label: 'Interactions', params: INTERACTION_PARAMS, options: o, noSkip: 'input and prompt state only', stage: 'gameplay',
    install(e) { i = new Interactions(e, opts); defineUse(e, i); return i; },
    fixed(dt) { i.fixed(dt); }, frame() { i.update(); },
    // interactions are "weak" info: when an NPC, pickup or entity already reported the same object, only add "interactable: xxx"
    describe(e, ctx) {
      for (const it of i.items) if (it.enabled(it.object, { actor: e.actor })) { const use = labelOf(it, e.actor); ctx.near(it.object, { name: use, kind: 'interactable', use }, true); }
      if (i.current) return { current: labelOf(i.current, e.actor) };
    } };
}

/** The engine op interaction.use { id?, action? }: what the interact key, the prompt click, the dev bridge and tests all run */
function defineUse(e, i) {
  const find = (id, action, ctx) => id !== undefined ? i.get(id) : i.pick(ctx.actor, action);
  e.ops.define('interaction.use', {
    desc: 'Use an interaction (talk, pick up, open...); without id, the one the actor would pick now (optionally for one action)',
    args: { id: 'string?', action: 'string?' },
    net: 'local',   // the prompt and reach are this player's; game ops inside onUse are routed to the host (net: 'peer' ones) or refused
    can(e, { id, action }, ctx) {
      const it = find(id, action, ctx);
      if (!it) return id === undefined ? 'nothingNear' : 'unknown';
      if (!it.enabled(it.object, { actor: ctx.actor })) return 'disabled';
      if (ctx.actor === e.actor && !e.input.enabled) return 'inputLocked';
      if (it.approach && !walkerOf(e, ctx.actor)) return 'cannotWalk';
      const p = e.actorPosition(ctx.actor);
      if (it.approach || !p) return true;
      // tooFar names the distance, the radius and where to stand: a bridge / test call (threedog op interaction.use) with the player elsewhere
      // got a bare 'tooFar' and the AI guessed; applyState({ pos }) next to `at` first
      const d = it.object.getWorldPosition(V).distanceTo(W.set(p.x, p.y ?? 0, p.z)), r1 = v => Math.round(v * 10) / 10;
      return d >= it.radius ? { code: 'tooFar', facts: { distance: r1(d), radius: it.radius, at: { x: r1(V.x), z: r1(V.z) } } } : true;
    },
    // onUse's return value is the op's value; { ok: false, code } fails the op (pickups: code 'full' when the bag is full).
    // approach from afar: the value is { approaching } (a Promise of onUse's result after arrival, or the walk's { status } when it did not arrive)
    run(e, { id, action }, ctx) {
      const it = find(id, action, ctx);
      if (!it.approach) return it.onUse?.(it.object, { actor: ctx.actor });
      const ch = walkerOf(e, ctx.actor), q = it.object.getWorldPosition(new THREE.Vector3());
      if (Math.hypot(q.x - ch.position.x, q.z - ch.position.z) <= APPROACH_ARRIVE + 0.3) return it.onUse?.(it.object, { actor: ctx.actor });
      // used after arrival, so checked again then: removed or disabled while walking = not used
      return { approaching: ch.walkTo(q, { arrive: APPROACH_ARRIVE }).then(r => r.status === 'arrived' && i.items.includes(it) && it.enabled(it.object, { actor: ctx.actor }) ? it.onUse?.(it.object, { actor: ctx.actor }) : r) };
    },
    offers(e, ctx) { const it = find(undefined, undefined, ctx); return it ? [{ id: it.id }] : []; },
    reasons: { unknown: 'No interaction with this id', nothingNear: 'No interaction in range', disabled: 'Its enabled() is false', tooFar: 'Actor is outside its radius', cannotWalk: 'approach walks the player; this actor has no character to walk', inputLocked: 'A window or dialogue locks input' },
  });
}
