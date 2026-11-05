// @ts-check
// __NAME__ lights: a sun that follows uSunDir and uDaylight, and one ambient fill. update() runs once per drawn frame.
import { THREE } from 'threedog';
import { palette } from './palette.js';

const SHADOW_BOX = 40, SHADOW_SNAP = 0.5;   // meters: half the box around the focus; the box moves in steps so shadow edges do not crawl while walking

/** @param {any} engine */
export function createLights(engine) {
  const { sun: S, ambient: A } = palette;
  const sun = new THREE.DirectionalLight(S.color, S.noon), ambient = new THREE.HemisphereLight(A.sky, A.ground, A.noon);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(S.shadowMap[engine.tier]);   // the picture reads the quality tier itself: the engine cannot hold this code to it
  Object.assign(sun.shadow.camera, { left: -SHADOW_BOX, right: SHADOW_BOX, bottom: -SHADOW_BOX, top: SHADOW_BOX, near: 1, far: 250 });
  sun.shadow.bias = -0.0001; sun.shadow.normalBias = 0.03;
  engine.scene.add(sun, sun.target, ambient);

  return {
    sun, ambient,
    // Rewrites sun.intensity, ambient.intensity and sun.position every frame: to change them, change this function; a write elsewhere lasts one frame.
    /** @param {any} signals engine.uniforms */
    update(signals) {
      const day = signals.uDaylight.value;
      sun.target.position.copy(engine.focus).divideScalar(SHADOW_SNAP).round().multiplyScalar(SHADOW_SNAP);
      sun.position.copy(signals.uSunDir.value).multiplyScalar(100).add(sun.target.position);
      sun.intensity = S.noon * day * signals.uWeatherLight.value;   // 1 in clear weather, lower under rain
      ambient.intensity = A.night + (A.noon - A.night) * day;
    },
  };
}
