// @ts-check
// Interior light palette: every value of the picture. Neutral numbers on a gray room; the colors of your game come from its own picture.
import { THREE } from 'threedog';

/** Surfaces of the room, by name */
export const COLORS = { wall: 0xb5b5b5, floor: 0x8f8f8f, ground: 0x8a8a8a, table: 0xa0a0a0, cabinet: 0x9c9c9c, sofa: 0xa6a6a6, stand: 0x777777, shade: 0xe8dccb };
export const ROUGHNESS = { surface: 0.9, ground: 0.95, shade: 1 };
/** azimuth: compass degrees from north (-Z), -90 = from the west. By night the same light is a weak moon */
export const SUN = { elevation: 32, azimuth: -90 + 12, intensity: 3.2, color: '#fff0dc' };
export const MOON = { elevation: 40, azimuth: -90 + 40, intensity: 0.12, color: '#8fa4d4' };
// the walls stop the sun but not these two, so indoors the ambient is turned down and the fill comes from bounce
export const AMBIENT = { outside: { hemi: 1.0, env: 0.3 }, inside: { hemi: 0.06, env: 0.04 } };
/** Hemisphere colors, blended by daylight */
export const HEMI = { day: { sky: '#b9b9b9', ground: '#4a4a4a' }, night: { sky: '#212121', ground: '#3a3a3a' } };
/** RectAreaLight: the sky seen through the window (nits-like units, Standard / Physical only) */
export const WINDOW_LIGHT = { color: '#cfe0ff', intensity: 2.2 };
/** ?fill=light: one unshadowed point light just above the sun patch, standing in for its bounce */
export const BOUNCE_LIGHT = { color: '#ffe2c0', intensity: 1.2, distance: 7, decay: 1, at: [-1.6, 0.4, 0.2] };
/** Exposure per zone, eased over `ease` seconds when the camera crosses the doorway (an eye adapting) */
export const EXPOSURE = { day: { outside: 1, inside: 1.9 }, night: { outside: 1.6, inside: 1 }, ease: 1.2 };
/** intensity in candela, physical falloff; a point light shadow is six renders, so only the light that needs it gets one. glow: the shade stays dim (no glare without bloom) */
export const LAMPS = {
  main: { intensity: 5, color: '#ffc58a', shadow: true, glow: 0.35 },
  side: { intensity: 2.5, color: '#ffb874', shadow: false, glow: 0.35 },
};
export const LAMP_SHADOW = { mapSize: 512, bias: -0.002, radius: 4 };
/** Fitted to the room: 8 m wide at 2048 px is 0.6 cm texels. Thin walls need a small normalBias, or light leaks along their inner edge; biasCm is the depth bias in centimeters */
export const SHADOW = { extent: 9, distance: 160, mapSize: { high: 2048, low: 1024 }, normalBias: 0.01, biasCm: 1, radius: 2, type: THREE.PCFShadowMap };
/** Sky colors by daylight; horizon is also the fog color */
export const SKY = { day: { top: '#d4d4d4', horizon: '#d4d4d4' }, night: { top: '#20242c', horizon: '#2a2a2a' } };
export const FOG = { near: 180, far: 600 };
export const TONE_MAPPING = THREE.AgXToneMapping;
