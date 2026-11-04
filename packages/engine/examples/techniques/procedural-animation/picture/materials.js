// @ts-check
// Materials by name, plain Lambert: matte gray keeps highlights from competing with the motion.
import { THREE } from 'threedog';
import { COLORS } from './palette.js';

export function createMaterials() {
  const mat = /** @type {Record<keyof typeof COLORS, THREE.MeshLambertMaterial>} */ ({});
  for (const [name, color] of Object.entries(COLORS)) mat[/** @type {keyof typeof COLORS} */ (name)] = new THREE.MeshLambertMaterial({ color });
  return { mat };
}
