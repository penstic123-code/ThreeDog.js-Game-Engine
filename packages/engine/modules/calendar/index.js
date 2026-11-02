// calendar() hooks, saves, scenario time.
// The calendar() module definition: install, per-step time, engine.skip, saves, scenario time / season, describe. engine.calendar API: Calendar.js.
// Stage 'environment' before sky: the sky reads the calendar each frame to draw, so the time it draws is this step's.
import { Calendar } from './Calendar.js';
import { timeCondition } from './seasons.js';
import { readParams, keysSchema } from '../../core/params.js';
import { parseClock } from '../../core/dayTime.js';
import { codedError } from '../../core/errorHints.js';
import { saveValues } from '../../core/saveValues.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { CalendarOptions } from '../../types/world' */

const CALENDAR_OPTIONS = ['time', 'dayLength', 'day', 'daysPerSeason', 'seasons', 'hoursPerDay'];
const STRINGS = {
  skyTime: "calendar() installed after sky({ time }): the sky now draws the calendar's time, so sky({ time }) would be unused; start the day with calendar({ time }) and drop sky({ time })",
};
const CALENDAR_PARAMS = keysSchema(CALENDAR_OPTIONS);   // keys only: time takes 'HH:MM' or 0-1, seasons names or { name, days }; Calendar checks them

/**
 * Game calendar: time of day, day, seasons, clock-time timers -> engine.calendar (sky() reads it to draw)
 * @param {CalendarOptions} [opts]
 * @returns {ModuleDef<Calendar>}
 */
export function calendar(opts = {}) {
  readParams('calendar', CALENDAR_PARAMS, opts);
  let c = null;
  return {
    name: 'calendar', label: 'Calendar', params: CALENDAR_PARAMS, options: opts, stage: 'environment', before: ['sky'],
    install(e) {
      // sky({ time }) is the fixed time drawn without a calendar: installed before this one it would now sit unused, so say so (sky checks the other order)
      if (e.modules.get('sky')?.options?.time != null) throw codedError('calendar-option', STRINGS.skyTime);
      c = new Calendar(e, opts);
      // audio rule condition { time: 'day' | 'night' | ['18:00', '06:00'] } and measure { daylight: { gt: 0.15 } } for music / ambience rule lists:
      // from the clock, so an indoor game without a sky still switches its night music
      e.audio.condition('time', timeCondition(c));
      e.audio.measure('daylight', () => c.daylight);
      // movedFrom.sky: saves from before the calendar was its own module kept the time under the 'sky' part ({ time, day }); they load here
      e.saves.register('calendar', { save: () => ({ time: c.timeOfDay, day: c.day }),
        // saved numbers pass saveValues as clock / random / time do: a time 'abc' showed clock 'NaN:NaN' and a day -5 broke seasons (one warning per part)
        load: d => {
          if (d) {
            const v = saveValues('calendar');
            c.timeOfDay = v.num(d.time ?? c.timeOfDay, 'time', { min: 0, max: 1, fallback: c.timeOfDay }) % 1;   // 1 is the next midnight, as calendar({ time })
            c.day = v.num(d.day ?? 1, 'day', { min: 1, int: true, fallback: c.day });
            v.done();
            c._season = c.season;
          }
          c._sched.rebase();
        },
        movedFrom: { sky: d => ({ time: d?.time, day: d?.day }) } });
      return c;
    },
    counts() { return { timers: c.scheduled }; },   // engine.counts().calendar
    fixed(dt) { c.tick(dt); },
    // engine.skip: segments end at clock marks (core/skip.js reads untilMark), so each tick crosses at most one mark and one midnight; a skip right after
    // loading counts from now (a step would only reset the baseline)
    skip(dt) { c._sched.last ??= c.totalDays; c.tick(dt); },
    dispose() { c._sched.dispose(); },
    // scenario param time: 'HH:MM' or 0-1 (text in the URL)
    // scenario param season: the first day of that season (outside the last-20% blend into the next one), time of day kept
    applyState(e, { time, season }) {
      if (time != null) c.timeOfDay = parseClock(time, c.hoursPerDay) % 1;
      if (season != null) {
        const i = c.seasons.indexOf(season);
        if (i < 0) throw codedError('calendar-option', `applyState({ season: '${season}' }): the calendar has ${c.seasons.length ? 'seasons ' + c.seasons.join(', ') : 'no seasons'}; ` +
          "seasons are off by default: calendar({ seasons: ['spring', 'summer', 'autumn', 'winter'] })");
        c.day = (i ? c._ends[i - 1] : 0) + 1; c._season = c.season;
      }
    },
    describe(e, ctx) {
      Object.assign(ctx.out.time ??= {}, { clock: c.clock, day: c.day, season: c.season, isDay: c.isDay, timeOfDay: Math.round(c.timeOfDay * 1000) / 1000,
        dayLength: c.dayLength, rate: e.clock.rate });
    },
  };
}
