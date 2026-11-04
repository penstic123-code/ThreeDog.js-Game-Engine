// @ts-check
// Plain-picture materials by name. Flat-illustration technique: MeshLambertMaterial with a flat color, plus an emissive copy of that same color whose
// strength rises at night. Why: in a flat illustration a night facade is still its own color, only darker and warmer; light from the scene alone would turn it black.
import { THREE } from '../../../index.js';
import { PALETTE, nightOf } from './palette.js';

export function createMaterials() {
  const mat = /** @type {Record<keyof typeof PALETTE, THREE.MeshLambertMaterial>} */ ({});
  for (const [k, hex] of Object.entries(PALETTE)) mat[/** @type {keyof typeof PALETTE} */ (k)] = new THREE.MeshLambertMaterial({ color: hex, emissive: hex, emissiveIntensity: 0 });
  // things that glow by themselves keep a fixed emissive; the rest get the night base below
  const glowing = new Set(['windowLit', 'lamp']);
  mat.windowLit.emissiveIntensity = 1;
  const lampHead = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  return {
    mat: { ...mat, lampHead },
    /** @param {any} signals engine.uniforms */
    update(signals) {
      const night = nightOf(signals.uDaylight.value);
      for (const [k, m] of Object.entries(mat)) if (!glowing.has(k)) m.emissiveIntensity = 0.2 * night;
      mat.windowLit.emissiveIntensity = 0.25 + 0.85 * night;
      lampHead.color.set(night > 0.5 ? 0xfff6dc : PALETTE.lamp);
    },
  };
}
