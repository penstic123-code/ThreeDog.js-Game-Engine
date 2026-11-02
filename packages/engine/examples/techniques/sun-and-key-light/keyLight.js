// @ts-check
// Sun and key light helpers (technique example, README.md next to this file). Imports only three; works on any engine with the sky module.
// Why helpers at all: aiming the sun and fitting its shadow each take three engine calls in a set order (take the direction, place position
// relative to target, stop the box following); written once here so a game's lighting code holds only its own numbers.
import * as THREE from 'three';

/**
 * Key and fill from one route: the sun is the key, the hemisphere light + room environment the fill. tint 0 = white light, 1 = the route's
 * colors, more = pushed further apart (warm key / cool shadows). Writes the override layer of look.lights (owner), so the sky's keyframes stay
 * underneath and remove() gives them back.
 * @param {any} engine
 * @param {{ key: { intensity: number, color: string }, fill: { intensity: number, color: string, ground: string }, env: number }} route
 * @param {{ tint?: number, owner?: string }} [o]
 */
export function applyKeyFill(engine, route, { tint = 1, owner = 'key-light' } = {}) {
  const push = (/** @type {string} */ c) => '#' + new THREE.Color('#ffffff').lerp(new THREE.Color(c), tint).getHexString();
  return engine.look.lights.set({
    sun: { intensity: route.key.intensity, color: push(route.key.color) },
    hemi: { intensity: route.fill.intensity, color: push(route.fill.color), ground: route.fill.ground },
    env: { intensity: route.env },
  }, { owner });
}

/**
 * Aim the sun for the composition. azimuth is measured around `target` from the camera: 0 = behind the camera (front light), 90 = from the
 * side, 180 = facing the camera (back light). Takes only the direction from the sky (look.lights.manual('sun.direction')); color and
 * intensity stay where they were. Returns the unit direction toward the sun.
 * @param {any} engine
 * @param {{ elevation: number, azimuth: number, camera: number[], target?: number[] }} o degrees; camera / target positions
 */
export function aimSun(engine, { elevation, azimuth, camera, target = [0, 0, 0] }) {
  engine.look.lights.manual('sun.direction');
  const sun = engine.lights.sun, t = new THREE.Vector3(target[0], target[1], target[2]);
  const toCam = new THREE.Vector3(camera[0] - t.x, 0, camera[2] - t.z).normalize();
  const el = THREE.MathUtils.degToRad(elevation);
  const h = toCam.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(azimuth));
  const dir = new THREE.Vector3(h.x * Math.cos(el), Math.sin(el), h.z * Math.cos(el)).normalize();
  sun.target.position.copy(t);
  sun.position.copy(t).addScaledVector(dir, 160);
  return dir;
}

/**
 * One shadow box fitted to a compact scene and centered on the sun's target (follow: false). biasCm is the depth bias in centimeters: three
 * adds bias in the shadow camera's 0-1 depth, i.e. a world offset of bias x (far - near). Other look.shadow keys (type, radius, blurSamples,
 * cascades, mapSize) pass through.
 * @param {any} engine
 * @param {{ extent: number, biasCm?: number, normalBias?: number, owner?: string } & Record<string, any>} o
 */
export function fitSunShadow(engine, { extent, biasCm = 2, normalBias = 0.02, owner = 'key-light', ...rest }) {
  const c = engine.lights.sun.shadow.camera;
  return engine.look.shadow.set({ follow: false, extent, bias: -biasCm / 100 / (c.far - c.near), normalBias, ...rest }, { owner });
}
