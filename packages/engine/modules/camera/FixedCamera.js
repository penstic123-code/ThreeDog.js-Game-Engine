// Fixed-shot camera (classic Resident Evil / horror style): several shots placed in the scene, switched as the situation changes.
//   - cut('name') switches at once; blend('name', seconds) transitions smoothly
//   - Auto switching: auto: 'nearest' picks the shot closest to the player; or a trigger zone (triggers module) emits the trigger:enter event,
//     and a tag 'camera:<shot name>' switches to that shot (triggerBlend decides how)
//   - A shot can look at a fixed point (lookAt) or turn with the player via track: true
//   - Movement direction follows the current view: pressing "up" walks into the screen. If a direction key is still held at a shot change, the old direction is kept until release
// Cutscene takeover: while someone holds engine.takeCamera (engine.cameraOverride is not null) the camera is left alone (see common.js).
//
//   engine.use(fixedCamera({
//     shots: {
//       hall:   { position: [0, 6, 12], lookAt: [0, 0, 0], fov: 50 },
//       garden: { position: [30, 4, 0], track: true, at: [24, 0, 0] },   // at: position used for the "nearest shot" test, defaults to position
//     },
//     start: 'hall', auto: 'nearest',
//   }));
//   engine.cameraRig.blend('garden', { seconds: 1.5 });
import * as THREE from 'three';
import { rigModule, defineRig, viewForward, rightOf, rigPlaced } from './common.js';
import { rigPixelSnap, checkPixelView } from './pixelSnap.js';
import { baseFov, shotFov, setProjection } from '../../core/scene/view.js';
import { vec3 } from '../../core/base/math.js';
import { ease as easing } from '../../core/base/easing.js';
import { warnMissing } from '../../core/base/validate.js';
import { readParams, keysSchema } from '../../core/base/params.js';
const BLEND_KEYS = ['seconds', 'ease'];
import { codedError } from '../../core/base/errorHints.js';

const SHOT_KEYS = ['position', 'lookAt', 'track', 'fov', 'at', 'trackHeight', 'projection', 'size'];

export class FixedCamera {
  /**
   * shots { name: { position, lookAt | track: true, fov, at, trackHeight, projection: 'orthographic', size } } (size: world units of view height; default perspective);
   * single-shot shorthand: fixedCamera({ position, lookAt, projection, size }); start initial shot;
   * auto false | 'nearest' (every autoInterval seconds pick the nearest shot); hysteresis how many meters closer a new shot must be to win (avoids flip-flopping);
   * triggerBlend transition seconds for trigger-zone switches (0 = hard cut); trackHeight how high on the character a track shot looks; trackSmoothing head-tracking smoothness;
   * holdDirection keep the direction at a shot change until the key is released (classic fixed-camera controls);
   * pixelSnap { pixelsPerMeter, bounds } art-pixel rounding: every shot is orthographic with no size, pixelSnap decides the view height (pixelSnap.js)
   */
  constructor(engine, { shots = {}, start = null, auto = false, autoInterval = 0.25, hysteresis = 2, triggerBlend = 0,
    trackHeight = 1.2, trackSmoothing = 8, holdDirection = true, ease = 'inOutCubic', pixelSnap = null, ...rest } = {}) {
    readParams('fixedCamera()', keysSchema(SHOT_KEYS), rest);   // top-level shot fields: the one-shot form setCamera('fixed', { position, lookAt, projection, size })
    if (!Object.keys(shots).length && rest.position) shots = { main: rest };
    else if (Object.keys(rest).length) throw codedError('camera-option', `fixedCamera(): top-level ${Object.keys(rest).join(', ')} are the one-shot form `
      + `(no shots, with position); with shots put them in shots.<name>`);
    Object.assign(this, { engine, auto, autoInterval, hysteresis, triggerBlend, trackHeight, trackSmoothing, holdDirection, ease });
    /** Art-pixel rounding (.grid, .error, .agrees) or null */
    this.pixelSnap = rigPixelSnap(engine, pixelSnap, 'fixedCamera');
    this._shown = undefined;   // the size last asked of engine.camera (null: a perspective shot)
    this.shots = {};
    for (const [n, s] of Object.entries(shots)) this.add(n, s);
    this.target = null;
    this.current = null;
    this._blend = null; this._autoT = 0; this._held = null;
    this._look = new THREE.Vector3();
    this._dir = { f: { x: 0, z: -1 }, r: { x: 1, z: 0 } };
    this._onZone = null;   // trigger:enter listener, only while this rig is the active camera (onEnter / onExit)
    const first = start || Object.keys(this.shots)[0];
    if (first) this.cut(first);
  }

