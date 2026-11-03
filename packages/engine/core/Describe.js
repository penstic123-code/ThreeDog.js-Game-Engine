// Game state description: engine.describe() returns a plain object (JSON.stringify-able); engine.describeText() returns multi-line text.
// For AI and test scripts: learn "what time it is, what the weather is, where the player is, what is nearby, which windows are open" without a screenshot.
//
// The core fills in only what it knows (time in seconds, player position, camera, windows, performance); the rest comes from modules' optional hooks:
//   describe(e, ctx) {
//     ctx.out.time.clock = '18:30';                       // you may add info to the standard fields
//     ctx.near(obj3D or {x,z}, { name, kind: 'npc' });   // report a "nearby thing"; the core computes distance, bearing and ordering
//     return { ... };                                     // the return value goes into the result under the module name as key (omitted if nothing is returned)
//   }
//
// A small game that does not want a full module: engine.describe.add(name, fn) registers the game's own state in one line; the return value goes into describe().<name> (fn gets the same arguments as a module hook).
//   const h = engine.describe.add('range', () => ({ score, targets: targets.length }));   h.remove() to cancel
// A big game writes its systems as modules and uses the module's describe hook.
// ctx.near(at, info, weak): reports for the same `at` (same object) are merged; with weak = true only missing fields are filled (used by the interaction module).
// Display names (ground type, weather name) are not hard-coded here: they come from the string table, ground.<type> and weather.<name> (registered by the terrain and weather modules), and go into groundName / label.
// describeText, which turns this into text, lives in describeText.js.
import { describeText } from './describeText.js';
import { moduleRow } from './moduleTypes.js';
import { inspect, explain } from './Inspect.js';
import { inspectScene } from './InspectScene.js';
import { inspectMaterials } from './InspectMaterials.js';
import { inspectPerf } from './InspectPerf.js';
import { codedError, coded } from './errorHints.js';
import { r1 } from './math.js';
import { describeRender } from './describeRender.js';
import { describeLook } from './look/report.js';
import { describeOwned } from './owned.js';
import { describeScene } from './thingOps.js';
import { describeHolds } from './holds.js';
import { warnOnce } from './validate.js';
import { stats } from '../render/backend.js';
import { threePatches } from './threePatches.js';
import { describeSlots } from './plugins.js';
/** describe().perf's draw counters (render/backend.js reads them per renderer) @param {any} r */
const drawStats = r => { const s = stats(r); return { drawCalls: s.drawCalls, triangles: s.triangles }; };

