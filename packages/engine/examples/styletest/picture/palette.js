// @ts-check
// What this page adds to the picture it tests: the colors and surface values of the exhibits, the lamp, the environment lighting of ?env=1.
// The terrain's ground colors come with the picture under test.
import { COLORS as WORLD } from '../../world/picture/palette.js';
export { TERRAIN } from '../../world/picture/palette.js';

/** Colors of the exhibits, by material name (materials.js) */
export const COLORS = {
  crate: 0xb08850, crateBand: 0x8a6a3c, tableLeg: 0x6b4a32, bedFrame: 0x9a7a52,
  stone: 0x8f897d, plinth: 0x7a766e, metal: 0xc8ccd2,
  block: 0xd8604a, slab: 0xf0ece4, plaster: 0xe8e2d6, linen: 0xd8d4cc,
  glassBlue: 0xbfe3f0, glassAmber: 0xf0d8a8,
};
/** The room's shell, one merged mesh in vertex colors */
export const ROOM = { wall: 0xe8dcc4, trim: 0x6b4a32, floor: 0x9a8468, roof: 0xa4553c };
/** Metal only reads as metal with something to reflect: ?env=1 */
export const METAL = { metalness: 0.9, roughness: 0.3 };
export const GLASS = { shininess: 100, paneOpacity: 0.35, windowOpacity: 0.3 };
/** The room's pooled light; the body of the lamp is the picture's own lamp material */
export const LAMP = { color: WORLD.lampGlow, intensity: 5, distance: 9 };
/** ?env=1. hemi: the sky's soft light replaces part of the hemisphere's, or shadows would wash out. interval: seconds between rebuilds while the sky moves */
export const ENV = { intensity: 0.8, hemi: 0.6, ground: 0x4d5a34, interval: 1, lowInterval: 4 };
