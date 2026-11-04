// Calendar: the game's time of day, day number, seasons and clock-time timers (engine.calendar). Gameplay time, not a picture: NPC schedules,
// shop hours, content `clock` conditions, audio rules { time } / { daylight } and engine.skip({ to }) read it, with or without a sky.
// Why its own module and not part of sky: an indoor game, a management sim with a custom backdrop or a game with its own sky dome has days and
// opening hours but no engine sky; when the calendar lived in sky, NPC schedules stalled without one. The sky only reads it to draw (sun, moon,
// colors, season tint); sky() without a calendar draws one fixed time of day (sky({ time })).
//
// engine.use(calendar({ time: '07:00', dayLength: 360 }));   // or calendar(presets.calendar.cycle)
// calendar() alone keeps a fixed time of day (dayLength Infinity): a day-night cycle is gameplay (a shooter or a dungeon has none).
// engine.calendar.timeOfDay = 0.75;  engine.mod('clock.rate', { owner: 'game', set: 10 });  engine.calendar.clock  // "18:00"
// engine.calendar.day (1-based); event day:start. Seasons are the game's choice and off by default:
// calendar({ seasons: ['spring', 'summer', 'autumn', 'winter'], daysPerSeason: 28 }), or each with its own length: [{ name: 'wet', days: 10 },
// { name: 'dry', days: 20 }]; then season, seasonProgress (0-1), dayOfSeason and the season:change event.
// A game's own calendar (a turn counter, a lunar calendar) replaces this module by meeting modules/calendar/contract.js.
// Time of day and day are views of the engine's 'calendar' time channel (engine.time.now('calendar') = engine.clock.now), not a second counter:
// the calendar keeps an origin (the day and time of day at channel second t0) and reads the rest from the channel. Why: one time source
// (core/time.js); a calendar that added its own dt drifted from clock timers, and skip had to advance both. Writing timeOfDay or day moves the
// origin. day:start / season:change and the clock timers fire right after the channel moves (engine.time.onMove), on a step and on a skip alike.
import { parseSeasons, seasonIndexOf, dayOfSeasonOf, seasonProgressOf } from './seasons.js';
import { formatClock, parseClock } from '../../core/dayTime.js';
import { Schedule } from './schedule.js';
import { codedError } from '../../core/errorHints.js';
/** @import { CalendarOptions, CalendarAtOptions, CalendarBetweenOptions } from '../../types/world' */
/** @import { Handle } from '../../types/common' */
const STRINGS = {
  badDayLength: 'calendar({ dayLength }): game seconds per day must be a number > 0 (Infinity = the time of day never moves); got {got}',
  noSeason: "calendar.onSeason('{name}'): the calendar has no such season (seasons: {list}). " +
    "Seasons are off by default: calendar({ seasons: ['spring', 'summer', 'autumn', 'winter'] })",
};
/** engine.calendar */
export class Calendar {
  /**
   * @internal
   * @param {any} engine
   * @param {CalendarOptions} [opts]
   */
  constructor(engine, { time = 0.33, dayLength = Infinity, day = 1, daysPerSeason = 7, seasons = [], hoursPerDay = 24 } = {}) {
    /** @internal */ this.engine = engine;
    if (!(dayLength > 0)) throw codedError('calendar-option', STRINGS.badDayLength.replace('{got}', String(dayLength)));
    // the origin: day _day0 at time of day _tod0 when the calendar channel read _t0 (kept apart, so a time just set reads back exactly)
    /** @internal */ this._day0 = day;
    /** @internal */ this._tod0 = parseClock(time, hoursPerDay) % 1;
    /** @internal */ this._t0 = engine.clock.now;
    /** @internal */ this._dayLength = dayLength;
    /** @internal the day the last move saw (day:start fires when a move changes it) */ this._lastDay = day;
    /** Hours per day (clock notation 'HH:MM', schedules, at / between) @type {number} */
    this.hoursPerDay = hoursPerDay;
    /** Days per season for seasons given by name only @type {number} */
    this.daysPerSeason = daysPerSeason;
    /** Season names, [] when the game has no seasons (the default) @type {string[]} */
    this.seasons = [];
    // kept as names plus the day each season ends (cumulative), so seasons of different lengths cost one short loop in the getters
    /** @internal */ this._ends = [];
    const parsed = parseSeasons(seasons, daysPerSeason);
    this.seasons.push(...parsed.names); this._ends.push(...parsed.ends);
    /** @internal */ this._season = this.season;
    /** @internal */ this._sched = new Schedule(this);
  }

