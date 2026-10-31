// Timeline: cutscenes, camera moves, scripted movement. Runs a list of steps in order and returns a Promise.
//
//   await engine.timeline.play([
//     { camera: { to: { position: [10, 6, 10], lookAt: [0, 1, 0] }, duration: 2, ease: 'inOutSine', fov: 45 } },
//     { parallel: [                                          // run at the same time; continue only when all finish
//       { tween: { target: door, to: { 'rotation.y': 1.6 }, duration: 1, ease: 'outBack' } },
//       { path: { object: npc, points: [[0,0,0], [4,0,2], [8,0,0]], duration: 3, lookAhead: 0.05, ground: true } },
//     ] },
//     { say: { speaker: '老渔夫', text: '你来了。' } },      // needs the dialogue module; waits for the dialogue to end
//     { wait: 0.5 },                                         // wait 0.5 seconds
//     { waitFor: 'quest:done' },                             // wait for an event
//     { do: engine => engine.events.emit('door:open') },     // run code (may be async)
//     { fade: 1 }, { fade: 0.5, to: 0 },                     // fade the screen to black over 1 second, then back in over 0.5 s (fadeScreen)
//   ], { skippable: true, letterbox: true, lockInput: true });
//
// Options: skippable (default true); letterbox black bars top and bottom (default false); lockInput locks player controls (default true)
// Skip: the back key Esc (the cutscene is in the UI focus stack, Esc goes only to the top; see ui/Focus.js), the action 'skip' (default Esc / Backspace; not Space, which is dialogue "continue"), or click the hint on the letterbox.
// While frozen (engine.freeze / flow 'paused') wait, tweens, camera and paths do not advance; they resume after unfreezing.
//   On skip all running tweens jump to their end and the remaining steps finish instantly (do steps still run, so state matches a normal playthrough).
// Camera takeover: a camera step sets engine.cameraOverride (see camera/common.js) and restores the previous value and view after the whole run; the camera module then resumes.
//   To hand the camera back midway: { camera: { release: true } }
// General tween (usable anywhere in a game): await engine.timeline.tween(mesh, { 'position.y': 2, 'material.opacity': 0 }, 1, 'outCubic')
// Events: timeline:start, timeline:end { skipped }
// Scenario param cutscene (engine.applyState / URL ?cutscene=skip): 'skip' skips the playing cutscene and all later ones, 'keep' restores normal behavior.
import * as THREE from 'three';
import { vec3 as v3 } from '../../core/math.js';
import { Tweener } from './Tween.js';
import { injectUICSS, fadeScreen, uiFocus } from '../../ui/UI.js';
import { checkOptions } from '../../core/validate.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Ease } from '../../types/common' */
/** @import { TimelineStep, TimelinePlayOptions, TimelineOptions, TweenTo, TweenPromise } from '../../types/gameplay' */

// Keys recognized by steps and their params
const STEP_KEYS = {
  step: ['parallel', 'sequence', 'wait', 'waitFor', 'timeout', 'do', 'tween', 'camera', 'path', 'say', 'fade', 'to'],
  tween: ['target', 'to', 'duration', 'ease'],
  camera: ['from', 'to', 'duration', 'ease', 'fov', 'release'],
  path: ['object', 'points', 'duration', 'ease', 'lookAhead', 'ground', 'closed', 'curve', 'tension', 'upright'],
  say: ['speaker', 'text', 'nodes', 'node'],
};
const SHOT_KEYS = ['position', 'lookAt', 'fov'];
function checkStep(s) {
  checkOptions('timeline step', s, STEP_KEYS.step);
  for (const k of ['tween', 'camera', 'path', 'say']) if (s[k]) checkOptions(`timeline ${k}`, s[k], STEP_KEYS[k]);
  if (s.camera) for (const k of ['from', 'to']) checkOptions(`timeline camera.${k}`, s.camera[k], SHOT_KEYS);
}


let runId = 0;

/** engine.timeline */
export class Timeline {
  /** @internal */
  constructor(engine, { skipKeys = ['Escape', 'Backspace'] } = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this._tweener = new Tweener();
    /** @internal */ this.runs = new Set();
    /** Skip every cutscene immediately (set by scenario param cutscene=skip) @type {boolean} */
    this.skipAll = false;
    engine.input.define('skip', skipKeys, 'timeline.skipAction');
    this._buildUI();
  }

  /**
   * Whether a cutscene is playing
   * @returns {boolean}
   */
  get playing() { return this.runs.size > 0; }

