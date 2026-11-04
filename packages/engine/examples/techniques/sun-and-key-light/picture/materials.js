// @ts-check
// Materials by name. Rough gray, so a form reads by its light; the ball is a little glossier to show the sun's highlight.
import { THREE } from 'threedog';
import { COLORS } from './palette.js';

export function createMaterials() {
  const flat = (/** @type {number} */ color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
  return { mat: { ground: flat(COLORS.ground, 0.95), cube: flat(COLORS.cube), ball: flat(COLORS.ball, 0.6), drum: flat(COLORS.drum), pole: flat(COLORS.pole), figure: flat(COLORS.figure), small: flat(COLORS.small) } };
}
