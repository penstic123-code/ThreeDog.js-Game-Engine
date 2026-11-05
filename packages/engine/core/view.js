// engine.autoView: the camera and drawing-buffer values the engine changes on its own (camera.far for the view range, camera.fov for the settings slider and camera
// modules, the pixel ratio for adaptive resolution). Each is an owned property (core/owned.js): a game's direct write wins, manual() takes one on purpose.
import { codedError } from './errorHints.js';
import { defineOwned, manualVerb } from './owned.js';

/**
 * Every engine write of camera.fov (settings menu slider, camera modules) goes through here: it yields to a fov the game set itself.
 * @param {any} e @param {number} v
 */
export function setFov(e, v) { e._oFov.drive(v); }

/** @param {any} e */
export function defineView(e) {
  const cam = () => e.camera;
  e._oFar = defineOwned(e, { id: 'view.far', part: 'view', key: 'far', read: () => cam().far, objects: [e.camera],
    write: v => { cam().far = v; cam().updateProjectionMatrix(); }, levels: { manual: "engine.autoView.manual('far')" } });
  e._oPixelRatio = defineOwned(e, { id: 'view.pixelRatio', part: 'view', key: 'pixelRatio', read: () => e.renderer.getPixelRatio(), objects: [e.renderer],
    levels: { manual: "engine.autoView.manual('pixelRatio')", set: 'engine.setPixelRatio(1.5)' } });
  // fov: the settings menu slider and camera modules (first person / rts / fixed shots, and restoring the fov at uninstall) write it.
  // They all go through setFov, so a game that sets camera.fov itself (a zoom, a cutscene) is not undone by the next camera switch.
  e._oFov = defineOwned(e, { id: 'view.fov', part: 'view', key: 'fov', read: () => cam().fov, objects: [e.camera],
    write: v => { if (cam().fov !== v) { cam().fov = v; cam().updateProjectionMatrix(); } }, levels: { manual: "engine.autoView.manual('fov')" } });
  // aspect: the engine writes it on every resize. A game's own (letterbox, split view) stays, the same as far and fov
  e._oAspect = defineOwned(e, { id: 'view.aspect', part: 'view', key: 'aspect', read: () => cam().aspect, objects: [e.camera],
    write: v => { cam().aspect = v; cam().updateProjectionMatrix(); }, levels: { manual: "engine.autoView.manual('aspect')" } });
  e._oFar.mark(); e._oPixelRatio.mark(); e._oFov.mark(); e._oAspect.mark();
  e.autoView = {
    /**
     * Stop the engine changing a camera or drawing-buffer value: the value is yours until you hand it back. A direct write takes it too; this says so on purpose,
     * with no warning. 'camera' hands the pose back after a direct write (take it with engine.takeCamera(owner)).
     * @example
     * const mine = engine.autoView.manual('far');
     * engine.camera.far = 5000;
     * mine.remove();
     * @param {'far' | 'fov' | 'aspect' | 'pixelRatio' | 'sunDir' | 'camera'} key
     * @param {boolean} [on] false hands it back
     * @returns {{ remove(): void }} remove() hands it back
     */
    manual(key, on = true) {
      if (typeof key !== 'string') throw codedError('owned-misuse', `engine.autoView.manual(key): key must be 'far', 'fov', 'aspect', 'pixelRatio', 'sunDir' or 'camera'; got ${JSON.stringify(key)}`);
      return manualVerb(e, 'view', key, on);
    },
  };
}
