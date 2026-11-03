// Engine core: what every 3D web game needs (rendering and post, main loop, events, input, assets, audio, saves, UI basics, loading screen, ground API).
// No terrain, sky or characters, and no art; everything else is a module installed with engine.use(...) (see recipes/14-custom-module.md).
// Split: main loop and step in loop.js, start() in startup.js, ground API in ground.js, module install in modules.js, dispose and counts in lifecycle.js (all
// mixed into Engine.prototype).
import * as THREE from 'three';
import { Page } from './page.js';
import { createServices } from './services.js';
import { Stacks } from './stacks.js';
import { PostFX } from '../render/PostFX.js';
import { createDefaultLights } from '../render/lights.js';
import { registerEngine, makeMaterial, MATERIAL_PURPOSES } from '../render/materials.js';
import { defineMaterialsLook, defineSurfaceLook } from '../render/lookSurface.js';
import { createUniforms } from '../render/effects.js';
import { bindUniforms } from '../render/engineUniforms.js';
import { UIParts } from '../ui/Parts.js';
import { defineCoreParts } from '../ui/defaults.js';
import { applyUIStyle } from '../ui/theme.js';
import { trackValidate, warnOnce, DEV } from './validate.js';
import { readParams } from './params.js';
import { loopMethods } from './loop.js';
import { holdMethods } from './holds.js';
import { startupMethods } from './startup.js';
import { groundMethods, flatGround } from './ground.js';
import { actorMethods } from './actor.js';
import { forcedTier, defaultPixelRatio } from './tier.js';
import { tier as detectTier, tierBeforeRenderer, ownMsaa, timerContext, isWebGPU, webgpuPart, watchNodePrograms } from '../render/backend.js';
import { dressNodeTwins } from '../render/patches.js';
import { lifecycleMethods, clearHooks, checkCanvasUsable } from './lifecycle.js';
import { createAdaptive, GpuTimer } from './adaptive.js';
import { watchRejections } from './errors.js';
import { createMovement } from './movement.js';
import { moduleMethods } from './modules.js';
import { skipMethods } from './skip.js';
import { checkMethods } from './checks.js';
import { styleFrom, NO_STYLE, styleIsEmpty } from './styleParts.js';
import { canvasBox, placeUI, resizeMethods } from './canvasBox.js';
import { sceneMethods } from './sceneMethods.js';
import { EngineCamera } from './engineCamera.js';
import { recordRender } from './describeRender.js';
import { defineCoreLook, defineCloudShadowLook, defineSeasonLook, defineViewLook } from './look/coreParts.js';
import { defineShadowLook } from './look/shadowPart.js';
import { nameShaderErrors } from '../render/shaderErrors.js';
import { probeMethods } from '../render/probes.js';
import { headlessSettled } from './headlessLoad.js';
import { codedError } from './errorHints.js';
const FALLBACKS = ['webgl2', 'webgl', 'error'];
// createEngine() options: the one table for the unknown-key and type check (dev throws with did-you-mean, release warns once), the plain
// defaults and engine.catalog('core').params; R6 checks EngineOptions (types/core.d.ts) has exactly these keys. A key with several shapes
// names them all ('bool|object'). Object / array defaults stay in the destructuring below (in the schema all engines would share one object).
/** @internal */
export const ENGINE_PARAMS = {
  canvas: 'object?', renderer: { type: 'string|object', optional: true, desc: "'webgl' (default), 'webgpu', or a renderer the game built" },
  fallback: { type: 'string', optional: true, values: FALLBACKS }, style: 'object|array?', antialias: 'bool?',
  pixelRatio: 'number?', adaptiveResolution: { type: 'bool', default: true }, targetFps: { type: 'number', default: 55, min: 1 },
  ui: 'object?', audio: 'object?', fov: { type: 'number', default: 55, min: 1, max: 179 }, near: { type: 'number', default: 0.3, min: 0 },
  locale: { type: 'string', default: 'auto' }, strings: 'object?', bindings: 'object?', saveKey: { type: 'string', default: 'game' },
  joystick: { type: 'string|bool', default: 'auto' }, headless: 'bool?', validate: { type: 'bool', default: true }, decoders: 'string?',
  budget: 'object?', urlState: 'bool?', seed: 'number?', movement: 'object?', threads: { type: 'string|number|bool', default: 'auto' },
  pauseOnBlur: { type: 'bool', default: true }, batching: 'bool|object?', lights: { type: 'bool', default: true },
};

