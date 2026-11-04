// @ts-check
// Palette of the gray floor: neutral on purpose, so motion is the only thing to look at. The numbers for a game come from its own picture.
import { THREE } from 'threedog';

/** Materials by name */
export const COLORS = { floor: 0x7d7d7d, creature: 0xa0a0a0 };
/** Sun (the moon at night) and ambient, day and night ends; the time of day blends between them */
export const LIGHT = {
  sun: { day: 3, night: 0.4, dayColor: 0xffffff, nightColor: 0xa8a8a8 },
  ambient: { day: 1.4, night: 0.35, dayColor: 0xb9b9b9, nightColor: 0x212121, dayGround: 0x4a4a4a, nightGround: 0x3a3a3a },
};
/** Only the creature casts and it stays at the focus, so a small box does. The blur keeps the edge soft: a sharp shadow under a boxy body reads as black cut-outs, and it hides the texels moving as the box follows the focus */
export const SHADOW = { extent: 24, near: 1, far: 120, bias: -0.0002, normalBias: 0.04, radius: 3 };
/** Sky colors as they appear on screen: the gradient skips the tone curve */
export const SKY = { dayTop: 0xb5b5b5, dayHorizon: 0xbababa, nightTop: 0x252525, nightHorizon: 0x292929, radius: 400 };
export const TONE_MAPPING = THREE.AgXToneMapping;
