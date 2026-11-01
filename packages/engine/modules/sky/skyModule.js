// The sky() module definition (split out of Sky.js): install, per-step time, per-frame update, saves, scenario time, describe.
// Usage and the engine.sky API are documented in Sky.js.
import { Sky } from './Sky.js';
import { dropCascades } from './cascades.js';
import { timeCondition } from './calendar.js';
import { readParams, keysSchema } from '../../core/params.js';
import { parseClock } from '../../core/dayTime.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { SkyOptions } from '../../types/world' */

// Options sky() accepts: calendar (time, dayLength, day, seasons, hoursPerDay) + look overrides of style pack style.sky
const SKY_OPTIONS = ['time', 'dayLength', 'day', 'daysPerSeason', 'seasons', 'keyframes', 'groundTint', 'sunSize', 'sunGlow', 'sunBrightness', 'moonBrightness',
  'moonSize', 'moonColor', 'clouds', 'starDensity', 'starScale', 'gradientCurve', 'skybox', 'shadow', 'orbitTilt', 'orbitSway', 'hoursPerDay', 'environment',
  'sun', 'hemisphere', 'fog', 'layers', 'backdrop'];
const SKY_PARAMS = keysSchema(SKY_OPTIONS);   // keys only: the values take several shapes (time: 'HH:MM' | 0-1), Sky checks them

/**
 * Sky, day/night, calendar -> engine.sky
 * @param {SkyOptions} [opts]
 * @returns {ModuleDef<Sky>}
 */
export function sky(opts = {}) {
  readParams('sky', SKY_PARAMS, opts);
  let s = null;
  return {
    name: 'sky', label: 'Sky', params: SKY_PARAMS, options: opts, stage: 'environment',
    install(e) {
      s = new Sky(e, opts);
      // audio rule condition { time: 'day' | 'night' | ['18:00', '06:00'] } for music / ambience rule lists
      e.audio.condition('time', timeCondition(s));
      e.audio.measure('daylight', () => s.daylight);   // data rules compare it: { daylight: { gt: 0.15 } } (0 at night, about 1 at noon)
      e.saves.register('sky', { save: () => ({ time: s.timeOfDay, day: s.day }),
        load: d => { if (d) { s.timeOfDay = d.time ?? s.timeOfDay; s.day = d.day ?? 1; s._season = s.season; } s._sched.rebase(); } });
      return s;
    },
    counts() { return { timers: s.scheduled }; },   // engine.counts().sky
    fixed(dt) { s.tick(dt); },
    // engine.skip: segments end at clock marks, so each tick crosses at most one mark and one midnight; a skip right after loading
    // counts from now (a step would only reset the baseline)
    skip(dt) { s._sched.last ??= s.totalDays; s.tick(dt); },
    frame(dt, e) { s.update(e.focus); s._envFrame(dt); },
    afterRender() { s.afterRender(); },
    dispose() { s._sched.dispose(); s._envOff(); s._fogOff(); dropCascades(s); },
    // scenario param time: 'HH:MM' or 0-1 (text in the URL)
    // scenario param season: the first day of that season (outside the last-20% blend into the next one), time of day kept
    applyState(e, { time, season }) {
      if (time != null) s.timeOfDay = parseClock(time, s.hoursPerDay) % 1;
      if (season != null) {
        const i = s.seasons.indexOf(season);
        if (i < 0) throw new Error(`applyState({ season: '${season}' }): the calendar has ${s.seasons.length ? 'seasons ' + s.seasons.join(', ') : 'no seasons'}; ` +
          "seasons are off by default: sky({ seasons: ['spring', 'summer', 'autumn', 'winter'] })");
        s.day = (i ? s._ends[i - 1] : 0) + 1; s._season = s.season;
      }
    },
    describe(e, ctx) {
      Object.assign(ctx.out.time, { clock: s.clock, day: s.day, season: s.season, isDay: s.isDay, timeOfDay: Math.round(s.timeOfDay * 1000) / 1000,
        dayLength: s.dayLength, timeScale: e.clock.timeScale });
    },
  };
}
