// Calendar clock-time / season timers (implementation of engine.calendar.at / between / daily / onSeason; Calendar owns one Schedule).
// They read the calendar's time of day calendar.timeOfDay, not game seconds; for "after N seconds / every N seconds" use engine.clock.after / every.
// at is a "cross a clock time" event: when time moves forward (natural flow, fast-forward, raising calendar.timeOfDay) across several triggers, catchUp decides replay: 'once' fires once (default), 'all' fires all, 'skip' fires none;
// rewinding time (applyState to an earlier time, lowering calendar.timeOfDay) and loading a save only reset the baseline, no replay. To hold a state during a time range use between.
import { parseClock, inFrac } from '../../core/dayTime.js';
import { reportError } from '../../core/errors.js';
import { readParams, keysSchema } from '../../core/params.js';

const AT_KEYS = ['days', 'catchUp'], BETWEEN_KEYS = ['on', 'off'];

// clock-time conversions needed every step are cached on the registered entry (recomputed only when the clock time or hours per day change)
function frac(o, key, hoursPerDay) {
  const c = o._c ||= {};
  if (c[key + 'h'] !== hoursPerDay || c[key + 'v'] !== o[key]) { c[key + 'h'] = hoursPerDay; c[key + 'v'] = o[key]; c[key] = parseClock(o[key], hoursPerDay); }
  return c[key];
}
export class Schedule {
  constructor(cal) {
    this.cal = cal;
    this.points = [];       // at / daily：{ clock, fn, days, catchUp }
    this.ranges = [];       // between：{ from, to, on, off, inside }
    this.last = null;       // last calendar.totalDays (null = reset baseline next step)
  }
  get size() { return this.points.length + this.ranges.length; }
  dispose() { this.points = []; this.ranges = []; }
  at(clock, fn, opts) {
    const { days = null, catchUp = 'once' } = readParams('calendar.at()', keysSchema(AT_KEYS), opts);
    parseClock(clock);   // a wrong clock time throws here, at the call, not later inside every step
    const p = { clock, fn, days, catchUp };
    this.points.push(p);
    return { remove: () => { this.points = this.points.filter(x => x !== p); } };
  }
  between(from, to, opts) {
    const { on, off } = readParams('calendar.between()', keysSchema(BETWEEN_KEYS), opts);
    parseClock(from); parseClock(to);   // as at(): a wrong clock time throws at the call
    const r = { from, to, on, off, inside: null };
    this.ranges.push(r);
    this.syncRanges();
    return { remove: () => { this.ranges = this.ranges.filter(x => x !== r); } };
  }
  /** A callback that throws is a gameplay error (errors.js), like clock timers; the other timers still run */
  _call(fn, arg) { try { fn(arg); } catch (err) { reportError(this.cal.engine, err, 'calendar timer'); } }
  onSeason(name, fn) { return this.cal.engine.events.on('season:change', s => { if (s === name) fn(s); }); }
  syncRanges() {
    const t = this.cal.timeOfDay, hpd = this.cal.hoursPerDay;
    for (const r of this.ranges) {
      const inside = inFrac(t, frac(r, 'from', hpd), frac(r, 'to', hpd));
      if (inside === r.inside) continue;
      r.inside = inside;
      const fn = inside ? r.on : r.off;
      if (fn) this._call(fn);
    }
  }
  /** Fraction of a day until the next clock mark (midnight, an at time, a between edge), in (0, 1]; engine.skip ends a segment there.
   *  A mark the clock sits exactly on counts as already crossed (it fired when time arrived), so the next one is a day away */
  untilNext() {
    const t = this.cal.timeOfDay, hpd = this.cal.hoursPerDay;
    let m = 1 - t || 1;
    const near = f => { const d = ((f - t) % 1 + 1) % 1 || 1; if (d < m) m = d; };
    for (const p of this.points) near(frac(p, 'clock', hpd));
    for (const r of this.ranges) { near(frac(r, 'from', hpd)); near(frac(r, 'to', hpd)); }
    return m;
  }
  /** After loading a save the next step only resets the baseline, no replay */
  rebase() { this.last = null; }
  /** Called right after the calendar channel moves (a step or a skip segment) */
  tick() {
    const cal = this.cal;
    if (this.ranges.length) this.syncRanges();
    const cur = cal.totalDays, last = this.last;
    this.last = cur;
    if (last == null || cur <= last) return;     // just loaded or time rewound: only reset the baseline
    for (const p of [...this.points]) {
      const f = frac(p, 'clock', cal.hoursPerDay);
      const first = Math.floor(last - f) + 1, end = Math.floor(cur - f);   // triggers crossed: days first..end (0-based)
      if (end < first) continue;
      const n = end - first + 1;
      if (p.catchUp === 'skip' && n > 1) continue;
      for (let d = p.catchUp === 'all' ? first : end; d <= end; d++) {
        const day = d + 1;
        if (p.days && !(typeof p.days === 'function' ? p.days(day) : p.days.includes(day))) continue;
        this._call(p.fn, day);
      }
    }
  }
}
