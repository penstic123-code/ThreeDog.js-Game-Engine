// @ts-check
// A flat backdrop in the fill color and fog that fades the ground into it: no gradient or sun disc at the wrong place. The environment is three's
// RoomEnvironment: soft fill with some direction, no asset. Its strength is the route's env, set by applyKeyFill.
import { THREE } from 'threedog';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FOG } from './palette.js';

/** @param {any} engine @param {string} backdrop */
export function createSky(engine, backdrop) {
  const { scene, renderer } = engine;
  scene.background = new THREE.Color(backdrop);
  scene.fog = new THREE.Fog(backdrop, FOG.near, FOG.far);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
