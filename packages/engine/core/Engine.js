// Engine core: what every 3D web game needs (rendering and post, main loop, events, input, assets, audio, saves, UI basics, loading screen, ground API).
// No terrain, sky or characters, and no art; everything else is a module installed with engine.use(...) (see recipes/14-custom-module.md).
// Split: main loop and step in loop.js, start() in startup.js, ground API in ground.js, module install in modules.js, dispose and counts in lifecycle.js (all
// mixed into Engine.prototype).
import * as THREE from 'three';
import { Page } from './page.js';
import { createServices } from './services.js';
import { PostFX } from '../render/PostFX.js';
import { createDefaultLights } from '../render/lights.js';
import { registerEngine, makeMaterial, MATERIAL_PURPOSES } from '../render/materials.js';
import { defineMaterialsLook, defineSurfaceLook } from '../render/lookSurface.js';
import { createUniforms } from '../render/effects.js';
import { bindUniforms } from '../render/engineUniforms.js';
import { UIParts } from '../ui/Parts.js';
import { defineCoreParts } from '../ui/defaults.js';
import { applyUIStyle } from '../ui/theme.js';
import { setValidate, warnOnce, DEV } from './validate.js';
import { readParams, keysSchema } from './params.js';
import { loopMethods } from './loop.js';
import { holdMethods } from './holds.js';
import { startupMethods } from './startup.js';
import { groundMethods, flatGround } from './ground.js';
import { actorMethods } from './actor.js';
import { detectTier, forcedTier } from './tier.js';
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
import { defineCoreLook, defineCloudShadowLook, defineViewLook } from './look/coreParts.js';
import { shadowTypeOf } from './shadowTypes.js';
import { nameShaderErrors } from '../render/shaderErrors.js';
import { probeMethods } from '../render/probes.js';
import { headlessSettled } from './headlessLoad.js';
import { codedError } from './errorHints.js';
// createEngine() options: one schema for the unknown-key check (dev throws with did-you-mean, release warns once), the plain defaults and
// engine.catalog('core').params. Why every key is any: many options take several shapes (post is a list or object, shadows is a switch or a level name), and the code that reads them checks the value;
// object / array defaults stay in the destructuring below (in the schema all engines would share one object).
/** @internal */
export const ENGINE_PARAMS = keysSchema(['canvas', 'style', 'shadows', 'shadowType', 'antialias', 'post', 'pixelRatio', 'adaptiveResolution', 'targetFps', 'ui', 'audio',
  'fov', 'near', 'fogFar',
  'locale', 'strings', 'bindings', 'saveKey', 'joystick', 'padBindings', 'headless', 'validate', 'decoders', 'budget', 'urlState', 'seed', 'movement', 'threads', 'pauseOnBlur', 'batching', 'lights', 'renderer'],
  { shadows: true, shadowType: 'pcf', adaptiveResolution: true, targetFps: 55, fov: 55, near: 0.3, fogFar: 600, locale: 'auto', saveKey: 'game', joystick: 'auto',
    validate: true, threads: 'auto', pauseOnBlur: true, lights: true },
  { targetFps: { type: 'number', default: 55, min: 1 }, fov: { type: 'number', default: 55, min: 1, max: 179 }, near: { type: 'number', default: 0.3, min: 0 },
    fogFar: { type: 'number', default: 600, min: 0 }, saveKey: { type: 'string', default: 'game' } });

/**
 * Default render scale. High tier: the display scale up to 1.5. Low tier: at least 0.75 x display scale (1.5 on a 2x screen; a fixed 1 there
 * would be an upscaled blurry picture), never above 1.5 or the display scale.
 */
function defaultPixelRatio(dpr, tier) {
  const cap = Math.min(dpr, 1.5);
  return tier === 'low' ? Math.min(cap, Math.max(1, +(0.75 * dpr).toFixed(2))) : cap;
}

