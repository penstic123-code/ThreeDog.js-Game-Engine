// Timeline: cutscenes, camera moves, scripted movement. Runs a list of steps in order and returns a Promise.
//
//   await engine.timeline.play([
//     { camera: { to: { position: [10, 6, 10], lookAt: [0, 1, 0] }, duration: 2, ease: 'inOutSine', fov: 45 } },
//     { parallel: [                                          // run at the same time; continue only when all finish
//       { tween: { target: door, to: { 'rotation.y': 1.6 }, duration: 1, ease: 'outBack' } },
//       { path: { object: npc, points: [[0,0,0], [4,0,2], [8,0,0]], duration: 3, lookAhead: 0.05, ground: true } },
//     ] },
//     { say: { speaker: '老渔夫', text: '你来了。' } },      // needs the dialogue module; waits for the dialogue to end
//     { say: { speaker: '路人', text: '看那边！', channel: 'bubble', at: npc.root } },   // a bubble over the speaker (input stays free); waits for it too
//     { wait: 0.5 },                                         // wait 0.5 seconds
//     { waitFor: 'quest:done' },                             // wait for an event
//     { do: engine => engine.events.emit('door:open') },     // run code (may be async)
//     { fade: 1 }, { fade: 0.5, to: 0 },                     // fade the screen to black over 1 second, then back in over 0.5 s (fadeScreen)
//   ], { skippable: true, letterbox: true, lockInput: true });
//
// Options: skippable (default true); letterbox black bars top and bottom (default false); lockInput locks player controls (default true)
// Skip: the back key Esc (the cutscene is in the UI focus stack, Esc goes only to the top; see ui/Focus.js), the action 'skip' (default Esc / Backspace; not
// Space, which is dialogue "continue"), or click the hint on the letterbox.
// While frozen (engine.freeze / flow 'paused') wait, tweens, camera and paths do not advance; they resume after unfreezing.
//   On skip all running tweens jump to their end and the remaining steps finish instantly (do steps still run, so state matches a normal playthrough).
// Camera takeover: a camera step takes the camera (engine.takeCamera, see camera/common.js) and releases its claim and restores the view after the whole run; the camera
// module then resumes.
//   To hand the camera back midway: { camera: { release: true } }
// General tween (usable anywhere in a game): await engine.timeline.tween(mesh, { 'position.y': 2, 'material.opacity': 0 }, 1, 'outCubic')
// Events: timeline:start, timeline:end { skipped }
// Scenario param cutscene (engine.applyState / URL ?cutscene=skip): 'skip' skips the playing cutscene and all later ones, 'keep' restores normal behavior.
import { Tweener } from './Tween.js';
import { fadeScreen, uiFocus } from '../../ui/UI.js';
import { cameraStep, pathStep, releaseCamera } from './shots.js';
import { buildLetterbox } from './letterbox.js';

import { readParams, keysSchema, isOptions } from '../../core/params.js';   // isOptions: a step part can also be a shot name, a text or a point list
import { warnOnce } from '../../core/validate.js';
import { coded } from '../../core/errorHints.js';
import { reportError } from '../../core/errors.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Ease } from '../../types/common' */
/** @import { TimelineStep, TimelinePlayOptions, TimelineOptions, TweenTo, TweenPromise } from '../../types/gameplay' */

// Keys recognized by steps and their params
const STEP_KEYS = {
  step: ['parallel', 'sequence', 'wait', 'waitFor', 'timeout', 'do', 'tween', 'camera', 'path', 'say', 'fade', 'to'],
  tween: ['target', 'to', 'duration', 'ease'],
  camera: ['from', 'to', 'duration', 'ease', 'fov', 'release'],
  path: ['object', 'points', 'duration', 'ease', 'lookAhead', 'ground', 'closed', 'curve', 'tension', 'upright'],
  say: ['speaker', 'text', 'nodes', 'node', 'channel', 'at', 'seconds'],
};
const SHOT_KEYS = ['position', 'lookAt', 'fov'];
function checkStep(s) {
  readParams('timeline step', keysSchema(STEP_KEYS.step), s);
  for (const k of ['tween', 'camera', 'path', 'say']) if (isOptions(s[k])) readParams(`timeline ${k}`, keysSchema(STEP_KEYS[k]), s[k]);
  if (s.camera) for (const k of ['from', 'to']) if (isOptions(s.camera[k])) readParams(`timeline camera.${k}`, keysSchema(SHOT_KEYS), s.camera[k]);
}

