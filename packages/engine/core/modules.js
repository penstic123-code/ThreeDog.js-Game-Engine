// Module installation (part of Engine, mixed into Engine.prototype): engine.use(...) / engine.has(name) / engine.moduleOrder.
// See CLAUDE.md "writing a module" for the module shape; dispose is called by lifecycle.js in reverse install order.
//
// Run order (fixed / frame / afterRender / skip hooks): by stage first, then before / after within a stage, then install order.
//   Stages (first to last): control timeline, camera -> world terrain, level -> environment weather, sky, water
//     -> gameplay interactions, dialogue, trigger zones, entities -> presentation particles, settings, objective markers
//     -> late (the default) characters, physics, navigation... -> audio music
//   before / after: lists of module names (not-installed names are ignored); they order modules only inside one stage.
//     One that contradicts the stage order (a 'control' module with after: ['sky']) makes use() throw naming both modules and stages;
//     a cycle makes use() throw on the spot, naming the modules on it.
// Install is all-or-nothing per engine.use(...) call: the whole batch is validated (names, requires, stage, before / after, cycles)
//   before anything installs; if a module's install() then throws, the modules this call already installed are removed again
//   (engine.name, module table, hooks; their dispose() runs) and the error is rethrown.
// Module state (engine.moduleStates): registered -> initializing -> running | failed; disposed after engine.dispose(). Modules without init() are
// running at once. fixed / frame / afterRender / skip hooks run only for modules that are not initializing or failed,
//   so a module installed after start() gets no hook before its init() finished.
// critical: true on a module makes a failed init() stop engine.start() with the reason; without it a failed init is reported (presentation: disabled;
// gameplay: error tiers in errors.js) and start() goes on.
// Dependencies: requires must be installed first (throws if missing). optional is a soft dependency: an array is only recorded (for GAMEMAP and rule R16);
//   written as { module: 'what is lost without it' }, start() warns once in dev when it is missing: use this form for optional dependencies
//   that change gameplay results, which must not be skipped silently.
import { requiresText, warnOnce, DEV, fmt } from './validate.js';
import { codedError, coded } from './errorHints.js';
import { reportError } from './errors.js';

