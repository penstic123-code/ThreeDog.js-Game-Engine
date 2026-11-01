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
import { setValidate, checkOptions, warnOnce, DEV } from './validate.js';
import { loopMethods } from './loop.js';
import { holdMethods } from './holds.js';
import { startupMethods } from './startup.js';
import { groundMethods, flatGround } from './ground.js';
import { actorMethods } from './actor.js';
import { detectTier } from './tier.js';
import { lifecycleMethods } from './lifecycle.js';
import { createMovement } from './movement.js';
import { moduleMethods } from './modules.js';
import { skipMethods } from './skip.js';
import { checkMethods } from './checks.js';
import { styleFrom, NO_STYLE } from './styleParts.js';
import { canvasBox, placeUI, resizeMethods } from './canvasBox.js';
import { sceneMethods } from './sceneMethods.js';
import { recordRender } from './describeRender.js';
import { defineCoreLook, defineCloudShadowLook } from './look/coreParts.js';
import { shadowTypeOf } from './shadowTypes.js';
// Options createEngine accepts (must match the constructor destructuring)
const ENGINE_OPTIONS = ['canvas', 'style', 'shadows', 'shadowType', 'antialias', 'post', 'pixelRatio', 'adaptiveResolution', 'targetFps', 'ui', 'audio',
  'fov', 'near', 'fogFar',
  'locale', 'strings', 'bindings', 'saveKey', 'joystick', 'padBindings', 'headless', 'validate', 'decoders', 'budget', 'urlState', 'seed', 'movement', 'threads', 'pauseOnBlur', 'batching', 'lights', 'renderer'];

