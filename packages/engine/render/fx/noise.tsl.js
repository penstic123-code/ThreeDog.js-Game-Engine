// TSL hash() / noise() (GLSL NOISE_GLSL).
// TSL value noise: hash(vec2) / noise(vec2), line for line NOISE_GLSL (render/effects.js threedogHash / threedogNoise).
import { Fn, vec2, sin, dot, fract, floor, mix } from 'three/tsl';
import { HASH } from '../fxNumbers.js';

/** threedogHash */
export const hash = Fn(/** @param {[import('three/webgpu').Node<'vec2'>]} a */ ([p]) => fract(sin(dot(p, vec2(...HASH.dir))).mul(HASH.scale)));
/** threedogNoise: smooth value noise, 0-1 */
export const noise = Fn(/** @param {[import('three/webgpu').Node<'vec2'>]} a */ ([p]) => {
  const i = floor(p), f0 = fract(p), f = f0.mul(f0).mul(f0.mul(-2).add(3));
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), f.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), f.x), f.y);
});
