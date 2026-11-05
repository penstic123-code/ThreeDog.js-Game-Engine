// @ts-check
// Paint: the one texture language of the scene. Every surface is a soft field: two near colors drifting into each other over large, blurred patches, with no hard
// edge, no speck and no fine noise. Why: the character layer on top is the picture's only fine texture. Detail painted below it fights the glyphs and turns to flicker.
// To change the language, change drift() and fade() here. If you turn the character layer off for good, this is where fine marks can come back.
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { color, float, mix, mx_noise_float, positionWorld, smoothstep } from 'three/tsl';

/** A soft blob field around 0, about -0.5..0.5. The second sample bends the first, so patches do not look like plain noise contours.
 *  @param {any} p position node, meters @param {any} size meters across a patch @returns {any} */
export function drift(p, size) {
  const q = p.div(size);
  return mx_noise_float(q.add(mx_noise_float(q.mul(0.6)).mul(0.5)));
}

/** 0 below `at`, 1 above it, across a wide soft band. @param {any} field @param {any} at @param {any} [width] @returns {any} */
export const fade = (field, at, width = 0.25) => smoothstep(float(at).sub(width), float(at).add(width), field);

/** Two near colors by the soft field. @param {number} a @param {number} b @param {any} size meters @param {any} [p] @returns {any} */
export const field = (a, b, size, p = positionWorld) => mix(color(a), color(b), fade(drift(p, size), 0));

/** The lit material every surface shares: plain diffuse, no shine. colorNode: what the surface is before light. @param {any} colorNode @returns {any} */
export function softMaterial(colorNode) {
  const mat = new MeshLambertNodeMaterial();
  mat.colorNode = colorNode;
  return mat;
}
