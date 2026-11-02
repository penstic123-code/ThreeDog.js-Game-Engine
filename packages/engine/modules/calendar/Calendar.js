// Calendar: the game's time of day, day number, seasons and clock-time timers (engine.calendar). Gameplay time, not a look: NPC schedules,
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
import { parseSeasons, seasonIndexOf, dayOfSeasonOf, seasonProgressOf, advance } from './seasons.js';
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
    /**
     * Time of day: 0-1 (0 midnight, 0.25 6am, 0.5 noon, 0.75 6pm); one day = dayLength game seconds (the unit of engine.clock.now). Writing it later
     * in the day counts as time passing (at timers crossed fire); writing it earlier only resets the timers' baseline @type {number}
     */
    this.timeOfDay = parseClock(time, hoursPerDay) % 1;
    if (!(dayLength > 0)) throw codedError('calendar-option', STRINGS.badDayLength.replace('{got}', String(dayLength)));
    /**
     * Game seconds per day (1 hour = dayLength / hoursPerDay game seconds; at clock.rate 1 calendar seconds equal real seconds); Infinity = the time of
     * day never moves @type {number}
     */
    this.dayLength = dayLength;
    /** Day number (1-based) @type {number} */
    this.day = day;
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
  get totalDays() { return this.day - 1 + this.timeOfDay; }

  /**
   * Advance time (called by the module every fixed step)
   * @param {number} dt
   * @returns {void}
   * @internal
   */
  tick(dt) { advance(this, dt); }

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
