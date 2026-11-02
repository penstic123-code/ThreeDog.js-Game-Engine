// The sky() module definition (split out of Sky.js): install, per-frame update, the fixed scenario time, describe. Time, day, seasons, their
// timers and saves are the calendar's (modules/calendar); the sky reads engine.calendar each frame to draw.
// Usage and the engine.sky API are documented in Sky.js.
import { Sky } from './Sky.js';
import { dropCascades } from './cascades.js';
import { setFogPatch } from './fog.js';
import { followRoomEnvironment } from '../../render/lights.js';
import { dropOwned, dropOwnedRow } from '../../core/owned.js';
import { readParams, keysSchema } from '../../core/params.js';
import { parseClock } from '../../core/dayTime.js';
import { codedError } from '../../core/errorHints.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { SkyOptions } from '../../types/world' */

// Options sky() accepts: time (the fixed time of day drawn without a calendar) + look overrides of style.sky
const SKY_OPTIONS = ['time', 'keyframes', 'groundTint', 'sunSize', 'sunGlow', 'sunBrightness', 'moonBrightness',
  'moonSize', 'moonColor', 'clouds', 'starDensity', 'starScale', 'gradientCurve', 'skybox', 'shadow', 'orbitTilt', 'orbitSway', 'environment',
  'sun', 'hemisphere', 'fog', 'layers', 'backdrop'];
const SKY_PARAMS = keysSchema(SKY_OPTIONS);   // keys only: the values take several shapes (time: 'HH:MM' | 0-1), Sky checks them
const CAL_KEYS = ['dayLength', 'day', 'daysPerSeason', 'seasons', 'hoursPerDay'];
const STRINGS = {
  calendarKey: 'sky({ {key} }): day length, days, seasons and hours per day belong to the calendar module: engine.use(calendar({ {key}: ... }), sky()) ' +
    '(the sky only draws the calendar time)',
  timeTwice: "sky({ time }) is the fixed time drawn without a calendar, but calendar() is installed, so the sky draws the calendar's time; " +
    'start the day with calendar({ time }) and drop sky({ time })',
  noSeason: "applyState({ season }): seasons are the calendar's; install calendar({ seasons: [...] }) (sky alone draws one fixed time)",
};

/**
 * Sky dome, sun / moon light and fog drawn from the time of day (engine.calendar; without one a fixed time) -> engine.sky
 * @param {SkyOptions} [opts]
 * @returns {ModuleDef<Sky>}
 */
export function sky(opts = {}) {
  // the old calendar keys: say where they went instead of the generic unknown-key error (the calendar moved out of the sky)
  const moved = CAL_KEYS.find(k => k in opts);
  if (moved) throw codedError('sky-option', STRINGS.calendarKey.replaceAll('{key}', moved));
  readParams('sky', SKY_PARAMS, opts);
  let s = null;
  return {
    name: 'sky', label: 'Sky', params: SKY_PARAMS, options: opts, stage: 'environment',
    // weather: only its name for the look context (core/look/state.js); calendar: the time drawn (without it one fixed time, sky({ time }))
    optional: ['weather', 'calendar'],
    install(e) {
      // a time given while a calendar draws would sit silently unused (calendar() installed after sky checks the same: modules/calendar/index.js)
      if (opts.time != null && e.calendar) throw codedError('sky-option', STRINGS.timeTwice);
      s = new Sky(e, opts);
      return s;
    },
    frame(dt, e) { s.update(e.focus); s._envFrame(dt); },
    afterRender() { s.afterRender(); },
    dispose() { s._envOff(); followRoomEnvironment(s.engine, null, s._oEnv.on); setFogPatch(s, null); dropCascades(s); dropOwned(s.engine, [...s._owned, s._oEnv]); dropOwnedRow(s.engine, 'shadow.csm'); dropOwnedRow(s.engine, 'fog.patch'); },
    // scenario params time / season go to the calendar when there is one (its own applyState); without it time sets the fixed time drawn
    applyState(e, { time, season }) {
      if (e.calendar) return;
      if (time != null) s.fixedTime = parseClock(time) % 1;
      if (season != null) throw codedError('sky-option', STRINGS.noSeason);
    },
    // describe().time is the calendar's; without one the sky reports the fixed time it draws
    describe(e, ctx) { if (!e.calendar) Object.assign(ctx.out.time, { timeOfDay: Math.round(s.fixedTime * 1000) / 1000, fixed: true }); },
  };
}
