// @ts-check
// Materials by name, every one plain Standard: the road needs roughness for the technique, and the rest must answer the same lights. Windows and lamp
// heads glow by the lamps' level, so a lit head and a lit street agree.
import { THREE } from 'threedog';
import { COLORS, LAMP, ROUGHNESS, WINDOW } from './palette.js';

export function createMaterials() {
  const gray = (/** @type {number} */ color, roughness = ROUGHNESS.rest) => new THREE.MeshStandardMaterial({ color, roughness });
  const glass = new THREE.MeshStandardMaterial({ color: COLORS.glass, emissive: WINDOW.color, emissiveIntensity: 0 });
  const head = new THREE.MeshStandardMaterial({ color: COLORS.head, emissive: LAMP.color, emissiveIntensity: 0 });
  return {
    mat: { road: gray(COLORS.road, ROUGHNESS.road), paint: gray(COLORS.paint, ROUGHNESS.paint), curb: gray(COLORS.curb), wall: gray(COLORS.wall), pole: gray(COLORS.pole), glass, head },
    /** @param {number} level the lamps' level, 0 off .. 1 on */
    update(level) { glass.emissiveIntensity = WINDOW.glow * level; head.emissiveIntensity = LAMP.glow * level; },
  };
}
