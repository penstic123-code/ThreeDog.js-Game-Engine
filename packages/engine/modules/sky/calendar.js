// Sky season tint (helper of Sky.js): blends style.seasons colors into the engine's foliage / ground tint uniforms every frame.
import * as THREE from 'three';
import { warnOnce } from '../../core/validate.js';
import { inRange } from '../../core/dayTime.js';

// This season's color, blending to the next season over the last 20% of the season
const c1 = new THREE.Color(), c2 = new THREE.Color();
export function applySeason(sky, uniforms) {
  // no seasons in this game's calendar: the style's season colors never apply, the tint stays neutral (white = no change)
  const S = sky.seasonStyle; if (!S || !sky.seasons.length) return;
  const cur = S[sky.season] || {}, next = S[sky.seasons[(sky.seasonIndex + 1) % sky.seasons.length]] || {};
  const k = Math.max(0, (sky.seasonProgress - 0.8) / 0.2);
  // mode 'multiply' (default): the color multiplies the surface. mode 'mix': the surface moves `strength` of the way to the color (orange on green
  // leaves stays orange instead of turning muddy); a season without a color for the part leaves it alone
  const mix = S.mode === 'mix', strength = S.strength ?? 0.5;
  const blend = (key, out, amount) => {
    const a = cur[key], b = next[key];
    c1.set(a ?? (mix ? b : null) ?? 0xffffff); c2.set(b ?? (mix ? a : null) ?? 0xffffff); out.copy(c1).lerp(c2, k);
    amount.value = mix ? strength * ((a != null ? 1 - k : 0) + (b != null ? k : 0)) : 0;
  };
  blend('foliage', uniforms.uFoliageTint.value, uniforms.uFoliageMix); blend('ground', uniforms.uGroundTint.value, uniforms.uGroundMix);
}

const STRINGS = {
  badTime: "audio rule condition time: {got} never matches; use 'day', 'night' or a clock range ['18:00', '06:00'] (or 0-1 times [0.75, 0.25])",
  badSeasons: "sky({ seasons }): a list of names (each daysPerSeason days long) or of { name, days } with days >= 1, [] for none; got {got}",
};
/** Season names and the cumulative day each one ends on, from sky({ seasons }): names (daysPerSeason long each) or { name, days } with days >= 1 */
export function parseSeasons(seasons, daysPerSeason) {
  if (!Array.isArray(seasons)) throw new Error(STRINGS.badSeasons.replace('{got}', JSON.stringify(seasons)));
  const names = [], ends = [];
  let end = 0;
  for (const x of seasons) {
    const name = typeof x === 'string' ? x : x?.name, days = typeof x === 'string' ? daysPerSeason : x?.days;
    if (typeof name !== 'string' || !(days >= 1)) throw new Error(STRINGS.badSeasons.replace('{got}', JSON.stringify(x)));
    names.push(name); ends.push(end += days);
  }
  return { names, ends };
}

/** Audio rule condition { time: 'day' | 'night' | ['18:00', '06:00'] } for music / ambience rule lists */
export function timeCondition(s) {
  return v => {
    if (v === 'day') return s.isDay;
    if (v === 'night') return !s.isDay;
    // anything else must be a [from, to] range; 'evening' or a lone '18:00' would silently never match, so say which forms work
    if (!Array.isArray(v) || v.length !== 2) { warnOnce(STRINGS.badTime.replace('{got}', JSON.stringify(v))); return false; }
    return inRange(s.timeOfDay, v[0], v[1], s.hoursPerDay);
  };
}

/** Index of the current season in sky.seasons (-1 without seasons) */
export function seasonIndexOf(sky) {
  const ends = sky._ends, n = ends.length;
  if (!n) return -1;
  const d = (sky.day - 1) % ends[n - 1];
  let i = 0;
  while (d >= ends[i]) i++;
  return i;
}
/** Day within the season (1-based); 0 without seasons */
export function dayOfSeasonOf(sky) {
  const i = sky.seasonIndex, ends = sky._ends;
  return i < 0 ? 0 : (sky.day - 1) % ends[ends.length - 1] - (ends[i - 1] ?? 0) + 1;
}
/** Fraction of the season elapsed, 0-1 (includes time of day); 0 without seasons */
export function seasonProgressOf(sky) {
  const i = sky.seasonIndex, ends = sky._ends;
  return i < 0 ? 0 : (sky.dayOfSeason - 1 + sky.timeOfDay) / (ends[i] - (ends[i - 1] ?? 0));
}
/** One fixed step of the sky clock: advance the time of day, and on a new day emit day:start (and season:change when the season turned) */
export function advance(sky, dt) {
  const t = sky.timeOfDay + dt * sky.engine.clock.timeScale / sky.dayLength;
  if (t >= 1) {
    sky.timeOfDay = t % 1; sky.day += Math.floor(t);
    sky.engine.events.emit('day:start', sky.day);
    if (sky.season !== sky._season) { sky._season = sky.season; sky.engine.events.emit('season:change', sky.season); }
  } else sky.timeOfDay = t;
  sky._sched.tick();
}
