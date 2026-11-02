// Scene and render settings on the engine (split out of Engine.js): add / detach / remove objects, pixel ratio, shadows, fog distance,
// tone mapping and exposure.
// add registers each root in the thing registry (things.js) so engine.thing / hit.thing can say what it is and what a save keeps; engine.scene.add
// stays the plain three.js way in, with no registration.
import { DEV } from './validate.js';
import { codedError } from './errorHints.js';
import { thing } from './thingOps.js';
import { TONE, exposureDriver } from './look/coreParts.js';
import { ownedRow } from './owned.js';

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
  // an engine.setPixelRatio call is the game's (or settings') request: written even when the game took the ratio, and re-read so it is not an outside write
  setPixelRatio(p) { this.renderer.setPixelRatio(p); this.post.setPixelRatio(p); this._oPixelRatio?.mark(); },
  /**
   * Master shadow switch. Off: remember each light's castShadow (the game's choice) then turn it off; on: restore only the lights that cast before (lights the
   * game turned off stay off).
   * Lights added while off are left alone (the renderer has shadows off, so it makes no difference).
   * Where the remembered values live: one engine-owned Map (this._shadowsHeld, shown as describe().owned 'shadows.off'), not light.userData: userData is the
   * game's (it is JSON-cloned, saved and exported to glTF), and a hidden key there was a second, invisible record of who switched the light off.
   */
  setShadows(on) {
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    const held = this._shadowsHeld ??= new Map();
    if (!held.size && !on) ownedRow(this, 'shadows.off', () => (held.size ? { part: 'shadow', key: 'enabled', writer: 'engine.setShadows(false)',
      lights: [...held.keys()].map(l => l.name || l.type), back: 'engine.setShadows(true) gives each light back its own castShadow' } : undefined));
    this.scene.traverse(o => {
      if (o.isLight && o.shadow) {
        if (!on) { if (!held.has(o)) held.set(o, o.castShadow); o.castShadow = false; }
        else if (held.has(o)) { o.castShadow = held.get(o); held.delete(o); }
      }
      if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true);
    });
    // a light removed from the scene while off is not reached by the walk: forget it, so the Map does not keep it alive
    if (on) held.clear();
    this.events.emit('settings:shadows', on);
  },
  /** @internal the engine's view-distance path (terrain viewFog, the far plane); a game sets its fog distance with engine.look.fog.set({ far }) */
  setFogFar(d) {
    this.fogFar = d;
    // scene.fog is not written here: while the sky drives the fog, its next frame reads engine.fogFar through the owned fog path (sky/fog.js),
    // so a game that owns the fog (look.fog.manual(), a direct write, look.fog.replace, or no sky at all) keeps its near / far.
    // Writing it here was the "the engine silently overrode my fog" bug.
    // camera.far is owned (core/owned.js): a game that set it itself keeps its value (look.view.manual('far'))
    if (this._oFar) this._oFar.drive(d + 150); else { this.camera.far = d + 150; this.camera.updateProjectionMatrix(); }
  },
  /** Raise camera.far to at least far (terrain view range, fog). Goes through ownership: a game that owns camera.far (look.view.manual('far')) keeps its value. @param {number} far */
  viewFar(far) {
    if (this.camera.far >= far) return;
    if (this._oFar) this._oFar.drive(far); else { this.camera.far = far; this.camera.updateProjectionMatrix(); }
  },
};
