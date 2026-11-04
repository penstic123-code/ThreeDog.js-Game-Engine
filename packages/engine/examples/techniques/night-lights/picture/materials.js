// @ts-check
// Materials by name. Windows, signs and lamp heads start dark: nightLights.js raises their emissive at night.
import { THREE } from 'threedog';
import { COLORS, ROUGHNESS } from './palette.js';

export function createMaterials() {
  const gray = (/** @type {number} */ color, roughness = ROUGHNESS.plain) => new THREE.MeshStandardMaterial({ color, roughness });
  const glowing = (/** @type {number} */ emissive) => new THREE.MeshStandardMaterial({ color: COLORS.glass, emissive, emissiveIntensity: 0, roughness: ROUGHNESS.glass });
  return {
    road: gray(COLORS.road, ROUGHNESS.road), curb: gray(COLORS.curb), wall: gray(COLORS.wall), pole: gray(COLORS.pole),
    windowWarm: glowing(COLORS.windowWarm), windowCool: glowing(COLORS.windowCool), signCyan: glowing(COLORS.signCyan), signPink: glowing(COLORS.signPink),
    // emissive stays black here: addLamp gives the head the lamp's own color
    head: new THREE.MeshStandardMaterial({ color: COLORS.head, roughness: ROUGHNESS.head, emissiveIntensity: 0 }),
  };
}
