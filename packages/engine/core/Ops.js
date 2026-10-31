// One entry point for actions: engine.ops. An op is one discrete thing an actor (player, NPC, network peer) decides to do:
// buy, talk, attack, roll, fire, craft, build. Continuous input (stick, look) and simulation (hunger, growth, burning) are not ops;
// they stay in fixed / world.simulate.
//   engine.ops.define('shop.buy', { args: { shop: 'string', item: 'string' }, can(e, a, ctx) { return true or 'noMoney' }, run(e, a, ctx) { ... } });
//   engine.ops.run('shop.buy', { shop: 'bakery', item: 'bread' })   // -> { ok: true, value } or { ok: false, reason: 'noMoney' }
// Why one entry: UI clicks, keys, the dev bridge, scenario tests, replay and network peers all end in the same run(),
// checked by the same can() and logged in one history (tick, phase, source, actor). So tests need no key timing,
// the AI can ask "what can I do now", and replay / netcode have a record of who did what on which step.
// run() is always synchronous: inside a fixed step it is phase 'fixed'; between steps (UI, bridge, tests) phase 'between',
// which lands "after step N" and replays the same. Args must be plain data and self-contained (aim direction goes in the args).
// The guard (ops.guard) backs "don't go around it": in dev, saved gameplay state written outside loading, fixed steps and ops
// is reported (see recipes/23-ops.md). Dev argument checks live in opsCheck.js.
import { DEV, missingText, warnOnce } from './validate.js';
import { checkDef, checkArgs, devError, fmt, SOURCES } from './opsCheck.js';
import { reportError } from './errors.js';
import { coded } from './errorHints.js';
import { guardWrite } from './opsGuard.js';
import { newRing, logEntry, recentEntries } from './opsHistory.js';

const MAX_DEPTH = 16;
const STRINGS = {
  dup: "ops.define('{name}'): already defined. To replace it call remove() on the handle define returned first",
  unknown: 'ops.run({name}): {text}',
  canResult: "{name}'s can must return true or a reason string, e.g. return 'noMoney'; got {got}",
  canRun: "{name}'s can called ops.run('{inner}'). can is read-only; call other ops from run",
  loop: 'ops call each other in a loop (deeper than ' + MAX_DEPTH + '): {chain}',
  badSource: "ops.run('{name}'): source '{source}' is not one of " + SOURCES.join(', '),
};

/**
 * engine.ops: one entry point for the discrete things players and NPCs decide to do. define registers, run executes (sync, logged), can only asks, list says what exists / what is possible now, recent reads the log.
 * Inside an op use ctx.actor (world record id, default engine.actor = 'player'), never engine.player: NPCs and network peers run the same op as themselves.
 */
