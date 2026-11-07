// @ts-check
// Lights: one near-neutral sun and one fill whose ground color is green. Why green: with no warm-cool shift in the sun, the fill alone decides what shade looks like,
// and a grey fill gives grey shade. Why sun + fill = about PI: three divides diffuse by PI, so that sum shows each color at the value written in palette.js.
import { THREE } from 'threedog';
import { palette } from './palette.js';

const SHADOW_BOX = 75, SHADOW_SNAP = 1;   // meters: half the box around the focus; moved in steps so shadow edges do not crawl under the character grid

/** @param {any} engine @param {any} ctx the picture module's ctx: what is added here leaves with it */
export function createLights(engine, ctx) {
  const { sun: S, fill: F } = palette;
  const sun = new THREE.DirectionalLight(S.color, S.noon), fill = new THREE.HemisphereLight(F.sky, F.ground, F.noon);
  const fixedSun = new THREE.Vector3(...S.direction).normalize();
  sun.name = 'sun';   // the 'sun' slot finds the main light by this name
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(S.shadowMap[engine.tier]);
  Object.assign(sun.shadow.camera, { left: -SHADOW_BOX, right: SHADOW_BOX, bottom: -SHADOW_BOX, top: SHADOW_BOX, near: 1, far: 300 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.08; sun.shadow.radius = S.softness;
  engine.scene.add(sun, sun.target, fill);
  ctx.track({ remove() { engine.scene.remove(sun, sun.target, fill); sun.dispose(); fill.dispose(); } });
  ctx.borrow(engine.scene, { background: new THREE.Color(palette.horizon), fog: new THREE.Fog(palette.horizon, palette.fog.near, palette.fog.far) });

  return {
    sun, fill,
    /** @param {any} signals engine.uniforms */
    update(signals) {
      const day = signals.uDaylight.value;
      // without a sky() module uSunDir stays straight up, which draws no useful shadow, so the fixed direction stands in
      const dir = engine.sky ? signals.uSunDir.value : fixedSun;
      sun.target.position.copy(engine.focus).divideScalar(SHADOW_SNAP).round().multiplyScalar(SHADOW_SNAP);
      sun.position.copy(dir).multiplyScalar(140).add(sun.target.position);
      sun.intensity = S.noon * day * signals.uWeatherLight.value;
      fill.intensity = F.night + (F.noon - F.night) * day;
    },
  };
}
