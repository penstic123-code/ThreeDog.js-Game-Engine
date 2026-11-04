// @ts-check
// Every value of the night street's picture. A neutral gray start: the street is gray so the lamps, windows and signs are the only color.
// The lamp, window and halo values live in nightLights.js, the technique this page shows; only what differs from them is here.
import { THREE } from 'threedog';

/** Surfaces of the demo street */
export const COLORS = { road: 0x5c5c60, curb: 0x8a8a8c, wall: 0x7c7c80, pole: 0x505054, glass: 0x18181a, head: 0x202020,
  windowWarm: 0xffb36b, windowCool: 0xc8d8ff, signCyan: 0x30e0ff, signPink: 0xff3a8a };
export const ROUGHNESS = { road: 0.8, plain: 0.9, glass: 0.3, head: 1 };

// The ambient at night sits well under the lamp pools: lights read only when the night is darker than they are
export const DAY = { top: 0xb4b4b4, horizon: 0xd4d4d4, sun: { color: 0xffffff, intensity: 3 }, hemi: { sky: 0xb9b9b9, ground: 0x909090, intensity: 1.2 } };   // ground: the sunlit road's bounce, what lifts the shaded facades
export const NIGHT = { top: 0x1a1a1a, horizon: 0x2a2a2a, sun: { color: 0xa8a8a8, intensity: 0.4 }, hemi: { sky: 0x212121, ground: 0x3a3a3a, intensity: 0.087 } };
export const FOG = { near: 180, far: 600 };
/** Sun height (uDaylight) from which it counts as full day: the sun of a real latitude never reaches 1 */
export const FULL_DAY_AT = 0.5;
/** 0 night .. 1 day from the sun's height, smooth at both ends so dusk has no kink @param {number} daylight */
export function dayLevel(daylight) {
  const t = Math.min(1, daylight / FULL_DAY_AT);
  return t * t * (3 - 2 * t);
}

/** The sun's shadow box covers the whole street, from the camera to the far end; the camera never moves, so it never has to follow */
export const SHADOW = { center: [0, 0, -50], extent: 90, near: 1, far: 260, distance: 120, normalBias: 0.04, mapSize: { low: 1024, high: 2048 } };

export const TONE_MAPPING = THREE.AgXToneMapping;
export const EXPOSURE = 1;

/** Bloom only for what is hotter than the threshold (linear): lamp heads at 2.5 bloom, windows at 0.6 never do */
export const BLOOM = { threshold: 1.4, strength: 0.45, radius: 0.35 };
/** Window and sign brightness where it differs from the technique's windowEmissive: cool windows are dimmer, signs hotter */
export const GLOW = { windowCool: 0.45, sign: 1.4 };
/** ?glare=1: the classic mistakes all at once. A threshold under 1 makes every lit wall and window glow, decay 0 floods the walls */
export const GLARE = { bloom: { threshold: 0.2, strength: 1.2, radius: 0.8 }, lights: { lampDecay: 0, windowEmissive: 3, headEmissive: 8 } };