export class Ops {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.defs = new Map();
    /** @internal ring of history entries, allocated once */ this._ring = [];
    /** @internal */ this._head = 0;
    /** @internal */ this._len = 0;
    /** @internal names of the ops currently running (nesting) */ this._stack = [];
    /** @internal */ this._inCan = null;
    /** @internal > 0 while state may be written without an op (save load, applyState, net sync) */ this._allowDepth = 0;
    /** @internal */ this._warned = new Set();
    /** @internal request counter (net replies carry it) */ this._seq = 0;
    /** @internal ctx of the innermost running op (nested ops inherit source and actor) */ this._last = null;
    /** @internal set by net() on clients: (def, args, opts) => result to return instead of running locally, or null to run here */ this._route = null;
    /** @internal set by net() on clients: every write outside allow() is reported, even in fixed steps and ops (own movement, world.move, excepted) */ this._client = false;
    this.historySize = 256;
  }
  /** @internal Name of the innermost op running right now, or null (world records who spawned a runtime record with it, dev only) @type {string | null} */
  get running() { return this._stack.at(-1) ?? null; }

  /** History entries kept (ring, default 256); setting it clears the history */
  get historySize() { return this._ring.length; }
  set historySize(n) {
    this._ring = newRing(n);
    this._head = 0; this._len = 0;
  }

  /**
   * Register an op. Name it noun.verb. run changes state; can (optional) is read-only and returns true or a reason string; offers (optional) lists the arg sets possible now (for list / describe / the dev bridge `ops` command).
   * args shape types: string number int bool position id any, suffix ? for optional. net: 'peer' lets remote players request it (default: host only);
   * owner (optional, checked by net() for peer requests): args => world record id whose `owner` field must equal the requesting actor.
   * @param {string} name
   * @param {{ run: (e: any, args: any, ctx: OpContext) => any, can?: (e: any, args: any, ctx: OpContext) => true | string, args?: Record<string, string>, offers?: (e: any, ctx: OpContext) => object[], reasons?: Record<string, string>, desc?: string, undo?: (e: any, args: any, value: any) => void, net?: 'peer' | 'local', owner?: (args: any) => string }} def
   * @returns {{ remove(): void }}
   * @example
   * const PRICE = { bread: 5 };
   * engine.ops.define('shop.buy', {
   *   desc: 'Buy from a shop shelf',
   *   args: { shop: 'string', item: 'string', n: 'int?' },
   *   can(e, { shop, item, n = 1 }, ctx) {
   *     if (!e.inventory.container(shop).has(item, n)) return 'soldOut';
   *     if (e.inventory.container(ctx.actor).count('gold') < PRICE[item] * n) return 'noMoney';
   *     return true;
   *   },
   *   run(e, { shop, item, n = 1 }, ctx) {
   *     const got = e.inventory.transfer(shop, ctx.actor, item, n);
   *     e.inventory.container(ctx.actor).remove('gold', PRICE[item] * got);
   *     return got;
   *   },
   *   reasons: { soldOut: 'Shelf is empty', noMoney: 'Not enough gold' },
   * });
   */
  define(name, def) {
    if (this.defs.has(name)) throw devError(fmt(STRINGS.dup, { name }));
    const shape = checkDef(name, def);
    const d = { name, ...def, shape };
    this.defs.set(name, d);
    return { remove: () => { if (this.defs.get(name) === d) this.defs.delete(name); } };
  }

  /**
   * Run an op now (synchronously): checks args (dev), calls can, then run, and logs it. Returns { ok: true, value } or { ok: false, reason }.
   * Pass a fresh args object each call (it is kept in the history; in dev it is frozen). opts.source: 'player' | 'game' | 'bridge' | 'test' | 'replay' | 'net'
   * (default: 'game' inside a fixed step, 'player' between steps); opts.actor: who does it (world record id, default engine.actor, which is 'player' unless the game hands control elsewhere).
   * @param {string} name
   * @param {object} [args]
   * @param {{ source?: string, actor?: string }} [opts]
   * @returns {{ ok: boolean, value?: any, reason?: string }}
   * @example
   * const r = engine.ops.run('shop.buy', { shop: 'bakery', item: 'bread' });
   * if (!r.ok) showHint(engine.t('op.shop.buy.' + r.reason));
   * // from a fixed step, for an input-driven action: e.ops.run('combat.roll', { dir }, { source: 'player' })
   */
  run(name, args = {}, opts) {
    const e = this.engine, d = this._def(name);
    if (!d) return { ok: false, reason: 'unknownOp' };
    if (this._inCan) throw devError(fmt(STRINGS.canRun, { name: this._inCan, inner: name }));
    if (this._stack.length >= MAX_DEPTH) throw devError(fmt(STRINGS.loop, { chain: this._stack.concat(name).join(' -> ') }));
    if (this._route) { const r = this._route(d, args, opts); if (r) return r; }   // net client: requests go to the host (also from inside a net: 'local' op)
    const parent = this._stack.length ? this._last : null;
    const ctx = this._ctx(name, args, opts, parent);
    if (DEV && args && typeof args === 'object') Object.freeze(args);
    const depth = this._stack.length;
    if (e._freezers.has('error')) { this._log(name, args, ctx, false, 'halted', depth); return { ok: false, reason: 'halted' }; }
    const where = `ops.run('${name}')`;
    this._stack.push(name);
    const prevCtx = this._last; this._last = ctx;
    let h = null, seq = 0;
    try {
      const reason = this._can(d, args, ctx);
      if (reason !== true) { this._log(name, args, ctx, false, reason, depth); return { ok: false, reason }; }
      h = this._log(name, args, ctx, true, null, depth); seq = h.seq;   // logged before run so nested ops follow their parent in the history
      return { ok: true, value: d.run(e, args, ctx) };
    } catch (err) {
      if (err?.opsDevError) throw err;
      if (h?.seq === seq) { h.ok = false; h.reason = 'error'; } else this._log(name, args, ctx, false, 'error', depth);
      reportError(e, err, where);
      if (e.error?.where === where && !e.error.ops) e.error.ops = this.recent().slice(-5).map(r => `${r.name}${r.ok ? '' : ' x ' + r.reason}`);
      return { ok: false, reason: 'error' };
    } finally { this._stack.pop(); this._last = prevCtx; }
  }

  /**
   * Reverse a finished op with the undo(e, args, value) its definition declared: pass the same args and the value run returned.
   * Returns { ok: true }, or { ok: false, reason: 'noUndo' } when the op did not declare undo. The undo runs as an op write (the dev guard stays quiet).
   * @example const r = engine.ops.run('inventory.trade', { take: 'rusty_key', give: 'gold_key' }); engine.ops.undo('inventory.trade', { take: 'rusty_key', give: 'gold_key' }, r.value);
   * @param {string} name
   * @param {object} args
   * @param {any} value
   * @param {{ actor?: string }} [opts]
   * @returns {{ ok: boolean, reason?: string }}
   */
  undo(name, args, value, opts) {
    const d = this._def(name);
    if (!d) return { ok: false, reason: 'unknownOp' };
    if (typeof d.undo !== 'function') return { ok: false, reason: 'noUndo' };
    this._allowDepth++;
    try { d.undo(this.engine, args, value, this._ctx(name, args, opts, null)); } finally { this._allowDepth--; }
    return { ok: true };
  }

  /**
   * Ask without doing: runs only can (no state change, no history). For greying out buttons and input buffers.
   * @param {string} name
   * @param {object} [args]
   * @param {{ actor?: string, source?: string }} [opts]
   * @returns {{ ok: boolean, reason?: string }}
   * @example const { ok, reason } = engine.ops.can('shop.buy', { shop: 'bakery', item: 'bread' });
   * button.disabled = !ok;
   */
  can(name, args = {}, opts) {
    const d = this._def(name);
    if (!d) return { ok: false, reason: 'unknownOp' };
    const ctx = this._ctx(name, args, opts, this._stack.length ? this._last : null);
    if (this.engine._freezers.has('error')) return { ok: false, reason: 'halted' };
    let reason;
    try { reason = this._can(d, args, ctx); } catch (err) { if (err?.opsDevError) throw err; reason = 'error'; }
    return reason === true ? { ok: true } : { ok: false, reason };
  }

  /**
   * What exists, or with { available: true } what is possible now: every arg set from each op's offers checked with can
   * (an op with neither offers nor args is checked once with {}; one with args but no offers is skipped, since its args are free-form).
   * @param {{ available?: boolean, actor?: string }} [opts]
   * @returns {{ name: string, desc?: string, args?: any, ok?: boolean, reason?: string }[]}
   * @example engine.ops.list({ available: true });   // [{ name: 'shop.buy', args: { shop: 'bakery', item: 'bread' }, ok: false, reason: 'noMoney' }, ...]
   */
  list({ available = false, actor } = {}) {
    if (!available) return [...this.defs.values()].map(d => ({ name: d.name, desc: d.desc, args: d.args }));
    const out = [];
    for (const d of this.defs.values()) {
      const ctx = this._ctx(d.name, null, { actor }, null);
      let sets;
      try { sets = d.offers ? d.offers(this.engine, ctx) : d.shape ? [] : [{}]; } catch { sets = []; }
      for (const args of sets || []) { const r = this.can(d.name, args, { actor }); out.push({ name: d.name, args, ok: r.ok, reason: r.reason }); }
    }
    return out;
  }

  /**
   * Recent history (old -> new), optionally of one op: { seq, tick, phase: 'fixed' | 'between', name, args, source, actor, ok, reason, depth, count }.
   * Consecutive identical failures (same actor, op and reason) merge into one entry with count.
   * @param {string} [name]
   * @returns {{ seq: number, tick: number, phase: string, name: string, args: any, source: string, actor: string, ok: boolean, reason: string | null, depth: number, count: number }[]}
   * @example engine.ops.recent('shop.buy').at(-1);   // { tick: 812, phase: 'between', ok: false, reason: 'noMoney', ... }
   */
  recent(name) {
    return recentEntries(this, name);
  }

  /**
   * Dev guard for a module that owns saved gameplay state: call it at the top of every method that writes that state. In development it warns once per call site
   * when the write happens outside a fixed step, an op or an allow() window (before ready everything is allowed); in a production build it is a no-op, so just call `engine.ops.guard(...)` (no DEV check needed).
   * @experimental
   * @example set(k, v) { this.engine.ops.guard('myStore.set'); this.data[k] = v; }
   * @param {string} where label shown in the warning, e.g. 'vars.setFlag'
   * @returns {void}
   */
  guard(where) {
    if (!DEV) return;   // release builds do not check; games cannot read DEV, so the no-op lives here
    guardWrite(this, where);
  }
  /** @internal A separator in the history (save load): later entries belong to a different world state */
  _mark(label) { this._log(label, null, { tick: this.engine.tick, source: 'game', actor: '' }, true, null, 0); }
  /**
   * Run fn with guarded writes allowed (loading a save, applying a scenario, net sync); works for an async fn too (allowed until its Promise settles). Returns what fn returns.
   * @experimental
   * @example engine.ops.allow(() => store.load(data));
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  allow(fn) {
    this._allowDepth++;
    let r;
    try { r = fn(); } catch (err) { this._allowDepth--; throw err; }
    if (r && typeof r.then === 'function') return /** @type {any} */ (r.finally(() => { this._allowDepth--; }));
    this._allowDepth--;
    return r;
  }

  /** @internal */
  _def(name) {
    const d = this.defs.get(name);
    if (d) return d;
    const msg = fmt(STRINGS.unknown, { name: JSON.stringify(name), text: missingText('op', name, [...this.defs.keys()]) });
    if (!DEV) { warnOnce(coded('op-misuse', msg)); return d; }   // release: the op is a no-op (reason unknownOp), said once
    throw devError(msg);
  }
  /** @internal */
  _ctx(name, args, opts, parent) {
    const e = this.engine;
    let source = opts?.source ?? parent?.source ?? (e._inFixed ? 'game' : 'player');
    if (DEV) {
      if (!SOURCES.includes(source)) throw devError(fmt(STRINGS.badSource, { name, source }));
      if (args) checkArgs(e, this.defs.get(name), args);
    }
    return { source, actor: opts?.actor ?? parent?.actor ?? e.actor, tick: e.tick, frozen: e.frozen };
  }
  /** @internal returns true or a reason string */
  _can(d, args, ctx) {
    if (!d.can) return true;
    const prev = this._inCan; this._inCan = d.name;
    let r;
    try { r = d.can(this.engine, args, ctx); } finally { this._inCan = prev; }
    if (r === true || (typeof r === 'string' && r)) return r;
    const msg = fmt(STRINGS.canResult, { name: d.name, got: JSON.stringify(r) ?? 'undefined' });
    if (DEV) throw devError(msg);
    warnOnce(coded('op-misuse', msg));   // release: denied, said once
    return 'denied';
  }
  /** @internal write a history entry in place (no allocation); consecutive identical failures merge */
  _log(name, args, ctx, ok, reason, depth) {
    return logEntry(this, name, args, ctx, ok, reason, depth);
  }
}

/** @typedef {{ source: string, actor: string, tick: number, frozen: boolean }} OpContext */
