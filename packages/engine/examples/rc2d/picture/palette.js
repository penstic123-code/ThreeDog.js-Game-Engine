// @ts-check
// Every value of the rc2d demo's picture. A street at night: one dim ambient, and the emissive shapes rc2d.js turns into light.
import { THREE } from 'threedog';

/** The scene's own light. rc2d divides by it to get albedo back, so the same number feeds the light and the cascades */
export const AMBIENT = 0.12;
/** The three.js layer rc2d.js looks at: emitters and occluders are on it, the floor is not, so the floor only receives light */
export const LIGHT_LAYER = 5;
export const COLORS = { floor: 0x8a8a90, wall: 0x6d6258, glowBase: 0x000000, lamp: 0xffb060, window: 0x7fb0ff, neon: 0xff40c0 };
/** emissiveIntensity of each emitter: this is what sets how far its light reaches */
export const GLOW = { lamp: 6, window: 2, neon: 3 };
/** The flickering lamp: its intensity swings by depth around 1 - depth, as the product of two sines at these rates */
export const FLICKER = { depth: 0.2, rates: [9, 2.3] };
export const TONE_MAPPING = THREE.AgXToneMapping;
export const EXPOSURE = 1;
