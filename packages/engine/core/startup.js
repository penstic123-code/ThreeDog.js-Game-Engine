// Startup (part of Engine, mixed into Engine.prototype): start() initializes modules, preloads assets, applies scenario parameters, waits for the world to be ready, and records startup timing in engine.startup.
// Every step is a task in engine.loading, so the loading screen, describe().loading and `threedog loading` name the same current item.
// A critical asset (manifest critical: true) that fails stops start() with the reason instead of starting a broken game.

import { reportError } from './errors.js';
import { asModule } from './moduleTypes.js';
import { catalogSnap, catalogClaim } from './catalog.js';
import { codedError, coded } from './errorHints.js';
import { warnOnce, DEV_SERVER } from './validate.js';
import { touchStart } from './inputTouch.js';
import { Loading, failureText } from './Loading.js';
import { startHeadlessLoad } from './headlessLoad.js';
import * as THREE from 'three';
import { isWebGPU, backendName, whyNoWebGPU, firstNodeMaterial, webglOnlyOn, tier as detectTier, timerContext, rendererSwapped, compileThrough } from '../render/backend.js';
import { bindUniforms } from '../render/engineUniforms.js';
import { nameShaderErrors } from '../render/shaderErrors.js';
import { forcedTier, defaultPixelRatio } from './tier.js';
import { GpuTimer } from './adaptive.js';
import { sceneVisitor } from './sceneDelta.js';
import { plugAtStart } from './plugins.js';

const DEV_STRINGS = {
  initFailed: 'init of module {name}',
  blocked: 'Startup blocked: {n} critical item(s) failed to load, the game cannot start:\n  {list}',
  stalled: 'Startup stalled: still waiting after {s} s for: {list}. A module\'s isReady(e) keeps returning false (or the world never finished its nearby builds); fix that module, or raise engine.loading.timeoutMs if the load is just slow',
  disposed: 'engine.start() stopped: engine.dispose() was called while it was loading ({at}); a disposed engine cannot start, create a new one',
};

