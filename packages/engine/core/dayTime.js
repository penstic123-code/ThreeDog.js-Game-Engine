// 'HH:MM' <-> day fraction. Pure functions.
// Clock-time conversion (pure functions): the calendar's time of day `timeOfDay` is the fraction of a day, 0-1, and 'HH:MM' is just another way to write it. engine.calendar timers, npc schedules and music conditions all use it.
import { codedError } from './errorHints.js';
/** 'HH:MM' or 0-1 (a number, or text such as '0.25' from a URL) -> fraction of a day, 0-1 (hoursPerDay = hours in a day, default 24) */
export function parseClock(v, hoursPerDay = 24) {
  let t;
  if (typeof v === 'number' || !String(v).includes(':')) t = typeof v === 'string' && !v.trim() ? NaN : +v;
  else { const [h, m = 0] = String(v).split(':').map(Number); t = (h + m / 60) / hoursPerDay; }
  // every clock time passes here (URL ?time=, calendar / sky options, schedules, timers): a NaN let through blacked out the sun and the frame
  if (!Number.isFinite(t) || t < 0) throw codedError('clock-time', `clock time ${JSON.stringify(v)} is not a time of day: write 'HH:MM' ('18:30') or a fraction of the day 0-1 (0.75)`);
  return t;
}
/** Is time t (0-1) inside the window [from, to)? (from and to are 'HH:MM' or 0-1; from > to wraps past midnight). calendar.between and the audio rule condition { time: [from, to] } both use it */
export function inRange(t, from, to, hoursPerDay = 24) { return inFrac(t, parseClock(from, hoursPerDay), parseClock(to, hoursPerDay)); }
export const inFrac = (t, a, b) => (a <= b ? t >= a && t < b : t >= a || t < b);
/** Fraction of a day 0-1 -> 'HH:MM' */
export function formatClock(t, hoursPerDay = 24) {
  // whole minutes with a hair of slack: 0.3 * 24 * 60 is 431.99999999999994 in floats, and flooring that showed 07:11 for 07:12
  const all = Math.floor(t * hoursPerDay * 60 + 1e-6), h = Math.floor(all / 60), m = all % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
