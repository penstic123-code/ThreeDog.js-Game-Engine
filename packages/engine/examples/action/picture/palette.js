// @ts-check
// The action room's palette: every color and key value of the picture, one copy; the other files here read it.
import { THREE } from '../../../index.js';

/** The room in cool stone, the pillars a little warmer, and the enemy the one saturated thing in it, so the eye finds it first */
export const COLORS = { floor: 0x5b6168, wall: 0x8a8f96, pillar: 0x9a8c78, enemy: 0x6fbf5a, eye: 0x1d2024 };
export const TONE_MAPPING = THREE.AgXToneMapping;
/** The day: [time 0-1, sun color (the moon at night), sun intensity, ambient intensity]. Colorless on purpose: the room's own colors carry the picture */
export const DAY = [
  [0.00, 0xa8a8a8, 0.4, 0.175],
  [0.20, 0xa8a8a8, 0.4, 0.175],
  [0.25, 0xe4e4e4, 1.8, 0.40],
  [0.50, 0xffffff, 3.0, 0.60],
  [0.75, 0xe4e4e4, 1.8, 0.40],
  [0.80, 0xa8a8a8, 0.4, 0.175],
  [1.00, 0xa8a8a8, 0.4, 0.175],
];
/** Hemisphere light's lower half: faces turned down read darker than faces turned up, and the pillars keep their form */
export const GROUND_BOUNCE = 0x4a4a4a;
/** Neutral fill beside the hemisphere light, as a share of its brightness: a colorless part keeps the walls in shade gray stone instead of near black */
export const FILL = 1;
/** The shadow box holds the whole 16 m room and never moves: nothing outside it casts. Soft edges: so small a box draws them razor sharp, which reads harsher than this soft room */
export const SHADOW = { extent: 14, far: 80, distance: 40, bias: -0.0002, normalBias: 0.04, radius: 6 };

const rows = DAY.map(([t, sun, intensity, ambient]) => ({ t, sun: new THREE.Color(sun), intensity, ambient }));
/** Write the day at t into the sun's color and return its numbers @param {THREE.Color} sunColor @param {number} t uTimeOfDay */
export function sampleDay(sunColor, t) {
  let i = 0;
  while (i < rows.length - 2 && t > rows[i + 1].t) i++;
  const a = rows[i], b = rows[i + 1], k = (t - a.t) / (b.t - a.t);
  sunColor.copy(a.sun).lerp(b.sun, k);
  return { intensity: a.intensity + (b.intensity - a.intensity) * k, ambient: a.ambient + (b.ambient - a.ambient) * k };
}
