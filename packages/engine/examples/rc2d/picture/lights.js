// @ts-check
// The scene's own light is one dim ambient; everything else on the street is lit by the cascades.
import { THREE } from 'threedog';
import { AMBIENT } from './palette.js';

/** @param {any} engine */
export function createLights(engine) {
  const ambient = new THREE.AmbientLight(0xffffff, AMBIENT);
  engine.scene.add(ambient);
  return { ambient };
}
