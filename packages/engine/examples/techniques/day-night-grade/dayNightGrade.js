// @ts-check
// Day-night lighting and color grade: one set of keyframes over the day for the sky (sun / moon, hemisphere, fog), exposure, a post color grade,
// and the game's own lamps. Technique example (README.md next to this file); copy and adapt: the numbers are a neutral starting point, the
// colors of your game come from its DESIGN.md look, not from here.
import { lut } from '@threedog/post-effects';

/** Sky keyframes: [time 0-1, zenith, horizon (= fog color), sun color (the moon at night), sun intensity, ambient intensity] */
export const SKY = [
  [0.00, 0x0d1626, 0x1f2c44, 0x8fa4d4, 0.35, 0.26],   // night: the "sun" row is moonlight, blue and weak; ambient keeps a floor
  [0.21, 0x172036, 0x3a4058, 0x9aa8d4, 0.35, 0.26],
  [0.26, 0x55688c, 0xd09c7c, 0xffb27c, 1.2, 0.6],     // sunrise: warm sun, horizon warm, zenith still cool (the contrast IS the look)
  [0.33, 0x6d92c2, 0xc6d2dc, 0xfff0dc, 2.4, 0.9],
  [0.50, 0x6e98ce, 0xcfdae4, 0xfffaf2, 3.0, 1.1],     // noon: sun 3 + hemi 1.1 ~ pi: mid-tone albedos show at their own value
  [0.68, 0x6a8ebe, 0xd4d0c6, 0xfff0d8, 2.6, 1.0],
  [0.73, 0x4c5c86, 0xdc9c6c, 0xffa264, 1.6, 0.7],     // dusk: warmth in the LIGHT color, ambient drops so shadows turn cool by contrast
  [0.78, 0x222e4c, 0x5c5068, 0x9aa6d4, 0.35, 0.32],     // blue hour: the moon row again, a little more ambient than deep night
  [1.00, 0x0d1626, 0x1f2c44, 0x8fa4d4, 0.35, 0.26],
];
/** Exposure over the day [time, exposure]: lifted at night so the moonlit scene reads, but never back to day brightness */
export const EXPOSURE = [[0, 1.15], [0.22, 1.15], [0.3, 1.0], [0.7, 1.0], [0.77, 1.1], [1, 1.15]];
/** Color grade over the day [time, temperature (-1 cool..1 warm), saturation, contrast] (the lut() post effect's params) */
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
/** Lamps: fully on below this daylight (0 night .. 1 noon), fading in above it */
export const LAMPS = { onBelow: 0.02, offAbove: 0.35 };   // daylight 0.35 is about 16:40: windows and lamps come on before dark, as people switch them on

/**
 * The style fragment that carries the keyframes: createEngine({ style: [yourStyle, dayNightStyle()] }) or merge the keys into your own.
 * The grade is a look plugin of this fragment (the shape a plugins/ file exports), so it reaches the chain through look.post.add like any effect
 */
export function dayNightStyle() {
  return { name: 'dayNight', sky: { keyframes: SKY, moonColor: 0xc8d4f0 }, exposure: EXPOSURE, plugins: { 'lut.js': { default: lut({ enabled: true }) } } };
}

/** Linear interpolation over [[t, ...values]] rows sorted by t, wrapping at 1 */
export function sample(rows, t) {
  let i = rows.findIndex(r => r[0] > t);
  if (i <= 0) i = i === 0 ? 0 : rows.length - 1;
  const a = rows[Math.max(0, i - 1)], b = rows[i], k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((v, j) => v + (b[j + 1] - v) * Math.min(1, Math.max(0, k)));
}

/**
 * Drive the grade and the game's lamps from engine.calendar every frame. Lamps: [{ light?: THREE.Light, material?: { emissiveIntensity },
 * intensity, emissive }]: full values at night. The grade is written through look.post (owner 'day-night'), only when it moved, so
 * describe() shows who set it and the fused post shader is not refreshed every frame (the same owner overwrites its keys). Returns { remove(), level() }.
 * @param {import('threedog').Engine} engine
 * @param {{ lamps?: { light?: any, material?: any, intensity?: number, emissive?: number }[] }} [o]
 */
export function followDayNight(engine, { lamps = [] } = {}) {
  let last = null, level = 0, post = null;
  const smooth = (/** @type {number} */ x) => x * x * (3 - 2 * x);
  const frame = engine.onFrame(() => {
    const cal = /** @type {any} */ (engine).calendar, t = cal.timeOfDay;
    const [temperature, saturation, contrast] = sample(GRADE, t);
    if (!last || Math.abs(last[0] - temperature) + Math.abs(last[1] - saturation) + Math.abs(last[2] - contrast) > 0.004) {
      last = [temperature, saturation, contrast];
      post = engine.look.post.set({ 'lut.temperature': temperature, 'lut.saturation': saturation, 'lut.contrast': contrast }, { owner: 'day-night' });
    }
    level = 1 - smooth(Math.min(1, Math.max(0, (cal.daylight - LAMPS.onBelow) / (LAMPS.offAbove - LAMPS.onBelow))));
    for (const l of lamps) {
      // intensity only, never visible = false: a light count change recompiles every lit material (a stall at dusk)
      if (l.light) l.light.intensity = (l.intensity ?? 1) * level;
      if (l.material) l.material.emissiveIntensity = (l.emissive ?? 1) * level;
    }
  });
  return { remove() { frame.remove(); post?.remove(); }, level: () => level };
}
