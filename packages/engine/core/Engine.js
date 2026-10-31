// Engine core: what every 3D web game needs (rendering and post, main loop, events, input, assets, audio, saves, UI basics, loading screen, ground API).
// No terrain, sky or characters, and no art; everything else is a module installed with engine.use(...) (see recipes/14-custom-module.md).
// Split: main loop and step in loop.js, start() in startup.js, ground API in ground.js, module install in modules.js, dispose and counts in lifecycle.js (all mixed into Engine.prototype).
import * as THREE from 'three';
import { Events } from './Events.js';
import { Input } from './Input.js';
import { I18n } from './I18n.js';
import { Saves } from './Saves.js';
import { Session } from './session.js';
import { Page } from './page.js';
import { Assets } from './Assets.js';
import { Audio } from './Audio.js';
import { PostFX } from '../render/PostFX.js';
import { createDefaultLights } from '../render/lights.js';
import { registerEngine } from '../render/materials.js';
import { createUniforms } from '../render/effects.js';
import { bindUniforms } from '../render/patches.js';
import { UIParts } from '../ui/Parts.js';
import { defineCoreParts } from '../ui/defaults.js';
import { applyUIStyle } from '../ui/theme.js';
import { describeApi } from './Describe.js';
import { setValidate, checkOptions, DEV } from './validate.js';
import { Clock } from './Clock.js';
import { Vars } from './Vars.js';
import { Budget } from './Budget.js';
import { Raycast } from './Raycast.js';
import { UrlState } from './UrlState.js';
import { Jobs } from './Jobs.js';
import { Threads } from './Threads.js';
import { Commits } from './Commits.js';
import { Ops } from './Ops.js';
import { Stream } from './Stream.js';
import { Batching } from './Batching.js';
import { Load } from './Load.js';
import { Random } from './Random.js';
import { loopMethods } from './loop.js';
import { startupMethods } from './startup.js';
import { groundMethods, flatGround } from './ground.js';
import { actorMethods } from './actor.js';
import { detectTier } from './tier.js';
import { lifecycleMethods } from './lifecycle.js';
import { reportListenerError } from './errors.js';
import { createMovement } from './movement.js';
import { moduleMethods } from './modules.js';
import { skipMethods, defineSkipOp } from './skip.js';
// Options createEngine accepts (must match the constructor destructuring)
const ENGINE_OPTIONS = ['canvas', 'style', 'shadows', 'antialias', 'post', 'pixelRatio', 'adaptiveResolution', 'targetFps', 'ui', 'audio',
  'fov', 'near', 'fogFar',
  'locale', 'strings', 'bindings', 'saveKey', 'joystick', 'padBindings', 'headless', 'validate', 'decoders', 'budget', 'urlState', 'seed', 'movement', 'threads', 'pauseOnBlur', 'batching'];

