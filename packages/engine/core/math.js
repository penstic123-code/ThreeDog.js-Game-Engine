// Small shared helpers (used by several modules)
import * as THREE from 'three';
import { codedError } from './errorHints.js';

// API convention: a position is one argument. The old (x, z, ...) form arrives as a number; throw with the fix (otherwise it silently becomes the origin)
const STRINGS = { position: 'A position must be passed as one argument: Vector3 / object / [x, y, z] / { x, z } (see the API conventions); got ' };
const POS_ERR = STRINGS.position;

/** Round to one decimal (describe, budget reports) @param {number} v @returns {number} */
export const r1 = v => Math.round(v * 10) / 10;

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
  return Array.isArray(v) ? [v[0] ?? 0, v[2] ?? 0] : [v.x ?? 0, v.z ?? 0];
}