const NEAR_RADIUS = 30, NEAR_MAX = 15;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];           // north = -Z, east = +X
const RELATIVE = ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'];   // relative to the camera heading
const STANDARD = new Set(['ready', 'error', 'disabledModules', 'moduleStates', 'loading', 'time', 'player', 'camera', 'nearbyRadius', 'nearby', 'actions', 'ui', 'cutscene', 'modules', 'perf', 'scene', 'render', 'look', 'owned', 'shared', 'control']);
const ACTIONS_MAX = 8;   // what the player can do now, with why not: saves the AI a guess for a few dozen characters   // the core's own fields
const sector = a => Math.round(((a % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 4)) % 8;

/** Display name from the string table (prefix + key); null if missing (the text then uses the raw name) */
const nameOf = (e, prefix, key) => (key != null && e.i18n.has(prefix + key) ? e.t(prefix + key) : null);

/**
 * The engine's state questions, assigned onto the engine: describe (call it for the state object; .add registers the game's own state),
 * describeText, inspect and explain (Inspect.js)
 * @param {any} e
 */
export function describeApi(e) {
  const extras = new Map();
  /**
   * Current game state (plain object, JSON.stringify-able). radius: how far counts as "nearby" (meters), default 30
   * @param {string | string[] | { radius?: number, center?: { x: number, z: number }, only?: string[] }} [opts] center: measure "nearby" from here instead
   *   of the player (inspect uses it); only: just these top-level sections (a name or an array is short for { only }), e.g. describe('look')
   *   or describe({ only: ['look', 'shared'] }). Why: the whole object is ~40 KB on a mid-size world, most of it engine tables (shared, look, slots)
   *   that a question about one part does not need, and only the asked sections are built. An unknown section name is reported in the result as unknownSections, never a silent {}
   * @example engine.describe('player').player.x
  */
  const api = opts => {
    const o = typeof opts === 'string' || Array.isArray(opts) ? { only: [opts].flat() } : opts ?? {};
    const part = describe(e, o, extras);
    if (part) return part;
    // a name that is not a section this time: build everything once to say which sections exist
    const all = describe(e, { ...o, only: undefined }, extras);
    const out = Object.fromEntries(o.only.filter(k => k in all).map(k => [k, all[k]])), unknown = o.only.filter(k => !(k in all));
    return { ...out, unknownSections: unknown, sections: Object.keys(all) };
  };
  /** @internal engine.catalog() reads which names were added (and by which module) */ api._extras = extras;
  /**
   * Register the game's own state: the return value of fn(engine, ctx) (must be JSON-able) goes into describe().<name>; undefined is omitted
   * @param {string} name key in the result; must not match an existing field or module name
   * @param {(e: any, ctx: any) => any} fn
   * @returns {{ remove(): void }}
   * @example engine.describe.add('range', () => ({ score: vars.get('score'), targets: targets.length }));
  */
  api.add = (name, fn) => {
    if (extras.has(name) || STANDARD.has(name) || e.modules.has(name)) throw codedError('describe-name', `describe.add('${name}'): this name is already taken; pick another (existing fields, module names and previously registered names cannot be reused)`);
    extras.set(name, fn);
    return { remove: () => { extras.delete(name); } };
  };
  /** Text of describe(): a summary by default; { path: 'world' } one part as JSON; { full: true } everything (see describeText.js) */
  // game: the describe.add names, so the summary lists the game's own state before engine tables (it is what the game author asked to see)
  const text = ({ full, path, ...opts } = {}) => describeText(api(opts), { full, path, game: [...extras.keys()] });
  const inspectApi = Object.assign((at, opts) => inspect(e, at, opts), { scene: opts => inspectScene(e, opts),
    materials: opts => inspectMaterials(e, opts), perf: opts => inspectPerf(e, opts) });
  return { describe: api, describeText: text, inspect: inspectApi, explain: q => explain(e, q) };
}

/** Only the modules that are not running normally (initializing / failed) appear in describe, so the common case adds nothing (null); engine.moduleStates has all of them */
function pendingModules(e) {
  const out = {};
  for (const [name, st] of e._modState) if (st === 'initializing' || st === 'failed') out[name] = st;
  return Object.keys(out).length ? out : null;
}

// Engine tables no module hook writes into (hooks add to time / player / camera / ui / perf / cutscene / nearby): a describe({ only }) that asks
// for nothing else skips the hooks, describe.add and the action list
const TABLES = new Set(['ready', 'error', 'disabledModules', 'loading', 'holds', 'input', 'control', 'shared', 'modules', 'slots', 'scene', 'threePatches', 'owned', 'look', 'render', 'renderer']);
const NONE = Symbol('none');   // a conditional section that is absent this time

/**
 * Build the state object. radius: how far counts as "nearby"; extras: those registered by describe.add; only: build just these top-level
 * sections (the other core sections are built on first touch, so a hook that writes ctx.out.time still works). Returns null when a requested
 * name is not a section this time: api() then builds everything to name the sections that exist
 */
function describe(e, { radius = NEAR_RADIUS, center: at, only } = {}, extras) {
  const p = e.player?.position, center = at || p || e.focus, cam = e.camera;
  /** @type {Record<string, () => any>} the core's sections in output order; NONE = left out */
  const core = {
    ready: () => e.ready,
    error: () => e.error,                                    // gameplay error in dev / tests (gameplay is frozen)
    unhandled: () => e._unhandled || NONE,                   // dev: first promise rejection nobody caught, and how many followed (errors.js)
    disabledModules: () => [...e.disabledModules],           // look / ui modules disabled after an error
    moduleStates: () => pendingModules(e) ?? NONE,           // while a module is initializing or failed
    loading: () => e.loading.view(),                         // what is pending / failed and whether it blocks the start (Loading.js)
    time: () => ({ tick: e.tick, real: r1(e.time.now('real')), ambient: r1(e.time.now('ambient')), calendar: r1(e.clock.now), paused: e.paused, frozen: e.frozen, ...(e.frozen ? { frozenBy: e.stacks.get('freeze').names() } : {}), headless: e.headless, run: e.runState,
      channels: e.time.describe(), rate: e.clock.rate }),
    holds: () => describeHolds(e),                        // who holds pause / freeze / camera / input (holds.js)
    input: () => e.input.describe(),                      // context stack, declared actions nobody bound, the player's rebindings (Input.js)
    control: () => e.control.describe(),                  // who decides where each held character goes: { id: { owner, layer, waiting } } (control.js)
    shared: () => e.stacks.describe(),                    // every shared value / slot with entries: value, writer, how it combined, who else wants it (stacks.js)
    wraps: () => { const w = e._wraps?.describe(); return w && Object.keys(w).length ? w : NONE; },   // engine.wrap: { 'inventory.add': [owners, outermost first] }
    player: () => p ? {
      x: r1(p.x), y: r1(p.y), z: r1(p.z),
      ground: e.groundType(p.x, p.z),
      groundName: nameOf(e, 'ground.', e.groundType(p.x, p.z)),
      inWater: e.waterAt(p.x, p.z) > p.y,
      state: e.player.state ?? null,   // the character module's own state name ('walk', 'jump'...): core passes it on and never interprets it
    } : null,
    // projection: engine.camera is an EngineCamera (core/engineCamera.js) that a rig may switch to orthographic; said here so the switch is never hidden
    camera: () => ({ type: null, projection: cam.orthoSize ? 'orthographic' : 'perspective', ...(cam.orthoSize ? { orthoSize: r1(cam.orthoSize) } : {}), x: r1(cam.position.x), y: r1(cam.position.y), z: r1(cam.position.z),
      focus: { x: r1(e.focus.x), z: r1(e.focus.z) }, override: e.cameraOverride?.owner ?? null }),
    nearbyRadius: () => radius,
    nearby: () => [],
    ui: () => ({ windows: [...e.openWindows], inputLocked: !e.input.enabled, dialogue: null, parts: e.ui.describe() }),   // windows include full-screen UI parts (title); parts: default / custom / off
    cutscene: () => null,
    modules: () => [...e.modules.values()].map(moduleRow),   // { name, type, provides?, requires? } in install order (moduleTypes.js)
    slots: () => describeSlots(e),                           // what is plugged in where, from which file, what it affects (plugins.js)
    scene: () => describeScene(e),                           // engine.add / world things: counts by save tier and what will not survive a load (thingOps.js)
    threePatches: () => threePatches.list(),                 // page-wide changes to three.js classes still on (core/threePatches.js)
    owned: () => describeOwned(e),                           // every property the engine writes on its own and who writes it now (owned.js)
    look: () => describeLook(e),                             // every look part key, its value and who set it (look/report.js)
    render: () => describeRender(e),                         // renderer / post / lights and who set each (describeRender.js)
    // which renderer was asked for and which backend draws; reason = why not WebGPU (core/startup.js _startRenderer). backend null before start()
    renderer: () => e._backend ?? { requested: e._backendWant.requested, backend: null, reason: null },
    perf: () => ({
      fps: e.paused ? null : Math.round(e.fps), cpuMs: e.paused ? null : r1(e.cpuMs),
      cpu: e.paused ? null : Object.fromEntries(Object.entries(e.cpuPhases).map(([k, v]) => [k, r1(v)])),
      apply: e.budget.cost.report(),
      ...drawStats(e.renderer), pixelRatio: e.renderer.getPixelRatio(),
      budget: e.budget.report(), startup: e.startup, stream: e.stream.stats, batching: e.batching.stats, jobs: e.jobs.pending, commits: { pending: e.commits.pending, ...e.commits.stats },
    }),
  };
  const out = {};
  if (!only) for (const k in core) { const v = core[k](); if (v !== NONE) out[k] = v; }
  else for (const k in core) {
    // built on first read; a hook's plain write (ctx.out.cutscene = ...) replaces it the same way
    const put = v => { if (v === NONE) delete out[k]; else Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true }); };
    Object.defineProperty(out, k, { get: () => (put(core[k]()), out[k]), set: put, enumerable: true, configurable: true });
  }
  if (!only || !only.every(k => TABLES.has(k) && !e.modules.has(k) && !extras.has(k))) hooks(e, out, radius, center, extras);
  if (!only) return out;
  const picked = {};
  for (const k of only) { const v = out[k]; if (!(k in out)) return null; picked[k] = v; }
  return picked;
}

