// @ts-check
// Grade: one step on the finished picture, before the character layer: pixels lose color as they get bright, and dark pixels keep theirs. Why here and not in the palette:
// a surface's lit and shaded parts are one albedo times light, so no surface color can be paler in the sun and richer in the shade by itself.
// It chains into the node graph with no extra pass. Delete the engine.post.add line in index.js and the palette's colors show as written.
import { dot, mix, smoothstep, vec3, vec4 } from 'three/tsl';
import { palette } from './palette.js';

export const grade = {
  name: 'grade', slot: 'ldr',
  /** @param {any} input the picture so far, display color */
  node(input) {
    const { from, to, amount } = palette.grade, luma = dot(input.rgb, vec3(0.2126, 0.7152, 0.0722));
    return vec4(mix(input.rgb, vec3(luma), smoothstep(from, to, luma).mul(amount)), input.a);
  },
};
