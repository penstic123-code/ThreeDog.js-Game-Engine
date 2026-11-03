// Distance fade for near-only vegetation (grass, flowers, pebbles, debris ... any species that only exists close to the player).
// Why: such species are placed per chunk ring (maxRing), so without this the ring edge is a visible line that pops in and out chunk by chunk.
// How: instances shrink toward their own base over a band [start, end] metres from the player, in the vertex shader of the species' own material:
// no extra draw call or shader program per frame (the patch is part of the material's one program), the sway of the wind patch is scaled with it, and the
// shadow pass shrinks the same way. The band ends where the ring can first end, so a clump is already gone when its chunk drops out.
import * as THREE from 'three';
import { codedError } from '../../core/errorHints.js';

const PARS = 'uniform vec2 uNearFade; uniform vec3 uNearFadeCenter;';
const VERTEX = `
  {
    vec4 ipo = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_INSTANCING
      ipo = instanceMatrix * ipo;
    #endif
    vec3 ip = (modelMatrix * ipo).xyz;
    transformed *= 1.0 - smoothstep(uNearFade.x, uNearFade.y, distance(ip.xz, uNearFadeCenter.xz));
  }`;

/**
 * The fade band of a species in metres from the player.
 * @param {false | { start?: number, end?: number } | undefined} fade the species' fade option (undefined = default for near-only species)
 * @param {boolean} nearOnly
 * @param {number} maxRing rings drawn around the player
 * @param {number} chunk chunk size in metres
 * @returns {{ start: number, end: number } | null} null = no fade
 */
export function fadeBand(fade, nearOnly, maxRing, chunk) {
  if (fade === false || (fade === undefined && !nearOnly)) return null;
  // the ring is guaranteed to reach maxRing x chunk in every direction (the player may stand at a chunk edge), so end the fade there
  const end = fade?.end ?? maxRing * chunk, start = fade?.start ?? end * 0.65;
  if (!(end > 0) || !(start >= 0) || start >= end) throw codedError('vegetation-option', `vegetation fade: need 0 <= start < end (metres), got start ${start}, end ${end}`);
  return { start, end };
}

/** The shader patch plus the uniform objects (move center each frame) @param {{ start: number, end: number }} band */
export function nearFadePatch(band) {
  const uniforms = { uNearFade: { value: new THREE.Vector2(band.start, band.end) }, uNearFadeCenter: { value: new THREE.Vector3() } };
  // tsl: the same line for WebGPURenderer (ctx.position is object space before instancing, objectOrigin() is the GLSL `ip`)
  const tsl = c => {
    const T = c.tsl, band = c.fx.patchUniform(uniforms.uNearFade), center = c.fx.patchUniform(uniforms.uNearFadeCenter);
    return c.position.mul(T.float(1).sub(T.smoothstep(band.x, band.y, T.distance(c.fx.objectOrigin().xz, center.xz))));
  };
  return { patch: { name: 'nearFade', cacheKey: 'v1', shadow: true, uniforms, slot: 'position', pars: PARS, glsl: VERTEX, tsl }, uniforms };
}