  /** @internal the camera module switched to this rig: camera:<shot> trigger zones cut to their shot from now on */
  onEnter() {
    this._shown = undefined;   // the switch of rigs put the camera back to perspective: the next _place asks for this shot's view again
    this.pixelSnap?.enter();
    this._onZone ??= this.engine.events.on('trigger:enter', p => {
      const tag = p.tag;
      const m = typeof tag === 'string' && tag.match(/^camera:(.+)$/);
      if (m && this.shots[m[1]]) this._moveOn(m[1]);
    });
  }
  /** @internal switched away (or replaced on a new playthrough): a rig that is not the camera never moves it (review 0.4 modules-a B1) */
  onExit() { this._onZone?.remove(); this._onZone = null; this._blend?.res(); this._blend = null; shotFov(this.engine, null); }   // await blend() never hangs: no update runs here any more; a shot's fov is this rig's, the base view stays

  /** Add or replace a shot */
  add(name, s) {
    readParams(`fixedCamera shots.${name}`, keysSchema(SHOT_KEYS), s);
    if (this.pixelSnap) checkPixelView(`fixedCamera shots.${name}`, s);
    else if (s.projection === 'orthographic' && !(s.size > 0)) throw codedError('camera-option', `fixedCamera shots.${name}: projection 'orthographic' needs size > 0 (world units of view height)`);
    const shot = {
      position: vec3(s.position), lookAt: s.lookAt ? vec3(s.lookAt) : null, track: !!s.track || !s.lookAt,
      fov: s.fov ?? null, size: s.projection === 'orthographic' ? s.size : null, at: s.at ? vec3(s.at) : null, trackHeight: s.trackHeight,
    };
    this.shots[name] = shot;
    return this;
  }
  /** A switch that comes by itself (a trigger zone, the nearest shot) */
  _moveOn(name) {
    if (this.triggerBlend > 0) this.blend(name, { seconds: this.triggerBlend });
    else this.cut(name);
  }
  follow(obj) { this.target = obj; }
  /** Cut to a shot at once */
  cut(name) {
    const s = this.shots[name]; if (!s) { warnMissing('shot', name, Object.keys(this.shots)); return; }
    const changed = this.current !== name;
    this.current = name;
    this._blend?.res(); this._blend = null;   // interrupt a running blend: its Promise still resolves (await blend() never hangs)
    this._lookTarget(s, this._look);
    this._place(s.position, this._look, s.fov ?? null, s.size);
    if (changed) { this._latchDirection(); this.engine.events.emit('camera:shot', { name }); }
  }
  /** Blend smoothly to a shot ({ seconds = 1, ease }); returns a Promise that resolves when the blend ends. blend(name, 1.5) throws in dev
   * @param {string} name @param {{ seconds?: number, ease?: import('../timeline/Tween.js').Ease }} [opts] */
  blend(name, opts) {
    const { seconds = 1, ease = this.ease } = readParams('cameraRig.blend()', keysSchema(BLEND_KEYS), opts);
    const s = this.shots[name]; if (!s) { warnMissing('shot', name, Object.keys(this.shots)); return Promise.resolve(); }
    if (seconds <= 0 || !this.current || this.engine.cameraOverride) { this.cut(name); return Promise.resolve(); }   // held: nothing to blend from, the shot lands at release
    const cam = this.engine.camera;
    return new Promise(res => {
      this._blend?.res();
      this._blend = { from: cam.position.clone(), fromLook: this._look.clone(), fromFov: cam.fov, fromSize: cam.isOrthographicCamera ? cam.top - cam.bottom : null, t: 0, dur: seconds, ease, res };
      this.current = name;
      this._latchDirection();
      this.engine.events.emit('camera:shot', { name });
    });
  }

  // Direction: follows the current view; if a direction key is held at a shot change, keep the old direction
  forward() { return (this._held || this._dir).f; }
  right() { return (this._held || this._dir).r; }
  focusPoint() { return this.target ? this.target.position : this._look; }