export class Engine {
  /**
   * @param o
   *   canvas        <canvas> (required)
   *   style         style pack (art data: colors, models, sky, particle looks, sounds...); modules read their look from it
   *   shadows       real-time shadows, default true
   *   antialias     MSAA edges, default style.antialias, else on for desktop and off for low-tier devices (phones, integrated GPUs); settings can switch it
   *   post          style post effects on/off by name, e.g. { bloom: false }; default each effect's own (costly ones off on low-tier devices)
   *   pixelRatio    render resolution, default min(device pixel ratio, 1.5)
   *   adaptiveResolution / targetFps   lower resolution automatically when the frame rate is short, default on / 55
   *   ui            UI parts { name: false | true | options | (engine, options) => part }: { loading: { title }, title: { title }, toast: false }; see ui/Parts.js
   *   audio         per-channel volume { volume, ambience, sfx, music }
   *   locale / strings   UI language ('auto' | 'zh-CN' | 'en' | your own) and override string tables. Default 'auto': a browser language starting with zh gives 'zh-CN', anything else 'en'; pass a locale to force one
   *   bindings      override default keys { interact: ['KeyF'] }
   *   saveKey       save-name prefix; must differ between games on one site, default 'game'
   *   fov / near / fogFar   camera field of view, near plane, default fog distance
   *   headless      headless mode: no real-time loop, no per-frame render, advances only on step() (tests, screenshots; reproducible).
   *                 adding ?threedog-headless to the URL also turns it on
   *   validate      runtime check of option names and misspelled names (console says "did you mean `xxx`?"), default true; may be off in a release
   *   decoders      Draco/KTX2 decoder directory (e.g. a CDN URL holding draco/ and basis/). Usually omit: the decoders bundled with three are packed by vite
   *   budget        performance budget limits { drawCalls, fps, ... }, only the given categories are checked; default off
   *   urlState      read URL parameters to set up a scenario (?time=18:30&pos=40,-20), default on in development only
   *   seed          seed of engine.random; default 1 in headless mode (reproducible), current time when running live
   *   threads       worker pool size for engine.threads: 'auto' (default, cores - 1, max 4), a number, or false (everything on the main thread; same results)
   *   pauseOnBlur   gameplay waits while the window is in the background or the tab is hidden, default true (engine.page, page.js)
   *   batching      automatic instancing of repeated static models (core/Batching.js): false turns it off, { minCount 8, cell } tunes it
   *   movement      one shared "can walk there" setting { radius 0.4, height 1.8, maxSlope 48 (degrees), stepHeight 0.45 }, exposed read-only as engine.movement
   */
  constructor(opts = {}) {
    setValidate(opts.validate);
    checkOptions('createEngine()', opts, ENGINE_OPTIONS);
    const { canvas, style = {}, shadows = true, antialias, post, pixelRatio, adaptiveResolution = true, targetFps = 55, ui = {}, audio = {},
      fov = 55, near = 0.3, fogFar = 600, locale = 'auto', strings = {}, bindings = {}, saveKey = 'game', joystick = 'auto', padBindings = {},
      headless = new URLSearchParams(location.search).has('threedog-headless'), validate = true,
      decoders = null, budget = null, urlState = DEV, seed, movement, threads = 'auto', pauseOnBlur = true, batching = {} } = opts;
    this.THREE = THREE;
    this.movement = createMovement(movement);   // character radius / height / slope / step height: the single copy shared by collision, physics and nav
    this.style = style;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.tier = detectTier(r);                 // 'low' | 'high': device tier, decides default quality
    r.setPixelRatio(pixelRatio ?? Math.min(devicePixelRatio || 1, this.tier === 'low' ? 1 : 1.5));
    r.setSize(innerWidth, innerHeight, false);
    const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };
    r.toneMapping = TONE[style.toneMapping ?? 'neutral'];   // neutral fallback; the look (ACES, exposure) is the style pack's
    r.toneMappingExposure = style.exposure ?? 1;
    r.shadowMap.enabled = shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(style.background ?? 0x8c8c8c);
    /** Default lights { sun: DirectionalLight, hemi: HemisphereLight }: neutral without sky, driven by sky when installed @type {{ sun: any, hemi: any }} */
    this.lights = createDefaultLights(this);
    this.camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, near, 1500);
    this.camera.position.set(0, 10, 20);
    this.focus = new THREE.Vector3();          // camera focus (updated by the camera module): the view loads around it; simulation follows world.anchor
    this.shadows = shadows;
    this.ground = flatGround;
    this.player = null;
    /** World record id of the one the local user controls (default 'player'): interactions, trigger zones, markers and ops (ctx.actor) use it. Set it to hand control to a vehicle or squad member @type {string} */
    this.actor = 'player';
    this.ready = false;
    this.disposed = false;                     // true after dispose()
    this._abort = new AbortController();
    this.signal = this._abort.signal;          // attach DOM listeners to it: addEventListener(type, fn, { signal: engine.signal }); dispose cancels them together
    this.uiRoot = document.createElement('div');   // engine and module UI elements live here (not on body); dispose removes the whole root
    this.uiRoot.className = 'threedog-root'; document.body.appendChild(this.uiRoot);
    this.headless = headless;
    this.paused = headless;                    // while paused the real-time loop does not advance; only step() does
    this.fps = 0;
    this.openWindows = new Set();              // ids of open windows (for describe)
    this.fogFar = fogFar;                       // base fog distance; terrain view range changes it, weather scales it
    this.modules = new Map();
    this.waterBodies = [];
    this._fixed = []; this._frame = []; this._hooks = { fixed: [], frame: [], afterRender: [], skip: [] };
    this._hookErrors = new Set();              // places that already reported an error (once per place, see errors.js)
    this.error = null;                         // gameplay error in dev/test: { where, message, cause?, docs? }; gameplay is frozen (see errors.js)
    this.disabledModules = new Set();          // presentation modules disabled after they threw
    this._elapsed = 0;                          // engine.elapsed: fixed seconds, advanced per fixed step and copied into uniforms.uTime
    /** This engine's shader uniforms (uTime, uWind, uCloud, season tints...); share these objects in your own ShaderMaterial or patch @type {import('../types/core').EngineUniforms} */
    this.uniforms = createUniforms(style);
    bindUniforms(r, this.uniforms);             // built-in shader effects read this engine's uniforms when compiled by this renderer
    this._materials = registerEngine(this);    // makeMaterial without an engine argument uses the first live engine's style pack

    this.events = new Events({ check: import.meta.env?.DEV && validate !== false,   // event-name spelling check runs in development only
      onError: (name, err) => reportListenerError(this, name, err), now: () => this.tick });   // listener errors are handled by severity (errors.js)
    this.i18n = new I18n(this, { locale, strings });
    this.saves = new Saves(this, { prefix: saveKey + '-' });
    this.session = new Session(this);          // new game / continue / back to title from a clean slate (session.js)
    this.input = new Input(this, canvas, { joystick, bindings, padBindings });
    this.events.on('ui:open', id => this.openWindows.add(id));
    this.events.on('ui:close', id => this.openWindows.delete(id));
    this.audio = new Audio(this, audio);
    this.decoders = decoders;
    this.assets = new Assets(this);
    this.clock = new Clock(this);              // game clock (game seconds, timers)
    this.vars = new Vars(this);                // story flags and counters
    this.budget = new Budget(this);            // performance budget (default off)
    if (budget) this.budget.enable(budget);
    this.raycaster = new Raycast(this);        // ray registry: engine.raycast / pick
    Object.assign(this, describeApi(this));     // describe / describeText / inspect / explain, see Describe.js
    this.random = new Random(seed ?? (headless ? 1 : Date.now()));   // wall-clock: differs per run when no seed is given
    this.saves.register('random', { save: () => this.random.toJSON(), load: d => this.random.fromJSON(d) });
    this._urlState = new UrlState(this, { fromUrl: urlState });
    this._freezers = new Set();                // who froze gameplay (freeze)
    this.tick = 0;                             // fixed-step count (the gameplay timeline: commits, event history and input records use it; stops while frozen)
    this.commits = new Commits(this);          // background results that affect gameplay take effect on a fixed tick (see Commits.js)
    this.ops = new Ops(this);                  // one entry point for actions (define / run / can / list / recent), see Ops.js
    defineSkipOp(this);                        // 'time.skip', behind engine.skip (skip.js)
    this.jobs = new Jobs(this);                // frame-spread job scheduler
    this.threads = new Threads(threads);       // worker pool (see Threads.js); workers start only when a lane is used
    this.load = new Load(this);                // load sources: where the world is loaded (stream, models, terrain, colliders read it)
    this.stream = new Stream(this);            // spatial stream-in
    this.batching = new Batching(this, batching);   // repeated static models drawn as InstancedMesh batches (Batching.js)
    this.startup = null;                       // startup timing report (set once start() finishes)
    this._prof = null;                         // module hook timing (profile(true) turns it on)
    this._afterTick = null;                    // at startup, checked once at the end of each frame for readiness
    // effects come from the style pack; costly ones start off on low-tier devices unless the post option names them
    this.post = new PostFX(this, { antialias: antialias ?? style.antialias ?? this.tier !== 'low', effects: style.post, enabled: post });
    this._uiStyle = applyUIStyle(this, style.ui);   // theme variables, pack CSS and fonts; removed on dispose
    this.ui = new UIParts(this, ui);           // UI parts: every piece of screen UI is replaceable or off (ui/Parts.js)
    defineCoreParts(this);
    this.ui.get('loading')?.show({});
    this.adaptive = { paused: false, on: adaptiveResolution && !headless, target: targetFps, min: 0.6, max: r.getPixelRatio(),
      t: 0, n: 0, good: 0, cooldown: 0 };
    addEventListener('resize', () => this._resize(), { signal: this.signal });
    this.page = new Page(this, { pauseOnBlur });   // window focus, tab visibility, mouse lock, WebGL context: handled only there
  }

  get waterLevel() { return this.ground.waterLevel; }

  // ---------- common ----------
  /** Get a UI string (i18n) */
  t(key, params) { return this.i18n.t(key, params); }
  /** Elapsed fixed-step seconds (ignores clock.timeScale; stops while frozen or paused), for presentation animation (sway, bobbing). Game seconds are clock.now (= fixed-step seconds × timeScale); sky time of day is sky.timeOfDay */
  get elapsed() { return this._elapsed; }
  /** Ray cast: the nearest hit or null, see Raycast.js */
  raycast(origin, dir, opts) { return this.raycaster.cast(origin, dir, opts); }
  /** Cast a ray from screen coordinates (-1..1) */
  pick(ndcX, ndcY, opts) { return this.raycaster.pick(ndcX, ndcY, opts); }
  /** Set up a scenario: { time, weather, pos, save, wait, cutscene, state }, see UrlState.js */
  applyState(params) { return this._urlState.apply(params); }
  /** Scenario ready: start() has finished and the URL parameters / latest applyState are applied (tests and screenshots wait for it) */
  get stateApplied() { return this.ready && this._urlState.applied; }
  /** Name a set of scenario parameters, then use applyState({ state: name }) or the URL ?state=name */
  defineState(name, params) { this._urlState.define(name, params); return this; }
  add(...objs) { this.scene.add(...objs); return objs[0]; }
  /** Detach from the parent only (no GPU release; use when you will add it back). Use remove for objects you are done with */
  detach(...objs) { for (const o of objs) o.removeFromParent(); }
  /** Delete an object for good: detach it, unregister its rays and dispose geometries and materials (textures are kept). Geometry and materials shared by assets model clones are only decremented in use count (see Assets.js) */
  remove(...objs) {
    for (const o of objs) {
      o.removeFromParent();
      this.raycaster.forget(o);
      this.assets.forget(o);
      const shared = this.assets.shared, held = this.batching.held;   // a batch still drawing the same geometry / material keeps it alive
      o.traverse(c => {
        if (c.geometry && !shared.has(c.geometry) && !held.has(c.geometry)) c.geometry.dispose();
        for (const m of [].concat(c.material || [])) if (!shared.has(m) && !held.has(m)) m.dispose();
      });
    }
  }
  /** Fixed-step logic (60 per second): movement, timers, gameplay keys. Returns a handle { remove() } */
  onFixed(fn) { this._fixed.push(fn); return { remove: () => { this._fixed = this._fixed.filter(f => f !== fn); } }; }
  /** Once per frame: animation, camera, UI. Returns a handle { remove() } */
  onFrame(fn) { this._frame.push(fn); return { remove: () => { this._frame = this._frame.filter(f => f !== fn); } }; }

  // ---------- settings ----------
  setPixelRatio(p) { this.renderer.setPixelRatio(p); this.post.setPixelRatio(p); }
  /**
   * Master shadow switch. Off: remember each light's castShadow (the game's choice) then turn it off; on: restore only the lights that cast before (lights the game turned off stay off).
   * Lights added while off are left alone (the renderer has shadows off, so it makes no difference).
   */
  setShadows(on) {
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse(o => {
      if (o.isLight && o.shadow) {
        const u = o.userData;
        if (!on) { if (!('threedogCastShadow' in u)) u.threedogCastShadow = o.castShadow; o.castShadow = false; }
        else if ('threedogCastShadow' in u) { o.castShadow = u.threedogCastShadow; delete u.threedogCastShadow; }
      }
      if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true);
    });
    this.events.emit('settings:shadows', on);
  }
  setFogFar(d) {
    this.fogFar = d;
    if (this.scene.fog) { this.scene.fog.far = d; this.scene.fog.near = d * 0.3; }
    this.camera.far = d + 150; this.camera.updateProjectionMatrix();
  }

  /** Display name of a module (loading screen): module.<name> from the string table, else the module's own label */
  moduleName(m) { return this.i18n.has('module.' + m.name) ? this.t('module.' + m.name) : (m.label || m.name); }

  // ---------- pause and deterministic stepping (tests, screenshots, AI checks) ----------
  /** Pause the real-time loop (the picture stops and the game stops advancing) */
  pause() { this.paused = true; return this; }
  /** Resume the real-time loop (in headless mode this starts live running) */
  resume() { if (!this.disposed) { this.paused = false; this._loop(); } return this; }
  // Gameplay freeze (menus, flow 'paused'): no fixed steps (movement, timers, game clock and engine.elapsed all stop) while frame hooks and rendering go on, so the picture and UI stay alive.
  // Gameplay logic (quest checks, cutscene waits) belongs in fixed, or check engine.frozen first in frame (see the top of loop.js).
  // Unlike pause(), which stops rendering too and is for tests and step(). owner is the freezer's name; play resumes only when all have unfrozen. step() obeys freezes as well.
  freeze(owner = 'game') { this._freezers.add(owner); return this; }
  unfreeze(owner = 'game') { this._freezers.delete(owner); return this; }
  /** True while someone has frozen gameplay */
  get frozen() { return this._freezers.size > 0; }

  _resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.post.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}

// Mix in by property descriptor (Object.assign would evaluate getters on the spot and lose them)
for (const part of [loopMethods, startupMethods, groundMethods, actorMethods, moduleMethods, lifecycleMethods, skipMethods])
  Object.defineProperties(Engine.prototype, Object.getOwnPropertyDescriptors(part));