/** Stage -> sort position */
const STAGES = { control: 100, world: 200, environment: 300, gameplay: 400, presentation: 450, late: 500, audio: 510 };
const HOOKS = ['fixed', 'frame', 'afterRender', 'skip'];
const STRINGS = {
  cycle: 'module order forms a cycle: {path} (check before / after on these modules)',
  stage: 'module {name} has stage "{stage}", which is not a stage; available stages: {list}',
  order: 'module {name} sets order, which is not supported; modules do not sort by number. Set stage ({list}) and use before / after within a stage',
  optional: 'optional dependency {dep} of module {name} is not installed: {what} (ignore if not needed; otherwise call engine.use({dep}()))',
  called: 'engine.use received the module function {name} itself; call it: {name}()',
  twice: 'module {name} is already installed; the second engine.use({name}()) is ignored',
  readyHook: 'module {name}: the load-complete hook is named isReady(e) (ready is always a boolean property in the engine); ready(e) will not be called',
  needs: 'module {name} requires module {dep} to be installed first; put {dep}() before it',
  clash: 'module name {name} clashes with an existing engine property; pick another name',
  lateInit: 'init of module {name} (installed after start)',
  conflict: 'module {a} (stage "{sa}") sets {kind}: ["{b}"], but module {b} is in stage "{sb}", which always runs {kind} stage "{sa}" (stage order: {list}); '
    + 'before / after only order modules inside one stage. Fix: give both modules the same stage, or remove {kind}: ["{b}"] from {a}',
};
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
  const left = new Set(list.filter(m => !out.includes(m)).map(m => m.name)), path = [];
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
  /**
   * Install one or more modules in order; dependencies must be installed first; hook order is described at the top of this file.
   * All-or-nothing: the batch is validated first, and if an install() throws, the modules this call installed are removed again.
   * A module installed after start() has its init(e) run at once (a task in engine.loading; an error goes through the error tiers) and gets no hooks
   * until it succeeded:
   * `await engine.loading.settled()` waits for it; engine.moduleStates shows where each module is.
   */
  use(...mods) {
    const plan = this._planUse(mods.flat()), done = [];
    try {
      for (const m of plan) {
        const had = Object.hasOwn(this, m.name), api = m.install?.(this) ?? m;
        this.modules.set(m.name, m);
        if (m.name) this[m.name] = api;
        done.push({ m, had });
        this._modState.set(m.name, m.init ? (this._started ? 'initializing' : 'registered') : 'running');
      }
    } catch (err) {
      for (const { m, had } of done.reverse()) {   // undo in reverse install order, like dispose
        this.modules.delete(m.name); this._modState.delete(m.name);
        if (had) this[m.name] = undefined; else delete this[m.name];
        try { m.dispose?.(this); } catch { /* the install error below is the one to report */ }
      }
      this._sortHooks();
      throw err;
    }
    this._sortHooks();
    if (this._started) for (const m of plan) if (m.init) this._lateInit(m);
    return this;
  },
  /** @internal validate a batch without touching the engine (so a failure leaves nothing half-installed);
   *  returns the modules to install */
  _planUse(list) {
    const names = new Set(this.modules.keys()), plan = [];
    for (const m of list) {
      if (!m) continue;
      if (typeof m === 'function') throw codedError('module-called', fmt(STRINGS.called, { name: m.name }));
      if (names.has(m.name)) { warnOnce(coded('module-name', fmt(STRINGS.twice, { name: m.name }))); continue; }
      if (typeof m.ready === 'function') warnOnce(coded('engine-misuse', fmt(STRINGS.readyHook, { name: m.name })));
      if (m.order != null) throw codedError('module-stage', fmt(STRINGS.order, { name: m.name, list: Object.keys(STAGES).join(', ') }));
      if (m.stage != null && !(m.stage in STAGES))
        throw codedError('module-stage', fmt(STRINGS.stage, { name: m.name, stage: m.stage, list: Object.keys(STAGES).join(', ') }));
      for (const dep of m.requires || []) if (!names.has(dep))
        throw codedError('module-requires', requiresText(m.name, dep, [...names]) ?? fmt(STRINGS.needs, { name: m.name, dep }));
      if (m.name in this && this[m.name] !== undefined) throw codedError('module-name', fmt(STRINGS.clash, { name: m.name }));
      names.add(m.name); plan.push(m);
    }
    if (plan.length) { const all = [...this.modules.values(), ...plan]; checkStages(all); sortModules(all); }
    return plan;
  },
  /** @internal init of a module installed after start(): run now, tracked in engine.loading, errors through the error tiers;
   *  its hooks join only after it succeeded */
  _lateInit(m) {
    const L = this.loading, task = L._begin(m.name, 'module');
    task.phase('build');
    L._track(Promise.resolve().then(() => m.init(this)).then(
      () => { L._done(task); this._setModState(m, 'running'); },
      e => { L._fail(task, e); this._setModState(m, 'failed'); reportError(this, e, fmt(STRINGS.lateInit, { name: m.name }), { module: m }); }));
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
  /** Is this module installed? */
  has(name) { return this.modules.has(name); },
  /** Run order of module hooks (module names, first to last), for debugging "who runs first". */
  get moduleOrder() { return this._moduleOrder ?? []; },

  /** Re-sort the module hooks in the main loop (disabled presentation modules are not put back). */
  _sortHooks() {
    const order = sortModules([...this.modules.values()]);
    this._moduleOrder = order.map(m => m.name);
    for (const k of HOOKS) this._hooks[k] = [];
    for (const m of order) {
      const st = this._modState.get(m.name);
      if (this.disabledModules.has(m.name) || st === 'initializing' || st === 'failed') continue;
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
      for (const [dep, what] of Object.entries(opt)) if (!this.modules.has(dep))
        warnOnce(coded('module-requires', fmt(STRINGS.optional, { name: m.name, dep, what })));
    }
  },
};