export class Engine {
  /**
   * @param o  createEngine options: each option, its default and meaning is documented once on EngineOptions (types/core.d.ts).
   *   style can also be a list of parts deep-merged left to right (rules in core/styleParts.js). ENGINE_PARAMS and the destructuring below must match it.
   */
  constructor(opts = {}) {
    setValidate(opts.validate);
    const o = readParams('createEngine()', ENGINE_PARAMS, opts);
    /** @internal createEngine options as read (engine.catalog('core').params shows them with the schema) */ this._createParams = o;
    const { canvas: canvasIn, renderer: rendererIn, style: styleIn, shadows, shadowType, antialias, post, pixelRatio, adaptiveResolution, targetFps, ui = {}, audio = {},
      fov, near, fogFar, locale, strings = {}, bindings = {}, saveKey, joystick, padBindings = {},
      headless = new URLSearchParams(location.search).has('threedog-headless'), validate,
      decoders = null, budget = null, urlState = DEV, seed, movement, threads, pauseOnBlur, batching = {}, lights } = o;
    this.THREE = THREE;
    const canvas = canvasIn ?? rendererIn?.domElement;
    this.movement = createMovement(movement);   // character radius / height / slope / step height: the single copy shared by collision, physics and nav
    const style = this.style = styleFrom(styleIn);   // a list of parts is deep-merged (styleParts.js); one object is used as is
    if (styleIsEmpty(opts.style)) warnOnce(NO_STYLE);
    // a game-supplied renderer is used as is: the engine configures (pixel ratio, size, tone mapping, shadows) only a renderer it created itself
    const owned = !rendererIn;
    this._ownsRenderer = owned;               // dispose() releases the WebGL context only of a renderer the engine built
    if (owned) checkCanvasUsable(canvas);
    const r = this.renderer = rendererIn ?? new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    nameShaderErrors(r);                       // compile errors name the patch and slot (render/shaderErrors.js); a game's own handler stays
    // 'low' | 'high': device tier, decides default quality. A headless tool page names its tier (?threedog-tier, core/tier.js): detection would call
    // every headless browser low tier and drop the game's costly post from shots
    this.tier = (headless && forcedTier()) || detectTier(r);
    if (owned || pixelRatio != null) r.setPixelRatio(pixelRatio ?? defaultPixelRatio(devicePixelRatio || 1, this.tier));
    this._autoSize = undefined;                // decided once the canvas is in the page (sizeMode): true = no CSS size, the engine sizes it to the window
    const box = canvasBox(this);
    if (owned) r.setSize(box.w, box.h, !!this._autoSize);
    if (owned) {
      r.shadowMap.enabled = shadows;
      r.shadowMap.type = shadowTypeOf(shadowType, 'createEngine({ shadowType })');
    }
    r.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(style.background ?? 0x8c8c8c);
    /** Default lights { sun: DirectionalLight, hemi: HemisphereLight }: neutral without sky, driven by sky when installed @type {{ sun: any, hemi: any }} */
    /** Look parts by name, each with set / patch / replace (recipes/52-look.md): tone, lights, cloudShadow from core, the rest from the modules that provide them @type {Record<string, import('../index').LookPart>} */
    this.look = {};
    this.shadows = shadows;                    // read by look.lights 'sun.shadow' below (set again with the camera, unchanged)
    this.lights = createDefaultLights(this, { add: lights !== false });
    // the engine's own renderer: render defaults are a technical baseline under every style (AgX, soft shadows, neutral environment; coreParts.js);
    // a pack that wants none sets it (toneMapping: 'none', look.lights sun.shadow false, env.intensity 0)
    defineCoreLook(this, { owned, baseline: owned });   // writes renderer.toneMapping once (style.toneMapping, else AgX); look.tone (exposure) and look.lights (coreParts.js)
    recordRender(this, { owned });   // baseline for describe().render (after the curve is written): which values the engine / style set
    this.camera = new EngineCamera(fov, box.w / box.h, near, 1500);   // a PerspectiveCamera that camera rigs can switch to orthographic (core/engineCamera.js)
    this.camera.position.set(0, 10, 20);
    this.focus = new THREE.Vector3();          // camera focus (updated by the camera module): the view loads around it; simulation follows world.anchor
    this.shadows = shadows;
    /** Shadow filter in use ('basic' | 'pcf' | 'vsm'); change it with look.shadow.set({ type }) @type {string} */
    this.shadowType = shadowType;
    this.ground = flatGround;
    this.player = null;
    /**
     * World record id of the one the local user controls (default 'player'): interactions, trigger zones, markers and ops (ctx.actor) use it. Set it to hand
     * control to a vehicle or squad member @type {string}
     */
    this.actor = 'player';
    this.ready = false;
    this.disposed = false;                     // true after dispose()
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
    this.fogFar = fogFar;                       // base fog distance; terrain view range changes it, weather scales it
    this.modules = new Map();
    this._modState = new Map();                // module name -> registered | initializing | running | failed | disposed (modules.js)
    this.waterBodies = [];
    clearHooks(this);
    this._hookErrors = new Set();              // places that already reported an error (once per place, see errors.js)
    this.error = null;                         // gameplay error in dev/test: { where, message, cause?, docs? }; gameplay is frozen (see errors.js)
    this.disabledModules = new Set();          // presentation modules disabled after they threw
    this._elapsed = 0;                          // engine.elapsed: fixed seconds of gameplay (stops while frozen)
    /** @internal uniforms.uTime: ambient seconds, fixed steps that keep going while frozen (core/loop.js) */ this._ambient = 0;
    /**
     * This engine's shader uniforms (uTime, uWind, uCloud, season tints...); share these objects in your own ShaderMaterial or patch @type
     * {import('../types/core').EngineUniforms}
     */
    this.uniforms = createUniforms(style);
    bindUniforms(r, this.uniforms);             // built-in shader effects read this engine's uniforms when compiled by this renderer
    defineViewLook(this);                       // look.view: manual() for camera.far / pixel ratio / camera pose the engine changes on its own (coreParts.js)
    defineCloudShadowLook(this);                // look.cloudShadow: the cloud-shadow patch every engine material carries, declared (coreParts.js)
    defineMaterialsLook(this, MATERIAL_PURPOSES); defineSurfaceLook(this);   // look.materials / look.surface: what makeMaterial reads (render/lookSurface.js)
    this._materials = registerEngine(this);    // makeMaterial without an engine argument uses the first live engine's style

    createServices(this, { canvas, validate, locale, strings, saveKey, joystick, bindings, padBindings, audio, decoders, budget, seed, headless, urlState, threads, batching });
    this.startup = null;                       // startup timing report (set once start() finishes)
    this._prof = null;                         // module hook timing (profile(true) turns it on)
    this._afterTick = null;                    // at startup, checked once at the end of each frame for readiness
    // effects come from the style; costly ones start off on low-tier devices unless the post option names them
    this.post = new PostFX(this, { antialias: antialias ?? style.antialias ?? this.tier !== 'low', effects: style.post, enabled: post });
    this._uiStyle = applyUIStyle(this, style.ui);   // theme variables, the style's CSS and fonts; removed on dispose
    this.ui = new UIParts(this, ui);           // UI parts: every piece of screen UI is replaceable or off (ui/Parts.js)
    defineCoreParts(this);
    this.ui.get('loading')?.show({});
    this.adaptive = createAdaptive({ on: adaptiveResolution && !headless, target: targetFps, max: r.getPixelRatio() });
    this._gpu = this.adaptive.on ? new GpuTimer(r.getContext()) : null;   // GPU frame time for adaptive resolution where the browser offers the timer query
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

  // ---------- common ----------
  /** Get a UI string (i18n) */
  t(key, params) { return this.i18n.t(key, params); }
  /**
   * Elapsed real (fixed-step) seconds (no scale; stops while frozen or paused), for presentation animation (sway, bobbing). Starts again from 0 on
   * session.newGame / load / quit (a new playthrough is a fresh page), so never keep an elapsed stamp across playthroughs. Channel seconds are
   * engine.time.now(ch), calendar seconds clock.now (core/time.js); time of day is engine.calendar.timeOfDay (calendar module)
   */
  get elapsed() { return this._elapsed; }
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
    throw codedError('camera-none', `engine.setCamera('${kind}'${o ? ', ' + o : ''}) needs a camera module, and none is installed (openWorld installs `
      + `followCamera; a bare scene has none): install the kind you want once, engine.use(${kind === 'firstPerson' ? 'firstPersonCamera' : kind === 'rts' ? 'rtsCamera' : kind === 'follow' ? 'followCamera' : 'fixedCamera'}(${o})), `
      + `then setCamera switches between kinds`);
  }

  /** @internal Display name of a module (loading screen): module.<name> from the string table, else the module's own label */
  moduleName(m) { return this.i18n.has('module.' + m.name) ? this.t('module.' + m.name) : (m.label || m.name); }
}

// Mix in by property descriptor (Object.assign would evaluate getters on the spot and lose them)
for (const part of [loopMethods, holdMethods, startupMethods, groundMethods, actorMethods, moduleMethods, lifecycleMethods, skipMethods, checkMethods, resizeMethods, sceneMethods, probeMethods])
  Object.defineProperties(Engine.prototype, Object.getOwnPropertyDescriptors(part));