  /**
   * General tween (the only entry point for tweens in the engine): await engine.timeline.tween(mesh, { 'position.y': 2 }, 1, 'outCubic'); duration in seconds. Returns a Promise (with finish()/cancel())
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
    checkOptions('timeline.play()', opts, ['skippable', 'letterbox', 'lockInput']);
    const { skippable = true, letterbox = false, lockInput = true } = opts;
    const e = this.engine;
    const run = { id: ++runId, skippable, letterbox, lockInput, skipping: false, cancels: new Set(), cam: null };
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
      console.error('[timeline] step failed', err);
    } finally {
      this._releaseCamera(run);
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
    // skip keys other than Esc (e.g. Backspace): Esc is already dispatched by the UI focus stack, so do not handle it twice; the first frame of a run does not count
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
    if (s.camera) { await this._camera(s.camera, run); return; }
    if (s.path) { await this._path(s.path, run); return; }
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

  /** Camera: { from?, to: { position, lookAt }, duration, ease, fov } or { release: true } @internal */
  _camera(c, run) {
    const e = this.engine, cam = e.camera;
    if (c.release) { this._releaseCamera(run); return Promise.resolve(); }
    const st = this._takeCamera(run);
    let fromP, fromL, fromFov, toP, toL;
    const lookOf = l => l?.isObject3D ? l.position : l;          // may look at a moving object
    return this._timed(run, {
      duration: c.duration ?? 1, ease: c.ease ?? 'inOutCubic',
      start: () => {
        fromP = c.from?.position ? v3(c.from.position) : cam.position.clone();
        toP = c.to?.position ? v3(c.to.position) : fromP.clone();
        // start look-at: use it if given, otherwise keep the current view direction at the same distance as the target
        if (c.from?.lookAt) fromL = v3(lookOf(c.from.lookAt));
        else { const d = c.to?.lookAt ? Math.max(1, cam.position.distanceTo(v3(lookOf(c.to.lookAt)))) : 10; fromL = cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(d).add(cam.position); }
        toL = c.to?.lookAt ? v3(lookOf(c.to.lookAt)) : fromL.clone();
        fromFov = c.from?.fov ?? cam.fov;
      },
      step: k => {
        if (c.to?.lookAt?.isObject3D) toL.copy(c.to.lookAt.position);
        cam.position.lerpVectors(fromP, toP, k);
        st.look.lerpVectors(fromL, toL, k);
        cam.lookAt(st.look);
        if (c.fov != null) { cam.fov = fromFov + (c.fov - fromFov) * k; cam.updateProjectionMatrix(); }
        st.override.focus.copy(st.look);
      },
    });
  }
  /** @internal */
  _takeCamera(run) {
    const e = this.engine;
    if (!run.cam) {
      run.cam = { prev: e.cameraOverride ?? null, fov: e.camera.fov, look: new THREE.Vector3(), override: { owner: 'timeline', id: run.id, focus: e.focus.clone() } };
      e.cameraOverride = run.cam.override;
    }
    return run.cam;
  }
  /** @internal */
  _releaseCamera(run) {
    const st = run.cam; if (!st) return;
    run.cam = null;
    const e = this.engine;
    if (e.cameraOverride === st.override) e.cameraOverride = st.prev;
    if (e.camera.fov !== st.fov) { e.camera.fov = st.fov; e.camera.updateProjectionMatrix(); }
  }

  /** Path: { object, points, duration, ease, lookAhead, ground, closed, curve: 'catmullrom'|'centripetal'|'chordal', tension } @internal */
  _path(p, run) {
    const e = this.engine, chr = p.object?.root?.isObject3D ? p.object : null, obj = chr ? chr.root : p.object;   // a character (Character) can be passed directly
    if (!obj || !p.points?.length) return Promise.resolve();
    const pts = p.points.map(x => v3(x));
    if (pts.length === 1) pts.unshift(obj.position.clone());
    const curve = new THREE.CatmullRomCurve3(pts, !!p.closed, p.curve ?? 'centripetal', p.tension ?? 0.5);
    const isCam = obj === e.camera;
    const st = isCam ? this._takeCamera(run) : null;
    const pos = new THREE.Vector3(), ahead = new THREE.Vector3();
    return this._timed(run, {
      duration: p.duration ?? 2, ease: p.ease ?? 'inOutSine',
      step: k => {
        curve.getPointAt(Math.min(1, Math.max(0, k)), pos);
        if (p.ground) pos.y = e.surface(pos.x, pos.z) + (typeof p.ground === 'number' ? p.ground : 0);
        obj.position.copy(pos);
        if (p.lookAhead) {
          const k2 = Math.min(1, k + p.lookAhead);
          if (k2 - k > 1e-4) {
            curve.getPointAt(k2, ahead);
            if (p.upright !== false && !isCam) ahead.y = pos.y;           // keep the character upright, only turn the horizontal heading
            obj.lookAt(ahead);
            if (chr && 'facing' in chr) chr.facing = obj.rotation.y;     // sync the character's own facing too, so it does not turn back after the walk
            if (isCam) st.look.copy(ahead);
          }
        }
        if (isCam) st.override.focus.copy(pos);
      },
    }).then(r => {
      // the path moved the model, not the mover: the character's world record (the player's) catches up once, so a save right after the cutscene has the new place
      if (chr?.recordId && chr.syncRecord) e.ops.allow(() => chr.syncRecord());
      return r;
    });
  }

