// Shared parts of the camera modules: used by every camera (follow / first-person / fixed / strategy top-down).
//
// Camera interface (every camera module is named 'cameraRig', only one installed; swap at runtime with engine.setCamera('firstPerson' | 'follow' | 'rts' | 'fixed', options?),
// the swapped-out camera is kept, so its params survive switching back; engine.cameraRig.kind is the current kind):
//   follow(object)      who to follow (called automatically when the player is created)
//   target              the object being followed
//   forward() / right() unit directions {x, z} on the XZ plane; player movement uses them
//   update(dt, input)   per-frame camera update
//
// Cutscene takeover contract: engine.cameraOverride
//   A cutscene (timeline module) that places the camera itself sets engine.cameraOverride = { owner: 'who', focus?: Vector3 }.
//   While it is not null the camera module leaves the camera alone; with a focus, engine.focus is set to it (the world loads around it).
//   Set it back to null when done; the camera module resumes from its previous state.
import * as THREE from 'three';
import { ownedProps } from '../../core/validate.js';

const STRINGS = { ownedHint: 'To place the camera yourself, set engine.cameraOverride = { owner: \'me\' } and set it back to null when done' };

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
 * Locked, mouse motion turns the view without dragging (input.look); Esc releases. Touch screens keep dragging
 */
export function clickToLock(rig, switched) {
  const e = rig.engine, canvas = e.renderer.domElement;
  const lock = () => {
    if (!rig.pointerLock || e.cameraOverride || !e.input.enabled) return;
    if (matchMedia('(pointer: coarse)').matches || document.pointerLockElement === canvas) return;
    try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* browser refused the lock; fall back to dragging */ }
  };
  rig._off = new AbortController();
  canvas.addEventListener('click', lock, { signal: AbortSignal.any([e.signal, rig._off.signal]) });   // removed on switch-away or engine.dispose()
  if (switched) lock();   // a runtime switch (a key press counts as a gesture) locks at once
}
/** Release the mouse lock; stop listening for clicks too when switched away (call from onExit; from onOverride with keepListening) */
export function releaseLock(rig, keepListening = false) {
  if (!keepListening) rig._off?.abort();
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
export function defineRig(kind, build) { RIGS.set(kind, build); }

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
    const r = build(engine, o ?? {});
    r.kind = k; cache.set(k, r);
    return r;
  };
  function setCamera(k, o) {
    if (k === c.kind && !o) return c;
    const old = c, target = old.target;
    old.onExit?.();
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
    name: 'cameraRig', label: 'Camera', optional: ['collision'], stage: 'control',
    install(e) {
      engine = e; fov0 = e.camera.fov;
      e.setCamera = setCamera;
      c = make(kind, opts);
      c.onEnter?.(false);
      // a new playthrough (newGame / load) starts with the camera as installed (kind, yaw, pitch, distance), placed at the player instead of flying across the map
      e.events.on('session:start', () => {
        const old = c;
        old.onExit?.(); cache.clear();
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
    describe(e, ctx) { ctx.out.camera.type = c.kind; if (c.current !== undefined) ctx.out.camera.shot = c.current; },
  };
}

/** Shared camera module text */
export const CAMERA_STRINGS = {
  'zh-CN': { 'camera.rotateLeft': '视角左转', 'camera.rotateRight': '视角右转' },
  en: { 'camera.rotateLeft': 'Rotate view left', 'camera.rotateRight': 'Rotate view right' },
};
