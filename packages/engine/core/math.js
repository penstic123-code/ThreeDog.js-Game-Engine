// Small shared helpers
import * as THREE from 'three';
import { codedError } from './errorHints.js';

// API convention: a position is one argument. The old (x, z, ...) form arrives as a number; throw with the fix (otherwise it silently becomes the origin)
const STRINGS = { position: 'A position must be passed as one argument: Vector3 / object / [x, y, z] / { x, z } (see the API conventions); got ' };
const POS_ERR = STRINGS.position;
// A horizontal position missing x or z (a 2-element [x, z] array reads z as undefined; { x, y } has no z) would become 0 silently
// (player.placeAt([10, 20]) at z = 0): say which part is missing and how to write it
const MAX_COORD = 1e9;
const XZ_ERR = 'A horizontal position needs finite x and z: pass [x, y, z] (a 2-element [x, z] array does not work) or { x, z }; got ';

/** Round to one decimal (describe, budget reports) @param {number} v @returns {number} */
export const r1 = v => Math.round(v * 10) / 10;

/**
 * Show a value someone set (style post params, exposure, light intensity) without changing it: 4 significant digits, never fewer than
 * the integer part. r1 is for measurements (positions, ms); a set value rounded to one decimal misreports it (bloom 0.25 read as 0.3,
 * contrast 1.12 as 1.1, R5), and a reader then "fixes" a value that was already right. 4 digits only drops float noise (0.30000000000000004).
 * @param {number} v @returns {number}
 */
export const rv = v => (Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(Math.max(4, Math.floor(Math.log10(Math.abs(v))) + 1))) : v);

/** An angle in radians as the same turn in -PI..PI; of a difference, the short way round @param {number} a @returns {number} */
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Normalize a Vector3 / Object3D / [x, y, z] / { x, y, z } into a Vector3 */
export function vec3(v, out = new THREE.Vector3()) {
  if (!v) return out;
  if (typeof v !== 'object') throw codedError('options-object', POS_ERR + JSON.stringify(v), TypeError);
  if (v.isVector3) return out.copy(v);
  if (v.isObject3D) return out.copy(v.position);
  if (Array.isArray(v)) return out.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  return out.set(v.x ?? 0, v.y ?? 0, v.z ?? 0);
}

/** The height a position names, or undefined when it names none ({ x, z }) */
export function yOf(v) {
  if (v?.isObject3D) v = v.position;
  const y = Array.isArray(v) ? v[1] : v?.y;
  return Number.isFinite(y) ? y : undefined;
}

/** Get the horizontal coordinates [x, z] from a Vector3 / Object3D / [x, y, z] / { x, z } */
export function xzOf(v) {
  if (!v || typeof v !== 'object') throw codedError('options-object', POS_ERR + JSON.stringify(v), TypeError);
  if (v.isObject3D) v = v.position;
  const x = Array.isArray(v) ? v[0] : v.x, z = Array.isArray(v) ? v[2] : v.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw codedError('options-object', XZ_ERR + JSON.stringify(v), TypeError);
  // Far past float precision (render coordinates are 32-bit): not a place. Worse, the chunk loops (`for (cx = floor(x / size); ...; cx++)`) never advance once x / size passes 2^53, a silent freeze (found by fuzz: pos z = -3.6e178)
  if (Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD) throw codedError('options-object', `A horizontal position must lie within ±${MAX_COORD} (far past that nothing renders or streams correctly, and chunk loops stop advancing); got ` + JSON.stringify(v), RangeError);
  return [x, z];
}

