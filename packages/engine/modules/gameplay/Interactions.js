// Interactions module: a prompt appears near an object ("E · 和老渔夫说话"), and the interact key fires a callback (dialogue, pickup, fishing, chopping...).
//
// engine.interactions.add(npc, { label: '和老渔夫说话', onUse: () => engine.dialogue.start('老渔夫') });
// Using one is the op interaction.use { id?, action? } (recipes/23-ops.md): the interact key (in fixed), a click on the prompt, the dev bridge and tests all
// run it,
// so every use is logged and checked by the same can (exists, enabled, in range, input not locked). Without id it uses the one the actor would pick now.
// Who interacts is engine.actor (core/actor.js), measured with engine.actorPosition(): the player by default, a vehicle or squad member when the game says so.
// How the one in front of you is chosen is the pick option: 'nearest' | 'facing' | 'aim' | a function (see interactions()). Each action is picked on its own,
// so one object can carry "Open" and "Lock" as two interactions with different action names (each bound to the game's own key).
// The prompt is the UI part 'prompt' (default interactionPrompt.js, CSS class .threedog-prompt): replace it or turn it off with engine.ui.set('prompt', ...);
// prompt height style.ui.promptHeight (meters)
import * as THREE from 'three';
import { worldToScreen } from '../../ui/UI.js';
import { promptPart } from './interactionPrompt.js';
import { checkOptions } from '../../core/validate.js';
import { readParams } from '../../core/params.js';
import { codedError } from '../../core/errorHints.js';
import { vec3 } from '../../core/math.js';

const PICKS = ['nearest', 'facing', 'aim'];
// 'facing': within 60° either side of where the actor faces (wide enough for a gamepad stick, narrow enough that doors behind you stay dark)
const FACING_COS = 0.5;
const AIM_WIDTH = 0.75;   // 'aim': meters the object may sit off the screen-center ray (an object is a vertical segment from its base up to its prompt height)
const V = new THREE.Vector3(), W = new THREE.Vector3(), O = new THREE.Vector3(), D = new THREE.Vector3();

const SETUP_FIX = "e.g. engine.use(interactions({ ...presets.interactions.nearest })) (import { presets } from 'threedog'), or interactions({ pick: 'nearest' | 'facing' | 'aim' | fn, keys: ['KeyE'] })";

export class Interactions {
  constructor(engine, { action = 'interact', promptHeight, radius = 2.5, pick, keys } = {}) {
    // No default pick and no default key: which object counts as "in front of you" and which key uses it are the game's choices (genericity rule:
    // core carries no preset). presets.interactions.* bundle common pairs, so the fix is one spread.
    if (pick === undefined) throw codedError('interaction-setup', `interactions(): no pick given; ${SETUP_FIX}`);
    if (typeof pick !== 'function' && !PICKS.includes(pick)) throw new Error(`interactions({ pick }): '${pick}' is not a pick mode. Use ${PICKS.map(p => `'${p}'`).join(' | ')} or a function (candidates, ctx) => candidate`);
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
    /** The interaction the prompt shows (best over all actions), null if none */
    this.current = null;
    /** One best interaction per action this frame ([{ action, id, label }]) for a prompt that lists several keys */
    this.options = [];
    this._actions = new Set();
    this._seq = 0;
    /** @internal non-zero during one fixed() / update() pass: each item's world position is computed once per pass, not once per action */ this._pass = 0;
    this._passes = 0;
    engine.input.touchButton(action, 'input.interact');
    engine.ui.define('prompt', promptPart);
    /** @internal clicking the prompt: the same op as the interact key */
    this._use = () => { if (this.current) engine.ops.run('interaction.use', { id: this.current.id }, { source: 'player' }); };
    this._shown = false;
  }

