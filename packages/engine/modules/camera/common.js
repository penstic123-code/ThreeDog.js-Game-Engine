// Shared parts of the camera modules: used by every camera (follow / first-person / fixed / strategy top-down).
//
// Camera interface (every camera module is named 'cameraRig', only one installed; swap at runtime with engine.setCamera('firstPerson' | 'follow' | 'rts' | 'fixed', options?),
// the swapped-out camera is kept, so its params survive switching back; engine.cameraRig.kind is the current kind):
//   follow(object)      who to follow (called automatically when the player is created)
//   target              the object being followed
//   forward() / right() unit directions {x, z} on the XZ plane; player movement uses them
//   update(dt, input)   per-frame camera update
//
// Cutscene takeover contract: engine.takeCamera(owner, { focus? }) -> { remove() } (core/holds.js); engine.cameraOverride is the holder in charge.
//   A cutscene, a named view or a photo mode that places the camera itself takes it; several can hold it, the latest is in charge.
//   While anyone holds it the camera module leaves the camera alone; with a focus, engine.focus is set to it (the world loads around it).
//   When the last holder removes its claim the camera module resumes from its previous state. cameraOverride itself is read-only.
import * as THREE from 'three';
import { ownedProps } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { setProjection } from './projection.js';

const STRINGS = { ownedHint: 'To place the camera yourself, take it: const cam = engine.takeCamera(\'me\'); ... cam.remove() when done' };

/** True during a cutscene takeover, and updates engine.focus from the focus the owner supplied */
function applyOverride(e) {
  const o = e.cameraOverride;
  if (!o) return false;
  if (o.focus) e.focus.copy(o.focus);
  return true;
}

/** Flatten a 3D direction onto the XZ plane and normalize; use fallback when nearly vertical (top-down) */
function planar(dir, fallback = { x: 0, z: -1 }) {
  const l = Math.hypot(dir.x, dir.z);
  return l < 1e-4 ? { x: fallback.x, z: fallback.z } : { x: dir.x / l, z: dir.z / l };
}
/** Right direction from the forward direction (Y up) */
export const rightOf = f => ({ x: -f.z, z: f.x });

/**
 * Shared methods for cameras that compute direction from horizontal yaw (follow, first-person, strategy): Object.assign(Class.prototype, YAW_RIG).
 * forward() / right() are unit directions on the XZ plane; focusPoint() is the follow target's position (the camera position when there is none)
 */
export const YAW_RIG = {
  forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; },
  right() { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; },
  focusPoint() { return this.target ? this.target.position : this.engine.camera.position; },
};

/**
 * Click-to-lock the mouse for a camera with a pointerLock flag (first person, over-the-shoulder follow); call from onEnter.
 * Locked, mouse motion turns the view without dragging (input.look); Esc releases. Touch screens keep dragging.
 * The press that locks is swallowed (not Mouse0, not a click) unless the rig sets swallowLockClick: false
 */
