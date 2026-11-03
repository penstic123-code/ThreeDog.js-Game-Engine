// TSL uniforms(engine): engine.uniforms as nodes.
// TSL nodes over engine.uniforms (threedog/tsl): one cached set per engine, no second copy of any value.
// Why not uniform(engine.uniforms.uWind): three 0.187's uniform() does not accept a { value } object (it cannot infer a type and throws).
// So every value is a readBack(obj) node (below): read back from the engine object each render. Values live only in engine.uniforms: weather
// changing uWind or the calendar changing uFoliageTint moves GLSL and TSL together.
// Cached per uniforms object, not globally: two engines on one page each have their own time, wind and cloud cover (same reason as bindUniforms on the GLSL side).
import { uniform, renderGroup } from 'three/tsl';
import { codedError } from '../../core/errorHints.js';
import { boundUniforms } from '../engineUniforms.js';

/**
 * A uniform node that reads `read()` again on every render and uploads it in the shared render group. The one way the engine's TSL files turn a
 * { value } object (engine.uniforms, sky.uniforms, a patch's or a module's own) into a node.
 * Why the render group and not three's default object group: three 0.187 (NodeMaterialObserver.needsRefresh) refreshes a draw's object-group
 * buffer only while its material has a node property of its own (colorNode ...) or the object changed. A plain MeshBasicNodeMaterial /
 * MeshStandardNodeMaterial with a 'color' / 'normal' / 'output' / 'lighting' patch (code inside three's setup methods, no property), or a
 * scene.fogNode read by such materials, gets only its shared groups refreshed after the first draw: an object-group value then freezes at its
 * first-frame value while the GLSL side moves (tests/specs/uniform-refresh.mjs measured it: cloud cover, a patch's own number, the foliage tint).
 * The render group is uploaded once per render for every draw, which is also the right granularity: these values are one per engine / patch,
 * never per object. Vector / Color values are read back too, so a game that replaces the object (u.value = new Color()) is followed.
 * @param {() => any} read  current value (number, Vector2/3/4, Color)
 * @param {any} [initial]  value that fixes the uniform's type (default: read() now)
 * @returns {any} the uniform node; its node type (float, vec2/3/4, color) follows the value at run time, so it is not typed statically
 */
export function readBack(read, initial = read()) {
  return uniform(initial).setGroup(renderGroup).onRenderUpdate(read);
}

/** readBack over a { value } object: o.value every render @param {{ value: any }} o @returns {any} */
export const valueNode = o => readBack(() => o.value);

const CACHE = new WeakMap();   // engine.uniforms object -> { uTime: node, uWind: node, ... }

/** @param {Record<string, { value: any }>} U */
function nodesOf(U) {
  let n = CACHE.get(U);
  if (n) return n;
  n = {};
  for (const [k, o] of Object.entries(U)) n[k] = valueNode(o);
  CACHE.set(U, n);
  return n;
}

/**
 * The engine's uniforms as TSL nodes (same names as engine.uniforms: uTime, uWind, uCloud, uFoliageTint...), cached per engine
 * @param {{ uniforms: Record<string, { value: any }> }} engine
 * @returns {Record<string, any>}
 */
export function uniforms(engine) {
  if (!engine?.uniforms || typeof engine.uniforms !== 'object')
    throw codedError('tsl-misuse', 'threedog/tsl uniforms(engine): pass the engine (createEngine(...)), got ' + (engine === null ? 'null' : typeof engine));
  return nodesOf(engine.uniforms);
}

/**
 * The uniform nodes of the engine that owns the renderer building this shader (what wind / cloudShadow / season read).
 * Why look up by renderer at build time: GLSL functions read global uniforms and take no engine; the TSL signatures match them exactly, so the engine
 * is found from the renderer compiling the node (the same table as resolveUniform on the GLSL side).
 * @internal
 * @param {any} builder
 * @param {string} fn   name for the error message
 */
export function engineNodes(builder, fn) {
  const U = boundUniforms(builder?.renderer);
  if (!U) throw codedError('tsl-misuse', `threedog/tsl ${fn}(): the renderer compiling this material belongs to no engine, so there is no uTime / uWind / uCloud to read`);
  return nodesOf(U);
}
