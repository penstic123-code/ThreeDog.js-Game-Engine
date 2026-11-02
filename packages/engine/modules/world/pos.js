// Position read / write for world: shared by add / move / query. A wrong position (a Vector3 used as an array, [x, z] with only two numbers) silently becomes NaN and null in the save,
// so dev builds throw on the spot and say how to fix it.
import { DEV } from '../../core/validate.js';
import { codedError } from '../../core/errorHints.js';

const STRINGS = {
  arr: '{fn}: an array position must be [x, y, z] (three numbers); for a horizontal position only, write { x, z }',
  nan: '{fn}: position is not a valid number (got {got}). Common cause: a Vector3 used as an array (v[0] is undefined); write v.x / v.z, or pass the Vector3 itself',
};

/** Write position v (Vector3 / object / [x, y, z] / { x, z }) into p; y stays unchanged if omitted @internal */
export function putPos(fn, v, p) {
  const arr = Array.isArray(v), o = v.isObject3D ? v.position : v;
  if (DEV && arr && v.length !== 3) throw codedError('bad-position', STRINGS.arr.replace('{fn}', fn));
  const x = arr ? v[0] : o.x, y = arr ? v[1] : o.y ?? p.y, z = arr ? v[2] : o.z;
  // check before writing: a bad position leaves no half-written NaN in the data
  if (DEV && !(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) throw codedError('bad-position', STRINGS.nan.replace('{fn}', fn).replace('{got}', JSON.stringify(v)));
  p.x = x; p.y = y; p.z = z;
}
/** Query center: objects use position, arrays are [x, y, z], others (Vector3 / { x, z }) are used as is, no allocation @internal */
export const centerOf = c => c.isObject3D ? c.position : Array.isArray(c) ? { x: c[0], z: c[2] } : c;
