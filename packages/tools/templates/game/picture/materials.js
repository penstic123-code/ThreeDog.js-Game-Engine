// @ts-check
// __NAME__ materials by name: other code asks for picture.materials.<name> and never builds its own, so a surface changes in this one place.
import { THREE } from 'threedog';
import { palette } from './palette.js';

export function createMaterials() {
  return { default: new THREE.MeshStandardMaterial(palette.material) };
}
