// The sky() module definition (split out of Sky.js): install, per-frame update, the fixed scenario time, describe. Time, day, seasons, their
// timers and saves are the calendar's (modules/calendar); the sky reads engine.calendar each frame to draw.
// Usage and the engine.sky API are documented in Sky.js.
import { Sky } from './Sky.js';
import { dropOwned } from '../../core/owned.js';
import { readParams, keysSchema } from '../../core/params.js';
import { parseClock } from '../../core/dayTime.js';
import { codedError } from '../../core/errorHints.js';
import { DEV } from '../../core/validate.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { SkyOptions } from '../../types/world' */

// Options sky() accepts: the time drawn without a calendar, and the dome's
// start values. After install the numbers are engine.uniforms values (shader.js), the rest plain fields or calls on engine.sky
const SKY_OPTIONS = ['time', 'clouds', 'backdrop', 'keyframes', 'sunSize', 'sunGlow', 'sunBrightness', 'moonSize', 'moonColor', 'moonBrightness',
  'starDensity', 'starScale', 'gradientCurve', 'orbitTilt', 'orbitSway', 'dim'];
// the sky no longer writes lights or fog, so there is nothing to switch off: say what to write instead of the generic unknown-key error
const REMOVED = { shadow: 'shadows are engine.shadows (box, budget, cascades on engine.lights.sun) and three.js (light.shadow.*, renderer.shadowMap.type)',
  sun: "lights are the game's: delete the option; createEngine({ lights: false }) drops the placeholder lights, and your picture/ code reads engine.uniforms.uSunDir / uDaylight",
  hemisphere: "lights are the game's: delete the option; createEngine({ lights: false }) drops the placeholder lights, and your picture/ code reads engine.uniforms.uDaylight / uSkyTop",
  environment: 'the sky builds no map on its own: delete the option and call engine.sky.environment({ into: engine.scene }); an asset map is plain three.js (recipes/34)',
  fog: "fog is the game's: delete the option and write scene.fog = new THREE.Fog(color, near, far) in your picture/ code (engine.uniforms.uSkyHorizon is the horizon color)" };
const MOVED = { layers: 'engine.sky.layer(name, layer) per layer', skybox: 'engine.sky.replace(skybox)' };
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
 * Sky dome and the sun / daylight / sky-color signals, from the time of day (engine.calendar; without one a fixed time) -> engine.sky
 * @param {SkyOptions} [opts]
 * @returns {ModuleDef<Sky>}
 */
export function sky(opts = {}) {
  // the old calendar keys: say where they went instead of the generic unknown-key error (the calendar moved out of the sky)
  const moved = CAL_KEYS.find(k => k in opts);
  if (moved) throw codedError('sky-option', STRINGS.calendarKey.replaceAll('{key}', moved));
  for (const k in REMOVED) if (k in opts) throw codedError('sky-option', `sky({ ${k} }) was removed: ${REMOVED[k]}`);
  if (DEV) for (const k in MOVED) if (k in opts) throw codedError('sky-option', `sky({ ${k} }) moved: ${MOVED[k]} after engine.use(sky()) (one entry per picture value)`);
  readParams('sky', SKY_PARAMS, opts);
  let s = null, own = () => {};
  return {
    name: 'sky', type: 'picture', label: 'Sky', params: SKY_PARAMS, options: opts, stage: 'environment',
    // the one sky: a game's own sky module takes over with engine.use(mySky(), { replaces: 'sky' }) (this one unloads with its picture changes)
    provides: ['sky'],
    // weather: only its name for the picture context; calendar: the time drawn (without it one fixed time, sky({ time }))
    optional: ['weather', 'calendar'],
    install(e, ctx) { e.i18n.add({ 'zh-CN': { 'module.sky': '天空' }, en: { 'module.sky': 'sky' } });
      // a time given while a calendar draws would sit silently unused (calendar() installed after sky checks the same: modules/calendar/index.js)
      if (opts.time != null && e.calendar) throw codedError('sky-option', STRINGS.timeTwice);
      s = new Sky(e, opts);
      // without a calendar the drawn sun tells day from night (night glow reads the measure); a calendar installed later registers its own over it
      own = () => { for (const [n, f] of [['daylight', () => s.daylight], ['timeOfDay', () => s.drawnTime]]) if (!e.audio.measures.has(n)) ctx.track(e.audio.measure(n, f)); };
      own();
      return s;
    },
    // a calendar removed mid-game takes its measures with it: the sky takes the signals back at once, or uDaylight / uTimeOfDay would freeze
    frame(dt) { own(); s.update(); s._envFrame(dt); },
    // the dome goes too: a sky swapped with replaces must not leave the old dome drawn behind the new one
    dispose() { s._shadowOff(); s._swap.remove(); s._envOff(); dropOwned(s.engine, s._owned); s.dome.removeFromParent(); s.dome.geometry.dispose(); s.dome.material.dispose(); },
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
