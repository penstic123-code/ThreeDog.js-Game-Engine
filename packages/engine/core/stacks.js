// Modifier stacks: the ONE way several systems change a shared quantity (time scales, the calendar rate, pause / freeze / camera holders; move speed,
// gravity and input gates reuse it later). One entry, one line:
//   const h = engine.mod('time.enemies', { owner: 'bullet-time', mul: 0.35, for: 2 });   // bullet time; h.remove() ends it early
// Why a stack and not "write the field, remember the old value": with two or more effects the remembered value is wrong as soon as they end in
// another order (bullet time saves 0.35 under a stopwatch, ends, the stopwatch restores 0.35 forever). Here nothing remembers an old value: every
// read equals a recompute from the base and the entries that are still there (a memo is reused only until the next change), so ending one
// entry can never resurrect another one's value.
// Rules (the same for every stack, so a tool can predict them):
//   - one entry per owner (per id for per-record stacks): the same owner modding again replaces its entry with a new one taken now (it becomes the
//     latest: 'top' puts it in charge, a tied set wins), and the old handle no longer ends anything
//   - only the owner ends it: handle.remove() / release(owner) drop that owner's entry; a stale handle (the owner ended and modded again) ends nothing
//   - number stacks combine by layer (priority: base 0 < game 100 (default) < effect 200 < system 300 < debug 400, or a number), lowest first;
//     inside a layer: set (the latest one) replaces the value, then every add is summed in, then every mul multiplies, then every clamp narrows it.
//     A higher layer's set hides everything below. The result is clamped to the stack's own min / max last.
//   - kind 'any' (freeze, pause, input gates): true while anyone holds it; kind 'top' (camera): the latest holder's value is in charge
//   - for: seconds then it ends by itself, measured on clock ('real' = fixed seconds, which stop while frozen, or a time channel name); saved with
//     the time left, and engine.skip ends it at the right point of the jump
// Plain JS stays first-class: a game's own fields and onFixed logic never need this; it is for quantities several systems write.
import { codedError } from './errorHints.js';
import { DEV, warnOnce } from './validate.js';

/** Named priority layers (a number works too) */
const PRIORITY = { base: 0, game: 100, effect: 200, system: 300, debug: 400 };
const NUM_OPS = ['set', 'add', 'mul', 'clamp'];
const KEYS = ['owner', 'set', 'add', 'mul', 'clamp', 'value', 'for', 'clock', 'id', 'priority'];
const SAVE_BELOW = PRIORITY.system;   // system / debug entries (menus, debug, cutscenes) are "what the screen is doing now": not saved, retaken after a load

const fail = msg => codedError('mod-owner', msg);

/**
 * pause('x') and pause({ owner: 'x' }) both work everywhere an owner is named
 * @param {string | { owner?: string } | undefined} a @param {any} [b] @returns {{ owner: string, opts: any }}
 */
export function ownerArgs(a, b, fallback = 'game') {
  if (a && typeof a === 'object') return { owner: a.owner ?? fallback, opts: a };
  return { owner: a ?? fallback, opts: b ?? {} };
}

