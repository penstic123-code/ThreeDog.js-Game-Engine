// Engine services: the objects every engine owns besides rendering (events, i18n, saves, input, audio, assets, clock, ops, jobs, streaming...).
// Split out of the Engine constructor so it stays readable; the order below matters (later services read earlier ones), do not reorder.
import { Events } from './Events.js';
import { Wraps } from './wrap.js';
import { I18n } from './I18n.js';
import { Saves } from './Saves.js';
import { Session } from './session.js';
import { Input } from './Input.js';
import { Audio } from './Audio.js';
import { Assets } from './Assets.js';
import { Clock } from './Clock.js';
import { Vars } from './Vars.js';
import { Budget } from './Budget.js';
import { Rays } from './Rays.js';
import { Random } from './Random.js';
import { UrlState } from './UrlState.js';
import { Jobs } from './Jobs.js';
import { Threads } from './Threads.js';
import { Commits } from './Commits.js';
import { Ops } from './Ops.js';
import { Views } from './Views.js';
import { Stream } from './Stream.js';
import { Batching } from './Batching.js';
import { defineHoldStacks } from './holds.js';
import { Stacks } from './stacks.js';
import { Control } from './control.js';
import { Time } from './time.js';
import { DebugOverrides } from './DebugOverrides.js';
import { describeApi } from './Describe.js';
import { reportListenerError } from './errors.js';
import { DEV } from './validate.js';
import { defineSkipOp } from './skip.js';
import { installThings } from './thingOps.js';
import { Plugins } from './plugins.js';
import { watchGameLights } from './gameLights.js';

/**
 * Create the engine services on `engine` (called once from the Engine constructor, after the renderer, scene and uniforms exist).
 * @param engine  the engine under construction
 * @param o  the createEngine options these services read, already defaulted by the constructor
 */
export function createServices(engine, { canvas, validate, locale, strings, saveKey, joystick, bindings, audio, decoders, budget, seed, headless, urlState, threads, batching }) {
  // DEV, not import.meta.env.DEV: the npm test bundle is a production build that sets THREEDOG_TEST, and the spelling check must run there too
  engine.events = new Events({ check: DEV && validate !== false,
    onError: (name, err) => reportListenerError(engine, name, err), now: () => engine.tick });   // listener errors are handled by severity (errors.js)
  engine.i18n = new I18n(engine, { locale, strings });
  engine.saves = new Saves(engine, { prefix: saveKey + '-' });
  engine.session = new Session(engine);          // new game / continue / back to title from a clean slate (session.js)
  // before Input: key bindings are the shared point 'input.keys'.
  // shared quantities (stacks.js): engine.mod(name, { owner, mul | add | set | clamp, for }) is the one way several systems change one
  (engine.stacks ??= new Stacks(engine))._hook();   // one registry, made early by Engine.js (look parts register points); saves and events hook in now
  engine.mod = (name, o) => engine.stacks.mod(name, o);
  engine.stacks.define('input.gate', { kind: 'any', per: true });   // input.gate(action, owner): one entry per owner and action (Input.js)
  engine.input = new Input(engine, canvas, { joystick, bindings });
  engine.events.on('ui:open', id => engine.openWindows.add(id));
  engine.events.on('ui:close', id => engine.openWindows.delete(id));
  engine.audio = new Audio(engine, audio);
  engine.decoders = decoders;
  engine.assets = new Assets(engine);
  engine.control = new Control(engine);          // who decides where each character goes (control.js): one holder in charge per character
  // module methods (wrap.js): engine.wrap(engine.inventory, 'add', (next, ...a) => ...) is the one way to change what a public method does
  engine._wraps = new Wraps(engine);
  engine.wrap = (target, method, fn, o) => engine._wraps.wrap(target, method, fn, o);
  engine.clock = new Clock(engine);              // calendar clock (calendar seconds, timers); its rate is the stack 'clock.rate'
  engine.time = new Time(engine);                // time channels: world, player, the game's own (time.js)
  engine.vars = new Vars(engine);                // story flags and counters
  engine.budget = new Budget(engine);            // performance budget (default off)
  if (budget) engine.budget.enable(budget);
  engine.rays = new Rays(engine);        // ray registry: engine.raycast / pick
  Object.assign(engine, describeApi(engine));     // describe / describeText / inspect / explain, see Describe.js
  engine.random = new Random(seed ?? (headless ? 1 : Date.now()));   // wall-clock: differs per run when no seed is given
  engine.saves.register('random', { atomic: true, save: () => engine.random.toJSON(), load: d => engine.random.fromJSON(d) });
  engine._urlState = new UrlState(engine, { fromUrl: urlState });
  // who holds the engine still: three named stacks (stacks.js: same owner rules as every shared quantity, holders in describe); pause / freeze / takeCamera in holds.js
  defineHoldStacks(engine);
  engine.commits = new Commits(engine);          // background results that affect gameplay take effect on a fixed tick (see Commits.js)
  engine.ops = new Ops(engine);                  // one entry point for actions (define / run / can / list / recent), see Ops.js
  engine.views = new Views(engine);              // named fixed camera views for repeatable screenshots (Views.js)
  defineSkipOp(engine);                        // 'time.skip', behind engine.skip (skip.js)
  installThings(engine);                       // engine.add registry, thing.set / remove, 'scene' save part
  engine.plugins = new Plugins(engine);          // the plugins folder: files plugged by what they export (plugins.js)
  watchGameLights(engine);                     // plain PointLight / SpotLight: light budget, shadow switch (gameLights.js)
  engine.debug = new DebugOverrides(engine);     // diagnostic overrides and view modes, all core; the debug() panel module adds engine.debug.panel (DebugOverrides.js)
  engine.jobs = new Jobs(engine);                // frame-spread job scheduler
  engine.threads = new Threads(threads);       // worker pool (see Threads.js); workers start only when a lane is used
  // spatial stream-in and the stream sources (where the world is loaded: stream, models, terrain, colliders read them)
  engine.stream = new Stream(engine);
  engine.batching = new Batching(engine, batching);   // repeated static models drawn as InstancedMesh batches (Batching.js)
}