export class Engine {
  /**
   * @param o  createEngine options: each option, its default and meaning is documented once on EngineOptions (types/core.d.ts).
   *   style can also be a list of parts deep-merged left to right (rules in core/styleParts.js). ENGINE_OPTIONS and the destructuring below must match it.
   */
  constructor(opts = {}) {
    setValidate(opts.validate);
    checkOptions('createEngine()', opts, ENGINE_OPTIONS);
    const { canvas: canvasIn, renderer: rendererIn, style: styleIn, shadows = true, shadowType = 'pcf', antialias, post, pixelRatio, adaptiveResolution = true, targetFps = 55, ui = {}, audio = {},
      fov = 55, near = 0.3, fogFar = 600, locale = 'auto', strings = {}, bindings = {}, saveKey = 'game', joystick = 'auto', padBindings = {},
      headless = new URLSearchParams(location.search).has('threedog-headless'), validate = true,
      decoders = null, budget = null, urlState = DEV, seed, movement, threads = 'auto', pauseOnBlur = true, batching = {}, lights = true } = opts;
    this.THREE = THREE;
    const canvas = canvasIn ?? rendererIn?.domElement;
    this.movement = createMovement(movement);   // character radius / height / slope / step height: the single copy shared by collision, physics and nav
    const style = this.style = styleFrom(styleIn);   // a list of parts is deep-merged (styleParts.js); one object is used as is
    if (!opts.style) warnOnce(NO_STYLE);
    // a game-supplied renderer is used as is: the engine configures (pixel ratio, size, tone mapping, shadows) only a renderer it created itself
    const owned = !rendererIn;
    const r = this.renderer = rendererIn ?? new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.tier = detectTier(r);                 // 'low' | 'high': device tier, decides default quality
    if (owned || pixelRatio != null) r.setPixelRatio(pixelRatio ?? Math.min(devicePixelRatio || 1, this.tier === 'low' ? 1 : 1.5));
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
    this.lights = createDefaultLights(this, { add: lights !== false });
    defineCoreLook(this, { owned });   // look.tone (style.toneMapping / exposure; none and 1 without a style pack) and look.lights (coreParts.js)
    recordRender(this, { owned });   // baseline for describe().render: which values the engine / style set
    this.camera = new THREE.PerspectiveCamera(fov, box.w / box.h, near, 1500);
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
    this._fixed = []; this._frame = []; this._hooks = { fixed: [], frame: [], afterRender: [], skip: [] };
    this._hookErrors = new Set();              // places that already reported an error (once per place, see errors.js)
    this.error = null;                         // gameplay error in dev/test: { where, message, cause?, docs? }; gameplay is frozen (see errors.js)
    this.disabledModules = new Set();          // presentation modules disabled after they threw
    this._elapsed = 0;                          // engine.elapsed: fixed seconds, advanced per fixed step and copied into uniforms.uTime
    /**
     * This engine's shader uniforms (uTime, uWind, uCloud, season tints...); share these objects in your own ShaderMaterial or patch @type
     * {import('../types/core').EngineUniforms}
     */
    this.uniforms = createUniforms(style);
    bindUniforms(r, this.uniforms);             // built-in shader effects read this engine's uniforms when compiled by this renderer
    defineCloudShadowLook(this);                // look.cloudShadow: the cloud-shadow patch every engine material carries, declared (coreParts.js)
    defineMaterialsLook(this, MATERIAL_PURPOSES); defineSurfaceLook(this);   // look.materials / look.surface: what makeMaterial reads (render/lookSurface.js)
    this._materials = registerEngine(this);    // makeMaterial without an engine argument uses the first live engine's style pack

    createServices(this, { canvas, validate, locale, strings, saveKey, joystick, bindings, padBindings, audio, decoders, budget, seed, headless, urlState, threads, batching });
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
    // follow the canvas's own CSS box, not the window: a canvas in a page section or editor panel renders at its own size.
    // The window event stays for a canvas outside the page (no box, falls back to the window) and for moves that do not resize the canvas
    addEventListener('resize', () => this._resize(), { signal: this.signal });
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
   * Elapsed fixed-step seconds (ignores clock.timeScale; stops while frozen or paused), for presentation animation (sway, bobbing). Game seconds are clock.now
   * (= fixed-step seconds × timeScale); sky time of day is sky.timeOfDay
   */
  get elapsed() { return this._elapsed; }
  /** Material by role from this engine's style pack: engine.makeMaterial('prop', { color: 0x8a5a36 }) */
  makeMaterial(purpose, params) { return makeMaterial(purpose, params, this); }
  /** Ray cast: the nearest hit or null, see Rays.js */
  raycast(origin, dir, opts) { return this.rays.cast(origin, dir, opts); }
  /** Cast a ray from screen coordinates (-1..1) */
  pick(ndcX, ndcY, opts) { return this.rays.pick(ndcX, ndcY, opts); }
  /** Set up a scenario: { time, weather, pos, save, wait, cutscene, state }, see UrlState.js */
  applyState(params) { return this._urlState.apply(params); }
  /** Scenario ready: start() has finished and the URL parameters / latest applyState are applied (tests and screenshots wait for it) */
  get stateApplied() { return this.ready && this._urlState.applied; }
  /** Name a set of scenario parameters, then use applyState({ state: name }) or the URL ?state=name */
  defineState(name, params) { this._urlState.define(name, params); return this; }
  /** Fixed-step logic (60 per second): movement, timers, gameplay keys. Returns a handle { remove() } */
  onFixed(fn) { this._fixed.push(fn); return { remove: () => { this._fixed = this._fixed.filter(f => f !== fn); } }; }
  /** Once per frame: animation, camera, UI. Returns a handle { remove() } */
  onFrame(fn) { this._frame.push(fn); return { remove: () => { this._frame = this._frame.filter(f => f !== fn); } }; }

  /** @internal Display name of a module (loading screen): module.<name> from the string table, else the module's own label */
  moduleName(m) { return this.i18n.has('module.' + m.name) ? this.t('module.' + m.name) : (m.label || m.name); }
}

// Mix in by property descriptor (Object.assign would evaluate getters on the spot and lose them)
for (const part of [loopMethods, holdMethods, startupMethods, groundMethods, actorMethods, moduleMethods, lifecycleMethods, skipMethods, checkMethods, resizeMethods, sceneMethods])
  Object.defineProperties(Engine.prototype, Object.getOwnPropertyDescriptors(part));
