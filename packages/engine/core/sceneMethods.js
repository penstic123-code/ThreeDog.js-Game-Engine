// Scene and render settings on the engine (split out of Engine.js): add / detach / remove objects, pixel ratio, shadows, fog distance,
// tone mapping and exposure, one-off renders (renderOnce).
// add registers each root in the thing registry (things.js) so engine.thing / hit.thing can say what it is and what a save keeps. A plain
// engine.scene.add(obj) is registered the same way (things.js adopts roots added under the scene), so both ways in give the same answer.
import { DEV } from './validate.js';
import { codedError } from './errorHints.js';
import { thing } from './thingOps.js';
import { TONE, exposureDriver } from './look/coreParts.js';
import { freshFrame, renderOnce as drawOnce } from '../render/backend.js';

/** The engine's fog distance when nobody set one (look.fog far's default; also the stream radius without terrain or fog) */
export const FOG_FAR = 600;
/** The fog distance in effect: look.fog far (with every layer: terrain view, style, game, weather), else FOG_FAR @param {any} e */
export const fogFarOf = e => e.look?.fog?.value('far') ?? FOG_FAR;

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
    // register first: scene.add below would otherwise adopt each root as a plain game object (thingOps adoptPlainAdds) before opts are seen
    for (const o of objs) T.add(o, opts, stack);
    this.scene.add(...objs);
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
  /**
   * Draw one picture now, outside the loop, on either renderer. renderOnce() (target null, the engine camera): the frame the player sees, onto
   * the canvas through engine.post; read the canvas in the same task (canvas.toDataURL / drawImage), as photo mode does.
   * renderOnce(target): that frame through engine.post into a render target instead (the canvas's pixels: tone mapped, output color space;
   * with no post work on, three's plain draw into a target). renderOnce(target, camera) with another camera: the scene without post (the chain
   * is built around the engine camera's screen), into target or, with target null, the canvas. On WebGPURenderer each call is a fresh node frame, so a RenderPipeline's scene
   * pass, which three draws once per frame, draws again: two calls in one task give two pictures (docs/plans/2026-11-03-webgpu-phase2.md 3).
   * @example engine.renderOnce(); const url = engine.renderer.domElement.toDataURL('image/png');
   * engine.renderOnce(rt, mapCamera);   // a minimap / thumbnail into your own render target
   * @param {any} [target] three render target, null = the canvas
   * @param {import('three').Camera} [camera] default engine.camera
   * @returns {void}
   */
  renderOnce(target = null, camera = this.camera) {
    const own = this._ownFrame;   // an engine draw, not the game taking the canvas over (render/ownFrame.js)
    if (own) own.inside++;
    try {
      if (camera === this.camera) { freshFrame(this.renderer); this.post.render(0, target); return; }
      drawOnce(this.renderer, this.scene, camera, target);
    } finally { if (own) own.inside--; }
  },
  // an engine.setPixelRatio call is the game's (or settings') request: written even when the game took the ratio, and re-read so it is not an outside write
  setPixelRatio(p) { this.renderer.setPixelRatio(p); this._oPixelRatio?.mark(); },
  /** Raise camera.far to at least far (terrain view range, fog). Goes through ownership: a game that owns camera.far (look.view.manual('far')) keeps its value. @param {number} far */
  viewFar(far) {
    if (this.camera.far >= far) return;
    if (this._oFar) this._oFar.drive(far); else { this.camera.far = far; this.camera.updateProjectionMatrix(); }
  },
};
