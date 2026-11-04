// @ts-check
// The picture's numbers: one place for colors, light levels and the tone curve. Neutral starting points; your game's come from its own picture.
import * as THREE from 'three';

export const TONE_MAPPING = THREE.AgXToneMapping;
export const EXPOSURE = 1;
/** Sky gradient, day and night; the fog takes the horizon color so far ground melts into the sky */
export const SKY = { day: { top: 0x8c8c8c, horizon: 0xb8b8b8 }, night: { top: 0x101010, horizon: 0x1c1c1c } };
export const FOG = { near: 180, far: 600 };
/** ambient: hemisphere intensity by day and by night; the night value is the floor that keeps the field readable under the lantern */
export const LIGHT = { sun: { color: 0xe7e7e7, intensity: 2 }, ambient: { sky: 0x9f9f9f, ground: 0x474747, day: 0.85, night: 0.7 } };
/** Half side of the sun's shadow box, meters: wide enough for the diagonal of the field */
export const SHADOW_BOX = 30;
export const GROUND = { earth: 0x857452, grass: 0x5f7a3c, noiseScale: 0.15 };
/** sway: wind amplitude, meters per meter of blade height (times engine.uniforms.uWind, which weather changes) */
export const GRASS = { root: 0x2f4a1c, tip: 0x8fb052, sway: 0.25 };
/** flicker: share of the glow that pulses, speed in radians per second */
export const LANTERN = { body: 0x3a2a18, glow: 0xffa040, strength: 3, flicker: 0.08, speed: 7 };
/** Post effect strength 0..1; 0 leaves the effect in the chain doing nothing */
export const SCANLINES = 0.08;

/** 0 night .. 1 day from uDaylight: the sun's height saturates early, so late afternoon still counts as full day @param {number} daylight */
export const dayLevel = daylight => Math.min(1, daylight / 0.15);
