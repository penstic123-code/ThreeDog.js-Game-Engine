// @ts-check
// Materials by name, plain Lambert: matte gray shows a shadow with nothing else to look at.
import { THREE } from 'threedog';
import { COLORS } from './palette.js';

/** @param {{ bakedAO: boolean }} o bakedAO: the crates read the vertex colors groundStatic baked */
export function createMaterials({ bakedAO }) {
  const mat = /** @type {Record<keyof typeof COLORS, THREE.MeshLambertMaterial>} */ ({});
  for (const [name, color] of Object.entries(COLORS)) mat[/** @type {keyof typeof COLORS} */ (name)] = new THREE.MeshLambertMaterial({ color });
  mat.crate.vertexColors = bakedAO;
  return { mat };
}