  /** @internal days since the origin, fractional (0 while dayLength is Infinity) */
  _x() { return this._tod0 + (this.engine.clock.now - this._t0) / this._dayLength; }
  /** @internal move the origin to `day` at `tod` now */
  _origin(day, tod) { this._day0 = day; this._tod0 = tod; this._t0 = this.engine.clock.now; }
  /**
   * Time of day: 0-1 (0 midnight, 0.25 6am, 0.5 noon, 0.75 6pm); one day = dayLength game seconds (the unit of engine.clock.now). Writing it later
   * in the day counts as time passing (at timers crossed fire); writing it earlier only resets the timers' baseline @type {number}
   */
  get timeOfDay() { const x = this._x(); return x - Math.floor(x); }
  set timeOfDay(v) { this._origin(this.day, v - Math.floor(v)); }   // not ((v % 1) + 1) % 1: that turns 0.3 into 0.30000000000000004
  /** Day number (1-based); writing it fires no day:start @type {number} */
  get day() { return this._day0 + Math.floor(this._x()); }
  set day(v) { this._origin(v, this.timeOfDay); this._lastDay = v; }
  /**
   * Game seconds per day (1 hour = dayLength / hoursPerDay game seconds; at clock.rate 1 calendar seconds equal real seconds); Infinity = the time of
   * day never moves. Changing it keeps the current time of day @type {number}
   */
  get dayLength() { return this._dayLength; }
  set dayLength(v) {
    if (!(v > 0)) throw codedError('calendar-option', STRINGS.badDayLength.replace('{got}', String(v)));
    this._origin(this.day, this.timeOfDay); this._dayLength = v;
  }
  /** Clock text, e.g. "18:00" */
  get clock() { return formatClock(this.timeOfDay, this.hoursPerDay); }
  /** Daylight from the clock 0-1 (0 from 18:00 to 06:00, 1 at noon; a sine over the day). Audio rules { daylight }, ambience and the sky's default sun read it */
  get daylight() { return Math.max(0, Math.sin((this.timeOfDay - 0.25) * Math.PI * 2)); }
  /** Whether it is daytime by the clock (06:00-18:00 of the day's hours) */
  get isDay() { return this.daylight > 0; }
  /** Current season index, -1 without seasons */
  get seasonIndex() { return seasonIndexOf(this); }
  /** Current season name, e.g. 'spring'; null without seasons @type {string | null} */
  get season() { return this.seasons[this.seasonIndex] ?? null; }
  /** Day within the season (1-based); 0 without seasons */
  get dayOfSeason() { return dayOfSeasonOf(this); }
  /** Fraction of the season elapsed, 0-1 (includes time of day); 0 without seasons */
  get seasonProgress() { return seasonProgressOf(this); }
  /** Total game time in days (fractional), for growth, cooldowns and the like */
  get totalDays() { return this._day0 - 1 + this._x(); }

  /**
   * After the calendar channel moved (engine.time.onMove; the module registers it): a new day emits day:start (and season:change when the season
   * turned), then the clock-time timers that were crossed fire
   * @returns {void}
   * @internal
   */
  moved() {
    const d = this.day;
    if (d !== this._lastDay) {
      const forward = d > this._lastDay;
      this._lastDay = d;
      if (forward) this.engine.events.emit('day:start', d);
      if (this.season !== this._season) { this._season = this.season; if (forward) this.engine.events.emit('season:change', this.season); }
    }
    this._sched.tick();
  }

  // ---------- Clock-time / season timers (read the calendar's time of day; for "after N seconds" use engine.clock.after) ----------
  /**
   * Call fn every day at a clock time: at('18:00', fn) or at(0.75, fn).
   * Fires only when time moves forward across the clock time: natural flow, engine.skip and setting timeOfDay later all count;
   * crossing several triggers at once is replayed per catchUp; rewinding time and loading a save do not fire, they only reset the baseline.
   * To hold a state during a time range (lights, shop door) use between
   * @param {string | number} clock  'HH:MM' or 0-1
   * @param {(day: number) => void} fn
   * @param {CalendarAtOptions} [opts]
   * @returns {Handle}
   */
  at(clock, fn, opts) { return this._sched.at(clock, fn, opts); }
  /**
   * Time-range switch: on() while clock time is in [from, to), otherwise off() (from > to wraps midnight).
   * Aligns once immediately on registration, new game, load, applying a scenario and time rewind; afterwards it calls on/off when crossing a boundary
   * @example engine.calendar.between('09:00', '17:00', { on: () => shop.open(), off: () => shop.close() })
   * @param {string | number} from
   * @param {string | number} to
   * @param {CalendarBetweenOptions} opts
   * @returns {Handle}
   */
  between(from, to, opts) { return this._sched.between(from, to, opts); }
  /**
   * Call fn(day) at the start of each day (00:00)
   * @param {(day: number) => void} fn
   * @param {CalendarAtOptions} [opts]
   * @returns {Handle}
   */
  daily(fn, opts) { return this._sched.at(0, fn, opts); }
  /**
   * Call fn(seasonName) on entering season name
   * @param {string} name
   * @param {(season: string) => void} fn
   * @returns {Handle}
   */
  onSeason(name, fn) {
    // a season the calendar does not have would never fire: say so now instead of waiting forever
    if (!this.seasons.includes(name))
      throw codedError('calendar-option', STRINGS.noSeason.replace('{name}', name).replace('{list}', this.seasons.length ? this.seasons.join(', ') : 'none'));
    return this._sched.onSeason(name, fn);
  }
  /**
   * Game seconds until the next clock mark (midnight, at times, between edges); engine.skip ends a segment there; Infinity when the time of day never moves
   * @returns {number}
   */
  untilMark() { return Number.isFinite(this.dayLength) ? this._sched.untilNext() * this.dayLength : Infinity; }
  /** Number of registered clock-time / season timers, for engine.counts() @internal */
  get scheduled() { return this._sched.size; }
}