export function clickToLock(rig, switched) {
  const e = rig.engine, canvas = e.renderer.domElement;
  const wouldLock = () => rig.pointerLock && !e.cameraOverride && e.input.enabled
    && !matchMedia('(pointer: coarse)').matches && document.pointerLockElement !== canvas;
  // Last outcome, shown by describe(): the drag fallback stays, but a refused lock is no longer silent
  const st = rig.lockState = { configured: !!rig.pointerLock, requested: false, locked: document.pointerLockElement === canvas, lastError: null,
    supported: typeof canvas.requestPointerLock === 'function' };
  const fail = err => { st.locked = false; st.lastError = String(err?.message ?? err ?? 'refused'); st.failedAt = e.elapsed; };
  const lock = () => {
    st.configured = !!rig.pointerLock;
    if (!wouldLock()) return;
    st.requested = true;
    try { const r = canvas.requestPointerLock?.(); r?.catch?.(fail); } catch (err) { fail(err); }   // browser refused the lock: fall back to dragging
  };
  rig._off = new AbortController();
  const sig = { signal: AbortSignal.any([e.signal, rig._off.signal]) };
  document.addEventListener('pointerlockchange', () => { st.locked = document.pointerLockElement === canvas; if (st.locked) st.lastError = null; else st.requested = false; }, sig);
  document.addEventListener('pointerlockerror', () => fail('pointerlockerror (browser refused: needs a user gesture, or the page lost focus)'), sig);
  const swallow = () => rig.swallowLockClick !== false && wouldLock();
  e.input.swallowLockClick = swallow; rig._swallow = swallow;
  canvas.addEventListener('click', lock, sig);   // removed on switch-away or engine.dispose()
  if (switched) lock();   // a runtime switch (a key press counts as a gesture) locks at once
}
/**
 * The pointer-lock state machine for describe(): off (not configured) / unsupported / locked / refused (browser denied) / requesting / waiting-click;
 * plus covered (an element other than the canvas sits at its centre, so a click never reaches it), cameraOverride (a takeover blocks locking) and the last failure
 * @internal
 */
export function lockView(e, st) {
  if (!st?.configured) return { state: 'off' };
  const state = !st.configured ? 'off' : !st.supported ? 'unsupported' : st.locked ? 'locked' : st.lastError ? 'refused' : st.requested ? 'requesting' : 'waiting-click';
  const c = e.renderer.domElement, r = c.getBoundingClientRect();
  const top = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  return { ...st, state, covered: top && top !== c ? (top.id ? '#' + top.id : top.className ? '.' + String(top.className).split(' ')[0] : top.tagName.toLowerCase()) : null,
    cameraOverride: e.cameraOverride?.owner ?? null, lastFailure: st?.lastError ? { reason: st.lastError, agoSec: Math.round((e.elapsed - st.failedAt) / 100) / 10 } : null };
}
/** Release the mouse lock; stop listening for clicks too when switched away (call from onExit; from onOverride with keepListening) */
export function releaseLock(rig, keepListening = false) {
  if (!keepListening) { rig._off?.abort(); if (rig.engine.input.swallowLockClick === rig._swallow) rig.engine.input.swallowLockClick = null; }
  if (document.pointerLockElement === rig.engine.renderer.domElement) document.exitPointerLock?.();
}

/** The camera's own view direction on the XZ plane */
const _v = new THREE.Vector3();
export function viewForward(camera, fallback) {
  camera.getWorldDirection(_v);
  // When looking almost straight down, use the camera's "up" to stand for screen-up
  if (Math.hypot(_v.x, _v.z) < 0.05) _v.set(0, 1, 0).applyQuaternion(camera.quaternion);
  return planar(_v, fallback);
}

export { screenToGround } from '../../core/screenToGround.js';   // shared with grid placement and click-to-move; lives in core

/** Camera kind table: kind name -> build(engine, opts). Each camera file registers once with defineRig; setCamera switches by name */
const RIGS = new Map();
const RIG_PARAMS = new Map();   // kind -> params schema (the option keys of that camera)
/** keys: the options that camera takes; they become its params schema (engine.catalog) and a misspelled one throws in dev */
export function defineRig(kind, build, keys = []) { RIGS.set(kind, build); RIG_PARAMS.set(kind, keysSchema(keys)); }

/**
 * Wrap a camera as a module: handles cutscene takeover, updates engine.focus, and provides runtime switching engine.setCamera(kind, options?).
 * The camera needs update(dt, input) and focusPoint(); optional onEnter(switching) / onExit() (when switched in / out) and onOverride(on) (cutscene takeover start / end).
 * kind: 'follow' | 'firstPerson' | 'fixed' | 'rts', reported in describe()
 */
