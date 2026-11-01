// Scene and render settings on the engine (split out of Engine.js): add / detach / remove objects, pixel ratio, shadows, fog distance,
// tone mapping and exposure.
// add registers each root in the thing registry (things.js) so engine.thing / hit.thing can say what it is and what a save keeps; engine.scene.add
// stays the plain three.js way in, with no registration.
import * as THREE from 'three';
import { DEV } from './validate.js';
import { codedError } from './errorHints.js';
import { thing } from './thingOps.js';
import { recordThing } from './Inspect.js';

/** style.toneMapping names -> three constants */
export const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };

/**
 * Exposure over the day: [[time 0-1, exposure], ...] sorted by time, wrapping across midnight (after the last row it blends back to the first),
 * or (sky) => number. Returns the per-frame function, null for a plain number (set once)
 */
function exposureDriver(v) {
  if (typeof v === 'number') return null;
  if (typeof v === 'function') return v;
  const ok = Array.isArray(v) && v.length > 0 && v.every((k, i) => Array.isArray(k) && typeof k[0] === 'number' && typeof k[1] === 'number' && k[0] >= 0 && k[0] <= 1 && (i === 0 || k[0] > v[i - 1][0]));
  if (!ok) throw new Error(`exposure must be a number, [[time 0-1, exposure], ...] sorted by time (e.g. [[0, 1.6], [0.5, 1], [0.8, 1.3]]) or (sky) => number; got ${JSON.stringify(v)}`);
  return sky => {
    const t = sky.timeOfDay, n = v.length;
    let i = -1; for (let k = 0; k < n; k++) if (v[k][0] <= t) i = k;
    const a = v[i < 0 ? n - 1 : i], b = v[(i + 1) % n];   // before the first row or after the last: the segment across midnight
    const span = (b[0] - a[0] + 1) % 1 || 1, f = ((t - a[0] + 1) % 1) / span;
    return a[1] + (b[1] - a[1]) * f;
  };
}

/** A short stack for "added at main.js:50" (dev): 4 frames are enough (this, add, its caller) and keep the cost low; it is formatted only when read */
function captureStack() {
  const lim = Error.stackTraceLimit; Error.stackTraceLimit = 4;
  try { return new Error(); } finally { Error.stackTraceLimit = lim; }
}

export const sceneMethods = {
  /**
   * Add objects to the scene and register them (engine.thing). The last argument may be an options object: id makes the object's thing.set /
   * thing.remove changes saved (unique, no '#'; with several objects pass id for one object only); without it a unique obj.name is used, else a
   * session id obj#n. save: true says you expect it to be saved: dev warns when it cannot be (no id, or added during play). Returns the first object.
   * @example engine.add(windmill, { id: 'windmill' });   // at setup: thing.set changes to it are saved
   * @example engine.add(spark);                          // fine for effects: lives this session only
   * @template {import('three').Object3D} T
   * @param {[T, ...any[]]} objs  Object3D roots, optionally followed by { id?, save? }
   * @returns {T}
   */
  add(...objs) {
    const last = objs.at(-1), opts = last && !last.isObject3D ? objs.pop() : null;
    if (opts?.id != null && objs.length > 1) throw codedError('thing-id', `engine.add(a, b, …, { id: '${opts.id}' }): an id names one object; add the others in their own call`);
    const T = this._things, stack = DEV && !opts?.owner && T.wantStack() ? captureStack() : null;
    if (DEV && opts?.owner !== 'world') for (const o of objs) {
      const rid = this.world?.idOf(o);
      if (rid) throw codedError('thing-owned', `engine.add(): this object is the model of world record '${rid}' (world builds, places and tears it down). Change the record instead: ops.run('thing.set', { id: '${rid}', position }) or world.set / world.move`);
    }
    this.scene.add(...objs);
    for (const o of objs) T.add(o, opts, stack);
    return objs[0];
  },
  /**
   * What a thing is and what a save keeps: a world record id, an id / name given to engine.add, or any Object3D (its registered ancestor).
   * Returns { id, kind, owner, at, phase, saved: 'record' | 'code' | 'session' | 'engine', keeps, loses, edit, object } (object is the live
   * Object3D); throws with the closest id when nothing matches. Change it with ops.run('thing.set', { id, position }) or 'thing.remove'.
   * @example engine.thing('windmill').saved   // 'code': rebuilt by code each start, thing.set changes saved
   * @example engine.thing(engine.pick(0, 0).object).edit
   * @param {string | import('three').Object3D} idOrObj
   * @returns {import('../types/core').Thing}
   */
  thing(idOrObj) { return thing(this, idOrObj, recordThing); },
  /** @internal Dev: a module found two systems managing one object; listed in describe().scene.conflicts and warned once (code thing-owned) */
  thingConflict(text) { this._things.conflict(text); },
  /** Detach from the parent only (no GPU release; use when you will add it back). Use remove for objects you are done with */
  detach(...objs) { for (const o of objs) o.removeFromParent(); },
  /**
   * Delete an object for good: detach it, unregister its rays and dispose geometries and materials (textures are kept). Geometry and materials shared by assets
   * model clones are only decremented in use count (see Assets.js)
   */
  remove(...objs) {
    for (const o of objs) {
      o.removeFromParent();
      this._things.forget(o);
      this.rays.forget(o);
      this.assets.forget(o);
      const shared = this.assets.shared, held = this.batching.held;   // a batch still drawing the same geometry / material keeps it alive
      o.traverse(c => {
        if (c.geometry && !shared.has(c.geometry) && !held.has(c.geometry)) c.geometry.dispose();
        for (const m of [].concat(c.material || [])) if (!shared.has(m) && !held.has(m)) m.dispose();
      });
    }
  },
  setPixelRatio(p) { this.renderer.setPixelRatio(p); this.post.setPixelRatio(p); },
  /**
   * Master shadow switch. Off: remember each light's castShadow (the game's choice) then turn it off; on: restore only the lights that cast before (lights the
   * game turned off stay off).
   * Lights added while off are left alone (the renderer has shadows off, so it makes no difference).
   */
  setShadows(on) {
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse(o => {
      if (o.isLight && o.shadow) {
        const u = o.userData;
        if (!on) { if (!('threedogCastShadow' in u)) u.threedogCastShadow = o.castShadow; o.castShadow = false; }
        else if ('threedogCastShadow' in u) { o.castShadow = u.threedogCastShadow; delete u.threedogCastShadow; }
      }
      if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true);
    });
    this.events.emit('settings:shadows', on);
  },
  setFogFar(d) {
    this.fogFar = d;
    if (this.scene.fog) { this.scene.fog.far = d; this.scene.fog.near = d * 0.3; }
    this.camera.far = d + 150; this.camera.updateProjectionMatrix();
  },
  setToneMapping(kind) {
    if (!(kind in TONE)) throw new Error(`engine.setToneMapping('${kind}'): use ${Object.keys(TONE).map(k => `'${k}'`).join(' | ')}`);
    this.renderer.toneMapping = TONE[kind];   // three recompiles each material on its next draw (tone mapping is part of its program)
  },
  setExposure(v) {
    // keyframes / a function become exposureDriver, which a time-of-day module (sky) evaluates each frame; core knows no time of day
    this.exposureDriver = exposureDriver(v);
    if (typeof v === 'number') this.renderer.toneMappingExposure = v;
  }
};