/** engine.timeline */
export class Timeline {
  /** @internal */
  constructor(engine, { skipKeys = ['Escape', 'Backspace'] } = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this._tweener = new Tweener();
    /** @internal */ this.runs = new Set();
    /** @internal numbers the runs of this engine (timeline:start / timeline:end id) */ this._runSeq = 0;
    /** Skip every cutscene immediately (set by scenario param cutscene=skip) @type {boolean} */
    this.skipAll = false;
    engine.input.define('skip', skipKeys, 'timeline.skipAction');
    buildLetterbox(this);
  }

  /**
   * Whether a cutscene is playing
   * @returns {boolean}
   */
  get playing() { return this.runs.size > 0; }

  /**
   * General tween (the only entry point for tweens in the engine): await engine.timeline.tween(mesh, { 'position.y': 2 }, 1, 'outCubic'); duration in seconds.
   * Returns a Promise (with finish()/cancel())
   * @param {any} target
   * @param {TweenTo} to
   * @param {number} [duration]
   * @param {Ease} [ease]
   * @returns {TweenPromise}
   */
  tween(target, to, duration = 1, ease = 'inOutCubic') { return this._tweener.tween(target, to, duration, ease); }

  /**
   * Play a timeline; resolves with { skipped } when it ends
   * @param {TimelineStep | TimelineStep[]} steps
   * @param {TimelinePlayOptions} [opts]
   * @returns {Promise<{ skipped: boolean }>}
   */
  async play(steps, opts = {}) {
    readParams('timeline.play()', keysSchema(['skippable', 'letterbox', 'lockInput']), opts);
    const { skippable = true, letterbox = false, lockInput = true } = opts;
    const e = this.engine;
    const run = { id: ++this._runSeq, skippable, letterbox, lockInput, skipping: false, cancels: new Set(), cam: null };
    // enter the UI focus stack: skippable cutscenes skip on Esc, unskippable ones swallow Esc (so it does not open the settings menu)
    run.focus = uiFocus(e).push('timeline', { cancel: skippable ? () => this.skip(run) : null });
    this.runs.add(run);
    run.ctx = lockInput ? e.input.push('cutscene') : null;
    this._refreshUI();
    e.events.emit('timeline:start', { id: run.id });
    if (this.skipAll && skippable) this.skip(run);
    try {
      await this._step(steps, run);
    } catch (err) {
      reportError(this.engine, err, 'timeline step', { soft: true });   // a step that threw ends this run; the game carries on
    } finally {
      releaseCamera(this, run);
      run.focus.remove();
      run.ctx?.remove();
      this.runs.delete(run);
      this._refreshUI();
      e.events.emit('timeline:end', { id: run.id, skipped: run.skipping });
    }
    return { skipped: run.skipping };
  }

  /**
   * Skip all (or one) playing timelines
   * @param {any} [run]
   * @returns {void}
   */
  skip(run) {
    for (const r of run ? [run] : [...this.runs]) {
      if (r.skipping) continue;
      r.skipping = true;
      this._tweener.finishAll(r);
      for (const c of [...r.cancels]) c();
    }
  }

  /**
   * Update every frame (called by the module each frame)
   * @param {number} dt
   * @returns {void}
   * @internal
   */
  frame(dt) {
    if (!this.engine.frozen) this._tweener.update(dt);   // wait and tweens do not advance while frozen
    const inp = this.engine.input;
    // skip keys other than Esc (e.g. Backspace): Esc is already dispatched by the UI focus stack, so do not handle it twice; the first frame of a run does not
    // count
    if (!this.runs.size || !inp.pressedRaw('skip') || inp.pressedRaw('cancel')) return;
    for (const r of this.runs) if (r.skippable && !r.focus.fresh) this.skip(r);
  }

  // ---------- Steps ----------
  /** @internal */
  async _step(s, run) {
    if (s == null) return;
    if (Array.isArray(s)) { for (const x of s) await this._step(x, run); return; }
    if (typeof s === 'function') { await s(this.engine, run); return; }
    checkStep(s);
    if (s.parallel) { await Promise.all(s.parallel.map(x => this._step(x, run))); return; }
    if (s.sequence) { await this._step(s.sequence, run); return; }
    if ('wait' in s) { await this._timed(run, { duration: s.wait }); return; }
    if (s.waitFor) { await this._waitFor(s.waitFor, s.timeout, run); return; }
    if (s.do) { await s.do(this.engine, run); return; }
    if (s.tween) { const t = s.tween; await this._tween(run, t.target, t.to, t.duration ?? 1, t.ease ?? 'inOutCubic'); return; }
    if (s.camera) { await cameraStep(this, s.camera, run); return; }
    if (s.path) { await pathStep(this, s.path, run); return; }
    if (s.say) { await this._say(s.say, run); return; }
    if ('fade' in s) { await this._fade(s.fade, s.to ?? 1, run); return; }
  }

