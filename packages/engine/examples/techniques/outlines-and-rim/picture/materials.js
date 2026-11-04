// @ts-check
// Materials by name. The rim column has its own two: same colors, plus the edge light the column shows.
import { THREE, applyEffects } from 'threedog';
import { rimPatch } from '../outlines.js';
import { COLORS, RIM } from './palette.js';

export function createMaterials() {
  const lit = (/** @type {number} */ color) => new THREE.MeshLambertMaterial({ color });
  const rim = (/** @type {number} */ color) => applyEffects(lit(color), { patches: [rimPatch(RIM)] });
  return { object: lit(COLORS.object), roof: lit(COLORS.roof), wall: lit(COLORS.wall), ground: lit(COLORS.ground), rimObject: rim(COLORS.object), rimRoof: rim(COLORS.roof) };
}