export function rigModule(kind, opts) {
  let c = null, was = false, owned = null, fresh = true, engine = null, fov0 = 50;
  const cache = new Map();   // kind -> camera instance: params like distance and pitch survive switching away and back
  const make = (k, o) => {
    const build = RIGS.get(k);
    if (!build) throw new Error(`setCamera() has no camera kind '${k}'; available: ${[...RIGS.keys()].join(', ')}`);
    readParams(`${k}Camera`, RIG_PARAMS.get(k), o);   // also covers setCamera(kind, options)
    const r = build(engine, o ?? {});
    r.kind = k; cache.set(k, r);
    return r;
  };
  function setCamera(k, o) {
    if (k === c.kind && !o) return c;
    const old = c, target = old.target;
    old.onExit?.();
    setProjection(engine.camera);   // back to perspective; an orthographic rig sets its own in onEnter / constructor
    engine.camera.fov = fov0; engine.camera.updateProjectionMatrix();   // fov returns to the value at install; each camera applies its own in onEnter / constructor
    const next = o || !cache.has(k) ? make(k, o) : cache.get(k);
    c = engine.cameraRig = next;
    next.onEnter?.(true);
    if (old.yaw !== undefined && next.yaw !== undefined && !(o && o.yaw != null)) next.yaw = old.yaw;   // keep turning from the same heading, no sudden spin
    next.follow(target ?? null);
    fresh = true;   // the camera position was changed here, not counted as "the game moved the camera"
    engine.events.emit('camera:change', { kind: k, previous: old.kind });   // player settings (sensitivity, fov) live on the rig: the settings menu re-applies them
    return c;
  }
  return {
    name: 'cameraRig', label: 'Camera', params: RIG_PARAMS.get(kind), options: opts, optional: ['collision'], stage: 'control',
    install(e) {
      engine = e; fov0 = e.camera.fov;
      e.setCamera = setCamera;
      c = make(kind, opts);
      c.onEnter?.(false);
      // a new playthrough (newGame / load) starts with the camera as installed (kind, yaw, pitch, distance), placed at the player instead of flying across the map
      e.events.on('session:start', () => {
        const old = c;
        old.onExit?.(); cache.clear();
        setProjection(e.camera);
        e.camera.fov = fov0; e.camera.updateProjectionMatrix();
        c = e.cameraRig = make(kind, opts);
        c.onEnter?.(false); c.follow(e.player?.cameraFollow ? e.player.root : null); fresh = true;   // follows the player only if the game asked (createPlayer({ cameraFollow }))
        e.events.emit('camera:change', { kind, previous: old.kind });   // settings re-apply the player's sensitivity / fov to the new rig
      });
      // The camera module places position/orientation every frame: warn once (in dev) if the game changed them between frames
      const cam = e.camera, p = cam.position, q = cam.quaternion;
      owned = ownedProps('camera.position / camera.quaternion', () => [p.x, p.y, p.z, q.x, q.y, q.z, q.w], STRINGS.ownedHint);
      return c;
    },
    frame(dt, e) {
      const over = !!e.cameraOverride;
      if (over !== was) { was = over; c.onOverride?.(over); }
      if (applyOverride(e)) { fresh = true; return; }   // not checked during takeover; re-record afterwards
      if (!fresh) owned.check();
      c.update(dt, e.input);
      e.focus.copy(c.focusPoint());   // decides only where the view (terrain, models) loads; the gameplay simulation center is world.anchor (default the player), so moving the camera away changes nothing
      owned.mark(); fresh = false;
    },
    describe(e, ctx) { ctx.out.camera.type = c.kind; if (c.current !== undefined) ctx.out.camera.shot = c.current;
      ctx.out.camera.pointerLock = lockView(e, c.lockState); },
  };
}

/** Shared camera module text */
export const CAMERA_STRINGS = {
  'zh-CN': { 'camera.rotateLeft': '视角左转', 'camera.rotateRight': '视角右转' },
  en: { 'camera.rotateLeft': 'Rotate view left', 'camera.rotateRight': 'Rotate view right' },
};