  update(dt, input) {
    if (!this.shots[this.current]) return;
    if (this.auto === 'nearest' && this.target && (this._autoT -= dt) <= 0) {
      this._autoT = this.autoInterval;
      const n = this.nearest(this.target.position);
      if (n && n !== this.current) {
        const p = this.target.position, d = k => (this.shots[k].at || this.shots[k].position).distanceTo(p);
        if (d(n) + this.hysteresis < d(this.current)) this._moveOn(n);
      }
    }
    const sh = this.shots[this.current];   // after the auto switch: the shot this frame shows
    const want = this._lookTarget(sh, this._want ??= new THREE.Vector3());   // scratch vectors: no per-frame allocation
    if (this._blend) {
      const fov = sh.fov ?? baseFov(this.engine);
      const b = this._blend; b.t += dt;
      const k = easing(b.ease)(Math.min(1, b.t / b.dur));
      const pos = (this._bp ??= new THREE.Vector3()).copy(b.from).lerp(sh.position, k), look = (this._bl ??= new THREE.Vector3()).copy(b.fromLook).lerp(want, k);
      this._look.copy(look);
      // size blends only between two orthographic shots; a perspective/orthographic mix switches to the target's mode at once
      this._place(pos, look, (b.fromFov ?? fov) + (fov - (b.fromFov ?? fov)) * k, sh.size && b.fromSize ? b.fromSize + (sh.size - b.fromSize) * k : sh.size);
      if (b.t >= b.dur) { this._blend = null; b.res(); }
    } else {
      if (sh.track) this._look.lerp(want, 1 - Math.exp(-this.trackSmoothing * dt));
      else this._look.copy(want);
      this._place(sh.position, this._look, sh.fov ?? null, sh.size);
    }
    // Direction: release the hold once no direction key is pressed
    const a = input.axis;
    if (this._held && Math.abs(a.x) < 0.05 && Math.abs(a.y) < 0.05) this._held = null;
    const f = viewForward(this.engine.camera, this._dir.f);
    this._dir = { f, r: rightOf(f) };
  }

  /** Name of the shot nearest a point */
  nearest(p) {
    let best = null, bd = Infinity;
    for (const [n, s] of Object.entries(this.shots)) { const d = (s.at || s.position).distanceTo(p); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  _lookTarget(s, out) {
    if (!s.track && s.lookAt) return out.copy(s.lookAt);
    if (this.target) { out.copy(this.target.position); out.y += s.trackHeight ?? this.trackHeight; return out; }
    return s.lookAt ? out.copy(s.lookAt) : out.set(s.position.x, s.position.y, s.position.z - 1);
  }
  _place(pos, look, fov, size = null) {
    if (this.engine.cameraOverride) return;   // a held camera has one writer: current and _look are what lands at release (common.js)
    shotFov(this.engine, size ? null : fov);   // before the projection: a hold would keep a swap waiting
    // the view is asked for when it changes, so a perspective camera the game assigned during a shot stays until the next one; a height goes on any orthographic camera
    if (!this.pixelSnap && (size !== this._shown || this.engine.camera.isOrthographicCamera)) { this._shown = size; setProjection(this.engine, size ? 'orthographic' : 'perspective', size); }
    const cam = this.engine.camera;   // read after the view: it may have just swapped
    cam.position.copy(pos); cam.lookAt(look);
    rigPlaced(this.engine);   // a cut between frames is the engine's own write (common.js)
  }
  _latchDirection() {
    if (!this.holdDirection) return;
    const a = this.engine.input.axis;
    if (Math.abs(a.x) > 0.05 || Math.abs(a.y) > 0.05) this._held ??= { f: this._dir.f, r: this._dir.r };
  }
}

/**
 * Fixed-shot camera module. Installs engine.cameraRig (pick it or followCamera).
 * fixedCamera({ shots: { name: { position, lookAt | track: true, fov } }, start, auto: 'nearest' })
 * A trigger zone tag 'camera:<name>' switches to that shot on enter. A camera:shot { name } event fires on every switch.
 */
export function fixedCamera(opts = {}) { return rigModule('fixed', opts); }
defineRig('fixed', (e, opts) => {
  return new FixedCamera(e, opts);
}, ['shots', 'start', 'auto', 'autoInterval', 'hysteresis', 'triggerBlend', 'trackHeight', 'trackSmoothing', 'holdDirection', 'ease',
  'pixelSnap', 'position', 'lookAt', 'track', 'fov', 'projection', 'size', 'at']);   // the last row: setCamera('fixed', { position, lookAt }) is a one-shot form
