// Small helpers several core files need. One definition each, so "what counts as a plain object" and "how a dotted path is read" cannot drift apart.

/** A plain data object: { } or Object.create(null); not an array, class instance, three.js object or function */
export const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** Read a dotted path ('look.fog.color'); undefined as soon as a step is missing @param {any} obj @param {string} path */
export function getPath(obj, path) {
  let v = obj;
  for (const k of path.split('.')) v = v?.[k];
  return v;
}
