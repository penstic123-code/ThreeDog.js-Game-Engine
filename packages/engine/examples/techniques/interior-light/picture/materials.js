// @ts-check
// Materials by name. Standard everywhere, since a RectAreaLight lights nothing else. Each lamp's shade glows in its own light's color.
import { THREE } from 'threedog';
import { COLORS, LAMPS, ROUGHNESS } from './palette.js';

export function createMaterials() {
  const flat = (/** @type {number} */ color, roughness = ROUGHNESS.surface) => new THREE.MeshStandardMaterial({ color, roughness });
  const shade = (/** @type {{ color: string, glow: number }} */ l) => new THREE.MeshStandardMaterial({ color: COLORS.shade, emissive: l.color, emissiveIntensity: l.glow, side: THREE.DoubleSide, roughness: ROUGHNESS.shade });
  return {
    mat: { wall: flat(COLORS.wall), floor: flat(COLORS.floor), ground: flat(COLORS.ground, ROUGHNESS.ground), table: flat(COLORS.table), cabinet: flat(COLORS.cabinet),
      sofa: flat(COLORS.sofa), stand: flat(COLORS.stand), shade: { main: shade(LAMPS.main), side: shade(LAMPS.side) } },
  };
}