/** createEngine({ renderer: 'webgpu' }): three's WebGPURenderer from the classes threedog/tsl registered (render/backend.js) @param {any} canvas */
function newWebGPURenderer(canvas, antialias) {
  return new (needTsl("'webgpu'").WebGPURenderer)({ canvas, antialias, powerPreference: 'high-performance' });
}

/**
 * The three/webgpu classes threedog/tsl registered. Both WebGPU roads need it before createEngine: it brings three/webgpu for 'webgpu', and
 * the tsl side of patches and the WebGPU parts for any WebGPURenderer. Why not a dynamic import in start(): the engine core never imports it,
 * so WebGL games stay small.
 * @param {string} how
 */
const needTsl = how => webgpuPart('classes', `createEngine({ renderer: ${how} })`);

/** Check renderer / fallback and say what start() does: { requested, fallback } @param {any} r @param {any} rendererIn @param {any} fallback */
function rendererWant(r, rendererIn, fallback) {
  if (typeof rendererIn === 'string' && rendererIn !== 'webgpu') throw codedError('engine-misuse', `createEngine({ renderer }): a name is 'webgl' (the default) or 'webgpu', or pass a three.js renderer object, got ${JSON.stringify(rendererIn)}`);
  const gpu = isWebGPU(r);
  if (gpu) needTsl('yourWebGPURenderer');
  if (fallback !== undefined && !gpu) throw codedError('engine-misuse', "createEngine({ fallback }) only applies with renderer: 'webgpu' or your own WebGPURenderer (WebGLRenderer has nothing to fall back from)");
  return { requested: gpu ? 'webgpu' : 'webgl', fallback: fallback ?? 'webgl2' };
}


