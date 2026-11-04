// Main loop (part of Engine, mixed into Engine.prototype): fixed step + per-frame hooks + render, deterministic step(), hook timing profile(),
// adaptive resolution.
//
// Hook errors: onFixed / onFrame callbacks and module fixed / frame / afterRender hooks each run in try/catch and are handled by error tier (errors.js):
// picture / ui modules are disabled, errors elsewhere freeze gameplay in dev / tests and are recorded in engine.error, core steps such as render
// report only once; input.endFrame() sits in finally so "just pressed" always clears.
//
// What freezing (engine.freeze) stops: the whole fixed step is skipped (onFixed, module fixed, tick and every time view but ambient stop);
// frame hooks, stream / jobs and render keep going (the picture and UI stay usable). So gameplay logic (movement, timers, quest checks, cutscene
// waits) belongs in fixed,
// or must check engine.frozen first inside frame.
//
// Determinism: in engine.step() and headless loading frames, jobs ignore the real-time budget and drain the queue (see Jobs.js),
// and stream's synchronous builds are attached to the scene before step returns: same input and same seed (engine.random) give the same result.
import { reportError } from './errors.js';
import { DEV, warnOnce } from './validate.js';
import { codedError } from './errorHints.js';
import { watchLights } from './lightWatch.js';
import { followFocus } from '../render/lights.js';
import { STEP } from './time.js';   // fixed step length: 60 per second
import { adapt } from './adaptive.js';
import { advanceUiClock } from './uiClock.js';
import { resetStats, programCount, freshFrame } from '../render/backend.js';
import { engineDraws } from '../render/ownFrame.js';
import { writeDaylight } from '../render/daylight.js';
// Most real time one frame may turn into fixed steps (6 steps). A longer hitch slows the game for that frame
// instead of replaying it in a burst (no spiral of death, no jump after a stall).
const MAX_CATCHUP = 0.1;
// Most milliseconds one frame spends on catch-up steps (two steps' worth of real time, one 30 fps frame). Why a time budget on top of the
// step cap: after a hitch in a heavy scene, 6 steps of 13 ms made a 77 ms fixed phase, so the next frame was long too and caught up again
// (a hitch cascade). Judged by the step just measured, so cheap steps still catch up all 6; the time left over is dropped (a brief slow-down)
const CATCHUP_MS = STEP * 2000;
// Dev message (console): which hook failed
const STRINGS = {
  onFixed: 'onFixed callback', commits: 'background result apply (commits)', onFrame: 'onFrame callback', onRender: 'onRender callback', clock: 'clock timer', render: 'render',
  hook: '{kind} hook of module {name}',
};

const SOFT = { soft: true };   // core steps (render, stream): report once only
/** Call a hook fn.call(self, a, b); errors go to reportError for tiering.
 *  opts: { module } the failing module / SOFT / null (game callback, counts as gameplay).
 *  Takes no ...args and needs no caller closure: the main loop calls this many times a frame, so it must not allocate each time. */
function safe(engine, key, fn, opts, self, a, b) {
  try { fn.call(self, a, b); } catch (err) { reportError(engine, err, key, opts ?? undefined); }
}

/** A freeze holder asked to stop ambient animation too (freeze(owner, { ambient: true })); only read while frozen */
// The first frame drawn after ready ends the first-frame measure (engine.startup.firstFrameMs, startup.js); one compare per frame after that
function firstFrame(e, at) {
  const s = e.startup;
  e._readyAt = null;
  if (s) { s.phases.draw = Math.round(at - (s.phases.script + s.phases.construct + s.phases.setup + s.phases.init + s.phases.preload + s.phases.world + s.phases.compile)); s.firstFrameMs = Math.round(at); }
}
function ambientHeld(e) { for (const h of e.stacks.get('freeze').entries()) if (h.value?.ambient) return true; return false; }

