// Small shared core helpers. One definition each, so "what counts as a plain object" and "how a dotted path is read" cannot drift apart.

/** A plain data object: { } or Object.create(null); not an array, class instance, three.js object or function */
export const isPlainObject = v => isObject(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
/** Is v an object at all (class instances count; not null, not an array)? isPlainObject is the strict answer, for data that must stay plain */
export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Is o an options object a game passed (not a number, string, array, Three.js object, vector or color)? Data checks use it where a field may also be a name or a list */
export const isOptions = o => isObject(o) && !o.isObject3D && !o.isVector3 && !o.isColor;

/**
 * f() or null when it throws. For read-only reports (thing.explain and its module parts) that join several sources: one source that cannot
 * answer (an unknown template, a disposed part) leaves its field null instead of failing the whole report. Never for gameplay paths.
 */
export const orNull = f => { try { return f(); } catch { return null; } };

/** One value or a list, as a list @template T @param {T | T[]} v @returns {T[]} */
export const list = v => (Array.isArray(v) ? v : [v]);

/** A model name in model / lod position: 'pine' or ['flower', 0xff0000] (content data and vegetation.define take the same form) @param {any} m */
export const isModelName = m => typeof m === 'string' || Array.isArray(m) && typeof m[0] === 'string';

/** Is o root, or does it hang under root? @param {any} o @param {any} root */
export function isUnder(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }
/** Is o visible, itself and every parent (what traverseVisible checks)? @param {any} o */
export function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

/** Read a dotted path ('a.b.c'); undefined as soon as a step is missing @param {any} obj @param {string} path */
export function getPath(obj, path) {
  let v = obj;
  for (const k of path.split('.')) v = v?.[k];
  return v;
}