export const startupMethods = {
  /**
   * What loading is doing now: tasks with phase / error / source, view() for the summary describe().loading shows.
   * @type {Loading}
   * @example engine.loading.view().waiting   // 'decoding model "hero" (/models/hero.glb, manifest "main")'
  */
  get loading() { return this._loading ||= new Loading(this); },

  /** Start the game: init modules, preload, apply scenario parameters, wait until the world is ready. A second call returns the first call's Promise. */
  start() { this._born.start ||= performance.now(); return (this._starting ??= this._start()); },   // measure

  /** @internal stop when dispose() ran during an await of start() */
  _alive(at) { if (this.disposed) throw codedError('engine-disposed', DEV_STRINGS.disposed.replace('{at}', at)); },

  /** @internal */
  async _start() {
    // Dev server only (npm run dev): if main.js forgot window.engine = engine, set it so the dev bridge and console can find the engine; leave an existing one alone (including tests with several engines)
    if (DEV_SERVER && typeof window !== 'undefined' && !window.engine) window.engine = this;
    this._alive('starting');
    this.phase = 'loading';                    // from here until the world is built: frame hooks only, no fixed step (loop.js)
    await this.saves.whenReady;                    // read the save index into memory (IndexedDB is async) so saves.list / check are synchronous afterwards
    this._alive('reading saves');
    await this._startRenderer();               // WebGPURenderer: init (or fall back) before anything draws or compiles; WebGL: nothing to do
    plugAtStart(this);                         // the plugins folder: before module init, so a module from a plugin inits with the others (plugins.js)
    this._alive('plugging plugins');
    this._checkOptional();                    // optional dependencies that affect gameplay are missing: warn once in dev (modules.js)
    if (!this.headless) this._loop();
    this.ui._check();                          // a UI part name the game set but no module declared is a typo: fail now, not silently
    touchStart(this.input);                    // on-screen stick / buttons are a UI part too, so they are drawn only once the parts are settled
    const ls = this.ui.get('loading'), t0 = performance.now(), L = this.loading;   // measure
    const ms = t => Math.round(performance.now() - t);        // measure
    const timing = {};                         // module name -> { init, ready } in ms (ready = time spent waiting for isReady)
    for (const m of this.modules.values()) if (m.init) {
      const task = L._begin(m.name, 'module', { critical: !!m.critical });
      task.phase('build');
      ls?.update({ progress: 0.1, text: this.t('common.preparing', { name: this.moduleName(m) }) });
      const t = performance.now();   // measure
      this._setModState(m, 'initializing');      // no hooks until init succeeded (modules.js)
      const snap = catalogSnap(this);   // what init registers belongs to this module in engine.catalog()
      const inst = this._modInst.get(m.name);   // a plugin removed while init awaits: its completion must not touch a same-named newcomer (modules.js)
      try { await asModule(this, m, () => m.init(this, this._modCtx(m, inst))); if (this._isLive(m.name, inst)) { catalogClaim(this, m.name, snap); this._setModState(m, 'running'); } L._done(task); }
      catch (e) {
        L._fail(task, e);
        if (this._isLive(m.name, inst)) { this._setModState(m, 'failed'); this._dropTracked(m.name); }   // a failed module keeps no listener on half-built state
        // a critical module stops start() with the reason (below); any other failure is reported by severity and start() goes on
        if (!m.critical) reportError(this, e, DEV_STRINGS.initFailed.replace('{name}', m.name), { module: m });
      }
      if (this._fatal().length) return this._blocked(this._fatal());
      timing[m.name] = { init: ms(t) };
      this._alive('init of ' + m.name);
    }
    this._started = true;                      // a module installed from now on runs its init at once (modules.js)
    const tp = performance.now();   // measure
    const progress = p => ls?.update({ progress: 0.2 + p * 0.3, text: L.text() ?? this.t('common.loadingAssets') });
    // fonts the UI picture names (ui.fonts: asset names) load with the preload, so the first menu never flashes the fallback font;
    // an unknown name rejects here with the manifest line to add
    await Promise.all([this.assets.preload(progress), ...this.ui.fonts.map(n => this.assets.font(n))]);
    const preloadMs = ms(tp), tr = performance.now();   // measure
    this._alive('preloading assets');
    if (this._fatal().length) return this._blocked(this._fatal());
    let streamMs = null;                       // time until the "required nearby" builds in the stream registry finished
    await this._urlState.early();             // scenario parameters: save, position, time, weather
    this._alive('applying scenario parameters');
    ls?.update({ progress: 0.5, text: this.t('common.generating', { name: this.t('common.world') }) });
    await this._waitReady(timing, tr, ms, v => { streamMs = v; }, () => streamMs).catch(why => Array.isArray(why) ? this._blocked(why) : Promise.reject(why));
    // Compile every visible material for the current lights now, behind the loading screen, instead of stalling the first frame that shows it
    // (async where the browser has KHR_parallel_shader_compile). A later change in the number of lights compiles again: see recipes/09 "Lights and stalls"
    this._checkBackendScene();                 // the scene is built now: materials the chosen backend cannot draw fail by name, not as a blank picture
    const tc = performance.now();   // measure
    // Everything below is handed to the parallel compile together, then awaited once: the scene, and on WebGL the post chain's fullscreen passes
    // compile for the target the scene really draws into (the composer's when post is on): see PostFX._sceneTarget.
    // compile() runs synchronously inside compileAsync, so the target only needs to be set around the call, not across the await
    const r = this.renderer, target = this.post._sceneTarget();
    r.setRenderTarget(target);
    let compiling;
    try { compiling = r.compileAsync(this.scene, this.camera); } finally { r.setRenderTarget(null); }
    // the chain's passes draw through three themselves, so compileAsync of the scene never sees their materials: a dry run of the chain
    // (render/backend.js compileThrough) starts them now instead of one by one in the warm-up frame (~130 ms measured, nine passes).
    // Not on WebGPU: its passes are nodes of one pipeline whose inner renders run only inside a real frame
    const post = !this.headless && this.post.active && !isWebGPU(r) ? compileThrough(r, () => this.post.render(0)) : null;
    // the page's thread is idle until the GPU is done: the one-time warm-ups modules queued run now instead of in the first frame (rigid)
    for (const f of this._whileCompiling.splice(0)) { try { f(); } catch (err) { reportError(this, err, 'warm-up while compiling', { soft: true }); } }
    await Promise.all([compiling, post]);
    this._alive('compiling shaders');
    // One hidden frame behind the loading screen: shadow depth materials, the post passes and the background quad are programs compileAsync
    // never sees, and without this frame they compiled in the first frame the player saw (a 300 ms hitch measured)
    if (!this.headless) { try { this._render(0); } catch (err) { reportError(this, err, 'render (warm-up frame)', { soft: true }); } }
    const compileMs = ms(tc), tReady = performance.now();   // measure
    this.phase = 'ready';                     // fixed steps run from the next one on: game time starts here on every machine (loop.js)
    this.commits.rebase();                     // background results registered during loading restart timing from now (see Commits.js)
    // Startup timing: totalMs from page open to playable, startMs from start() to playable
    // firstFrameMs (page open to the end of the first frame drawn after the loading screen) and its phases, which add up to it: script (page
    // open until createEngine), construct (createEngine), setup (game code until start(), installs included), init (saves, renderer, module
    // init), preload, world (scenario parameters, nearby builds), compile (shaders + hidden warm-up frame), draw (ready until that frame's
    // draw calls were submitted; loop.js). draw and firstFrameMs stay null until the frame, and with no real-time loop (headless)
    const b = this._born, d = (a, z) => Math.round(z - a);   // measure
    const phases = { script: Math.round(b.at), construct: d(b.at, b.built), setup: d(b.built, b.start), init: d(b.start, tp), preload: d(tp, tr), world: d(tr, tc), compile: d(tc, tReady), draw: null };
    this.startup = { totalMs: Math.round(performance.now()), startMs: ms(t0), preloadMs, streamMs, compileMs, firstFrameMs: null, phases, modules: timing };   // measure
    this._readyAt = tReady;
    this.budget.checkStartup(this.startup);
    ls?.update({ progress: 1, text: '' }); ls?.hide();
    this.ops.allow(() => this.events.emit('engine:ready'));   // engine:ready listeners finish setting up the game; still loading for the ops guard
    this.session._capture();                   // the state engine.session.newGame() returns to: set up, nothing played yet
    this.ui.open('title');                     // the title screen, only when the game turned it on (createEngine({ ui: { title: {...} } }))
    await this._urlState.late();              // scenario parameters: skip the cutscene, wait, align the time, then emit state:applied
    startHeadlessLoad(this);                  // headless: what the game sets up after start (a species, a teleport) still loads with no step() (headlessLoad.js)
    this._alive('applying scenario parameters');
    this.phase = 'running';
    return this;
  },

  /**
   * @internal The WebGPU route (docs/plans/2026-11-03-webgpu-phase2.md section 1.2; Engine already checked threedog/tsl is loaded): find out
   * whether WebGPU is there, then init or fall back by createEngine({ fallback }). Whatever it falls back to is said loudly and kept in
   * describe().renderer. Why probe before init(): three falls back to WebGL2 silently and loses the reason, and once its WebGL2 backend took
   * the canvas, fallback 'webgl' could not hand a clean canvas to WebGLRenderer.
   */
  async _startRenderer() {
    const r = this.renderer, want = this._backendWant;
    if (!isWebGPU(r)) { this._backend = { requested: 'webgl', backend: 'webgl', reason: null }; return; }
    const forced = !!r.backend?.parameters?.forceWebGL;   // the game asked for the WebGL2 backend itself: not a fallback
    let reason = forced || (r.initialized && r.backend.isWebGPUBackend) ? null : await whyNoWebGPU();
    this._alive('looking for WebGPU');
    if (reason && want.fallback === 'error') {
      throw codedError('renderer-backend', `[threedog] WebGPU unavailable (${reason}) and createEngine({ fallback: 'error' }) asked not to fall back; `
        + "fallback: 'webgl2' runs the same renderer on WebGL2 (your TSL keeps working), 'webgl' runs WebGLRenderer (GLSL only)");
    }
    if (reason && want.fallback === 'webgl') this._swapToWebGL(r);
    else if (!r.initialized) { await r.init(); this._alive('initializing WebGPU'); }
    const backend = backendName(this.renderer);
    // the probe said yes but three still fell back (a device lost in between): say so all the same
    if (!forced && backend === 'webgl2') reason ??= 'three fell back to its WebGL2 backend during init()';
    if (reason && want.fallback === 'error') throw codedError('renderer-backend', `[threedog] WebGPU unavailable (${reason}) and createEngine({ fallback: 'error' }) asked not to fall back`);
    this._backend = { requested: 'webgpu', backend, reason: forced ? 'forceWebGL: true (asked for by the game)' : reason };
    // loud on purpose: a game that chose WebGPU runs 1.5-1.9x slower on the WebGL2 backend, or without its TSL on WebGLRenderer
    if (reason && !forced) warnOnce(coded('renderer-backend', `[threedog] WebGPU unavailable (${reason}), running ${backend}; createEngine({ renderer: 'webgpu', fallback: 'webgl2' | 'webgl' | 'error' })`));
    // the GPU is known only now (adapterInfo after init): the default quality follows the real device
    if (!(this.headless && forcedTier())) {
      const t = detectTier(this.renderer);
      if (t !== this.tier && this._ownsRenderer && this._createParams.pixelRatio == null) this.renderer.setPixelRatio(defaultPixelRatio(devicePixelRatio || 1, t));
      // MSAA defaults from the tier too (Engine.js: antialias ?? tier !== 'low'); decided from a WebGL probe before the WebGPU
      // adapter was known, so a low-tier device could keep MSAA on the WebGPU route (found by the WebGPU parity test). Untouched when the game
      // chose, or changed it since. The renderer's own samples stay as made: the new value then runs through the post chain (PostFX active)
      const aaDefault = this._createParams.antialias == null && this.post.antialias === (this.tier !== 'low');
      if (t !== this.tier && aaDefault) this.post.setAntialias(t !== 'low');
      this.tier = t;
    }
  },

  /**
   * @internal fallback 'webgl': drop the WebGPURenderer (never initialized, so the canvas has no context yet) for a WebGLRenderer on the
   * same canvas, carrying over what was already set on it (size, scale, tone, shadows, clear color) and what the engine hooked onto it.
   * @param {any} old
   */
  _swapToWebGL(old) {
    // the canvas's own MSAA as the post chain wants it, so an effect-free frame still draws straight to the canvas (PostFX active)
    const r = new THREE.WebGLRenderer({ canvas: old.domElement, antialias: this.post.antialias, powerPreference: 'high-performance' });
    const size = old.getSize(new THREE.Vector2());
    r.setPixelRatio(old.getPixelRatio()); r.setSize(size.x, size.y, false);
    r.shadowMap.enabled = old.shadowMap.enabled; r.shadowMap.type = old.shadowMap.type;
    r.toneMapping = old.toneMapping; r.toneMappingExposure = old.toneMappingExposure; r.outputColorSpace = old.outputColorSpace;
    r.setClearColor(old.getClearColor(new THREE.Color()), old.getClearAlpha());
    r.info.autoReset = false;
    nameShaderErrors(r); bindUniforms(r, this.uniforms);
    try { old.dispose(); } catch { /* never initialized: nothing of it reached the GPU */ }
    // owned rows name the renderer object they live on (tween exemptions, core/owned.js)
    for (const row of [this._oTone, this._oPixelRatio]) if (row) row.objects = row.objects.map(o => (o === old ? r : o));
    this.renderer = r;
    // parts built for the old renderer before start(): the post chain (its backend and every effect's part), then whatever registered a rebuild
    this.post._setBackend();
    rendererSwapped(this);
    if (this._gpu) this._gpu = new GpuTimer(timerContext(r));
  },

  /** @internal After the world is built, before compiling: what the backend in use cannot draw is an error naming it (plan section 1.3) */
  _checkBackendScene() {
    const b = this._backend;
    if (b?.requested !== 'webgpu') return;
    if (b.backend === 'webgl') {
      const hit = firstNodeMaterial(this.scene);
      if (hit) throw codedError('renderer-backend', `[threedog] ${hit.material.type} on ${hit.object.type} '${hit.object.name || '(unnamed)'}' is a NodeMaterial (TSL), and `
        + `createEngine({ fallback: 'webgl' }) is running WebGLRenderer, which cannot draw it (WebGPU unavailable: ${b.reason}). Use fallback: 'webgl2' `
        + '(the same WebGPURenderer on WebGL2: TSL keeps working), or give these objects a GLSL material too');
      return;
    }
    // one visitor on the engine's "entered the scene" mechanism (core/sceneDelta.js): the whole scene now, then only what is added later,
    // checked each frame by _checkBackendAdds; a material swapped in (mesh.material = m) counts as an add.
    // shortcut: an onBeforeCompile assigned to a material already in the scene is not seen; an add after it is. Upgrade if games do that.
    const found = [];
    this._webglOnlyView = sceneVisitor(this.scene, { enter: o => { if (o.material) { const msg = webglOnlyOn(o); if (msg) found.push(msg); } } });
    this._webglOnlyFound = found;
    this._webglOnlyView.sync();
    if (found.length) { const msg = found[0]; found.length = 0; throw codedError('renderer-backend', `[threedog] ${msg}`); }
  },
  /** @internal Per frame on the WebGPU route: what entered the scene since the last frame and will not draw there is an error naming it (reportError) */
  _checkBackendAdds() {
    const v = this._webglOnlyView;
    if (!v) return;
    v.sync();
    const found = this._webglOnlyFound;
    if (!found.length) return;
    const msgs = found.splice(0);
    for (const msg of msgs) reportError(this, codedError('renderer-backend', `[threedog] ${msg} (added after start())`), msg);
  },

  /** Critical items that failed: assets, track() steps and modules declared critical: true (a non-critical module's init error goes through reportError instead) */
  _fatal() { return this.loading.list({ phase: 'failed' }).filter(t => t.critical); },

  /** A critical item failed: keep the loading screen up with the failure, log it (errors.log in dev) and reject start() with every reason */
  _blocked(fatal) {
    const err = codedError(fatal.some(t => t.kind === 'module') ? 'module-critical' : 'asset-critical', DEV_STRINGS.blocked.replace('{n}', String(fatal.length)).replace('{list}', fatal.map(failureText).join('\n  ')));
    this.ui.get('loading')?.update({ progress: 1, text: this.t('loading.failed', { name: fatal.map(t => t.name).join(', ') }), failed: fatal });
    reportError(this, err, 'engine.start()', { soft: true });   // logged once (errors.log in dev), then start() rejects with it
    throw err;
  },

  // Check every 20 ms and also at the end of each real-time frame (a software-rendered frame is long, so a timer alone often waits a whole extra frame)
  _waitReady(timing, tr, ms, setStream, getStream) {
    const ls = this.ui.get('loading');
    return new Promise((res, rej) => {
      let done = false;
      const t0 = performance.now();   // measure: wall clock, so a module that never turns ready ends the wait instead of hanging
      const check = () => {
        if (done) return;
        if (this.disposed) { done = true; rej(codedError('engine-disposed', DEV_STRINGS.disposed.replace('{at}', 'waiting for the world'))); return; }
        // Headless mode has no real-time loop: run one frame by hand (time does not advance, jobs ignore real time) so terrain and other modules keep loading
        if (this.headless) this._frameHooks(0, true);
        const waiting = [...this.modules.values()].filter(m => m.isReady && !m.isReady(this));
        for (const m of this.modules.values()) if (m.isReady && !waiting.includes(m) && timing[m.name]?.ready == null) (timing[m.name] ||= {}).ready = ms(tr);
        if (this.stream.ready && getStream() == null) setStream(ms(tr));
        const fatal = this._fatal();   // a critical step tracked by a module can fail while we wait
        if (fatal.length || (!waiting.length && getStream() != null)) { done = true; this._afterTick = null; if (fatal.length) rej(fatal); else res(); return; }
        if (performance.now() - t0 > this.loading.timeoutMs) {   // measure
          done = true; this._afterTick = null;
          const who = [...waiting.map(m => m.name), ...(this.stream.ready ? [] : ['the stream (required nearby builds)'])];
          rej(codedError('module-not-ready', DEV_STRINGS.stalled.replace('{s}', String(Math.round(this.loading.timeoutMs / 1000))).replace('{list}', who.join(', '))));
          return;
        }
        ls?.update({ progress: 0.5 + 0.5 * (1 - waiting.length / this.modules.size), text: this.loading.text() ?? this.t('common.generating', { name: this.t('common.world') }) });
      };
      const poll = () => { check(); if (!done) setTimeout(poll, 20); };   // main-loop: poll for readiness while loading (a dispose rejects on the next check)
      this._afterTick = check;
      poll();
    });
  },
};
