// @ts-check
// Materials by name: one maker per route, called with a part's name, so a column differs from the next only here.
import { THREE } from 'threedog';
import { rampTexture, toonMaterial, painterlyMaterial, stylizedPbrMaterial } from '../shading.js';
import { COLORS, PARTS, PBR_LIFT, PBR_ROUGHNESS, PAINTERLY, PLASTIC_ROUGHNESS, TOON_BANDS, TOON_RAMP, TOON_SHADE } from './palette.js';

export function createMaterials() {
  const ramp = rampTexture(TOON_RAMP);
  /** @type {Record<string, (part: keyof typeof PARTS) => THREE.Material>} */
  const routes = {
    'toon (ramp texture)': part => toonMaterial({ color: PARTS[part], ramp, ...TOON_SHADE }),
    'toon (smoothstep)': part => toonMaterial({ color: PARTS[part], ...TOON_BANDS, ...TOON_SHADE }),
    painterly: part => painterlyMaterial({ color: PARTS[part], ...PAINTERLY }),
    'stylized PBR': part => stylizedPbrMaterial({ color: PARTS[part], roughness: PBR_ROUGHNESS[part], lift: PBR_LIFT }),
    'plastic (mistake)': part => new THREE.MeshStandardMaterial({ color: PARTS[part], roughness: PLASTIC_ROUGHNESS, metalness: 0 }),
  };
  return { routes, ground: new THREE.MeshLambertMaterial({ color: COLORS.ground }) };
}
