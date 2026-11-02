// Small shared helpers
import * as THREE from 'three';
import { codedError } from './errorHints.js';

// API convention: a position is one argument. The old (x, z, ...) form arrives as a number; throw with the fix (otherwise it silently becomes the origin)
const STRINGS = { position: 'A position must be passed as one argument: Vector3 / object / [x, y, z] / { x, z } (see the API conventions); got ' };
const POS_ERR = STRINGS.position;
// A horizontal position missing x or z (a 2-element [x, z] array reads z as undefined; { x, y } has no z) would become 0 silently
// (player.placeAt([10, 20]) at z = 0): say which part is missing and how to write it
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

/** Normalize a Vector3 / Object3D / [x, y, z] / { x, y, z } into a Vector3 */
export function vec3(v, out = new THREE.Vector3()) {
  if (!v) return out;
  if (typeof v !== 'object') throw codedError('options-object', POS_ERR + JSON.stringify(v), TypeError);
  if (v.isVector3) return out.copy(v);
  if (v.isObject3D) return out.copy(v.position);
  if (Array.isArray(v)) return out.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  return out.set(v.x ?? 0, v.y ?? 0, v.z ?? 0);
}

/** Get the horizontal coordinates [x, z] from a Vector3 / Object3D / [x, y, z] / { x, z } */
export function xzOf(v) {
  if (!v || typeof v !== 'object') throw codedError('options-object', POS_ERR + JSON.stringify(v), TypeError);
  if (v.isObject3D) v = v.position;
  const x = Array.isArray(v) ? v[0] : v.x, z = Array.isArray(v) ? v[2] : v.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw codedError('options-object', XZ_ERR + JSON.stringify(v), TypeError);
  return [x, z];
}

