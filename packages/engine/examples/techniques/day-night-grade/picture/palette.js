// @ts-check
// Day-night palette: one set of keyframes over the day for sky, light, exposure, grade and lamps. Numbers are a neutral starting point on a gray
// scene; the colors of your game come from its own picture, not from here.
import { THREE } from 'threedog';

/** Materials and lamp colors of the demo street, by name */
export const COLORS = { ground: 0x8e8e8e, wall: 0xb2b2b2, roof: 0x7a7a7a, figure: 0xa0a0a0, crate: 0x9c9c9c, dark: 0x202020, window: 0xffc27a, lampHead: 0xffd29a, lamp: 0xffc88a };
/** Sky keyframes: [time 0-1, zenith, horizon (= fog color), sun color (the moon at night), sun intensity, ambient color, ambient intensity] */
export const SKY = [
  [0.00, 0x0d1626, 0x1f2c44, 0x8fa4d4, 0.35, 0x2f3147, 0.26],   // night: the "sun" row is moonlight, blue and weak; ambient keeps a floor
  [0.21, 0x172036, 0x3a4058, 0x9aa8d4, 0.35, 0x2f3147, 0.26],
  [0.26, 0x55688c, 0xd09c7c, 0xffb27c, 1.2, 0x8088a8, 0.6],     // sunrise: warm sun, horizon warm, zenith still cool (the contrast IS the picture)
  [0.33, 0x6d92c2, 0xc6d2dc, 0xfff0dc, 2.4, 0xa0b6d4, 0.9],
  [0.50, 0x6e98ce, 0xcfdae4, 0xfffaf2, 3.0, 0xa8bdd9, 1.1],     // noon: sun 3 + ambient 1.1 ~ pi: mid-tone albedos show at their own value
  [0.68, 0x6a8ebe, 0xd4d0c6, 0xfff0d8, 2.6, 0xa4b8d4, 1.0],
  [0.73, 0x4c5c86, 0xdc9c6c, 0xffa264, 1.6, 0x7c88ac, 0.7],     // dusk: warmth in the LIGHT color, ambient drops so shadows turn cool by contrast
  [0.78, 0x222e4c, 0x5c5068, 0x9aa6d4, 0.35, 0x3c4060, 0.32],   // blue hour: the moon row again, a little more ambient than deep night
  [1.00, 0x0d1626, 0x1f2c44, 0x8fa4d4, 0.35, 0x2f3147, 0.26],
];
/** Exposure over the day [time, exposure]: lifted at night so the moonlit scene reads, but never back to day brightness */
export const EXPOSURE = [[0, 1.15], [0.22, 1.15], [0.3, 1.0], [0.7, 1.0], [0.77, 1.1], [1, 1.15]];
/** Color grade over the day [time, temperature (-1 cool..1 warm), saturation, contrast] */
export const GRADE = [
  [0.00, -0.45, 0.72, 1.06],   // night: cooler and less saturated (eyes lose color in the dark), a touch of contrast keeps edges
  [0.22, -0.3, 0.8, 1.04],
  [0.28, 0.35, 0.95, 1.0],
  [0.40, 0, 1, 1],
  [0.65, 0, 1, 1],
  [0.73, 0.5, 0.9, 1.04],      // dusk: warm, and saturation DOWN as warmth goes up, or oranges clip into neon
  [0.79, -0.25, 0.78, 1.05],
  [1.00, -0.45, 0.72, 1.06],
];
/** Lamps: fully on below this daylight (0 night .. 1 noon), fading in above it. Daylight 0.35 is about 16:40: lamps come on before dark, as people switch them on */
export const LAMPS = { onBelow: 0.02, offAbove: 0.35, light: 14, window: 2.2, head: 3 };
export const TONE_MAPPING = THREE.AgXToneMapping;

/** The two keyframe rows around t and how far t is between them; rows are sorted by t and the table wraps at 1 @param {number[][]} rows @param {number} t */
function around(rows, t) {
  let i = rows.findIndex(r => r[0] > t);
  if (i <= 0) i = i === 0 ? 0 : rows.length - 1;
  const a = rows[Math.max(0, i - 1)], b = rows[i], k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  return { a, b, k: Math.min(1, Math.max(0, k)) };
}
/** Plain numbers at t @param {number[][]} rows @param {number} t */
export function sample(rows, t) {
  const { a, b, k } = around(rows, t);
  return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k);
}
const ca = new THREE.Color(), cb = new THREE.Color();
/** One color column of SKY at t, blended as colors (hex numbers must not be interpolated as numbers) @param {THREE.Color} out @param {number} col @param {number} t */
export function skyColor(out, col, t) {
  const { a, b, k } = around(SKY, t);
  return out.copy(ca.set(a[col])).lerp(cb.set(b[col]), k);
}
/** One number column of SKY at t @param {number} col @param {number} t */
export function skyNumber(col, t) {
  const { a, b, k } = around(SKY, t);
  return a[col] + (b[col] - a[col]) * k;
}
