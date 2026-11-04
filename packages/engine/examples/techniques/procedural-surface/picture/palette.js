// @ts-check
// Surface demo palette: the colors and the values each surface tool takes. Sizes are in screen pixels on purpose: the shot decides the scale.
import { THREE } from 'threedog';

export const COLORS = { wall: 0xd6d0c6, roof: 0x8c847d, crate: 0xb7a58f, ground: 0x8f8d88, sky: 0xa3acb6, shade: 0xe6e6e6 };
export const NOISE = { cellPx: 14, strength: 0.5 };   // cells of 14 screen pixels: reads as plaster patches at this distance
export const CLOSE_UP_SCALE = 40;                     // repeats per meter an artist picks 1 m from the wall; invisible at 15 m
export const BRUSH = { cellPx: 120, strength: 0.5 };  // one brush tile over ~120 px, so single strokes are ~10 px
export const CAVITY = { strength: 0.9, radius: 0.9 };
export const WEAR = { width: 0.1, strength: 0.7 };
export const JITTER = { hue: 0.03, value: 0.12 };
/** sun: offset from its target (direction only); ambient sets how dark shade gets, and it is all the fill there is */
export const LIGHT = { sun: [30, 40, 26], sunIntensity: 3.2, ambient: 2 };
export const FOG = { near: 30, far: 90 };
export const TONE_MAPPING = THREE.AgXToneMapping;
