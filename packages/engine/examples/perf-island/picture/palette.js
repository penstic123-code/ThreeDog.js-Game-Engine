// @ts-check
// Perf island palette: every color and key value of the picture, one copy. A soft painted diorama: few flat colors, soft shadows, a pale warm
// backdrop with no horizon. The other files here read these; the island's shape is the game's terrain() in ../main.js, never here.
import { THREE } from '../../../index.js';

/** Model colors (models.js) */
export const COLORS = { leaf: 0x6fa64a, leafLight: 0x8fbf5c, bark: 0x8a6448, wool: 0xf3efe6, face: 0x2b2725, wheat: 0xe2b448, wheatTip: 0xf0cf6a };

/** How the ground is colored, spread into terrain({...}) in main.js: the workers bake these into the chunks, so they go in at the start */
export const GROUND = {
  shading: /** @type {const} */ ('texture'), colorResolution: 256,   // crisp river bank and field edge without more triangles (recipe 53); 128 (0.5 m pixels) shows stairs up close
  colors: { grassA: 0x92c062, grassB: 0x86b658, river: 0x6aa6d6, riverDeep: 0x5b97ca, wheatA: 0xdcae48, wheatB: 0xd2a442, earth: 0xb98d64, rock: 0x94705a },
  biomeColors: { grass: ['grassA', 'grassB'], river: ['river', 'riverDeep'], wheat: ['wheatA', 'wheatB'], cliff: ['earth'], rock: ['rock'] },
};

const DAY = 0xefebe4, DUSK = 0xf0d9c4, NIGHT = 0x2c3346;
/** The day: [time 0-1, backdrop (= fog), sun color (the moon at night), sun intensity, ambient intensity]. One backdrop color, so no horizon line ever shows.
 *  Daytime ambient is high for a sun this strong: the cliff walls face away from it, and only the ambient keeps them the warm earth of the palette */
export const SKY = [
  [0.00, NIGHT, 0x9aaad8, 0.7, 0.85],
  [0.22, NIGHT, 0x9aaad8, 0.7, 0.85],
  [0.30, DAY, 0xfff0dc, 1.8, 1.2],
  [0.50, DAY, 0xfffaf0, 2.3, 1.4],
  [0.70, DAY, 0xffe6c8, 1.9, 1.2],
  [0.77, DUSK, 0xffb07a, 1.5, 1.0],
  [0.84, NIGHT, 0x9aaad8, 0.7, 0.85],
  [1.00, NIGHT, 0x9aaad8, 0.7, 0.85],
];
/** The ground half of the ambient: a meadow green, so the shaded undersides of the wool and the crowns pick up the grass */
export const AMBIENT_GROUND = 0xb8c49a;
/** Soft light on every material: half-lambert wrap so the shade side of a round blob is not black, and a cool blue shade instead of a gray one */
export const SOFT = { wrap: 0.45, shade: 0x7d88b8, strength: 0.45, soft: 0.3 };
/** Winter whitens foliage and ground most of the way, not all: a little of the green under the snow keeps the shapes readable */
export const SNOW = { color: 0xf5f5f8, amount: 0.82 };
/** Snow pulls the backdrop this far toward a pale overcast, so the island stays readable instead of going gray */
export const OVERCAST = 0xe6e3de;
/** Barely there: the far rim fades a touch into the backdrop */
export const FOG = { near: 71, far: 237 };
/** Soft edges; the island is small, so one tight box keeps them sharp enough */
export const SHADOW = { extent: 45, radius: 4, distance: 160, mapSize: 2048, lowMapSize: 1024 };
// Neutral keeps the painted colors close to what is written here (ACES darkens and shifts them)
export const TONE_MAPPING = THREE.NeutralToneMapping;
export const EXPOSURE = 1;

const ca = new THREE.Color(), cb = new THREE.Color();
/** The two rows around t and how far t is between them (rows are sorted by time, first at 0, last at 1) @param {number} t */
function around(t) {
  const i = Math.max(1, SKY.findIndex(r => r[0] > t)), a = SKY[i - 1], b = SKY[i];
  return { a, b, k: Math.min(1, (t - a[0]) / (b[0] - a[0])) };
}
/** One color column of SKY at t, blended as colors (hex numbers must not be interpolated as numbers) @param {THREE.Color} out @param {number} col @param {number} t */
export function skyColor(out, col, t) {
  const { a, b, k } = around(t);
  return out.copy(ca.set(a[col])).lerp(cb.set(b[col]), k);
}
/** One number column of SKY at t @param {number} col @param {number} t */
export function skyNumber(col, t) {
  const { a, b, k } = around(t);
  return a[col] + (b[col] - a[col]) * k;
}
