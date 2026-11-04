// @ts-check
// A flat painted backdrop: one color at every height, the same as the fog, so the island floats with no horizon. The engine's dome is hidden.
import { THREE } from '../../../index.js';
import { FOG, OVERCAST, skyColor } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene } = engine;
  const backdrop = new THREE.Color(), overcast = new THREE.Color(OVERCAST);
  scene.background = backdrop;
  scene.fog = new THREE.Fog(backdrop.getHex(), FOG.near, FOG.far);
  if (engine.sky) engine.sky.dome.visible = false;
  return {
    /** @param {any} s engine.uniforms */
    update(s) {
      skyColor(backdrop, 1, s.uTimeOfDay.value).lerp(overcast, engine.weather?.current.grey ?? 0);
      /** @type {THREE.Fog} */ (scene.fog).color.copy(backdrop);
    },
  };
}
