// Scene and render settings on the engine (split out of Engine.js): add / detach / remove objects, pixel ratio, shadows, fog distance,
// tone mapping and exposure.
// add registers each root in the thing registry (things.js) so engine.thing / hit.thing can say what it is and what a save keeps; engine.scene.add
// stays the plain three.js way in, with no registration.
import { DEV } from './validate.js';
import { codedError, renamed } from './errorHints.js';
import { thing } from './thingOps.js';
import { TONE, exposureDriver } from './look/coreParts.js';

export { TONE } from './look/coreParts.js';   // style.toneMapping names -> three constants (kept here for older imports)

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
      const rid = this._things.idOf(o);
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
  thing(idOrObj) { return thing(this, idOrObj); },
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
  /** Renamed in 0.2: throws and names the new call, engine.look.tone.set({ mapping }). @param {string} _kind @returns {never} */
  setToneMapping(_kind) { return renamed('setToneMapping'); },
  /** Renamed in 0.2: throws and names the new call, engine.look.tone.set({ exposure }). @param {any} _v @returns {never} */
  setExposure(_v) { return renamed('setExposure'); }
};
