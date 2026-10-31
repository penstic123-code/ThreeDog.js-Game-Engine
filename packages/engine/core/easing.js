// Easing functions: input progress 0..1, output 0..1 (back/elastic overshoot slightly).
// Names are used by the ease param of tween, camera moves and path moves; you can also pass a function directly, e.g. t => t*t.
//   linear · inQuad outQuad inOutQuad · inCubic outCubic inOutCubic · inSine outSine inOutSine
//   inExpo outExpo inOutExpo · inBack outBack inOutBack · outElastic · outBounce · smooth（= smoothstep）
import { warnMissing } from './validate.js';
const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1;
const outBounce = t => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

export const EASINGS = {
  linear: t => t,
  smooth: t => t * t * (3 - 2 * t),
  inQuad: t => t * t, outQuad: t => 1 - (1 - t) * (1 - t), inOutQuad: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  inCubic: t => t ** 3, outCubic: t => 1 - (1 - t) ** 3, inOutCubic: t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  inSine: t => 1 - Math.cos(t * Math.PI / 2), outSine: t => Math.sin(t * Math.PI / 2), inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: t => t === 0 ? 0 : 2 ** (10 * t - 10), outExpo: t => t === 1 ? 1 : 1 - 2 ** (-10 * t),
  inOutExpo: t => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  inBack: t => c3 * t ** 3 - c1 * t * t, outBack: t => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  inOutBack: t => t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  outElastic: t => t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
  outBounce,
};

/** Name or function -> easing function (an unknown name falls back to linear, with a warning) */
export function ease(e) {
  if (typeof e === 'function') return e;
  if (e != null && !EASINGS[e]) warnMissing('ease', e, Object.keys(EASINGS));
  return EASINGS[e] || EASINGS.linear;
}
