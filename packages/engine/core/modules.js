// Module installation (part of Engine, mixed into Engine.prototype): engine.use(...) / engine.has(name) / engine.moduleOrder.
// See CLAUDE.md "writing a module" for the module shape; dispose is called by lifecycle.js in reverse install order.
//
// Run order (fixed / frame / afterRender / skip hooks): by stage first, then before / after within a stage, then install order.
//   stage only orders hooks; what a module may own and what happens when it throws come from its type (moduleTypes.js, errors.js).
//   Stages (first to last): control timeline, camera -> ground terrain, level -> environment weather, sky, water
//     -> gameplay interactions, dialogue, trigger zones -> effects particles, settings, objective markers
//     -> late (the default) characters, physics, navigation... -> audio music
//   before / after: lists of module names (not-installed names are ignored); they order modules only inside one stage.
//     One that contradicts the stage order (a 'control' module with after: ['sky']) makes use() throw naming both modules and stages;
//     a cycle makes use() throw on the spot, naming the modules on it.
// Install is all-or-nothing per engine.use(...) call: the whole batch is validated (names, requires, stage, before / after, cycles)
//   before anything installs; if a module's install() then throws, the modules this call already installed are removed again
//   (engine.name, module table, hooks; their dispose() runs) and the error is rethrown.
// Module state (engine.moduleStates): registered -> initializing -> running | failed; disposed after engine.dispose(). Modules without init() are
// running at once. fixed / frame / afterRender / skip hooks run only for running modules, so no module gets a hook before its init() finished
//   (during start() or when installed later).
// Ownership: install(e, ctx) and init(e, ctx) get ctx = { name, track(handle), mod(point, o), control.take(character, o) }. A handle passed to ctx.track (events.on, onFixed, onFrame,
//   clock timers, audio.measure... anything with remove()) belongs to the module and is removed with it: when the use() batch rolls back,
//   when its init fails, and on engine.dispose() (before the module's own dispose). Listeners a module adds go through it, so an install
//   that fails halfway leaves no ghost listener behind (review 0.4 A; the rollback spec checks every built-in module).
//   ctx.mod(point, o) = ctx.track(engine.mod(point, { ...o, owner: ctx.name })): a module's changes to shared values go with it too.
//   ctx.input.action(name, { context }) / ctx.input.bind(name, keys): the module's input declarations and bindings, gone with it too.
//   Every install is its own instance (engine._modInst: name -> token): a ctx belongs to one install, not to a name. An async init that resumes after
//   its module was unloaded (replaces, a plugin removed) and a same-named one installed must not act on the newcomer: what the stale ctx tracks is
//   removed at once (dev warning naming the module), and its completion or failure changes no state and drops no handle of the newcomer.
// Exclusive slots: provides: ['inventory'] takes each named slot (a kind 'one' shared point, core/sharedPoint.js) for the module before its install;
//   a second provider is shared-taken. requires may name a slot instead of a module. engine.use(mine(), { replaces: 'inventory' }) unloads the
//   holder first (its handles, slot, drawing parts, dispose), and puts it back if the new install fails.
// critical: true on a module makes a failed init() stop engine.start() with the reason; without it a failed init is reported (picture / ui: disabled;
// other types: error tiers in errors.js) and start() goes on.
// Dependencies: requires must be installed first (throws if missing). optional is a soft dependency: an array is only recorded (for GAMEMAP and rule R16);
//   written as { module: 'what is lost without it' }, start() warns once in dev when it is missing: use this form for optional dependencies
//   that change gameplay results, which must not be skipped silently.
import { warnOnce, DEV, fmt, closest } from './validate.js';
import { codedError, coded } from './errorHints.js';
import { reportError } from './errors.js';
import { catalog, catalogSnap, catalogClaim } from './catalog.js';
import { readParams } from './params.js';
import { slotMethods, isUseOpts, checkProvides } from './moduleSlots.js';
import { checkType, asModule } from './moduleTypes.js';