  /**
   * Add an interaction. target is a three.js object (followed) or a fixed position (Vector3 / [x, y, z] / { x, y, z }). label is text or a function returning
   * text
   * (put state-dependent text here: () => locked ? 'Unlock' : 'Open'); enabled returning false hides the prompt entirely; action defaults to 'interact';
   * radius defaults to interactions({ radius }) (2.5 m). Add two with different actions to give one object two verbs. Returns a handle { remove() }.
   * @example engine.interactions.add(door, { label: 'Open', onUse: open });
   * engine.interactions.add(door, { label: 'Lock', action: 'lock', enabled: () => hasKey, onUse: lock }); // a second verb: define the 'lock' action's key
   * first
   * @example // onUse may return a result; interaction.use hands it back as value: const r = engine.ops.run('interaction.use'); if (r.ok && r.value?.ok ===
   * false) say(r.value.reason) // 'full' for a pickup
   */
  add(target, opts = {}) {
    checkOptions('interactions.add()', opts, ['id', 'label', 'radius', 'action', 'onUse', 'enabled', 'height']);
    const { label = '', radius = this.radius, action = this.action, onUse, enabled = () => true, height } = opts;
    // stable id for the interaction.use op: given, else the world record being built (pickup, NPC, entity), else a running number
    let id = opts.id ?? this.engine.world?.buildingId ?? 'interaction' + (++this._seq);
    if (this.get(id)) id += '#' + (++this._seq);
    let object = target;
    if (!target?.isObject3D) { object = new THREE.Object3D(); vec3(target, object.position); }
    // a fixed position never moves: its world position is known now; an object is measured once per pass (_at)
    const it = { id, object, label, radius, action, onUse, enabled, height, _p: new THREE.Vector3(), _at: target?.isObject3D ? -1 : Infinity };
    if (!target?.isObject3D) it._p.copy(object.position);
    this.items.push(it);
    return { remove: () => { this.items = this.items.filter(x => x !== it); if (this.current === it) this.current = null; } };
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
    for (const it of this.items) {
      if (action !== undefined && it.action !== action) continue;
      const q = this._where(it), d = q.distanceTo(pos);
      if (d >= it.radius || !it.enabled()) continue;
      let s = d;
      if (aim) s = this._offRay(q, it.height ?? this.promptHeight);
      else if (obj && d > 0.5) {   // standing on top of it counts as facing it
        const c = ((q.x - pos.x) * D.x + (q.z - pos.z) * D.z) / Math.hypot(q.x - pos.x, q.z - pos.z);
        if (c < FACING_COS) continue;
        s = d / it.radius + (1 - c);   // mostly "straight ahead", then "closer"
      }
      if (s < bestS) { best = it; bestS = s; }
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
    const list = [];
    for (const it of this.items) {
      if (action !== undefined && it.action !== action) continue;
      const distance = this._where(it).distanceTo(pos);
      if (distance < it.radius && it.enabled()) list.push({ id: it.id, object: it.object, action: it.action, label: it.label, distance });
    }
    if (!list.length) return null;
    list.sort((a, b) => a.distance - b.distance);
    const c = fn(list, { engine: this.engine, actor, position: pos, action });
    return c ? this.get(c.id) : null;
  }
  /** Fixed step: each action's key fires that action's pick (input snapshot, frame-rate independent; picked on the spot, not from last frame). @internal */
  fixed() {
    const inp = this.engine.input;
    if (!inp.enabled) return;
    this._pass = ++this._passes;
    this._actions.clear();
    for (const it of this.items) this._actions.add(it.action);
    for (const a of this._actions) {
      if (!inp.pressed(a)) continue;
      const b = this.pick(undefined, a);
      if (b) this.engine.ops.run('interaction.use', { id: b.id }, { source: 'player' });
    }
    this._pass = 0;
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
    if (best && this._actions.size === 1) this.options.push({ action: best.action, id: best.id, label: labelOf(best) });
    const input = this.engine.input;
    const part = this.engine.ui.get('prompt');
    if (!best || !input.enabled || !part) { if (this._shown) part?.hide(); this._shown = false; return; }
    const label = labelOf(best), key = input.label(best.action);
    best.object.getWorldPosition(V); V.y += best.height ?? this.promptHeight;
    const s = worldToScreen(this.engine, V);
    part.update({ id: best.id, action: best.action, key, label, text: `${key} · ${label}`, x: s.x, y: s.y, onScreen: s.onScreen, use: this._use, options: this.options });
    this._shown = true;
  }
  /** @internal Several actions: fill options, return the default action's pick (else the first found) for the prompt */
  _perAction() {
    let main = null, first = null;
    for (const a of this._actions) {
      const b = this.pick(undefined, a);
      if (!b) continue;
      this.options.push({ action: a, id: b.id, label: labelOf(b) });
      if (a === this.action) main = b;
      first ??= b;
    }
    return main ?? first;
  }
}

const labelOf = it => typeof it.label === 'function' ? it.label() : it.label;

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
    fixed() { i.fixed(); }, frame() { i.update(); },
    // interactions are "weak" info: when an NPC, pickup or entity already reported the same object, only add "interactable: xxx"
    describe(e, ctx) {
      for (const it of i.items) if (it.enabled()) { const use = labelOf(it); ctx.near(it.object, { name: use, kind: 'interactable', use }, true); }
      if (i.current) return { current: labelOf(i.current) };
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
      if (!it.enabled()) return 'disabled';
      if (ctx.actor === e.actor && !e.input.enabled) return 'inputLocked';
      const p = e.actorPosition(ctx.actor);
      return p && it.object.getWorldPosition(V).distanceTo(W.set(p.x, p.y ?? 0, p.z)) >= it.radius ? 'tooFar' : true;
    },
    // onUse's return value is the op's value: pickups give { ok:false, reason:'full' } when the bag is full
    run(e, { id, action }, ctx) { const it = find(id, action, ctx); return it.onUse?.(it.object); },
    offers(e, ctx) { const it = find(undefined, undefined, ctx); return it ? [{ id: it.id }] : []; },
    reasons: { unknown: 'No interaction with this id', nothingNear: 'No interaction in range', disabled: 'Its enabled() is false', tooFar: 'Actor is outside its radius', inputLocked: 'A window or dialogue locks input' },
  });
}