export class Engine {
  /**
   * @param o  createEngine options: each option, its default and meaning is documented once on EngineOptions (types/core.d.ts).
   *   style can also be a list of parts deep-merged left to right (rules in core/styleParts.js). ENGINE_PARAMS and the destructuring below must match it.
   */
  constructor(opts = {}) {
    /** This engine's dev checks (createEngine({ validate })); another engine on the page does not change it @type {boolean} */
    this.validate = opts.validate !== false;
    /** @internal */ this._untrackValidate = trackValidate(opts.validate);
    // createEngine({ post }) was a third switch next to look.post.set, and read as "turn bloom on" when nothing had added a bloom. Said here,
    // before the unknown-option check, so the message names the one way instead of only "unknown option"
    if (opts.post !== undefined) throw codedError('post-effect', 'createEngine({ post }) is gone. The engine ships no effects: add one with engine.look.post.add(bloom()) ' +
      "(import { bloom } from '@threedog/post-effects'), or a plugins/10-bloom.js file (export default bloom()); switch an added one with " +
      `engine.look.post.set(${JSON.stringify(opts.post)}) after it is added (a style's costly effects start off on low-tier devices: set turns them on)`);
    const o = readParams('createEngine()', ENGINE_PARAMS, opts);
    /** @internal createEngine options as read (engine.catalog('core').params shows them with the schema) */ this._createParams = o;
    const { canvas: canvasIn, renderer: rendererName, style: styleIn, antialias, pixelRatio, adaptiveResolution, targetFps, ui = {}, audio = {},
      fov, near, locale, strings = {}, bindings = {}, saveKey, joystick,
      headless = new URLSearchParams(location.search).has('threedog-headless'), validate,
      decoders = null, budget = null, urlState = DEV, seed, movement, threads, pauseOnBlur, batching = {}, lights, fallback } = o;
    this.THREE = THREE;
    // 'webgl' names the default (a WebGLRenderer the engine builds), so it reads like leaving the option out
    const rendererIn = rendererName === 'webgl' ? undefined : rendererName;
    // 'webgpu' is the same road as a game's own WebGPURenderer: built here, then handed on like one (start() inits it, core/startup.js)
    const gpuWanted = rendererIn === 'webgpu';
    const canvas = canvasIn ?? (gpuWanted ? undefined : rendererIn?.domElement);
    this.movement = createMovement(movement);   // character radius / height / slope / step height: the single copy shared by collision, physics and nav
    const style = this.style = styleFrom(styleIn);   // a list of parts is deep-merged (styleParts.js); one object is used as is
    if (styleIsEmpty(opts.style)) warnOnce(NO_STYLE);
    // a game-supplied renderer is used as is: the engine configures (pixel ratio, size, tone mapping, shadows) only a renderer it created itself
    const owned = !rendererIn || gpuWanted;
    this._ownsRenderer = owned;               // dispose() releases the WebGL context only of a renderer the engine built
    if (owned) checkCanvasUsable(canvas);
    // 'low' | 'high': device tier, decides default quality. A headless tool page names its tier (?threedog-tier, core/tier.js): detection would call
    // every headless browser low tier and drop the game's costly post from shots. An engine-built renderer needs it before it exists: MSAA defaults
    // from the tier and is the canvas's own (antialias, fixed when the context is made), so an effect-free frame skips the post chain
    const tierFirst = (headless && forcedTier()) || (owned ? tierBeforeRenderer() : null);
    const aa = antialias ?? style.antialias ?? (owned ? tierFirst !== 'low' : null);
    const r = this.renderer = gpuWanted ? newWebGPURenderer(canvas, aa) : rendererIn ?? new THREE.WebGLRenderer({ canvas, antialias: aa, powerPreference: 'high-performance' });
    /** @internal what the game asked for and what to do without WebGPU; start() fills describe().renderer from it */
    this._backendWant = rendererWant(r, rendererIn, fallback);
    watchNodePrograms(r);                      // WebGPU: generated code per material, for debug.view('shaderCost') (render/backend.js)
    if (isWebGPU(r)) dressNodeTwins(r);        // WebGPU: classic materials get their patches as nodes (render/patches.js)
    nameShaderErrors(r);                       // compile errors name the patch and slot (render/shaderErrors.js); a game's own handler stays
    this.tier = tierFirst || detectTier(r);
    if (owned || pixelRatio != null) r.setPixelRatio(pixelRatio ?? defaultPixelRatio(devicePixelRatio || 1, this.tier));
    this._autoSize = undefined;                // decided once the canvas is in the page (sizeMode): true = no CSS size, the engine sizes it to the window
    const box = canvasBox(this);
    if (owned) r.setSize(box.w, box.h, !!this._autoSize);
    r.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(style.background ?? 0x8c8c8c);
    /** Default lights { sun: DirectionalLight, hemi: HemisphereLight }: neutral without sky, driven by sky when installed @type {{ sun: any, hemi: any }} */
    /** Look parts by name, each with set / patch / replace (recipes/52-look.md): tone, lights, cloudShadow from core, the rest from the modules that provide them @type {Record<string, import('../index').LookPart>} */
    this.look = {};
    this.lights = createDefaultLights(this, { add: lights !== false });
    // the engine's own renderer: render defaults are a technical baseline under every style (AgX, soft shadows, neutral environment; coreParts.js);
    // a pack that wants none sets it (toneMapping: 'none', look.shadow enabled false, look.lights env.intensity 0)
    this.stacks = new Stacks(this);   // look values are shared points (core/look/points.js): the registry exists before the first look part
    defineCoreLook(this, { owned, baseline: owned });   // writes renderer.toneMapping once (style.toneMapping, else AgX); look.tone (exposure) and look.lights (coreParts.js)
    defineShadowLook(this, { owned, baseline: owned });   // look.shadow: the master switch and filter (a sky adds its shadow-box keys)
    recordRender(this, { owned });   // baseline for describe().render (after the curve is written): which values the engine / style set
    this.camera = new EngineCamera(fov, box.w / box.h, near, 1500);   // a PerspectiveCamera that camera rigs can switch to orthographic (core/engineCamera.js)
    this.camera.position.set(0, 10, 20);
    this.focus = new THREE.Vector3();          // camera focus (updated by the camera module): the view loads around it; simulation follows world.anchor
    this.ground = flatGround;
    this.player = null;
    /**
     * World record id of the one the local user controls (default 'player'): interactions, trigger zones, markers and ops (ctx.actor) use it. Set it to hand
     * control to a vehicle or squad member @type {string}
     */
    this.actor = 'player';
    /**
     * Where the engine is in its life, the one state every "may this run yet" check reads: 'constructed' (createEngine done, start() not called)
     * -> 'loading' (start() running: modules init, assets, the world builds; frame hooks run, fixed steps do not, so no game time passes)
     * -> 'ready' (the world is built: fixed steps run, engine:ready fires, the new-game state is captured) -> 'running' (start() resolved)
     * -> 'disposed'. @type {'constructed' | 'loading' | 'ready' | 'running' | 'disposed'}
     */
    this.phase = 'constructed';
    /** @internal module name -> handles its install / init passed to ctx.track (removed with the module: modules.js) */ this._modTracked = new Map();
    this._abort = new AbortController();
    // attach DOM listeners to it: addEventListener(type, fn, { signal: engine.signal }); dispose cancels them together
    this.signal = this._abort.signal;
    this.uiRoot = document.createElement('div');   // engine and module UI elements live here (not on body); dispose removes the whole root
    // the UI root sits right after the canvas and covers exactly its box (placeUI): HUD, windows and prompts line up with the canvas
    // whether it fills the window, sits in a page section, a split layout or an editor panel
    this.uiRoot.className = 'threedog-root';
    if (r.domElement.parentElement) r.domElement.after(this.uiRoot); else document.body.appendChild(this.uiRoot);
    this.headless = headless;
    this.paused = headless;                    // while paused the real-time loop does not advance; only step() does
    this.fps = 0;
    this.cpuMs = 0;                            // main-thread ms of the last real-time frame; cpuPhases splits it (loop.js)
    this.cpuPhases = { fixed: 0, frame: 0, render: 0, afterRender: 0 };
    this.openWindows = new Set();              // ids of open windows (for describe)
    this.modules = new Map();
    this._modState = new Map();                // module name -> registered | initializing | running | failed | disposed (modules.js)
    this.waterBodies = [];
    clearHooks(this);
    this._hookErrors = new Set();              // places that already reported an error (once per place, see errors.js)
    this.error = null;                         // gameplay error in dev/test: { where, message, cause?, docs? }; gameplay is frozen (see errors.js)
    this.disabledModules = new Set();          // look / ui modules disabled after they threw
    /**
     * This engine's shader uniforms (uTime, uWind, uCloud, season tints...); share these objects in your own ShaderMaterial or patch @type
     * {import('../types/core').EngineUniforms}
     */
    this.uniforms = createUniforms(style);
    bindUniforms(r, this.uniforms);             // built-in shader effects read this engine's uniforms when compiled by this renderer
    defineViewLook(this);                       // look.view: manual() for camera.far / pixel ratio / camera pose the engine changes on its own (coreParts.js)
    defineCloudShadowLook(this);                // look.cloudShadow: the cloud-shadow patch every engine material carries, declared (coreParts.js)
    defineSeasonLook(this);                     // look.season: the season / cover tint's replace slot (coreParts.js, render/terms.js)
    defineMaterialsLook(this, MATERIAL_PURPOSES); defineSurfaceLook(this);   // look.materials / look.surface: what makeMaterial reads (render/lookSurface.js)
    this._materials = registerEngine(this);    // makeMaterial without an engine argument uses the first live engine's style

    createServices(this, { canvas, validate, locale, strings, saveKey, joystick, bindings, audio, decoders, budget, seed, headless, urlState, threads, batching });
    this.startup = null;                       // startup timing report (set once start() finishes)
    this._prof = null;                         // module hook timing (profile(true) turns it on)
    this._afterTick = null;                    // at startup, checked once at the end of each frame for readiness
    // effects come through look.post.add only (a style's plugins, the plugins folder, game code); style.post was the second way in, gone
    if (style.post != null) throw codedError('style-value', 'style.post is gone: a style brings its post effects as plugins (style/plugins/10-bloom.js: export default bloom(); ' +
      "the style object: plugins: import.meta.glob('./plugins/*.js', { eager: true })), the same files a game's plugins/ folder takes. docs/MIGRATING-0.4.md");
    // a game's own renderer keeps its own MSAA choice by default (used as is, like its pixel ratio)
    this.post = new PostFX(this, { antialias: aa ?? ownMsaa(r) });
    this._uiStyle = applyUIStyle(this, style.ui);   // theme variables, the style's CSS and fonts; removed on dispose
    this.ui = new UIParts(this, ui);           // UI parts: every piece of screen UI is replaceable or off (ui/Parts.js)
    defineCoreParts(this);
    this.ui.get('loading')?.show({});
    this.adaptive = createAdaptive({ on: adaptiveResolution && !headless, target: targetFps, max: r.getPixelRatio() });
    this._gpu = this.adaptive.on ? new GpuTimer(timerContext(r)) : null;   // GPU frame time for adaptive resolution where the browser offers the timer query
    // follow the canvas's own CSS box, not the window: a canvas in a page section or editor panel renders at its own size.
    // The window event stays for a canvas outside the page (no box, falls back to the window) and for moves that do not resize the canvas
    addEventListener('resize', () => this._resize(), { signal: this.signal });
    this._unhandled = null; watchRejections(this);
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => this._resize());
      ro.observe(r.domElement);
      this.signal.addEventListener('abort', () => ro.disconnect());
    }
    placeUI(this);
    this.page = new Page(this, { pauseOnBlur });   // window focus, tab visibility, mouse lock, WebGL context: handled only there
  }

  get waterLevel() { return this.ground.waterLevel; }
  /** True once the world is built (phase 'ready' or 'running'): fixed steps, ops and rendering run from here on @type {boolean} */
  get ready() { return this.phase === 'ready' || this.phase === 'running'; }
  /** True after dispose() @type {boolean} */
  get disposed() { return this.phase === 'disposed'; }

  // ---------- common ----------
  /** Get a UI string (i18n) */
  t(key, params) { return this.i18n.t(key, params); }
  /**
   * Fixed steps run (= engine.time.tick, the one time counter, core/time.js). Read-only; starts again from 0 on session.newGame / load / quit.
   * Seconds are views of it: engine.time.now('real' | 'ambient' | 'calendar' | channel)
   */
  get tick() { return this.time.tick; }
  /** Material by role from this engine's style: engine.makeMaterial('prop', { color: 0x8a5a36 }) */
  makeMaterial(purpose, params) { return makeMaterial(purpose, params, this); }
  /** Ray cast: the nearest hit or null, see Rays.js */
  raycast(origin, dir, opts) { return this.rays.cast(origin, dir, opts); }
  /** Cast a ray from screen coordinates (-1..1) */
  pick(ndcX, ndcY, opts) { return this.rays.pick(ndcX, ndcY, opts); }
  /** Set up a scenario: { time, weather, pos, save, wait, cutscene, state }, see UrlState.js */
  applyState(params) { return this._urlState.apply(params); }
  /**
   * Scenario ready: start() has finished, the URL parameters / latest applyState are applied, and (headless) a load begun after start has settled
   * (tests and screenshots wait for it; core/headlessLoad.js)
   */
  get stateApplied() { return this.ready && this._urlState.applied && headlessSettled(this); }
  /**
   * Name a set of scenario parameters, then use applyState({ state: name }) or the URL ?state=name. Returns a handle: remove() forgets the name
   * @param {string} name @param {import('../types/core').StateParams} params @param {{ owner?: string }} [opts]
   * @returns {{ owner?: string, remove(): void }}
   */
  defineState(name, params, opts) { return this._urlState.define(name, params, opts); }
  /**
   * Fixed-step logic (60 per second): movement, timers, gameplay keys. dt is real seconds (always 1 / 60) unless { channel } names a time channel:
   * then dt is that channel's scaled dt (bullet time slows it). Returns a handle { remove() }
   * phase (order is declared, never "which line registered first"): 'early' (default) runs before every module fixed hook, so the player has not
   * moved yet this step; 'late' runs after all modules (player moved, physics stepped) and before the clock: hit checks, reading this step's result.
   * @example engine.onFixed(dt => moveEnemies(dt), { channel: 'enemies' })
   * @example engine.onFixed(() => checkHits(engine.player.position), { phase: 'late' })
   */
  onFixed(fn, { channel, phase = 'early' } = {}) {
    if (phase !== 'early' && phase !== 'late') throw codedError('engine-misuse', `engine.onFixed(fn, { phase }): phase is 'early' (default, before modules) or 'late' (after modules), got ${JSON.stringify(phase)}`);
    if (channel) this.time._get(channel);   // unknown channel: throw now, not every step
    const f = channel ? () => fn(this.time.dt(channel)) : fn, key = phase === 'late' ? '_fixedLate' : '_fixed';
    this[key].push(f); return { remove: () => { this[key] = this[key].filter(x => x !== f); } };
  }
  /** Once per frame: animation, camera, UI. Returns a handle { remove() } */
  onFrame(fn) { this._frame.push(fn); return { remove: () => { this._frame = this._frame.filter(f => f !== fn); } }; }
  /**
   * Around the main render, after the camera update and batching: fn({ renderer, scene, camera, dt }). when 'before' (default) runs just before the
   * engine's frame render: render to your own target there (mirror, minimap, portal, picking); the render target is reset afterwards. 'after' runs
   * right after it (read pixels, overlays). The main frame render stays the engine's. Returns a handle { remove() }
   * @param {(ctx: { renderer: any, scene: any, camera: any, dt: number }) => void} fn @param {{ when?: 'before' | 'after' }} [opts]
   */
  onRender(fn, { when = 'before' } = {}) {
    if (typeof fn !== 'function') throw codedError('engine-misuse', `engine.onRender(fn, { when }): fn must be a function, got ${typeof fn}`);
    if (when !== 'before' && when !== 'after') throw codedError('engine-misuse', `engine.onRender(fn, { when }): when must be 'before' or 'after', got ${JSON.stringify(when)}`);
    this._onRender[when].push(fn);
    return { remove: () => { this._onRender[when] = this._onRender[when].filter(f => f !== fn); } };
  }

  /**
   * @internal Stands in until a camera module is installed (its install replaces engine.setCamera). Why: core cannot install a module (rule 2), and
   * without this a scene with no openWorld / camera module failed with "setCamera is not a function", which names no fix.
   */
  setCamera(kind, opts) {
    const o = opts && typeof opts === 'object' ? `{ ${Object.keys(opts).join(', ')} }` : '';
    throw codedError('camera-none', `engine.setCamera('${kind}'${o ? ', ' + o : ''}) needs a camera module, and none is installed (openWorld({ camera }) `
      + `installs the one you name, camera: false installs none; a bare scene has none): install the kind you want once, engine.use(${kind === 'firstPerson' ? 'firstPersonCamera' : kind === 'rts' ? 'rtsCamera' : kind === 'follow' ? 'followCamera' : 'fixedCamera'}(${o})), `
      + `then setCamera switches between kinds`);
  }

  /** @internal Display name of a module (loading screen): module.<name> from the string table, else the module's own label */
  moduleName(m) { return this.i18n.has('module.' + m.name) ? this.t('module.' + m.name) : (m.label || m.name); }
}

// Mix in by property descriptor (Object.assign would evaluate getters on the spot and lose them)
for (const part of [loopMethods, holdMethods, startupMethods, groundMethods, actorMethods, moduleMethods, lifecycleMethods, skipMethods, checkMethods, resizeMethods, sceneMethods, probeMethods])
  Object.defineProperties(Engine.prototype, Object.getOwnPropertyDescriptors(part));
// engine.elapsed was a second counter beside engine.time (review 0.4, B): removed. In dev a read throws with the new form instead of giving
// undefined (NaN in every Math.sin(engine.elapsed) animation, silently)
if (DEV) Object.defineProperty(Engine.prototype, 'elapsed', { configurable: true, get() {
  throw codedError('renamed-field', "engine.elapsed was removed: read engine.time.now('real') (fixed seconds, no scale) or engine.time.now('ambient') (keeps moving while frozen)");
} });
