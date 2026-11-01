// Startup (part of Engine, mixed into Engine.prototype): start() initializes modules, preloads assets, applies scenario parameters, waits for the world to be ready, and records startup timing in engine.startup.
// Every step is a task in engine.loading, so the loading screen, describe().loading and `threedog loading` name the same current item.
// A critical asset (manifest critical: true) that fails stops start() with the reason instead of starting a broken game.

import { reportError } from './errors.js';
import { codedError } from './errorHints.js';
import { touchStart } from './inputTouch.js';
import { Loading, failureText } from './Loading.js';

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
  start() { return (this._starting ??= this._start()); },

  /** @internal stop when dispose() ran during an await of start() */
  _alive(at) { if (this.disposed) throw codedError('engine-disposed', DEV_STRINGS.disposed.replace('{at}', at)); },

  /** @internal */
  async _start() {
    // Dev server only (npm run dev): if main.js forgot window.engine = engine, set it so the dev bridge and console can find the engine; leave an existing one alone (including tests with several engines)
    if (import.meta.env?.DEV && typeof window !== 'undefined' && !window.engine) window.engine = this;
    await this.saves.whenReady;                    // read the save index into memory (IndexedDB is async) so saves.list / check are synchronous afterwards
    this._alive('reading saves');
    this._checkOptional();                     // optional dependencies that affect gameplay are missing: warn once in dev (modules.js)
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
      try { await m.init(this); L._done(task); this._setModState(m, 'running'); }
      catch (e) {
        L._fail(task, e); this._setModState(m, 'failed');
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
    // fonts the UI look names (style.ui.fonts: asset names) load with the preload, so the first menu never flashes the fallback font;
    // an unknown name rejects here with the manifest line to add
    await Promise.all([this.assets.preload(progress), ...(this.style.ui?.fonts || []).map(n => this.assets.font(n))]);
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
    const tc = performance.now();   // measure
    await this.renderer.compileAsync(this.scene, this.camera);
    const compileMs = ms(tc);
    this._alive('compiling shaders');
    this.ready = true;
    this.commits.rebase();                     // background results registered during loading restart timing from now (see Commits.js)
    // Startup timing: totalMs from page open to playable, startMs from start() to playable
    this.startup = { totalMs: Math.round(performance.now()), startMs: ms(t0), preloadMs, streamMs, compileMs, modules: timing };   // measure
    this.budget.checkStartup(this.startup);
    ls?.update({ progress: 1, text: '' }); ls?.hide();
    this.ops.allow(() => this.events.emit('engine:ready'));   // engine:ready listeners finish setting up the game; still loading for the ops guard
    this.session._capture();                   // the state engine.session.newGame() returns to: set up, nothing played yet
    this.ui.open('title');                     // the title screen, only when the game turned it on (createEngine({ ui: { title: {...} } }))
    await this._urlState.late();              // scenario parameters: skip the cutscene, wait, align the time, then emit state:applied
    return this;
  },

  /** Critical items that failed: assets, track() steps and modules declared critical: true (a non-critical module's init error goes through reportError instead) */
  _fatal() { return this.loading.list({ phase: 'failed' }).filter(t => t.critical); },

  /** A critical item failed: keep the loading screen up with the failure, log it (errors.log in dev) and reject start() with every reason */
  _blocked(fatal) {
    const err = codedError(fatal.some(t => t.kind === 'module') ? 'module-critical' : 'asset-critical', DEV_STRINGS.blocked.replace('{n}', String(fatal.length)).replace('{list}', fatal.map(failureText).join('\n  ')));
    this.ui.get('loading')?.update({ progress: 1, text: this.t('loading.failed', { name: fatal.map(t => t.name).join(', ') }), failed: fatal });
    console.error(err.message);
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