/** Module describe hooks and describe.add, then the nearby list and the player's actions, into out */
function hooks(e, out, radius, center, extras) {
  const dir = e.camera.getWorldDirection(new e.THREE.Vector3()), camYaw = Math.atan2(dir.x, -dir.z);
  // Nearby things: collect first, then sort and truncate once at the end
  const found = new Map(), v = new e.THREE.Vector3();
  const ctx = {
    out, radius, center,
    near(at, info, weak = false) {
      const pos = at.isObject3D ? at.getWorldPosition(v) : at;
      const dx = pos.x - center.x, dz = pos.z - center.z, dist = Math.hypot(dx, dz);
      if (dist > radius) return;
      const old = found.get(at);
      if (old) { for (const k in info) if (!weak || old[k] == null) old[k] = info[k]; return; }
      const bearing = Math.atan2(dx, -dz);
      found.set(at, { ...info, dist: r1(dist), dir: COMPASS[sector(bearing)], rel: RELATIVE[sector(bearing - camYaw)], x: r1(pos.x), z: r1(pos.z) });
    },
  };
  // A module's hook that throws fills only its own entry: describe() runs at the end of every engine.step(), so letting one broken hook throw
  // would make step() throw after time has already advanced and lose every other module's state with it.
  for (const m of e.modules.values()) {
    if (!m.describe) continue;
    try { const part = m.describe(e, ctx); if (part !== undefined) out[m.name] = part; }
    catch (err) {
      const msg = String(err?.message || err);
      out[m.name] = { error: msg, code: 'describe-threw' };
      warnOnce(coded('describe-threw', `describe(): module '${m.name}' describe hook threw: ${msg}`), 'describe-threw:' + m.name);
    }
  }
  for (const [name, fn] of extras) {
    try { const part = fn(e, ctx); if (part !== undefined) out[name] = part; } catch (err) { out[name] = { error: String(err.message || err) }; }   // an error in the game's own description must not take down the whole describe
  }
  out.nearby = [...found.values()].sort((a, b) => a.dist - b.dist).slice(0, NEAR_MAX);
  // ops on offer for the player (engine.ops.list({ available: true })): possible ones first; omitted when the game has none
  const acts = e.ops.list({ available: true }).sort((a, b) => b.ok - a.ok).slice(0, ACTIONS_MAX);
  if (acts.length) out.actions = acts.map(a => ({ op: a.name, args: a.args, ok: a.ok, ...(a.ok ? {} : { code: a.code, facts: a.facts, nextActions: a.nextActions }) }));
}
