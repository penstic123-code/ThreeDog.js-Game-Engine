// Main loop (part of Engine, mixed into Engine.prototype): fixed step + per-frame hooks + render, deterministic step(), hook timing profile(),
// adaptive resolution.
//
// Hook errors: onFixed / onFrame callbacks and module fixed / frame / afterRender hooks each run in try/catch and are handled by error tier (errors.js):
// presentation modules are disabled, gameplay errors freeze gameplay in dev / tests and are recorded in engine.error, core steps such as render
// report only once; input.endFrame() sits in finally so "just pressed" always clears.
//
// What freezing (engine.freeze) stops: the whole fixed step is skipped (onFixed, module fixed, the game clock and engine.elapsed all stop);
// frame hooks, stream / jobs and render keep going (the picture and UI stay usable). So gameplay logic (movement, timers, quest checks, cutscene
// waits) belongs in fixed,
// or must check engine.frozen first inside frame.
//
// Determinism: in engine.step() and headless loading frames, jobs ignore the real-time budget and drain the queue (see Jobs.js),
// and stream's synchronous builds are attached to the scene before step returns: same input and same seed (engine.random) give the same result.
import { reportError } from './errors.js';
import { DEV } from './validate.js';
import { codedError } from './errorHints.js';
import { watchLights } from './lightWatch.js';

const STEP = 1 / 60;   // fixed step length: 60 per second
// Most real time one frame may turn into fixed steps (6 steps). A longer hitch slows the game for that frame
// instead of replaying it in a burst (no spiral of death, no jump after a stall).
const MAX_CATCHUP = 0.1;
// Dev message (console): which hook failed
const STRINGS = {
  onFixed: 'onFixed callback', commits: 'background result apply (commits)', onFrame: 'onFrame callback', clock: 'clock timer', render: 'render',
  hook: '{kind} hook of module {name}',
};

const SOFT = { soft: true };   // core steps (render, stream): report once only
/** Call a hook fn.call(self, a, b); errors go to reportError for tiering.
 *  opts: { module } the failing module / SOFT / null (game callback, counts as gameplay).
 *  Takes no ...args and needs no caller closure: the main loop calls this many times a frame, so it must not allocate each time. */
function safe(engine, key, fn, opts, self, a, b) {
  try { fn.call(self, a, b); } catch (err) { reportError(engine, err, key, opts ?? undefined); }
}