export const loopMethods = {
  _fixedStep() {
    // No game time while start() loads (engine.phase): loading takes as long as the machine needs, so a step during it would make the opening
    // tick, clock and elapsed depend on machine speed (review 0.4 core B1). step() during loading (headless scenario settling) still runs frame
    // hooks. An engine never started ('constructed': no loop, nothing loading) steps by hand only, for tests and tools that need no world
    if (this.phase === 'loading') return;
    // input snapshot for this step: keys read in fixed depend only on the step count, not on how many steps a frame ran
    this.input.beginFixed();
    try {
      // gameplay frozen: no clock moves, no channel, no mod({ for }) timer (frame hooks and render continue). uTime is the ambient clock (wind, water,
      // clouds): it keeps moving behind a pause menu, the common expectation, unless a freezer asked freeze(owner, { ambient: true })
      if (this.frozen) { this.time._frozenStep(!ambientHeld(this)); return; }
      this.time._beginStep();                  // the one counter (core/time.js): this step's commits, ops and input records carry the new tick
      this._inFixed = true;                    // ops log phase 'fixed' and the dev guard lets gameplay writes through
      // due background results first, so this step's gameplay sees them; an engine stepped by hand before start() applies none (start() rebases them)
      if (this.ready) safe(this, STRINGS.commits, this.commits.tick, null, this.commits, this.tick);
      for (const f of this._fixed) safe(this, STRINGS.onFixed, f, null, undefined, STEP);
      this._runHooks('fixed', STEP);
      for (const f of this._fixedLate) safe(this, STRINGS.onFixed, f, null, undefined, STEP);   // onFixed({ phase: 'late' }): reads this step's result
      safe(this, STRINGS.clock, this.time._endStep, null, this.time);   // ambient, channel and calendar seconds; timed mods end; timers fire
    } finally { this._inFixed = false; this.input.endFixed(); }
  },
  /** Per frame: onFrame callbacks, module frame, stream, jobs. With deterministic true (step, headless loading) jobs ignore real time. */
  _frameHooks(dt, deterministic = false) {
    // one profile frame = one frame-hook cycle (the real loop: one per rendered frame; step(): one per frameEvery fixed steps). Counting rendered frames
    // instead made step(render: false) divide by zero frames and report the whole run's milliseconds as one frame's
    if (this._prof) this._prof.frames++;
    this._picture?.frameStart();
    advanceUiClock(this, dt);   // headless pages: UI display timers run on the stepped time (core/uiClock.js)
    writeDaylight(this);   // before the hooks: an onFrame reads this frame's signal
    for (const f of this._frame) safe(this, STRINGS.onFrame, f, null, undefined, dt);
    this._runHooks('frame', dt);
    safe(this, 'stream.update', this.stream._update, SOFT, this.stream);
    this.jobs.run({ deterministic });
    safe(this, 'stream.settle', this.stream._settle, SOFT, this.stream);   // after every loader ran: readiness of stream sources
    safe(this, 'batching.update', this.batching.update, SOFT, this.batching);   // last before rendering: picks up everything built this frame
    safe(this, 'audio.tick', this.audio._tick, SOFT, this.audio);   // positional sounds follow their objects (returns at once when there are none)
  },
  /** @param {number} dt @param {boolean} [hooks] false: draw without the game's onRender hooks (the picture check's probe renders: picture code
   *  run there wrote back the light it had just turned off) */
  _render(dt, hooks = true) {
    const r = this.renderer;
    resetStats(r);
    this._gameLights?.frame();   // plain PointLight / SpotLight at intensity 0 stop redrawing their shadow map (gameLights.js)
    writeDaylight(this);   // again: a time jump in onFrame / a module's frame hook after the first write must reach uDaylight / uTimeOfDay in the frame that draws it, with uSunDir
    followFocus(this);   // baseline sun (no sky module): its shadow box follows engine.focus (render/lights.js)
    const t0 = performance.now();   // measure
    const gpu = this.adaptive.on ? this._gpu : null;   // GPU time feeds adaptive resolution only; no queries while it is off
    gpu?.begin();
    // engine.onRender: camera and batching are final here. 'before' may render into its own targets (counted in renderer.info and the render phase)
    const before = hooks ? this._onRender.before : [], after = hooks ? this._onRender.after : [];
    const ctx = before.length || after.length ? { renderer: r, scene: this.scene, camera: this.camera, dt } : null;
    // the game drew the canvas itself since the last engine frame (own composer / render loop): it holds the frame, the engine yields (render/ownFrame.js)
    const draws = engineDraws(this), own = this._ownFrame;
    if (own) own.inside++;
    try {
      for (const f of before) { safe(this, STRINGS.onRender, f, null, undefined, ctx); r.setRenderTarget(null); }
      this.shadows._frame();   // a game light's cascades, after 'before': picture code aims its light there, and the placement must be what is drawn (core/shadows.js)
      this._checkBackendAdds();   // WebGPU route: a WebGL-only material added since the last frame is named, not drawn blank (startup.js)
      freshFrame(r);   // WebGPU: step() several times in one task, or a renderOnce() earlier in this tick, must not reuse that scene pass
      if (this._picture) this._picture.drawing = true;
      if (draws) this.post.render(dt);
      if (this._picture) this._picture.drawing = false;
      for (const f of after) safe(this, STRINGS.onRender, f, null, undefined, ctx);
    } finally { if (own) own.inside--; this._picture?.frameEnd(); }
    gpu?.end();
    // frames that first draw new objects pay their GPU upload here (Budget.js ApplyCost); a frame that compiled shaders is not judged by adaptive resolution
    this._compiled = this.budget.cost.rendered(performance.now() - t0, programCount(r) ?? -1, t0 / 1000);   // measure
    if (DEV && this.ready && !this._probing) watchLights(this);   // dev: a light added / removed mid-play compiled new shaders (one long frame): say so (lightWatch.js)
  },
  _runHooks(kind, dt) {
    const p = this._prof;
    const was = this._curModule;
    for (const h of this._hooks[kind]) {
      const key = h.key ??= STRINGS.hook.replace('{name}', h.name).replace('{kind}', kind);   // build the key once
      const opts = h.opts ??= { module: h.mod };
      this._curModule = h.mod;   // the module type checks (moduleTypes.js) know whose hook is writing
      if (!p) { safe(this, key, h.fn, opts, undefined, dt, this); continue; }
      const t0 = performance.now();   // measure
      safe(this, key, h.fn, opts, undefined, dt, this);
      p.t[h.name] = (p.t[h.name] || 0) + performance.now() - t0;   // measure
    }
    this._curModule = was;
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

  /**
   * Real loop only (step() never comes here, so it stays deterministic): turn this frame's real time dt into fixed steps. At least one step
   * runs when one is due; another runs only while this frame's fixed work, plus the cost of the step just run, stays within CATCHUP_MS.
   * Returns how many ran (tests read it).
   */
  _catchUp(dt) {
    let acc = Math.min((this._acc || 0) + dt, MAX_CATCHUP), n = 0;
    const f0 = performance.now();   // measure
    let s0 = f0;
    while (acc >= STEP) {
      this._fixedStep(); acc -= STEP; n++;
      const t = performance.now();   // measure
      if (acc >= STEP && t - f0 + (t - s0) > CATCHUP_MS) { acc %= STEP; break; }   // the next one would go over: drop the rest
      s0 = t;
    }
    this._acc = acc;
    return n;
  },

  _loop() {
    if (this._looping) return;
    this._looping = true;
    this._acc = 0;   // real time not yet turned into fixed steps
    let last = performance.now();   // main-loop
    const tick = now => {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(tick);
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (this.paused) { this._acc = 0; return; }        // paused: no advance, no render
      // Adaptive resolution judges the frames up to the last one (cpuMs, GPU time and _compiled still describe it) and changes the
      // render scale here, before this frame draws. Why not after the render: a canvas resize clears its drawing buffer, so a change made
      // after the draw handed the compositor a blank frame (R2: a screenshot caught the 1 -> 0.9 frame black). Not counted in cpuMs
      this._adapt(dt);
      this._compiled = false;
      // CPU time of one frame = main-thread work from here to the end of the afterRender hooks, in four phases (engine.cpuPhases):
      // fixed (input poll + fixed steps), frame (onFrame + module frame hooks + stream / jobs / batching), render (submitting the draw
      // calls: three.js CPU work, upload of new objects, shader compiles; not GPU time), afterRender (module hooks). Adaptive resolution
      // (before, above) and the startup readiness check (after) are not counted. Budget is sampled last so it sees this frame, not the previous one.
      const c0 = performance.now();   // measure
      let c1, c2, c3;
      try {
        this.input.poll(dt);
        // page away / WebGL lost: gameplay waits; coming back drops the time spent away, so play resumes without a burst of steps (page.js)
        if (this.page.held || this.page.consumeResync()) this._acc = 0;
        else this._catchUp(dt);
        c1 = performance.now();   // measure
        this._frameHooks(dt);
        c2 = performance.now();   // measure
        // Before ready only the loading screen (DOM) is on screen: a scene frame there is never seen, but it compiled shaders and uploaded
        // geometry in the middle of loading (cold start measured 2.9 s -> 1.6 s without it). start() draws one hidden warm-up frame itself
        if (this.ready) safe(this, STRINGS.render, this._render, SOFT, this, dt);
        c3 = performance.now();   // measure
        if (this._readyAt != null && this.ready) firstFrame(this, c3);
      } finally { this.input.endFrame(); }
      this._runHooks('afterRender', dt);
      const c4 = performance.now(), P = this.cpuPhases;   // measure
      P.fixed = c1 - c0; P.frame = c2 - c1; P.render = c3 - c2; P.afterRender = c4 - c3;
      this.cpuMs = c4 - c0;
      this.budget.sample(dt);
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      this._afterTick?.();
    };
    this._raf = requestAnimationFrame(tick);
  },

  /**
   * Advance synchronously by seconds of real (fixed-step) time; channels and the calendar advance by their own scales (core/time.js): fixed hooks run at 60 Hz;
   * frame hooks run once per frameEvery fixed steps (default 2, i.e. 30 Hz, dt = 1/30),
   * so fast-forwarding 600 seconds runs only 18000 frame-hook calls with no rendering and finishes in seconds. Renders one frame at the end when
   * render is true.
   * Input is read as usual: set engine.input.autopilot = { x, y, speed } to make the player walk by itself.
   * Jobs ignore real time inside step and drain the queue each frame; stream's synchronous builds are attached before it returns (stream.ready and
   * handle built are correct immediately).
   * Note: step is synchronous, so Promise continuations (the next timeline segment, await, async build) resume only after step returns; split a long
   * cutscene across several step calls.
   * seconds must be a finite number >= 0: step(0) advances nothing (no fixed step, no render), a negative or non-finite value throws; any positive
   * value runs at least one fixed step. While start() is still loading it runs frame hooks only (no game time passes until engine.phase is
   * 'ready').
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

  // Adaptive resolution (core/adaptive.js): judged on frame cost; tests drive it with explicit cost / compiled values
  _adapt(dt, cost = Math.max(this.cpuMs, this._gpu?.ms ?? 0), compiled = !!this._compiled, gpuKnown = this._gpu?.ms != null) { adapt(this, dt, cost, compiled, gpuKnown); },
};
