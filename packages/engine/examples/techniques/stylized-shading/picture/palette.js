// @ts-check
// Shading demo palette: neutral bases, the same in every column so only the shading differs, and the values each route takes.
import { THREE } from 'threedog';

/** sRGB hex per model part; ground and sky around the columns */
export const PARTS = { wall: 0xc2bcb2, roof: 0x7d756e, body: 0xb0b2b8, ball: 0xaaa59d, tile: 0x96948f };
export const COLORS = { ground: 0x6c6a66, sky: 0xa3acb6, shade: 0xb0b0b0 };
export const TOON_RAMP = /** @type {[number, number][]} */ ([[0, 0.0], [0.12, 0.45], [0.55, 0xfff2df]]);   // [sun share where a band starts, light]: shade, mid band, a warm lit band
export const TOON_BANDS = { bands: 3, soft: 0.02 };
export const TOON_SHADE = { shade: 0x6a78b8, shadeStrength: 0.35 };   // the dark band leans blue-violet
export const PAINTERLY = { wrap: 0.5, terminator: 0xff7a45, terminatorStrength: 0.35, shadow: 0x5a6fb0, shadowStrength: 0.45 };
export const PBR_ROUGHNESS = { wall: 0.9, roof: 0.75, body: 0.6, ball: 0.45, tile: 0.95 };   // designed per surface, never one value for all
export const PBR_LIFT = 0.12;
export const PLASTIC_ROUGHNESS = 0.2;   // the mistake: one low roughness everywhere
/** sun: offset from its target (direction only), from the right and behind, so every model shows a lit side, a turn and a shaded side. ambient sets how dark shade
 *  gets; room: the reflection Standard materials get, which is what the plastic column's hot spots are made of (strong, it flattens PBR shade) */
export const LIGHT = { sun: [36, 44, -8], sunIntensity: 3.2, ambient: 0.35, room: 0.35 };
export const FOG = { near: 30, far: 90 };
export const TONE_MAPPING = THREE.AgXToneMapping;
