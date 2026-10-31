// Engine uniforms (helper of patches.js): a patch uniform that is the engine's own (time, cloud cover...), resolved per renderer when a program compiles.
// An engine uniform carries its name under this key; at compile time it is swapped for the same-named uniform of the engine
// that owns the renderer (bindUniforms), and a renderer without an engine keeps the object it was given.
const ENGINE_UNIFORM = Symbol.for('threedog.engineUniform');
const BOUND = new WeakMap();   // renderer -> its engine's uniforms
/**
 * A uniform object { value } tagged as the engine uniform `name` (resolved per renderer at compile time)
 * @internal
 * @param {string} name
 * @param {any} value
 * @returns {{ value: any }}
 */
export function engineUniform(name, value) { return { value, [ENGINE_UNIFORM]: name }; }
/**
 * Programs this renderer compiles from now on read these engine uniforms (called once per engine)
 * @internal
 * @param {any} renderer
 * @param {Record<string, { value: any }>} uniforms
 * @returns {void}
 */
export function bindUniforms(renderer, uniforms) { BOUND.set(renderer, uniforms); }
export const sameUniform = (a, b) => a === b || (!!a[ENGINE_UNIFORM] && a[ENGINE_UNIFORM] === b[ENGINE_UNIFORM]);
export const resolveUniform = (u, renderer) => (u?.[ENGINE_UNIFORM] && renderer && BOUND.get(renderer)?.[u[ENGINE_UNIFORM]]) || u;
