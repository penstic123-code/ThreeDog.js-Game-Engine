// @ts-check
// Sun and key light helpers (technique example, README.md next to this file). Imports only three and writes only the lights you pass in.
// Why helpers at all: aiming a sun relative to the camera and fitting its shadow are a few writes in a set order; written once here so a game's
// lighting code holds only its own numbers.
import * as THREE from 'three';

/**
 * Key and fill from one route: the sun is the key, the hemisphere light + the scene's environment the fill. tint 0 = white light, 1 = the route's
 * colors, more = pushed further apart (warm key / cool shadows). Returns { remove() }: it writes back the values it found.
 * @param {{ sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, scene?: THREE.Scene }} lights scene: for environmentIntensity; leave it out without an environment
 * @param {{ key: { intensity: number, color: string }, fill: { intensity: number, color: string, ground: string }, env: number }} route
 * @param {{ tint?: number }} [o]
 */
export function applyKeyFill({ sun, hemi, scene }, route, { tint = 1 } = {}) {
  const saved = { key: sun.intensity, keyColor: sun.color.clone(), fill: hemi.intensity, fillColor: hemi.color.clone(), ground: hemi.groundColor.clone(), env: scene?.environmentIntensity };
  const white = new THREE.Color('#ffffff');
  sun.intensity = route.key.intensity;
  sun.color.copy(white).lerp(new THREE.Color(route.key.color), tint);
  hemi.intensity = route.fill.intensity;
  hemi.color.copy(white).lerp(new THREE.Color(route.fill.color), tint);
  hemi.groundColor.set(route.fill.ground);
  if (scene) scene.environmentIntensity = route.env;
  return {
    remove() {
      sun.intensity = saved.key; sun.color.copy(saved.keyColor);
      hemi.intensity = saved.fill; hemi.color.copy(saved.fillColor); hemi.groundColor.copy(saved.ground);
      if (scene) scene.environmentIntensity = /** @type {number} */ (saved.env);
    },
  };
}

/**
 * Aim the sun for the composition. azimuth is measured around `target` from the camera: 0 = behind the camera (front light), 90 = from the
 * side, 180 = facing the camera (back light). Writes only the direction; color and intensity stay where they were. Returns the unit direction
 * toward the sun.
 * @param {THREE.DirectionalLight} sun
 * @param {{ elevation: number, azimuth: number, camera: number[], target?: number[] }} o degrees; camera / target positions
 */
export function aimSun(sun, { elevation, azimuth, camera, target = [0, 0, 0] }) {
  const t = new THREE.Vector3(target[0], target[1], target[2]);
  const toCam = new THREE.Vector3(camera[0] - t.x, 0, camera[2] - t.z).normalize();
  const el = THREE.MathUtils.degToRad(elevation);
  const h = toCam.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(azimuth));
  const dir = new THREE.Vector3(h.x * Math.cos(el), Math.sin(el), h.z * Math.cos(el)).normalize();
  sun.target.position.copy(t);
  sun.position.copy(t).addScaledVector(dir, 160);
  return dir;
}

/**
 * One shadow box fitted to a compact scene, centered on the sun's target. biasCm is the depth bias in centimeters: three adds bias in the shadow
 * camera's 0-1 depth, i.e. a world offset of bias x (far - near). Returns { remove() }: it writes back the values it found.
 * @param {THREE.DirectionalLight} sun
 * @param {{ extent: number, biasCm?: number, normalBias?: number, mapSize?: number, radius?: number, blurSamples?: number }} o
 */
export function fitSunShadow(sun, { extent, biasCm = 2, normalBias = 0.02, mapSize = sun.shadow.mapSize.x, radius = sun.shadow.radius, blurSamples = sun.shadow.blurSamples }) {
  const s = sun.shadow, c = s.camera;
  const write = (/** @type {number} */ half, /** @type {number} */ size, /** @type {Partial<THREE.DirectionalLightShadow>} */ values) => {
    Object.assign(c, { left: -half, right: half, top: half, bottom: -half });
    c.updateProjectionMatrix();   // three.js does not do this for a DirectionalLight's shadow camera
    Object.assign(s, values);
    if (s.mapSize.x !== size) {   // a map keeps the size it was made with: drop it and three.js makes the new one
      s.mapSize.setScalar(size);
      s.map?.dispose();
      s.map = null;
    }
  };
  const before = c.right, beforeSize = s.mapSize.x, saved = { bias: s.bias, normalBias: s.normalBias, radius: s.radius, blurSamples: s.blurSamples };
  write(extent, mapSize, { bias: -biasCm / 100 / (c.far - c.near), normalBias, radius, blurSamples });
  return { remove() { write(before, beforeSize, saved); } };
}
