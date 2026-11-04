// @ts-check
// Materials by name. An emitter is a black surface with an emissive: rc2d.js reads emissive * emissiveIntensity every frame, so a write here is
// all it takes for the light to follow. The flickering lamp has its own material, the other lamps keep theirs steady.
import { THREE } from 'threedog';
import { COLORS, FLICKER, GLOW } from './palette.js';

export function createMaterials() {
  const flat = (/** @type {number} */ color) => new THREE.MeshLambertMaterial({ color });
  const glow = (/** @type {number} */ emissive, /** @type {number} */ emissiveIntensity) =>
    new THREE.MeshLambertMaterial({ color: COLORS.glowBase, emissive, emissiveIntensity });
  const flicker = glow(COLORS.lamp, GLOW.lamp), [fast, slow] = FLICKER.rates;
  return {
    mat: { floor: flat(COLORS.floor), wall: flat(COLORS.wall), lamp: glow(COLORS.lamp, GLOW.lamp), flicker,
      window: glow(COLORS.window, GLOW.window), neon: glow(COLORS.neon, GLOW.neon) },
    /** @param {number} now seconds */
    update(now) { flicker.emissiveIntensity = GLOW.lamp * (1 - FLICKER.depth + FLICKER.depth * Math.sin(now * fast) * Math.sin(now * slow)); },
  };
}