/** One shared quantity. Made by stacks.define; games normally only call engine.mod(name, ...) and read value(). */
export class Stack {
  /** @param {Stacks} all @param {string} name @param {any} o */
  constructor(all, name, { kind = 'number', base, min = -Infinity, max = Infinity, save = true, onChange = null, per = false }) {
    this.all = all; this.name = name; this.kind = kind;
    this.base = base ?? (kind === 'number' ? 1 : kind === 'any' ? false : null);
    this.min = min; this.max = max; this.save = save; this.per = per; this.onChange = onChange;
    /** @type {Map<string, Map<string, any>>} id ('' when not per record) -> owner -> entry */
    this._by = new Map();
    // number value memo: id -> { ver, base, v }. Movers read speed / gravity / jump per character per step, and the layered combine allocates
    // lists and Sets whenever any entry exists. Every change goes through _changed (take, remove, expiry, dropId, clear, load), which bumps _ver,
    // so a memo with the same _ver and base is exactly what a recompute would give
    this._ver = 0; this._memo = new Map();
  }
  /** @internal */
  _map(id, make) { let m = this._by.get(id ?? ''); if (!m && make) this._by.set(id ?? '', m = new Map()); return m; }
  /**
   * Add or update owner's entry. Number stacks take exactly one of set / add / mul / clamp ({ min, max }); 'any' stacks need none (holding is the
   * value); 'top' stacks take value (any data, e.g. the camera focus).
   * @returns {{ owner: string, remove(): void }}
   */
  take(o) {
    const { owner } = o;
    if (!owner || typeof owner !== 'string') throw fail(`engine.mod('${this.name}', { owner }): owner is a non-empty string naming who holds it, e.g. 'my-menu', got ${JSON.stringify(owner)}`);
    let op = null, value;
    if (this.kind === 'number') {
      const ops = NUM_OPS.filter(k => o[k] !== undefined);
      if (ops.length !== 1) throw fail(`engine.mod('${this.name}', { owner: '${owner}', ... }): give exactly one of set / add / mul / clamp, e.g. { owner: '${owner}', mul: 0.5 }; got ${ops.length ? ops.join(' + ') : 'none'}`);
      op = ops[0]; value = o[op];
      const ok = op === 'clamp' ? value && typeof value === 'object' : Number.isFinite(value);
      if (!ok) throw fail(`engine.mod('${this.name}', { ${op} }): ${op === 'clamp' ? 'clamp is { min?, max? }' : op + ' is a finite number'}, got ${JSON.stringify(value)}`);
    } else value = o.value ?? (this.kind === 'top' ? null : true);   // any: optional data beside the hold (a pause's kind); top: the holder's value
    if (this.per === true && o.id == null) throw fail(`engine.mod('${this.name}'): this quantity is per record, pass { id }, e.g. { owner: '${owner}', id: 'slime_3', ... }`);
    const pr = o.priority == null ? PRIORITY.game : typeof o.priority === 'number' ? o.priority : PRIORITY[o.priority];
    if (!Number.isFinite(pr)) throw fail(`engine.mod('${this.name}', { priority }): use ${Object.keys(PRIORITY).join(' / ')} or a number, got ${JSON.stringify(o.priority)}`);
    const clock = o.clock ?? 'real';
    if (o.for != null && !(o.for >= 0 && Number.isFinite(o.for))) throw fail(`engine.mod('${this.name}', { for }): for is seconds >= 0 on clock '${clock}', got ${JSON.stringify(o.for)}`);
    const m = this._map(o.id, true);
    // 再次 take：删掉旧条目再放新对象到末尾。为什么不原地改：原地改时 Map 顺序不变，'top' 的"最新者"和同层 set 的"最新者"都不是它；
    // 而且旧句柄和新句柄指向同一个对象，旧句柄的 remove() 会把新值删掉。新对象让旧句柄的 _drop 比对不上，什么也不删。
    m.delete(owner);
    const ent = { owner, id: o.id ?? null, at: this.all._at(), op, value, priority: pr, clock, until: o.for != null ? this.all._nowOf(clock) + o.for : null };
    m.set(owner, ent);
    this.all._timedDirty = true;
    this._changed(o.id);
    return { owner, remove: () => { this._drop(owner, o.id, ent); } };
  }
  /** @internal remove owner's entry (only `ent` when given: a stale handle removes nothing) */
  _drop(owner, id, ent) {
    const m = this._map(id);
    if (!m || (ent && m.get(owner) !== ent) || !m.delete(owner)) return false;
    if (!m.size && (id ?? '') !== '') this._by.delete(id);
    this._changed(id);
    return true;
  }
  /** @internal */
  _changed(id) { this._ver++; this.all._version++; this.onChange?.(id ?? null); }
  /** @internal End owner's entry by name (engine holds: unfreeze / resume); games end theirs with the handle's remove(). false when it held none @param {string} owner @param {{ id?: string }} [o] */
  release(owner, { id } = {}) { return this._drop(owner, id); }
  /** Drop every entry for record id (world.remove does it, so no orphan entries) @param {string} id */
  dropId(id) { this._memo.delete(id); const m = this._by.get(id); if (!m) return; this._by.delete(id); this._changed(id); }
  /** @param {string} owner @param {string} [id] */
  has(owner, id) { return !!this._map(id)?.has(owner); }
  /** Number of entries (for id, or the global ones) */
  size(id) { return this._map(id)?.size ?? 0; }
  /** Owner names in the order they took it @param {string} [id] */
  names(id) { return [...(this._map(id)?.keys() ?? [])]; }
  /**
   * The current value: always equal to recomputing from base + the entries now present (nothing remembers an old value; the number memo
   * is keyed by the stack's change count and the base, so it is that recompute, not an old value).
   * number: the layered result; any: true while anyone holds it; top: the latest holder's value (or base).
   * base: a base kept elsewhere (a character's own speed: the game writes player.speed, the stack only holds the modifiers), default the stack's.
   * per: 'optional' stacks combine the entries without an id (every record) with the record's own, the record's after, so its set wins a tie.
   * @param {string} [id] @param {number} [base]
   */
  value(id, base = this.base) {
    const m = this._map(id), all = this.per === 'optional' && id != null ? this._map(undefined) : null;
    if (this.kind === 'any') return m?.size || all?.size ? true : base;
    if (this.kind === 'top') { let t = null; if (m) for (const e of m.values()) t = e; return t ? t.value : base; }
    if (!m?.size && !all?.size) return Math.min(this.max, Math.max(this.min, base));   // no entries: nothing to remember
    const k = id ?? '', c = this._memo.get(k);
    if (c && c.ver === this._ver && Object.is(c.base, base)) return c.v;
    const v = this._combine(m, all, base);
    if (c) { c.ver = this._ver; c.base = base; c.v = v; } else this._memo.set(k, { ver: this._ver, base, v });
    return v;
  }
  /** @internal the layered number combine (see the rules in the header), clamped to min / max */
  _combine(m, all, base) {
    let v = base;
    const list = all?.size ? [...all.values(), ...(m?.values() ?? [])] : [...m.values()];
    const layers = [...new Set(list.map(e => e.priority))].sort((a, b) => a - b);
    for (const p of layers) {
      const es = list.filter(e => e.priority === p);
      const sets = es.filter(e => e.op === 'set');
      if (sets.length) {
        v = sets[sets.length - 1].value;   // the latest set in the layer (Map keeps take order)
        if (sets.length > 1 && sets.some(s => s.value !== v)) warnOnce(`engine.mod('${this.name}'): ${sets.map(s => `'${s.owner}' sets ${s.value}`).join(', ')} at the same priority ${p}; the latest wins. Give one a higher priority (e.g. priority: 'effect') to say which is in charge`);
      }
      for (const e of es) if (e.op === 'add') v += e.value;
      for (const e of es) if (e.op === 'mul') v *= e.value;
      for (const e of es) if (e.op === 'clamp') v = Math.min(e.value.max ?? Infinity, Math.max(e.value.min ?? -Infinity, v));
    }
    return Math.min(this.max, Math.max(this.min, v));
  }
  /** Each holder's value in take order: [{ owner, value }] (the data an 'any' holder gave, e.g. a pause's kind) @param {string} [id] */
  entries(id) { return [...(this._map(id)?.values() ?? [])].map(e => ({ owner: e.owner, value: e.value })); }
  /** The latest holder's entry ({ owner, value }) or null: for 'top' stacks (the camera in charge) @param {string} [id] */
  top(id) { let t = null; const m = this._map(id); if (m) for (const e of m.values()) t = e; return t; }
  /** What describe shows: [{ owner, op?, value?, priority, left?, clock?, at }] @param {string} [id] */
  holders(id) {
    return [...(this._map(id)?.values() ?? [])].map(e => {
      const h = { owner: e.owner, at: e.at };
      if (this.kind === 'number') Object.assign(h, { op: e.op, value: e.value, priority: e.priority });
      if (e.until != null) Object.assign(h, { left: Math.max(0, e.until - this.all._nowOf(e.clock)), clock: e.clock });
      return h;
    });
  }
  /** The ids that have entries (per-record stacks) */
  ids() { return [...this._by.keys()].filter(k => k !== ''); }
  /** Drop every entry */
  clear() { this._memo.clear(); if (!this._by.size) return; const ids = [...this._by.keys()]; this._by.clear(); for (const id of ids) this._changed(id || null); }
}

