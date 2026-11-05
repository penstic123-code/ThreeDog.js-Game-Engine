// TSL wind() (GLSL threedogWind).
// TSL wind: wind(position, origin, amplitude) -> vec3, line for line GLSL threedogWind (render/effects.js threedog_wind).
// Same parameters as GLSL: position = the object-space vertex before the instance transform (positionGeometry in TSL, not positionLocal: positionNode
// runs after the instance transform), origin = the object's world origin (objectOrigin()), amplitude in metres per metre of height; returns an object-space offset
// (with rotated / scaled instances, pass it through instanceOffset() (threedog/tsl) before adding to positionLocal, since GLSL adds it before the instance transform).
// Uniforms are not parameters: the GLSL version reads the global uTime / uWind / uWindFreq; here the engine is found at build time from the compiling renderer.
import { Fn, vec3, sin, max } from 'three/tsl';
import { engineNodes } from './uniforms.tsl.js';
import { WIND as N } from '../fxNumbers.js';

/** @template {string} T @typedef {import('three/webgpu').Node<T>} Nd */

/** Object-space sway offset: higher vertices sway more, each object gets its phase from its own world origin */
export const wind = Fn(/** @param {[Nd<'vec3'>, Nd<'vec3'>, Nd<'float'>]} a @param {any} builder */ ([position, origin, amplitude], builder) => {
  /** @type {{ uTime: Nd<'float'>, uWind: Nd<'float'>, uWindFreq: Nd<'float'> }} */
  const u = engineNodes(builder, 'wind');
  const wt = u.uTime.mul(u.uWindFreq);
  const sw = sin(wt.mul(u.uWind.mul(N.gust).add(N.speed)).add(origin.x.mul(N.phase[0])).add(origin.z.mul(N.phase[1]))).mul(N.weight)
    .add(sin(wt.mul(N.speed2).add(origin.x.mul(N.phase2[0])).add(origin.z.mul(N.phase2[1]))).mul(N.weight2));
  const k = max(position.y, 0).mul(amplitude).mul(u.uWind);
  return vec3(sw.mul(k).add(k.mul(N.lean).mul(u.uWind.sub(1))), 0, sw.mul(k).mul(N.side));
});
