// engine.view: the camera and drawing-buffer values the engine changes on its own (camera.far for the view range, camera.fov for the settings slider and camera
// modules, the pixel ratio for adaptive resolution). Each is an owned property (core/owned.js): a game's direct write wins, manual() takes one on purpose.
import { codedError } from './errorHints.js';
import { defineOwned, manualVerb } from './owned.js';

/**
 * Every engine write of camera.fov (settings menu slider, camera modules) goes through here: it yields to a fov the game set itself.
 * @param {any} e @param {number} v
 */
export function setFov(e, v) { e._setFov(v); }

/** @param {any} e */
export function defineView(e) {
  const cam = () => e.camera;
  e._oFar = defineOwned(e, { id: 'view.far', part: 'view', key: 'far', read: () => cam().far, objects: [e.camera],
    write: v => { cam().far = v; cam().updateProjectionMatrix(); }, levels: { manual: "engine.view.manual('far')" } });
  e._oPixelRatio = defineOwned(e, { id: 'view.pixelRatio', part: 'view', key: 'pixelRatio', read: () => e.renderer.getPixelRatio(), objects: [e.renderer],
    levels: { manual: "engine.view.manual('pixelRatio')", set: 'engine.setPixelRatio(1.5)' } });
  // fov: the settings menu slider and camera modules (first person / rts / fixed shots, and restoring the fov at uninstall) write it.
  // They all go through e._setFov, so a game that sets camera.fov itself (a zoom, a cutscene) is not undone by the next camera switch.
  e._oFov = defineOwned(e, { id: 'view.fov', part: 'view', key: 'fov', read: () => cam().fov, objects: [e.camera],
    write: v => { if (cam().fov !== v) { cam().fov = v; cam().updateProjectionMatrix(); } }, levels: { manual: "engine.view.manual('fov')" } });
  /** @internal every engine write of camera.fov (settings menu, camera modules): yields to the game's own value */
  e._setFov = (/** @type {number} */ v) => e._oFov.drive(v);
  e._oFar.mark(); e._oPixelRatio.mark(); e._oFov.mark();
  e.view = {
    /**
     * Stop the engine changing a camera or drawing-buffer value: the value is yours until you hand it back. A direct write takes it too; this says so on purpose,
     * with no warning. 'camera' hands the pose back after a direct write (take it with engine.takeCamera(owner)).
     * @example
     * const mine = engine.view.manual('far');
     * engine.camera.far = 5000;
     * mine.remove();
     * @param {'far' | 'fov' | 'pixelRatio' | 'camera'} key
     * @param {boolean} [on] false hands it back
     * @returns {{ remove(): void }} remove() hands it back
     */
    manual(key, on = true) {
      if (typeof key !== 'string') throw codedError('owned-misuse', `engine.view.manual(key): key must be 'far', 'fov' or 'pixelRatio'; got ${JSON.stringify(key)}`);
      return manualVerb(e, 'view', key, on);
    },
  };
}
