// @ts-check
// Outlines demo palette: the colors and key values of this page. Values sit close on purpose, so the silhouette is the problem the routes solve.
import { THREE } from 'threedog';

export const COLORS = { object: 0xb3b0aa, wall: 0xa9a7a2, ground: 0xa4a29d, roof: 0x9a958e, sky: 0xa3acb6, shade: 0xe6e6e6 };
/** One line color for every route, so only the method differs */
export const LINE = 0x24242c;
export const OUTLINE = { thickness: 1.5, strength: 0.9 };
/** thickness: meters for 'world', device pixels for 'screen' */
export const HULL = { world: { thickness: 0.035, units: /** @type {'world'} */ ('world'), color: LINE }, screen: { thickness: 2.5, units: /** @type {'screen'} */ ('screen'), color: LINE } };
export const RIM = { color: 0xe4ecff, strength: 1.2, power: 2.5, shadowSide: 0.5 };
/** sun: offset from its target (direction only), high enough that the turned side of a capsule stays a mid-tone; ambient sets how dark shade gets, and it is all the fill there is */
export const LIGHT = { sun: [40, 80, 30], sunIntensity: 3.2, ambient: 2.2 };
export const FOG = { near: 30, far: 90 };
// a soft curve keeps object, wall and ground close in value, which is the problem this page is about
export const TONE_MAPPING = THREE.AgXToneMapping;
