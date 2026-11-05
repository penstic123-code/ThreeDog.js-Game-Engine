// @ts-check
// Paint: the one texture language. Everything on screen is flat color fields with a clean, wobbling edge between them: leaves, stone, ground,
// water bands, clouds. There is no high-frequency noise, no grain and no photo detail. Why: a surface with one kind of mark reads as one world,
// and mixing marks (soft gradients here, noise there) is what makes a generated scene look assembled from parts.
// To change the language, change cut() and blotch() here: a hard stripe, dots or a hand-drawn hatch instead of blobs. Everything follows.
import { MeshToonNodeMaterial } from 'three/webgpu';
import { color, float, fwidth, mix, mx_noise_float, positionLocal, smoothstep } from 'three/tsl';
import { rampTexture } from 'threedog';
import { celLighting } from 'threedog/tsl';
import { palette } from './palette.js';

/** A smooth blob field around 0, about -0.5..0.5: the shape of every patch. The second sample bends the first, so the edges are not plain noise contours.
 *  @param {any} p position node, meters @param {any} size meters across a blob @returns {any} */
export function blotch(p, size) {
  const q = p.div(size);
  return mx_noise_float(q.add(mx_noise_float(q.mul(1.7)).mul(0.35)));
}

/** 0 below `at`, 1 above it, with an edge one pixel wide at any distance: far away it fades to the average instead of shimmering.
 *  @param {any} field @param {any} at @returns {any} */
export function cut(field, at) {
  const w = fwidth(field).max(0.0001);
  return smoothstep(float(at).sub(w), float(at).add(w), field);
}

/** A lit material with the ramp's flat bands. colorNode: what the surface is before light. @param {any} colorNode @returns {any} */
export function celMaterial(colorNode) {
  const mat = new MeshToonNodeMaterial({ gradientMap: rampTexture(palette.ramp) });
  mat.setupLightingModel = celLighting;   // colored bands; a cast shadow takes the same flat color as the turned-away side
  mat.colorNode = colorNode;
  return mat;
}

/** Two flat colors by the blob field. positionLocal: the patches stay on an object that moves.
 *  @param {{ base: number, patch: number, size: number, cover: number }} s @param {any} [p] @returns {any} */
export const patches = (s, p = positionLocal) => mix(color(s.base), color(s.patch), cut(blotch(p, s.size), s.cover));