  /** Line: { speaker, text, node? }. Needs the dialogue module; skipped with a warning if not installed @internal */
  _say(s, run) {
    const e = this.engine, d = e.dialogue;
    if (!d) { console.warn('[timeline] say requires the dialogue module to be installed'); return Promise.resolve(); }
    if (run.skipping) return Promise.resolve();
    // the line is on top of the focus stack: Esc still skips the whole cutscene
    const said = d.say(s.nodes || s.text, { speaker: s.speaker, node: s.node || 'start', onCancel: run.skippable ? () => this.skip(run) : null });
    return new Promise(done => {
      // skipping the cutscene closes this line; it also settles the step when the line was dropped without ending (a new playthrough)
      const cancel = () => { if (d.speaking === said.id) d.end(); done(); };
      run.cancels.add(cancel);
      said.then(() => { run.cancels.delete(cancel); done(); });
    });
  }

  // ---------- Letterbox ----------
  /** @internal */
  _buildUI() {
    injectUICSS(`
.threedog-letterbox{position:fixed;left:0;right:0;height:0;background:var(--threedog-letterbox-bg,var(--threedog-loading-bg));z-index:18;pointer-events:none;transition:height var(--threedog-letterbox-speed,.5s) ease}
.threedog-letterbox-top{top:0}.threedog-letterbox-bottom{bottom:0}
.threedog-letterbox.is-on{height:var(--threedog-letterbox-size,11vh)}
.threedog-letterbox-skip{position:absolute;right:calc(16px + env(safe-area-inset-right,0px));bottom:12px;font:12px var(--threedog-font);color:var(--threedog-muted);
  background:none;border:0;cursor:pointer;pointer-events:auto;opacity:0;transition:opacity .4s}
.threedog-letterbox.is-on .threedog-letterbox-skip.is-on{opacity:.8}
.threedog-letterbox-skip:hover,.threedog-letterbox-skip:focus-visible{color:var(--threedog-fg);outline:none}
@media (prefers-reduced-motion:reduce){.threedog-letterbox{transition:none}}
`);
    const bar = cls => { const b = document.createElement('div'); b.className = `threedog-ui threedog-letterbox ${cls}`; this.engine.uiRoot.appendChild(b); return b; };
    /** @internal */ this.top = bar('threedog-letterbox-top');
    /** @internal */ this.bottom = bar('threedog-letterbox-bottom');
    /** @internal */ this.skipBtn = document.createElement('button');
    this.skipBtn.type = 'button'; this.skipBtn.className = 'threedog-letterbox-skip';
    this.skipBtn.addEventListener('click', () => { for (const r of this.runs) if (r.skippable) this.skip(r); });
    this.bottom.appendChild(this.skipBtn);
    this.engine.events.on('i18n:change', () => this._refreshUI());
    this.engine.events.on('input:rebind', () => this._refreshUI());
  }
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

/**
 * Timeline (cutscenes, tweens) -> engine.timeline.
 * timeline({ skipKeys: ['Escape', 'Backspace'] })（timeline({ skipKeys: ['Escape', 'Backspace'] }) (Esc is the back key, dispatched by the UI focus stack)
 * Optional dependency: dialogue (say step). The camera module cooperates with engine.cameraOverride automatically.
 * @param {TimelineOptions} [opts]
 * @returns {ModuleDef<Timeline>}
 */
export function timeline(opts = {}) {
  let t = null;
  return {
    name: 'timeline', label: 'Timeline', stage: 'control', before: ['cameraRig'],   // before the camera, so the takeover applies on the same frame
    install(e) {
      checkOptions('timeline()', opts, ['skipKeys']); e.i18n.add(STRINGS); t = new Timeline(e, opts); e.cameraOverride ??= null;
      e.events.on('session:end', () => { if (t.runs.size) t.skip(); });   // a running cutscene ends with its playthrough (session waits one macrotask for its steps to settle)
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