/** Stage -> sort position */
const STAGES = { control: 100, ground: 200, environment: 300, gameplay: 400, effects: 450, late: 500, audio: 510 };
const HOOKS = ['fixed', 'frame', 'afterRender', 'skip'];
const STRINGS = {
  cycle: 'module order forms a cycle: {path} (check before / after on these modules)',
  stage: 'module {name} has stage "{stage}", which is not a stage; available stages: {list}',
  order: 'module {name} sets order, which is not supported; modules do not sort by number. Set stage ({list}) and use before / after within a stage',
  optional: 'optional dependency {dep} of module {name} is not installed: {what} (ignore if not needed; otherwise call engine.use({dep}()))',
  called: 'engine.use received the module function {name} itself; call it: {name}()',
  twice: 'module {name} is already installed; the second engine.use({name}()) is ignored',
  readyHook: 'module {name}: the load-complete hook is named isReady(e) (ready is always a boolean property in the engine); ready(e) will not be called',
  // both ways out: the engine's part of that name, or the game's own provider (requires names a capability, never a particular module)
  needs: "module {name} requires '{dep}', which no installed module provides. Fix: install the engine's part first, engine.use({dep}(), {name}(...)), "
    + "or your own module with provides: ['{dep}'] (then engine.{dep} is your module's API){typo}",
  typo: " (did you mean '{hint}'? installed: {list})",
  clash: 'module name {name} clashes with an existing engine property; pick another name',
  slotClash: "module {name} provides '{slot}', but engine.{slot} is already an engine property, so dependents could not reach it there. Fix: pick another slot name",
  lateInit: 'init of module {name} (installed after start)',
  conflict: 'module {a} (stage "{sa}") sets {kind}: ["{b}"], but module {b} is in stage "{sb}", which always runs {kind} stage "{sa}" (stage order: {list}); '
    + 'before / after only order modules inside one stage. Fix: give both modules the same stage, or remove {kind}: ["{b}"] from {a}',
};
const CTX_OWNER = "ctx.mod('{point}', { owner }) in module {name}: ctx.mod names the module as the owner itself; drop owner (use engine.mod for another owner name)";
const BAD_HANDLE = 'ctx.track(handle) in module {name}: handle must have remove(), like the result of engine.events.on / onFixed / clock.after; got {got}';
const STALE = 'module {name} registered something after it was unloaded (its async init or a callback resumed after replaces / unload); it was removed at once. '
  + 'The module installed under that name now is not affected';
const STALE_INIT = 'init of module {name}, which was unloaded before it finished';
const hookCache = new WeakMap();   // module definition -> { fixed, frame, afterRender, skip } hook entries (reused when re-sorting)

/** Sort modules by stage, before / after and install order (Kahn topological sort; among the ready ones take the earliest stage,
 *  then earliest installed); throws on a cycle. */
function sortModules(list) {
  const idx = new Map(list.map((m, i) => [m.name, i])), byName = new Map(list.map(m => [m.name, m]));
  const rank = m => STAGES[m.stage] ?? STAGES.late;
  const succ = new Map(list.map(m => [m.name, new Set()])), indeg = new Map(list.map(m => [m.name, 0]));
  const edge = (a, b) => { if (!idx.has(a) || !idx.has(b) || succ.get(a).has(b)) return; succ.get(a).add(b); indeg.set(b, indeg.get(b) + 1); };
  for (const m of list) { for (const b of m.before || []) edge(m.name, b); for (const a of m.after || []) edge(a, m.name); }
  const cmp = (a, b) => rank(a) - rank(b) || idx.get(a.name) - idx.get(b.name);
  const ready = list.filter(m => !indeg.get(m.name)), out = [];
  while (ready.length) {
    ready.sort(cmp);
    const m = ready.shift(); out.push(m);
    for (const n of succ.get(m.name)) { indeg.set(n, indeg.get(n) - 1); if (!indeg.get(n)) ready.push(byName.get(n)); }
  }
  if (out.length === list.length) return out;
  // What is left is on a cycle or behind one: walk edges from any node; revisiting a node closes the cycle
  // First drop, repeatedly, the nodes with no successor still left: those are only blocked behind a cycle (a walk starting there would dead-end
  // on a node without a next step); every node that remains has a successor in the set, so the walk always ends in a real cycle
  const left = new Set(list.filter(m => !out.includes(m)).map(m => m.name)), path = [];
  for (let drop = true; drop;) { drop = false; for (const n of left) if (![...succ.get(n)].some(x => left.has(x))) { left.delete(n); drop = true; } }
  for (let n = left.values().next().value; !path.includes(n); n = [...succ.get(n)].find(x => left.has(x))) path.push(n);
  const cyc = path.slice(path.indexOf([...succ.get(path.at(-1))].find(x => path.includes(x))));
  throw codedError('module-cycle', STRINGS.cycle.replace('{path}', [...cyc, cyc[0]].join(' -> ')));
}

/** before / after across stages must agree with the stage order (the stage always wins), else the declaration would be silently ignored:
 *  throw naming both modules */
