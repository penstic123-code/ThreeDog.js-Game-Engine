// @ts-check
// Materials by name. Windows and lamp heads glow by the same level as the lamps: a lit window and a lit street must agree.
import { THREE } from 'threedog';
import { COLORS, LAMPS } from './palette.js';

export function createMaterials() {
  const flat = (/** @type {number} */ color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: COLORS.dark, emissive: COLORS.window, emissiveIntensity: 0, roughness: 0.9 });
  const head = new THREE.MeshStandardMaterial({ color: COLORS.dark, emissive: COLORS.lampHead, emissiveIntensity: 0, roughness: 0.9 });
  return {
    mat: { ground: flat(COLORS.ground), wall: flat(COLORS.wall), roof: flat(COLORS.roof), figure: flat(COLORS.figure), crate: flat(COLORS.crate), glass, head },
    /** @param {number} level the lamps' level, 0 off .. 1 on */
    update(level) { glass.emissiveIntensity = LAMPS.window * level; head.emissiveIntensity = LAMPS.head * level; },
  };
}