export const loopMethods = {
  _fixedStep() {
    // input snapshot for this step: keys read in fixed depend only on the step count, not on how many steps a frame ran
    this.input.beginFixed();
    try {
      if (this._freezers.size) return;         // gameplay frozen: fixed seconds and game seconds stop (frame hooks and render continue)
      this.tick++;
      this._inFixed = true;                    // ops log phase 'fixed' and the dev guard lets gameplay writes through
      // due background results apply first so this step's gameplay sees them; not advanced while loading (start() rebases when it finishes)
      if (this.ready) safe(this, STRINGS.commits, this.commits.tick, null, this.commits, this.tick);
      for (const f of this._fixed) safe(this, STRINGS.onFixed, f, null, undefined, STEP);
      this._runHooks('fixed', STEP);
      safe(this, STRINGS.clock, this.clock.tick, null, this.clock, STEP);
      this._elapsed += STEP; this.uniforms.uTime.value = this._elapsed;
    } finally { this._inFixed = false; this.input.endFixed(); }
  },
  /** Per frame: onFrame callbacks, module frame, stream, jobs. With deterministic true (step, headless loading) jobs ignore real time. */
  _frameHooks(dt, deterministic = false) {
    // one profile frame = one frame-hook cycle (the real loop: one per rendered frame; step(): one per frameEvery fixed steps). Counting rendered frames
    // instead made step(render: false) divide by zero frames and report the whole run's milliseconds as one frame's
    if (this._prof) this._prof.frames++;
    for (const f of this._frame) safe(this, STRINGS.onFrame, f, null, undefined, dt);
    this._runHooks('frame', dt);
    safe(this, 'stream.update', this.stream._update, SOFT, this.stream);
    this.jobs.run({ deterministic });
    safe(this, 'stream.settle', this.stream._settle, SOFT, this.stream);   // after every loader ran: readiness of stream sources
    safe(this, 'batching.update', this.batching.update, SOFT, this.batching);   // last before rendering: picks up everything built this frame
    safe(this, 'audio.tick', this.audio._tick, SOFT, this.audio);   // positional sounds follow their objects (returns at once when there are none)
  },
  _render(dt) {
    this.renderer.info.reset();
    const t0 = performance.now();   // measure
    this.post.render(dt);
    // frames that first draw new objects pay their GPU upload here (Budget.js ApplyCost)
    this.budget.cost.rendered(performance.now() - t0);   // measure
    if (DEV && this.ready) watchLights(this);   // dev: a light added / removed mid-play compiled new shaders (one long frame): say so (lightWatch.js)
  },
  _runHooks(kind, dt) {
    const p = this._prof;
    for (const h of this._hooks[kind]) {
      const key = h.key ??= STRINGS.hook.replace('{name}', h.name).replace('{kind}', kind);   // build the key once
      const opts = h.opts ??= { module: h.mod };
      if (!p) { safe(this, key, h.fn, opts, undefined, dt, this); continue; }
      const t0 = performance.now();   // measure
      safe(this, key, h.fn, opts, undefined, dt, this);
      p.t[h.name] = (p.t[h.name] || 0) + performance.now() - t0;   // measure
    }
  },
  /** Time module hooks: profile(true) starts, profile(false) stops; profile() returns { moduleName: average ms per frame } and resets (null when off). */
  profile(on) {
    if (on !== undefined) { this._prof = on ? { frames: 0, t: {} } : null; return this; }
    const p = this._prof;
    if (!p) return null;
    const r = {};
    for (const k in p.t) r[k] = Math.round(p.t[k] / Math.max(1, p.frames) * 100) / 100;
    p.frames = 0; p.t = {};
    return r;
  },

  // ---------- nextFixed (pause / freeze / runState live in holds.js; step() below is the deterministic way to advance) ----------
  /**
   * Run fn at the start of the next fixed step (before that step's fixed hooks), from any callback (UI click, promise, worker result): gameplay state is safe to write there.
   * Returns a Promise of fn's value (rejects if fn throws). Waits while frozen or loading. Built on engine.commits: applies in request order and survives save loads.
   * @template T
   * @param {() => T} fn
   * @returns {Promise<T>}
   * @example engine.nextFixed(() => engine.ops.run('door.open', { id: 'gate' }));
   */
  nextFixed(fn) {
    return new Promise((resolve, reject) => {
      const t = this.commits.request({ lag: 1, valid: () => true, fallback: () => undefined, apply: () => { try { resolve(fn()); } catch (err) { reject(err); } } });
      t.resolve(undefined);   // nothing to wait for: otherwise the fallback would count as late
    });
  },

  _loop() {
    if (this._looping) return;
    this._looping = true;
    let acc = 0, last = performance.now();   // main-loop
    const tick = now => {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(tick);
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (this.paused) { acc = 0; return; }        // paused: no advance, no render
      // CPU time of one frame = main-thread work from here to the end of the afterRender hooks, in four phases (engine.cpuPhases):
      // fixed (input poll + fixed steps), frame (onFrame + module frame hooks + stream / jobs / batching), render (submitting the draw
      // calls: three.js CPU work, upload of new objects, shader compiles; not GPU time), afterRender (module hooks). Adaptive resolution
      // and the startup readiness check run after and are not counted. Budget is sampled last so it sees this frame, not the previous one.
      const c0 = performance.now();   // measure
      let c1, c2, c3;
      try {
        this.input.poll(dt);
        // page away / WebGL lost: gameplay waits; coming back drops the time spent away, so play resumes without a burst of steps (page.js)
        if (this.page.held || this.page.consumeResync()) acc = 0;
        else { acc = Math.min(acc + dt, MAX_CATCHUP); while (acc >= STEP) { this._fixedStep(); acc -= STEP; } }
        c1 = performance.now();   // measure
        this._frameHooks(dt);
        c2 = performance.now();   // measure
        safe(this, STRINGS.render, this._render, SOFT, this, dt);
        c3 = performance.now();   // measure
      } finally { this.input.endFrame(); }
      this._runHooks('afterRender', dt);
      const c4 = performance.now(), P = this.cpuPhases;   // measure
      P.fixed = c1 - c0; P.frame = c2 - c1; P.render = c3 - c2; P.afterRender = c4 - c3;
      this.cpuMs = c4 - c0;
      this.budget.sample(dt);
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      this._adapt(dt);
      this._afterTick?.();
    };
    this._raf = requestAnimationFrame(tick);
  },

  /**
   * Advance synchronously by seconds of fixed-step time (game seconds clock.now advance by seconds x clock.timeScale): fixed hooks run at 60 Hz;
   * frame hooks run once per frameEvery fixed steps (default 2, i.e. 30 Hz, dt = 1/30),
   * so fast-forwarding 600 seconds runs only 18000 frame-hook calls with no rendering and finishes in seconds. Renders one frame at the end when
   * render is true.
   * Input is read as usual: set engine.input.autopilot = { x, y, speed } to make the player walk by itself.
   * Jobs ignore real time inside step and drain the queue each frame; stream's synchronous builds are attached before it returns (stream.ready and
   * handle built are correct immediately).
   * Note: step is synchronous, so Promise continuations (the next timeline segment, await, async build) resume only after step returns; split a long
   * cutscene across several step calls.
   * seconds must be a finite number >= 0: step(0) advances nothing (no fixed step, no render), a negative or non-finite value throws; any positive
   * value runs at least one fixed step.
   * Returns the result of describe() (null with { describe: false }, which callers that ignore it pass to skip the work).
   */
  step(seconds, { render = true, frameEvery = 2, describe = true } = {}) {
    if (this.disposed) return null;            // nothing advances after dispose
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0)
      throw codedError('step-seconds',
        `engine.step(${String(seconds)}): seconds must be a finite number >= 0, e.g. engine.step(0.5) (game seconds; 1 / 60 is one fixed step)`);
    if (seconds === 0) return describe ? this.describe() : null;   // 0 advances nothing (a tiny positive value still runs one fixed step)
    const n = Math.max(1, Math.round(seconds / STEP));
    let since = 0;
    for (let i = 0; i < n; i++) {
      this._fixedStep();
      if (++since >= frameEvery || i === n - 1) {
        try { this._frameHooks(since * STEP, true); } finally { this.input.endFrame(); }
        since = 0;
      }
    }
    if (render) {
      safe(this, STRINGS.render, this._render, SOFT, this, STEP);
      this._runHooks('afterRender', STEP);
    }
    return describe ? this.describe() : null;   // describe: false for internal loops that ignore the result (describe() walks every module)
  },

  // Adaptive resolution: lower render quality when frame rate stays under target for 1 s; raise it slowly after 4 s of headroom
  _adapt(dt) {
    const a = this.adaptive;
    if (!a.on || !this.ready || a.paused) return;
    a.t += dt; a.n++; a.cooldown -= dt;
    if (a.t < 1) return;
    const fps = a.n / a.t; a.t = 0; a.n = 0;
    const pr = this.renderer.getPixelRatio();
    if (fps < a.target - 5 && pr > a.min + 0.01) { this.setPixelRatio(Math.max(a.min, +(pr - 0.1).toFixed(2))); a.good = 0; a.cooldown = 5; }
    else if (fps >= a.target + 3 && pr < a.max - 0.01 && a.cooldown <= 0) {
      if (++a.good >= 4) { this.setPixelRatio(Math.min(a.max, +(pr + 0.05).toFixed(2))); a.good = 0; }
    } else a.good = 0;
  },
};
