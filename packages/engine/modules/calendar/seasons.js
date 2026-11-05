// Calendar arithmetic (helpers of Calendar.js): seasons, day of season, and the audio rule condition `time`.
// Why here and not in the sky: day, season and clock time are gameplay (an indoor shop sim or a dungeon has no sky but has opening hours and
// a day counter); the sky only reads them to draw (modules/sky/season.js tints by season, frame.js places the sun by the time of day).
import { warnOnce } from '../../core/validate.js';
import { inRange } from '../../core/dayTime.js';
import { codedError } from '../../core/errorHints.js';

const STRINGS = {
  badTime: "audio rule condition time: {got} never matches; use 'day', 'night' or a clock range ['18:00', '06:00'] (or 0-1 times [0.75, 0.25])",
  badSeasons: "calendar({ seasons }): a list of names (each daysPerSeason days long) or of { name, days } with days >= 1, [] for none; got {got}",
};
/** Season names and the cumulative day each one ends on, from calendar({ seasons }): names (daysPerSeason long each) or { name, days } with days >= 1 */
export function parseSeasons(seasons, daysPerSeason) {
  if (!Array.isArray(seasons)) throw codedError('calendar-option', STRINGS.badSeasons.replace('{got}', JSON.stringify(seasons)));
  const names = [], ends = [];
  let end = 0;
  for (const x of seasons) {
    const name = typeof x === 'string' ? x : x?.name, days = typeof x === 'string' ? daysPerSeason : x?.days;
    if (typeof name !== 'string' || !(days >= 1)) throw codedError('calendar-option', STRINGS.badSeasons.replace('{got}', JSON.stringify(x)));
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
    // a rule is read every frame: a wrong clock time ('dusk') warns once like the shapes above instead of throwing each frame
    try { return inRange(s.timeOfDay, v[0], v[1], s.hoursPerDay); } catch (err) { warnOnce(err.message); return false; }
  };
}

/** Index of the current season in calendar.seasons (-1 without seasons) */
export function seasonIndexOf(c) {
  const ends = c._ends, n = ends.length;
  if (!n) return -1;
  const d = (c.day - 1) % ends[n - 1];
  let i = 0;
  while (d >= ends[i]) i++;
  return i;
}
/** Day within the season (1-based); 0 without seasons */
export function dayOfSeasonOf(c) {
  const i = c.seasonIndex, ends = c._ends;
  return i < 0 ? 0 : (c.day - 1) % ends[ends.length - 1] - (ends[i - 1] ?? 0) + 1;
}
/** Fraction of the season elapsed, 0-1 (includes time of day); 0 without seasons */
export function seasonProgressOf(c) {
  const i = c.seasonIndex, ends = c._ends;
  return i < 0 ? 0 : (c.dayOfSeason - 1 + c.timeOfDay) / (ends[i] - (ends[i - 1] ?? 0));
}
