// @ts-check
// Palette of the gray yard: neutral on purpose, so the only thing to judge is whether small objects sit. The numbers for a game come from its own picture.
import { THREE } from 'threedog';

/** Materials by name */
export const COLORS = { ground: 0x9a9a9a, tableTop: 0xb0b0b0, tableLeg: 0x8c8c8c, cup: 0xd0d0d0, ball: 0xc4c4c4, block: 0xc8c8c8, crate: 0xb4b4b4, figure: 0xa8a8a8, wall: 0xbcbcbc };
/** Sun (the moon at night) and ambient. Ambient is one intensity with the time of day in its color, so whoever scales the fill never fights the cycle */
export const LIGHT = {
  sun: { day: 3, night: 0.4, dayColor: 0xffffff, nightColor: 0xa8a8a8 },
  ambient: { intensity: 1.2, dayColor: 0xb9b9b9, nightColor: 0x212121, ground: 0x4a4a4a },
};
/**
 * The sun's shadow before the technique: loose settings sized for a 140 m open world, not for a cup. They are the picture of ?mode=float and what
 * remove() returns to. 70 m on a 2048 map is 6.8 cm a texel, and 4 cm of normal bias suits that texel, not a 10 cm object.
 */
export const LOOSE_SHADOW = { extent: 70, mapSize: 2048, normalBias: 0.04, bias: -0.00005 };
export const TONE_MAPPING = THREE.AgXToneMapping;
