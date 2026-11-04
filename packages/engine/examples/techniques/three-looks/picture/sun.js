// @ts-check
// The one casting light every look has; its color, height and softness are the look's, passed in.
import { THREE } from 'threedog';
import { positionGeometry, positionLocal, float } from 'three/tsl';
import { wind, objectOrigin } from 'threedog/tsl';

/** @param {any} engine @param {{ color: number, intensity: number, at: number[], radius: number }} o */
export function addSun(engine, { color, intensity, at, radius }) {
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.position.set(at[0], at[1], at[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; sun.shadow.radius = radius;
  engine.scene.add(sun, sun.target);
  return sun;
}

/** A material whose vertices sway; positionNode is all it takes, three's shadow pass reads it too @template {any} M @param {M} mat @param {number} amplitude @returns {M} */
export function swaying(mat, amplitude) {
  /** @type {any} */ (mat).positionNode = positionLocal.add(wind(positionGeometry, objectOrigin(), float(amplitude)));
  return mat;
}
