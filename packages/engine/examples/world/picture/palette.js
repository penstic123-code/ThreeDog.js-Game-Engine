// @ts-check
// The open world's palette: every color and key value of the picture, one copy; the other files here read it.
import { THREE } from '../../../index.js';

export const TONE_MAPPING = THREE.ACESFilmicToneMapping;
export const EXPOSURE = 1.05;

/** The day: [time 0-1, zenith, horizon (= fog), sun color (the moon at night), sun intensity, ambient intensity] */
export const SKY = [
  [0.00, 0x0b1026, 0x1d2747, 0x8fa3d6, 0.45, 0.175],   // night: blue moonlight; ambient keeps the land readable
  [0.25, 0x6f8ec4, 0xf0b48c, 0xffb27a, 1.90, 0.40],    // sunrise: warm sun and horizon under a still cool zenith
  [0.50, 0x4f95d8, 0xc8e4f6, 0xffffff, 3.00, 0.60],
  [0.75, 0x5a6fb0, 0xf2a07a, 0xff9a5c, 1.90, 0.40],
  [1.00, 0x0b1026, 0x1d2747, 0x8fa3d6, 0.45, 0.175],
];
/** What a sky turns into as the weather closes in; `grey` of the weather is how far. Dimmed by the hour, or a rainy night would be a lit grey */
export const OVERCAST = 0x8c8c8c;
/** Hemisphere light's lower half: the meadows bouncing back, so undersides stay green and never go black */
export const GROUND_BOUNCE = 0x4d5a34;
/** Neutral fill beside the hemisphere light, as a share of its brightness. The hemisphere alone leaves a wall in shade the plain average of sky and meadow,
 *  dark and blue; a colorless part keeps shaded faces gray and readable. It rides the same ambient, so nights and rain still darken */
export const FILL = 1;
/** How much of the sun the weather takes the ambient loses too: clouds block the sun but scatter its light, so a rainy noon stays a grey day and not a dusk */
export const WEATHER_AMBIENT = 0.25;
/** Fog starts at this share of the view distance: the near field stays clear, the far edge hides the end of the streamed world */
export const FOG_NEAR = 0.3;
/** Shadow box around the player: wide enough for what the camera sees sharply, one map */
export const SHADOW = { extent: 70, far: 420, distance: 160, snap: 0.5, bias: -0.00005, normalBias: 0.04 };
export const BLOOM = { strength: 0.35, radius: 0.5, threshold: 0.85 };

/** The dome's clouds and the shadow they drop on the land */
export const CLOUDS = { color: 0xf8f6f0, shade: 0xb0b8c4, coverage: 1, scale: 0.35, speed: [0.004, 0.002], groundShadow: 0.55 };

/** Ground colors, baked into the chunks by the terrain workers; the type names come from terrainPreset() of @threedog/terrain-noise */
export const TERRAIN = {
  shading: /** @type {'flat'} */ ('flat'),
  colors: { sand: 0xe2cf9c, meadowA: 0x95c45e, meadowB: 0x80b350, forestA: 0x6aa04a, forestB: 0x5a9142, savannaA: 0xc9bd6e, savannaB: 0xb3a85c,
    wetland: 0x6f9a5a, riverbank: 0x8fb06a, highGrass: 0x60954a, rock: 0x8f897d, rockDark: 0x77726a, snow: 0xf1efe8 },
  biomeColors: { beach: ['sand'], snow: ['snow'], rock: ['rock', 'rockDark'], riverbank: ['riverbank', 'meadowA'], wetland: ['wetland', 'meadowB'],
    savanna: ['savannaA', 'savannaB'], forest: ['forestA', 'forestB'], highland: ['highGrass', 'meadowB'], meadow: ['meadowA', 'meadowB'] },
  steep: [{ maxNormalY: 0.62, colors: ['rockDark'] }, { maxNormalY: 0.78, colors: ['rock', 'rockDark'] }],
};

/** Colors of the things built in code, by material name (materials.js) */
export const COLORS = { water: 0x4f9cc0, lampBody: 0x6b5a40, lampGlow: 0xffc070, ball: 0xe8c25a, barrel: 0x8a5a36, cloth: 0xd9774a, skin: 0xf1c9a5, trousers: 0x3f4a5c, hair: 0x4a3426,
  pickupGlow: 0x403418 };
/** How bright the doorway lamp burns when it is on: above 1 so the bloom catches it */
export const DOOR_LAMP = 1.6;

export const PARTICLES = {
  dust: { max: 200, lifetime: [0.5, 1.1], speed: [0.6, 1.8], direction: [0, 1, 0], spread: 1.2, gravity: -1.5, drag: 2, size: [0.25, 0.6], color: [0xd8c8a0, 0xc8b890], opacity: [0.6, 0] },
  smoke: { max: 120, rate: 6, lifetime: [3, 5], speed: [0.4, 0.8], direction: [0.2, 1, 0], spread: 0.25, gravity: 0.15, drag: 0.4, size: [0.6, 2.2], color: [0xc8c4bc, 0xe8e6e2], opacity: [0.55, 0] },
  leaves: { max: 150, lifetime: [3, 6], speed: [0.3, 1], direction: [1, -0.4, 0.3], spread: 1, gravity: -0.6, drag: 1.2, size: [0.18, 0.18], color: [0xd99a4a, 0xb86a30], opacity: [1, 0], spin: 3 },
};

/** The engine's UI parts read these CSS variables: warm dark panels that sit well over a bright landscape */
export const UI = { bg: 'rgba(24,22,18,.9)', fg: '#f3eee2', muted: '#a8a294', accent: '#f0b450', line: 'rgba(255,255,255,.15)', radius: '12px' };

const rows = SKY.map(([t, top, horizon, sun, sunIntensity, ambient]) => ({ t, top: new THREE.Color(top), horizon: new THREE.Color(horizon), sun: new THREE.Color(sun), sunIntensity, ambient }));
/** The sky of this moment, as a live object the sky and the lights both read @returns {{ top: THREE.Color, horizon: THREE.Color, sun: THREE.Color, sunIntensity: number, ambient: number }} */
export const skyNow = () => ({ top: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), sunIntensity: 0, ambient: 0 });
/** Write the day at t into a skyNow() object. Colors blend as colors, never as hex numbers
 *  @param {ReturnType<typeof skyNow>} out @param {number} t uTimeOfDay */
export function sampleSky(out, t) {
  let i = 0;
  while (i < rows.length - 2 && t > rows[i + 1].t) i++;
  const a = rows[i], b = rows[i + 1], k = (t - a.t) / (b.t - a.t);
  out.top.copy(a.top).lerp(b.top, k); out.horizon.copy(a.horizon).lerp(b.horizon, k); out.sun.copy(a.sun).lerp(b.sun, k);
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * k;
  out.ambient = a.ambient + (b.ambient - a.ambient) * k;
  return out;
}
/** The brightest ambient of the day: the scale a grey sky dims by */
export const AMBIENT_PEAK = Math.max(...rows.map(r => r.ambient));