  /** Full-screen fade: jumps to the target when skipped @internal */
  async _fade(seconds, to, run) {
    const now = () => fadeScreen(this.engine, to, 0);
    if (run.skipping) return now();
    run.cancels.add(now);
    await fadeScreen(this.engine, to, seconds);
    run.cancels.delete(now);
  }

  /** @internal */
  _timed(run, o) { return this._tweener.run({ ...o, duration: run.skipping ? 0 : o.duration, group: run }); }
  /** @internal */
  _tween(run, target, to, d, ease) { return this._tweener.tween(target, to, run.skipping ? 0 : d, ease, run); }

  /** @internal */
  _waitFor(name, timeout, run) {
    if (run.skipping) return Promise.resolve();
    return new Promise(res => {
      let timer = null, over = false;
      const done = () => { if (over) return; over = true; sub.remove(); timer?.cancel(); run.cancels.delete(done); res(); };
      const sub = this.engine.events.once(name, done);
      run.cancels.add(done);
      if (timeout) (timer = this._tweener.run({ duration: timeout })).then(done);   // timeout counts in game time
    });
  }

  /** Line: { speaker, text, node?, channel?: 'main' | 'bubble', at?, seconds? }. Needs the dialogue module; skipped with a warning if not installed @internal */
  _say(s, run) {
    const e = this.engine, d = e.dialogue;
    if (!d) { warnOnce(coded('module-needs', '[timeline] say requires the dialogue module to be installed')); return Promise.resolve(); }
    if (run.skipping) return Promise.resolve();
    // the line is on top of the focus stack: Esc still skips the whole cutscene
    const said = d.say(s.nodes || s.text, { speaker: s.speaker, node: s.node || 'start', channel: s.channel, at: s.at, seconds: s.seconds, onCancel: run.skippable ? () => this.skip(run) : null });
    return new Promise(done => {
      // skipping the cutscene closes this line; it also settles the step when the line was dropped without ending (a new playthrough)
      const cancel = () => { said.stop(); done(); };   // stop(): the say() handle of the dialogue contract, either channel
      run.cancels.add(cancel);
      said.then(() => { run.cancels.delete(cancel); done(); });
    });
  }

  // ---------- Letterbox ----------
  /** @internal */
  _refreshUI() {
    const runs = [...this.runs], on = runs.some(r => r.letterbox), canSkip = runs.some(r => r.letterbox && r.skippable && !r.skipping);
    this.top.classList.toggle('is-on', on); this.bottom.classList.toggle('is-on', on);
    this.skipBtn.textContent = this.engine.t('timeline.skip');
    this.skipBtn.classList.toggle('is-on', canSkip);
    this.skipBtn.hidden = !canSkip;
  }
}

const STRINGS = {
  'zh-CN': { 'timeline.skip': '{key:skip} 跳过', 'timeline.skipAction': '跳过过场' },
  en: { 'timeline.skip': '{key:skip} Skip', 'timeline.skipAction': 'Skip cutscene' },
};

const TIMELINE_PARAMS = keysSchema(['skipKeys']);

/**
 * Timeline (cutscenes, tweens) -> engine.timeline.
 * timeline({ skipKeys: ['Escape', 'Backspace'] })（timeline({ skipKeys: ['Escape', 'Backspace'] }) (Esc is the back key, dispatched by the UI focus stack)
 * Optional dependency: dialogue (say step). The camera module cooperates with engine.cameraOverride automatically.
 * @param {TimelineOptions} [opts]
 * @returns {ModuleDef<Timeline>}
 */
export function timeline(opts = {}) {
  readParams('timeline', TIMELINE_PARAMS, opts);
  let t = null;
  return {
    name: 'timeline', params: TIMELINE_PARAMS, options: opts, label: 'Timeline', stage: 'control', before: ['cameraRig'],   // before the camera, so the takeover applies on the same frame
    install(e) {
      e.i18n.add(STRINGS); t = new Timeline(e, opts);
      // a running cutscene ends with its playthrough (session waits one macrotask for its steps to settle)
      e.events.on('session:end', () => { if (t.runs.size) t.skip(); });
      return t;
    },
    frame(dt) { t.frame(dt); },
    // scenario param cutscene: 'skip' | 'keep'
    applyState(e, p) {
      if (p.cutscene === undefined) return;
      t.skipAll = p.cutscene === 'skip';
      if (t.skipAll) t.skip();
    },
    describe(e, ctx) {
      const runs = [...t.runs];
      if (runs.length) ctx.out.cutscene = { count: runs.length, skippable: runs.some(r => r.skippable && !r.skipping), letterbox: runs.some(r => r.letterbox) };
    },
  };
}