function checkStages(list) {
  const byName = new Map(list.map(m => [m.name, m])), rank = m => STAGES[m.stage] ?? STAGES.late, stage = m => m.stage ?? 'late';
  const order = Object.keys(STAGES).join(' -> ');
  const fail = (a, kind, b) => {
    throw codedError('module-order', fmt(STRINGS.conflict, { a: a.name, sa: stage(a), kind, b: b.name, sb: stage(b), list: order }));
  };
  for (const m of list) {
    for (const n of m.before || []) { const o = byName.get(n); if (o && rank(m) > rank(o)) fail(m, 'before', o); }
    for (const n of m.after || []) { const o = byName.get(n); if (o && rank(o) > rank(m)) fail(m, 'after', o); }
  }
}

export const moduleMethods = {
  ...slotMethods,   // provides / replaces (moduleSlots.js)
  /**
   * Install one or more modules in order; dependencies must be installed first; hook order is described at the top of this file.
   * All-or-nothing: the batch is validated first, and if an install() throws, the modules this call installed are removed again.
   * A module installed after start() has its init(e) run at once (a task in engine.loading; an error goes through the error tiers) and gets no hooks
   * until it succeeded:
   * `await engine.loading.settled()` waits for it; engine.moduleStates shows where each module is.
   */
  use(...mods) {
    const opts = isUseOpts(mods.at(-1)) ? mods.pop() : null;
    const list = mods.flat(Infinity), gone = this._replaced(list, opts?.replaces);
    const plan = this._planUse(list, gone), done = [];
    // replaces: the holder goes first (its tracked handles, its slot, its drawing parts, its dispose), so the newcomer's install sees a free slot
    const removed = [...gone].map(n => this._unuse(n, true));
    try {
      for (const m of plan) {
        const had = Object.hasOwn(this, m.name), prev = this[m.name], snap = catalogSnap(this);
        done.push({ m, had, prev });   // before install(): what it tracked before throwing is removed too
        this._modInst.set(m.name, {});   // this install's identity: install and init ctx check it, so a stale async init cannot act on a later install
        const ctx = this._modCtx(m);
        this._picture?.installing(m);
        for (const slot of m.provides ?? []) ctx.track(this._slot(slot, m.name).take({ owner: m.name }));   // shared-taken when another module holds it
        const api = asModule(this, m, () => m.install?.(this, ctx)) ?? m;   // asModule: the type checks know who is installing (moduleTypes.js)
        catalogClaim(this, m.name, snap);   // ops / save parts / describe names it registered show under it in engine.catalog()
        this.modules.set(m.name, m);
        if (m.name) this[m.name] = api;
        // engine.<slot> is the provider's API too, so a module that requires 'inventory' reaches the game's own bag at engine.inventory after
        // a replaces: dependents name the capability, never the module that gives it
        for (const slot of m.provides ?? []) if (slot !== m.name) { this[slot] = api; ctx.track(this._aliasSlot(slot, api)); }
        this._modState.set(m.name, m.init ? (this._started ? 'initializing' : 'registered') : 'running');
      }
    } catch (err) {
      for (const { m, had, prev } of done.reverse()) {   // undo in reverse install order, like dispose
        const installed = this.modules.get(m.name) === m;
        this.modules.delete(m.name); this._modState.delete(m.name); this._modInst.delete(m.name);
        if (had) this[m.name] = prev; else delete this[m.name];   // put back what was there (an undefined slot stays undefined), never blank it
        this._dropTracked(m.name);
        if (installed) try { m.dispose?.(this); } catch { /* the install error below is the one to report */ }
      }
      this._sortHooks();
      // a replaced module comes back, so a failed swap leaves the game as it was (it installs fresh: its old handles already went)
      if (removed.length) try { this.use(...removed); } catch (e2) { reportError(this, e2, 'putting back the module a failed replaces removed', { soft: true }); }
      throw err;
    }
    this._sortHooks();
    if (this._started) for (const m of plan) if (m.init) this._lateInit(m);
    return this;
  },
  /** @internal validate a batch without touching the engine (so a failure leaves nothing half-installed);
   *  returns the modules to install */
  _planUse(list, gone = new Set()) {
    const names = new Set([...this.modules.keys()].filter(n => !gone.has(n))), plan = [];
    // requires names a module or a capability: another module's provides (depend on 'inventory', not on whichever module gives it)
    const caps = new Set(names);
    for (const n of names) for (const s of this.modules.get(n).provides ?? []) caps.add(s);
    for (const m of list) {
      if (!m) continue;
      if (typeof m === 'function') throw codedError('module-called', fmt(STRINGS.called, { name: m.name }));
      if (names.has(m.name)) { warnOnce(coded('module-name', fmt(STRINGS.twice, { name: m.name }))); continue; }
      if (typeof m.ready === 'function') warnOnce(coded('engine-misuse', fmt(STRINGS.readyHook, { name: m.name })));
      if (m.order != null) throw codedError('module-stage', fmt(STRINGS.order, { name: m.name, list: Object.keys(STAGES).join(', ') }));
      if (m.stage != null && !(m.stage in STAGES))
        throw codedError('module-stage', fmt(STRINGS.stage, { name: m.name, stage: m.stage, list: Object.keys(STAGES).join(', ') }));
      checkType(m);
      for (const dep of m.requires || []) if (!caps.has(dep)) {
        const hint = closest(dep, [...caps]);
        throw codedError('module-requires', fmt(STRINGS.needs, { name: m.name, dep, typo: hint ? fmt(STRINGS.typo, { hint, list: [...caps].join(', ') }) : '' }));
      }
      checkProvides(m);
      for (const slot of m.provides ?? []) if (slot !== m.name && !gone.has(slot) && !names.has(slot) && slot in this && this[slot] !== undefined && !this._slotAlias?.has(slot))
        throw codedError('module-provides', fmt(STRINGS.slotClash, { name: m.name, slot }));
      if (DEV && m.params && m.options) readParams(m.name, m.params, m.options);   // a definition built by hand still gets its options checked
      if (!gone.has(m.name) && m.name in this && this[m.name] !== undefined) throw codedError('module-name', fmt(STRINGS.clash, { name: m.name }));
      names.add(m.name); caps.add(m.name); for (const s of m.provides ?? []) caps.add(s);
      plan.push(m);
    }
    if (plan.length) { const all = [...[...this.modules.values()].filter(m => !gone.has(m.name)), ...plan]; checkStages(all); sortModules(all); }
    return plan;
  },
  /** @internal init of a module installed after start(): run now, tracked in engine.loading, errors through the error tiers;
   *  its hooks join only after it succeeded */
  _lateInit(m) {
    const L = this.loading, task = L._begin(m.name, 'module');
    task.phase('build');
    const snap = catalogSnap(this);
    // the instance and its ctx are taken now, not when the microtask runs: by then a same-named module may be installed in its place
    const inst = this._modInst.get(m.name), ctx = this._modCtx(m, inst), live = () => this._isLive(m.name, inst);
    L._track(Promise.resolve().then(() => asModule(this, m, () => m.init(this, ctx))).then(
      () => { L._done(task); if (live()) { catalogClaim(this, m.name, snap); this._setModState(m, 'running'); } },
      e => {
        L._fail(task, e);
        // unloaded meanwhile: its handles already went with it, and the state / handles under this name belong to the newcomer now
        if (!live()) return reportError(this, e, fmt(STALE_INIT, { name: m.name }), { soft: true });
        this._setModState(m, 'failed'); this._dropTracked(m.name); reportError(this, e, fmt(STRINGS.lateInit, { name: m.name }), { module: m });
      }));
  },
  /** @internal is this install (token from engine._modInst) still the module installed under its name? */
  _isLive(name, inst) { return !this.disposed && inst !== undefined && this._modInst.get(name) === inst; },
  /** @internal the ctx install / init receive: track(handle) ties a handle to the module's life (see the top of this file) */
  _modCtx(m, inst = this._modInst.get(m.name)) {
    const name = m.name;
    const track = h => {
      if (typeof h?.remove !== 'function') throw codedError('module-handle', fmt(BAD_HANDLE, { name, got: String(h) }));
      if (this.disposed) { h.remove(); return h; }   // a late registration after dispose: nothing will ever remove it otherwise
      // a registration from an install that is gone (replaced / unloaded while its async init awaited): filing it under the name would hand it
      // to the newcomer, which would then own a listener it never made; remove it now instead
      if (!this._isLive(name, inst)) { if (DEV) warnOnce(coded('module-handle', fmt(STALE, { name }))); h.remove(); return h; }
      let set = this._modTracked.get(name);
      if (!set) this._modTracked.set(name, set = new Set());
      set.add(h);
      if (this._curModule === m) this._picture?.learn(m);   // the module's own code called this: its file is the part's (core/pictureWriters.js)
      return h;
    };
    // mod: engine.mod with the module as owner, tracked. Why a ctx verb and not "guess the running module": in an async callback the guess is wrong;
    // and a handle that is not tracked is a weather multiplier still on after the module went
    const mod = (point, o) => {
      if (o?.owner !== undefined) throw codedError('mod-owner', fmt(CTX_OWNER, { point, name }));
      return track(this.mod(point, { ...o, owner: name }));
    };
    // input: declare actions / bind the keys the game handed the module, owned by the module (removed with it); never a key of its own
    const input = {
      action: (n, o) => track(this.input.action(n, { ...o, owner: name })),
      bind: (n, keys) => track(this.input.bind(n, keys, { owner: name })),
    };
    // control: engine.control.take with the module as default owner, tracked, so a module that goes (unload, rollback, replaces) hands back every
    // character it was steering. Unlike mod an owner may be given: one module can hold several characters on its own names (one per cutscene run).
    // A hold that ends by itself leaves the tracked set too, so a module taking control often (a cutscene a minute) does not pile up dead handles.
    // Taking the same character again under the same owner replaces the hold, so the stale handle leaves the tracked set as well.
    const held = new Map();   // `${id} ${owner}` -> the live handle
    const control = {
      take: (who, o = {}) => {
        const h = this.control.take(who, { ...o, owner: o.owner ?? name }), end = h.remove, key = `${h.id} ${h.owner}`;
        const old = held.get(key);
        if (old) this._modTracked.get(name)?.delete(old);
        held.set(key, h);
        h.remove = () => { end(); if (held.get(key) === h) held.delete(key); this._modTracked.get(name)?.delete(h); };
        return track(h);
      },
      has: (who, owner = name) => this.control.has(who, owner),
    };
    // whileCompiling: a one-time warm-up (a WASM library's first call) run while start() waits for the GPU to compile shaders, when the page's
    // thread is idle anyway (startup.js); after start() it runs at once
    // It checks the install like track does: a warm-up queued by an install that was unloaded before start() ran the queue must not run
    // (it would touch state of an install that is gone), and one asked for by an install that is already stale is not queued at all
    const whileCompiling = fn => {
      if (!this._isLive(name, inst)) return;
      const run = () => { if (this._isLive(name, inst)) fn(); };
      if (this.ready) run(); else this._whileCompiling.push(run);
    };
    return { name, track, mod, input, control, whileCompiling };
  },
  /** @internal remove every handle a module tracked; one that throws is reported and the rest still go */
  _dropTracked(name) {
    const set = this._modTracked.get(name);
    if (!set) return;
    this._modTracked.delete(name);
    for (const h of set) { try { h.remove(); } catch (err) { reportError(this, err, `remove() of a handle module ${name} tracked`, { soft: true }); } }
  },
  /** @internal move a module to a new state and refresh the hooks (initializing / failed modules run none) */
  _setModState(m, state) {
    if (this.disposed || this._modState.get(m.name) === state) return;
    this._modState.set(m.name, state);
    this._sortHooks();
  },
  /**
   * Where each module is: 'registered' (init not started yet), 'initializing', 'running', 'failed' (init threw: no hooks) or 'disposed'.
   * @returns {Record<string, string>}
   * @example engine.use(shop()); await engine.loading.settled(); engine.moduleStates.shop   // 'running'
   */
  get moduleStates() { return Object.fromEntries(this._modState); },
  /**
   * What this game can do, read from the registrations (see core/catalog.js): no argument = short list, a module id or op name = that entry expanded.
   * @param {string | { find?: string }} [id]
   * @returns {any}
   * @example engine.catalog();  engine.catalog('sky');  engine.catalog('shop.buy');  engine.catalog({ find: 'buy' })
   */
  catalog(id) { return catalog(this, id); },
  /** Is this module installed? */
  has(name) { return this.modules.has(name); },
  /** Run order of module hooks (module names, first to last), for debugging "who runs first". */
  get moduleOrder() { return this._moduleOrder ?? []; },

  /** Re-sort the module hooks in the main loop (disabled picture / ui modules are not put back). */
  _sortHooks() {
    const order = sortModules([...this.modules.values()]);
    this._moduleOrder = order.map(m => m.name);
    for (const k of HOOKS) this._hooks[k] = [];
    for (const m of order) {
      const st = this._modState.get(m.name);
      if (this.disabledModules.has(m.name) || st !== 'running') continue;   // registered (init not run yet), initializing, failed: no hooks
      let c = hookCache.get(m);
      if (!c) hookCache.set(m, c = {});
      for (const k of HOOKS) if (m[k]) this._hooks[k].push(c[k] ??= { fn: m[k].bind(m), name: m.name, mod: m });
    }
  },
  /** Called by start(): warn once in dev when an optional dependency written as { module: 'what is lost' } is not installed. */
  _checkOptional() {
    if (!DEV) return;
    for (const m of this.modules.values()) {
      const opt = m.optional;
      if (!opt || Array.isArray(opt)) continue;
      for (const [dep, what] of Object.entries(opt)) if (!this.modules.has(dep) && !this._provided(dep))
        warnOnce(coded('module-requires', fmt(STRINGS.optional, { name: m.name, dep, what })));
    }
  },
};
