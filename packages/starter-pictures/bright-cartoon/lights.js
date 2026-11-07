// @ts-check
// Lights: one sun and one soft fill. With celLighting the sun decides the bands and the fill lifts everything evenly, with a slight blue-from-above,
// warm-from-below tint. Why sun + ambient = about PI: three divides diffuse by PI, so that sum shows each color at the value written in palette.js.
import { THREE } from 'threedog';
import { palette } from './palette.js';

const SHADOW_BOX = 40, SHADOW_SNAP = 0.5;   // meters: half the box around the focus; moved in steps so shadow edges do not crawl while walking

/** @param {any} engine @param {any} ctx the picture module's ctx: what is added here leaves with it */
export function createLights(engine, ctx) {
  const { sun: S, ambient: A } = palette;
  const sun = new THREE.DirectionalLight(S.color, S.noon), ambient = new THREE.HemisphereLight(A.sky, A.ground, A.noon);
  const fixedSun = new THREE.Vector3(...S.direction).normalize();
  sun.name = 'sun';   // the 'sun' slot finds the main light by this name
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(S.shadowMap[engine.tier]);
  Object.assign(sun.shadow.camera, { left: -SHADOW_BOX, right: SHADOW_BOX, bottom: -SHADOW_BOX, top: SHADOW_BOX, near: 1, far: 250 });
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.05;
  // VSM: its blur is smooth, so the ramp cuts it to one clean line. The default PCF blurs with a dither pattern, and the ramp's hard step shows that as dots (or as stairs at a small radius)
  ctx.borrow(engine.renderer.shadowMap, { type: THREE.VSMShadowMap });
  sun.shadow.radius = 4; sun.shadow.blurSamples = 12;
  engine.scene.add(sun, sun.target, ambient);
  ctx.track({ remove() { engine.scene.remove(sun, sun.target, ambient); sun.dispose(); ambient.dispose(); } });

  return {
    sun, ambient,
    /** @param {any} signals engine.uniforms */
    update(signals) {
      const day = signals.uDaylight.value;
      // without a sky() module uSunDir stays straight up, which draws no useful shadow, so the fixed direction stands in
      const dir = engine.sky ? signals.uSunDir.value : fixedSun;
      sun.target.position.copy(engine.focus).divideScalar(SHADOW_SNAP).round().multiplyScalar(SHADOW_SNAP);
      sun.position.copy(dir).multiplyScalar(100).add(sun.target.position);
      sun.intensity = S.noon * day * signals.uWeatherLight.value;
      ambient.intensity = A.night + (A.noon - A.night) * day;
    },
  };
}
