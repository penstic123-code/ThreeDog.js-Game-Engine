// @ts-check
// Materials by name, plain Lambert: the ground plus one material per kit slot, from one set of the palette.
import { THREE } from 'threedog';
import { GROUND, SETS } from './palette.js';

/** @param {string} set a name in SETS */
export function createMaterials(set) {
  const slots = SETS[/** @type {keyof typeof SETS} */ (set)];
  if (!slots) throw new Error(`modular-building: unknown set "${set}" (${Object.keys(SETS).join(', ')})`);
  const mat = /** @type {Record<string, THREE.MeshLambertMaterial>} */ ({ ground: new THREE.MeshLambertMaterial({ color: GROUND }) });
  for (const [name, v] of Object.entries(slots)) mat[name] = new THREE.MeshLambertMaterial(typeof v === 'number' ? { color: v } : v);
  return { mat };
}