/** engine.stacks: every shared quantity by name; engine.mod(name, o) is the one way to change one */
export class Stacks {
  constructor(engine) {
    this.engine = engine;
    /** @type {Map<string, Stack>} */ this._all = new Map();
    /** @internal saved entries of a stack the game has not defined yet: applied when it does */ this._pending = {};
    this._version = 0; this._timedDirty = false;
    /** @internal now on a clock ('real' or a channel); core/time.js replaces it */ this._nowOf = () => 0;
    // at = game clock time of the take (engine.clock.now), not engine.elapsed (time since the page opened): session.newGame resets the clock, so an
    // entry a fresh playthrough makes reads the same in every new game (the session contract: as if the page had just opened)
    this._at = () => engine.clock?.now ?? 0;
    engine.saves?.register('stacks', { save: () => this._save(), load: d => this._load(d) });
    engine.events?.on('world:remove', ({ id }) => { for (const s of this._all.values()) if (s.per) s.dropId(id); });
  }
  /**
   * Define a shared quantity (engine modules and games use the same call). kind: 'number' (default; base 1), 'any' (true while held), 'top' (latest holder wins).
   * per: true = one value per record id (mod with { id }); per: 'optional' = an entry with { id } is that record's, one without is every record's
   * (move.speed: haste on the player, mud on everyone). save: false keeps it out of saves (screen state like the camera holder).
   * @param {string} name @param {{ kind?: 'number' | 'any' | 'top', base?: any, min?: number, max?: number, per?: boolean | 'optional', save?: boolean, onChange?: (id: string | null) => void }} [o]
   * @returns {Stack}
   * @example engine.stacks.define('damageTaken', { per: true, min: 0 }); engine.mod('damageTaken', { owner: 'shield', id: 'player', mul: 0.5, for: 3 });
   */
  define(name, o = {}) {
    if (this._all.has(name)) throw codedError('mod-owner', `engine.stacks.define('${name}'): already defined; read it with engine.stacks.get('${name}')`);
    const s = new Stack(this, name, o);
    this._all.set(name, s);
    if (this._pending[name]) { this._loadOne(s, this._pending[name]); delete this._pending[name]; }
    return s;
  }
  /** @param {string} name @returns {Stack} */
  get(name) {
    const s = this._all.get(name);
    if (!s) throw codedError('unknown-name', `engine.stacks: no quantity '${name}'. Known: ${[...this._all.keys()].join(', ')}. Define your own with engine.stacks.define('${name}', { base })`);
    return s;
  }
  /** @param {string} name */
  has(name) { return this._all.has(name); }
  /** Names of every quantity */
  list() { return [...this._all.keys()]; }
  /**
   * The one entry: change a shared quantity, returns a handle whose remove() ends only this owner's entry.
   * @param {string} name @param {{ owner: string, set?: number, add?: number, mul?: number, clamp?: { min?: number, max?: number }, value?: any, for?: number, clock?: string, id?: string, priority?: number | 'base' | 'game' | 'effect' | 'system' | 'debug' }} o
   * @returns {{ owner: string, remove(): void }}
   */
  mod(name, o) {
    if (DEV) { const bad = Object.keys(o ?? {}).filter(k => !KEYS.includes(k)); if (bad.length) warnOnce(`engine.mod('${name}'): unknown option ${bad.join(', ')}; known: ${KEYS.join(', ')}`); }
    return this.get(name).take(o ?? {});
  }
  /** describe(): every quantity that has entries, { name: holders } (per-record ones as { name: { id: holders } }) */
  describe() {
    const out = {};
    for (const s of this._all.values()) {
      if (s.per) {   // per-record: { id: holders }; a per: 'optional' stack's every-record entries show under '*'
        const o = Object.fromEntries(s.ids().map(id => [id, s.holders(id)]));
        if (s.size()) o['*'] = s.holders();
        if (Object.keys(o).length) out[s.name] = o;
      }
      else if (s.size()) out[s.name] = s.holders();
    }
    return out;
  }
  /** @internal entries with a `for`, as [stack, entry] */
  _timed() {
    const out = [];
    for (const s of this._all.values()) for (const m of s._by.values()) for (const e of m.values()) if (e.until != null) out.push([s, e]);
    return out;
  }
  /**
   * @internal End every entry whose time is up (core/time.js calls it after advancing the clocks), earliest first; emits mod:end for each.
   * @returns {number} how many ended
   */
  _expire() {
    if (!this._timedDirty) return 0;
    const timed = this._timed();
    if (!timed.length) { this._timedDirty = false; return 0; }   // nothing timed: later steps return at once until the next timed mod
    const due = timed.map(([s, e]) => ({ s, e, over: this._nowOf(e.clock) - e.until })).filter(d => d.over >= -1e-9);
    due.sort((a, b) => b.over - a.over);   // the most overdue ended first in time
    for (const { s, e } of due) {
      if (!s._drop(e.owner, e.id, e)) continue;
      this.engine.events?.emit('mod:end', { target: s.name, owner: e.owner, id: e.id });
    }
    return due.length;
  }
  /** @internal smallest time left on any timed entry, converted to game seconds by toGame(clock, left) (engine.skip ends a segment there) */
  _untilNext(toGame) {
    let best = Infinity;
    for (const [, e] of this._timed()) best = Math.min(best, toGame(e.clock, Math.max(0, e.until - this._nowOf(e.clock))));
    return best;
  }
  /** @internal a channel's clock jumped by delta (a load set its now): entries timed on it keep their time left, whichever save part loaded first */
  _rebase(clock, delta) { for (const [, e] of this._timed()) if (e.clock === clock) e.until += delta; }
  /** @internal */
  _save() {
    const out = {};
    for (const s of this._all.values()) {
      if (s.save === false || s.kind !== 'number') continue;
      const list = [];
      for (const m of s._by.values()) for (const e of m.values()) {
        if (e.priority >= SAVE_BELOW) continue;
        list.push({ owner: e.owner, id: e.id, op: e.op, value: e.value, priority: e.priority, clock: e.clock, left: e.until == null ? null : e.until - this._nowOf(e.clock) });
      }
      if (list.length) out[s.name] = list;
    }
    return out;
  }
  /** @internal a load replaces every saved (below-system) entry; system / debug entries stay (the screen that holds them is still up) */
  _load(d) {
    this._pending = {};
    for (const s of this._all.values()) if (s.save !== false && s.kind === 'number') this._loadOne(s, d?.[s.name] ?? []);
    for (const [k, v] of Object.entries(d ?? {})) if (!this._all.has(k)) this._pending[k] = v;
  }
  /** @internal */
  _loadOne(s, list) {
    for (const m of [...s._by.values()]) for (const e of [...m.values()]) if (e.priority < SAVE_BELOW) s._drop(e.owner, e.id, e);
    for (const e of list) {
      const m = s._map(e.id, true);
      m.set(e.owner, { owner: e.owner, id: e.id ?? null, at: this._at(), op: e.op, value: e.value, priority: e.priority, clock: e.clock ?? 'real', until: e.left == null ? null : this._nowOf(e.clock ?? 'real') + e.left });
      this._timedDirty = true;
      s._changed(e.id);
    }
  }
}
