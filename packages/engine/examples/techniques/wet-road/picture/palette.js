// @ts-check
// Palette of the wet street: neutral gray on purpose, so the only color is the warm light the wet road reflects. The numbers for a game come from its own picture.
import { THREE } from 'threedog';

/** Materials by name */
export const COLORS = { road: 0x606064, paint: 0xb8b8b4, curb: 0x8a8a8c, wall: 0x7c7c80, pole: 0x505054, glass: 0x202024, head: 0x303030 };
/** Only the road surfaces differ: they start rough, and the technique takes that down when they get wet. Anything not named here is ROUGHNESS.rest */
export const ROUGHNESS = { road: 0.85, paint: 0.7, rest: 0.9 };
/** Sun (the moon at night) and ambient. Weather takes the sun down fully but only a quarter of the ambient: an overcast sky scatters what it blocks */
export const LIGHT = {
  sun: { day: 3, night: 0.4, dayColor: 0xffffff, nightColor: 0xa8a8a8 },
  ambient: { day: 1.2, night: 0.35, dayColor: 0xa7a7a7, nightColor: 0x191919, ground: 0x4a4a4a, weatherShare: 0.25 },
};
/** Emitters. streak: linear brightness of the reflection, kept near the emitter's own glow so a reflection never outshines what it reflects */
export const LAMP = { color: 0xffc890, light: 80, distance: 20, glow: 3, streak: 1.6 };
export const WINDOW = { color: 0xffd9a0, glow: 0.8, streak: 0.35 };
/** Lamps reach full strength as daylight falls to 0 and are off above this */
export const LAMPS_OFF_ABOVE = 0.3;
export const SKY = { dayTop: 0x8c8c8c, dayHorizon: 0xb9b9b9, nightTop: 0x0c0c0c, nightHorizon: 0x1f1f1f };
/** Clear-weather fog distances; uWeatherFog shortens them in rain */
export const FOG = { near: 180, far: 600 };
/** Strength of the sky's reflection. The map stays the day sky, so at night this number is what makes the lamps matter */
export const ENV = { day: 1, night: 0.1 };
export const TONE_MAPPING = THREE.AgXToneMapping;
