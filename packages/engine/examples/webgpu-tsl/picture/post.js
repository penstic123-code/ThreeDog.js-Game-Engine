// @ts-check
// Soft scanlines. On the WebGPU route a post effect is a node function: input is the picture so far, the return value the new color. A three.js
// Pass does not run on WebGPURenderer.
import { float, screenCoordinate, sin, uniform, vec4 } from 'three/tsl';
import { SCANLINES } from './palette.js';

/** Returns the strength as a uniform node: a write to its .value is live, with no rebuild. @param {any} engine */
export function createPost(engine) {
  const amount = uniform(SCANLINES);
  // 'ldr': after tone mapping, so the values are display colors 0..1
  engine.post.add((/** @type {any} */ input) => {
    const line = sin(screenCoordinate.y.mul(Math.PI)).mul(0.5).add(0.5);   // 0..1 every other device pixel row
    return vec4(input.rgb.mul(float(1).sub(amount.mul(line))), input.a);
  }, { name: 'scanlines', slot: 'ldr' });
  return { amount };
}
