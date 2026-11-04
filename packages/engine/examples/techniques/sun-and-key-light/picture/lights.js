// @ts-check
// Key, fill and the sun's shadow for one route. No signals: a route is a fixed composition, so everything is written once.
import { THREE } from 'threedog';
import { applyKeyFill, aimSun, fitSunShadow } from '../keyLight.js';
import { SHADOW_TYPES } from './palette.js';

/**
 * @param {any} engine
 * @param {{ route: any, tint: number, elevation: number, azimuth: number, camera: number[], shadow: { type: string, extent: number, biasCm: number, normalBias: number, mapSize: number, radius: number, blurSamples?: number, cascades: number } }} o
 */
export function createLights(engine, { route, tint, elevation, azimuth, camera, shadow }) {
  const { scene, renderer } = engine, { type, cascades, ...fit } = shadow;
  const filter = SHADOW_TYPES[/** @type {keyof typeof SHADOW_TYPES} */ (type)];
  if (filter === undefined) throw new Error(`?shadow=${type}: use one of ${Object.keys(SHADOW_TYPES).join(', ')}`);
  renderer.shadowMap.type = filter;

  const hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { near: 1, far: 320 });   // the sun stands 160 m from its target: the box reaches past it on both sides
  scene.add(hemi, sun, sun.target);

  applyKeyFill({ sun, hemi, scene }, route, { tint });
  const sunDir = aimSun(sun, { elevation, azimuth, camera });
  fitSunShadow(sun, fit);
  if (cascades > 1) engine.shadows.cascades(sun, { count: cascades });

  // key:fill from the light numbers: a surface facing the sun gets key + fill, one in shadow only fill. The ground gets the key at sin(elevation),
  // which is why a low sun darkens the ground and brightens the walls facing it. A rough guide only: the room environment adds more fill than its
  // intensity number says, so the measured ratio is lower (README "Measured"); read the real one in a shot
  const fillUp = route.fill.intensity + route.env, up = Math.sin(THREE.MathUtils.degToRad(elevation));
  const ratio = { ground: +((route.key.intensity * up + fillUp) / fillUp).toFixed(2), facing: +((route.key.intensity + fillUp) / fillUp).toFixed(2) };
  return { sun, hemi, sunDir, ratio };
}
