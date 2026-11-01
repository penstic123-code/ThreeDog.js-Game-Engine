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
import { inspect, explain } from './Inspect.js';
import { inspectScene } from './InspectScene.js';
import { codedError } from './errorHints.js';
import { r1 } from './math.js';
import { describeRender } from './describeRender.js';
import { describeScene } from './thingOps.js';

const NEAR_RADIUS = 30, NEAR_MAX = 15;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];           // north = -Z, east = +X
const RELATIVE = ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'];   // relative to the camera heading
const STANDARD = new Set(['ready', 'error', 'disabledModules', 'moduleStates', 'loading', 'time', 'player', 'camera', 'nearbyRadius', 'nearby', 'actions', 'ui', 'cutscene', 'modules', 'perf', 'scene', 'render']);
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
   * @param {{ radius?: number, center?: { x: number, z: number } }} [opts] center: measure "nearby" from here instead of the player (inspect uses it)
  */
  const api = opts => describe(e, opts, extras);
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
  const text = ({ full, path, ...opts } = {}) => describeText(api(opts), { full, path });
  const inspectApi = Object.assign((at, opts) => inspect(e, at, opts), { scene: opts => inspectScene(e, opts) });
  return { describe: api, describeText: text, inspect: inspectApi, explain: q => explain(e, q) };
}

/** Only the modules that are not running normally (initializing / failed) appear in describe, so the common case adds nothing; engine.moduleStates has all of them */
function pendingModules(e) {
  const out = {};
  for (const [name, st] of e._modState) if (st === 'initializing' || st === 'failed') out[name] = st;
  return Object.keys(out).length ? { moduleStates: out } : {};
}

/** Build the state object. radius: how far counts as "nearby"; extras: those registered by describe.add */
function describe(e, { radius = NEAR_RADIUS, center: at } = {}, extras) {
  const p = e.player?.position, center = at || p || e.focus, cam = e.camera;
  const dir = cam.getWorldDirection(new e.THREE.Vector3()), camYaw = Math.atan2(dir.x, -dir.z);
  const out = {
    ready: e.ready,
    error: e.error,                                    // gameplay error in dev / tests (gameplay is frozen)
    disabledModules: [...e.disabledModules],           // presentation modules disabled after an error
    ...pendingModules(e),                              // { moduleStates } while a module is initializing or failed
    loading: e.loading.view(),                         // what is pending / failed and whether it blocks the start (Loading.js)
    time: { elapsed: r1(e.elapsed), paused: e.paused, frozen: e.frozen, headless: e.headless },
    player: p ? {
      x: r1(p.x), y: r1(p.y), z: r1(p.z),
      ground: e.groundType(p.x, p.z),
      groundName: nameOf(e, 'ground.', e.groundType(p.x, p.z)),
      inWater: e.waterAt(p.x, p.z) > p.y,
      state: e.player.state ?? null,
      running: e.player.state === 'run',
      jumping: e.player.state === 'jump' || e.player.state === 'fall',
    } : null,
    camera: { type: null, x: r1(cam.position.x), y: r1(cam.position.y), z: r1(cam.position.z),
      focus: { x: r1(e.focus.x), z: r1(e.focus.z) }, override: e.cameraOverride?.owner ?? null },
    nearbyRadius: radius,
    nearby: [],
    ui: { windows: [...e.openWindows], inputLocked: !e.input.enabled, inputContexts: e.input.contexts, dialogue: null, parts: e.ui.describe() },   // windows include full-screen UI parts (title); parts: default / custom / off
    cutscene: null,
    modules: [...e.modules.keys()],
    scene: describeScene(e),                           // engine.add / world things: counts by save tier and what will not survive a load (thingOps.js)
    render: describeRender(e),                         // renderer / post / lights and who set each (describeRender.js)
    perf: {
      fps: e.paused ? null : Math.round(e.fps), cpuMs: e.paused ? null : r1(e.cpuMs),
      cpu: e.paused ? null : Object.fromEntries(Object.entries(e.cpuPhases).map(([k, v]) => [k, r1(v)])),
      apply: e.budget.cost.report(),
      drawCalls: e.renderer.info.render.calls, triangles: e.renderer.info.render.triangles, pixelRatio: e.renderer.getPixelRatio(),
      budget: e.budget.report(), startup: e.startup, stream: e.stream.stats, batching: e.batching.stats, jobs: e.jobs.pending, commits: { pending: e.commits.pending, ...e.commits.stats },
    },
  };
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
  for (const m of e.modules.values()) {
    if (!m.describe) continue;
    const part = m.describe(e, ctx);
    if (part !== undefined) out[m.name] = part;
  }
  for (const [name, fn] of extras) {
    try { const part = fn(e, ctx); if (part !== undefined) out[name] = part; } catch (err) { out[name] = { error: String(err.message || err) }; }   // an error in the game's own description must not take down the whole describe
  }
  out.nearby = [...found.values()].sort((a, b) => a.dist - b.dist).slice(0, NEAR_MAX);
  // ops on offer for the player (engine.ops.list({ available: true })): possible ones first; omitted when the game has none
  const acts = e.ops.list({ available: true }).sort((a, b) => b.ok - a.ok).slice(0, ACTIONS_MAX);
  if (acts.length) out.actions = acts.map(a => ({ op: a.name, args: a.args, ok: a.ok, ...(a.ok ? {} : { reason: a.reason }) }));
  return out;
}
