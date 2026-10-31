// Clock-time conversion (pure functions): sky time of day `timeOfDay` is the fraction of a day, 0-1, and 'HH:MM' is just another way to write it. engine.sky timers, npc schedules and music conditions all use it.
/** 'HH:MM' or 0-1 (a number, or text such as '0.25' from a URL) -> fraction of a day, 0-1 (hoursPerDay = hours in a day, default 24) */
export function parseClock(v, hoursPerDay = 24) {
  if (typeof v === 'number' || !String(v).includes(':')) return +v;
  const [h, m = 0] = String(v).split(':').map(Number);
  return (h + m / 60) / hoursPerDay;
}
/** Is time t (0-1) inside the window [from, to)? (from and to are 'HH:MM' or 0-1; from > to wraps past midnight). sky.between and music's when.time both use it */
export function inRange(t, from, to, hoursPerDay = 24) { return inFrac(t, parseClock(from, hoursPerDay), parseClock(to, hoursPerDay)); }
export const inFrac = (t, a, b) => (a <= b ? t >= a && t < b : t >= a || t < b);
/** Fraction of a day 0-1 -> 'HH:MM' */
export function formatClock(t, hoursPerDay = 24) {
  const h = Math.floor(t * hoursPerDay), m = Math.floor((t * hoursPerDay - h) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
