// @ts-check
// Palette of the modular street: every value of the picture. The sets are demo values that prove the kit is style-free, not a recommended picture.
import { THREE } from 'threedog';

/** Slot colors per set. A plain number is the color; an object is the material's own properties */
export const SETS = {
  // the block-out: gray, so only silhouette and rhythm are left to judge
  gray: { wall: 0x9c9c9c, trim: 0xbdbdbd, roof: 0x6c6c6c, frame: 0x5c5c5c, glass: 0x3c4046, accent: 0x7c7c7c, awning: 0xc4c4c4, sign: 0xd2d2d2 },
  warm: { wall: 0xd9c7a3, trim: 0xf0e9da, roof: 0xa4553a, frame: 0x3f5b45, glass: 0x2e3d4f, accent: 0x7a4e33, awning: 0xb8433a, sign: 0xe0b54a },
  cool: { wall: 0x4a5260, trim: 0x9aa3ad, roof: 0x2c3038, frame: { color: 0x30c0d0, emissive: 0x1a6a74, emissiveIntensity: 0.6 },
    glass: { color: 0x1b2a33, emissive: 0x0e2a33, emissiveIntensity: 0.5 }, accent: 0xd07a30, awning: 0x2f8f9a, sign: 0xe6edf2 },
};
export const GROUND = 0x8c8c86;
export const BACKGROUND = 0x8c8c8c;
/** A strong, nearly even fill over a modest sun, on purpose: a block-out has to show every facade, so the sides facing away stay as readable as the lit ones */
export const LIGHT = {
  sun: { color: 0xffffff, intensity: 2, offset: [40, 80, 30] },
  ambient: { sky: 0xffffff, ground: 0x909090, intensity: 3.1 },
};
/** A 60 m box around what the camera looks at: most of a ten-building street, at about 3 cm a texel */
export const SHADOW = { extent: 30, far: 250, mapSize: 2048, lowMapSize: 1024, bias: -0.0001, normalBias: 0.03, radius: 3 };
export const TONE_MAPPING = THREE.AgXToneMapping;
export const EXPOSURE = 1;
