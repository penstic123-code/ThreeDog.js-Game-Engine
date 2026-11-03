// Weather, the state half (type 'world', engine.weather): the game's table of weather types (weather({ types })); without one only a calm 'clear' (the engine assumes no climate).
// Seven temperate ones are an opt-in preset: weather(presets.weather.temperate), extend with types: { ...presets.weather.temperate.types, dust: {...} }.
// All fields blend smoothly on change.
// Affects: cloud shadows, sky color, sun intensity, fog distance, wind (plants sway), rain/snow particles, lightning, ambience.
// Particle and lightning looks: style.weather.rain / snow / lightning, engine.look.weather.replace (particles.js, recipes/44).
// weather() installs two modules: this state (current / target / progress, auto weather, lightning timing, events, save) and the look half
// (weatherLook.js: particles, sky / fog / sun effects, thunder). Why split: the state is game data that saves and skips; the look only reads it,
// so a game can swap the look without touching the weather a save restores.
//
// engine.weather.set('rain', { seconds: 20 })   // turn to rain over 20 seconds
// engine.weather.setAuto(true)     // change weather at random (uses engine.random, so step/tests are reproducible and saved)
// Weather display names live in the string table as weather.<name> (describe and the debug panel use them); a game that adds a new weather adds its name with
// i18n.add.
import { warnMissing } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { STRINGS, ERR } from './strings.js';
import { codedError } from '../../core/errorHints.js';
import { weatherLookModule } from './weatherLook.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { WeatherName, WeatherPreset, WeatherOptions } from '../../types/world' */

// The table when the game gives none: one calm type, so engine.weather works without assuming rain, snow or storms exist
const ONLY_CLEAR = { clear: {} };
const OPTIONS = ['start', 'auto', 'particles', 'types', 'autoPool', 'autoInterval', 'transition', 'area', 'lightningFirst', 'lightningInterval'];
const SET_PARAMS = keysSchema(['seconds']);
const WEATHER_PARAMS = keysSchema(OPTIONS);
// Fields a type leaves out: calm (no cloud, rain, snow, grey or lightning; normal sun, fog and wind)
const CALM = { cloud: 0, sun: 1, fog: 1, wind: 1, rain: 0, snow: 0, grey: 0, lightning: 0 };
/** engine.weather */
export class Weather {
  /**
   * start: initial weather (default 'clear', or the table's first type); types: the game's weather table (default only a
   * calm 'clear'; seven temperate ones in presets.weather.temperate)
   * autoPool autoPool: candidates for automatic weather (repeat a name to make it likelier); autoInterval [min, max] seconds
   * lightningFirst: seconds to the first bolt once a stormy type holds (default 5); lightningInterval [min, max] seconds between later bolts (default [6, 20]).
   * Options, not constants: a game's storm rhythm (a bolt every few seconds in a horror level, rare far thunder in a calm one) is its own decision
   * @internal
   */
  constructor(engine, { start, types, autoPool, autoInterval = [90, 240], transition = 25, lightningFirst = 5, lightningInterval = [6, 20] } = {}) {
    /** @internal */ this.engine = engine;
    const st = engine.style.weather || {};   // checked by the look half (weatherLook.js); here only its types fill the table
    // The game's table is the whole list (a desert game has no snow, a space station no rain); without one only a calm 'clear'.
    // The style only fills fields of types the table has (its look of 'storm'), it never adds a kind of weather to a game.
    if (types !== undefined && (!types || typeof types !== 'object' || !Object.keys(types).length)) throw codedError('weather-option', ERR.types.replace('{got}', JSON.stringify(types)));
    const table = types ?? ONLY_CLEAR;
    /**
     * The weather types this game has: name -> numbers (the standard fields plus any of the game's own, all blended on change) @type {Record<string,
     * WeatherPreset>}
     */
    this.types = {};
    for (const k of Object.keys(table)) {
      // calm, then the style's look, then the game's own numbers (a preset the game picked counts as the game's)
      const v = { ...CALM, ...(st.types?.[k] || {}), ...table[k] };
      for (const f in v) if (typeof v[f] !== 'number') throw codedError('weather-option', ERR.field.replace('{k}', k).replace('{f}', f).replace('{got}', JSON.stringify(v[f])));
      this.types[k] = v;
    }
    // a game field one type has ('heat' on 'heatwave') is 0 on the others, so a change always blends between two numbers
    for (const v of Object.values(this.types)) for (const o of Object.values(this.types)) for (const f in o) v[f] ??= 0;
    start ??= this.types.clear ? 'clear' : Object.keys(this.types)[0];
    if (!this.types[start]) throw codedError('weather-option', ERR.start.replace('{got}', start).replace('{list}', Object.keys(this.types).join(', ')));
    /** Current (mid-transition) weather parameters @type {WeatherPreset} */
    this.current = { ...this.types[start] };
    /** @internal */ this.from = { ...this.current };
    /** @internal */ this.to = { ...this.current };
    /** @internal */ this.t = 1;
    /** @internal */ this.dur = 1;
    /** Current weather name @type {string} */
    this.name = start;
    /** Automatic weather on/off @type {boolean} */
    this.auto = false;
    /** @internal */ this.autoTimer = 0;
    /** Candidates for automatic weather (repeat a name to make it likelier) @type {string[]} */
    this.autoPool = [...(autoPool || Object.keys(this.types))];
    for (const k of this.autoPool) if (!this.types[k]) throw codedError('weather-option', ERR.pool.replace('{got}', k).replace('{list}', Object.keys(this.types).join(', ')));
    /** Automatic weather interval [min, max] seconds @type {number[]} */
    this.autoInterval = autoInterval;
    /** Transition seconds for automatic weather @type {number} */
    this.autoTransition = transition;
    /** Seconds to the first bolt (also after a load without a saved timer) @type {number} */
    this.lightningFirst = lightningFirst;
    /** [min, max] seconds between bolts while a type with lightning > 0.5 holds @type {number[]} */
    this.lightningInterval = lightningInterval;
    /** @internal seconds to the next lightning strike while a type with lightning > 0.5 holds */ this.nextBolt = lightningFirst;
  }

  /**
   * Automatic weather on/off
   * @param {boolean} on
   * @returns {void}
   */
  setAuto(on) { this.auto = on; if (on) this.autoTimer = 0; }

  /**
   * Switch weather. seconds: transition seconds, default 15; 0 switches at once (current is the new weather before the next step, so a
   * screenshot or test right after shows all of it). Options in an object like every other engine call: set('rain', 20) throws
   * [module-params] in dev (the old positional form)
   * @param {WeatherName} name
   * @param {{ seconds?: number }} [opts]
   * @returns {void}
   * @example engine.weather.set('rain', { seconds: 20 })
   * @example engine.weather.set('storm', { seconds: 0 })   // at once
   */
  set(name, opts) {
    const { seconds = 15 } = readParams('weather.set()', SET_PARAMS, opts);
    const p = this.types[name];
    if (!p) { warnMissing('weather', name, Object.keys(this.types)); return; }
    const from = this.name;
    if (!(seconds >= 0 && Number.isFinite(seconds))) throw codedError('module-params', `weather.set('${name}', { seconds }) takes seconds >= 0 (0 = at once); got ${seconds}`);
    this.name = name; this.from = { ...this.current }; this.to = { ...p }; this.t = 0; this.dur = seconds;
    // seconds 0: land now, not on the next fixed step (a shot or test right after the call saw the old weather, or 1/3 of a short blend)
    if (seconds === 0) { this.t = 1; for (const key in this.to) this.current[key] = this.to[key]; }
    // once per change of name (the blend then runs over `seconds`); setting the same weather again is not a change
    if (from !== name) this.engine.events.emit('weather:change', { from, to: name });
  }
  /**
   * Display name of a weather (string table weather.<name>, falls back to the name itself); defaults to the current weather
   * @param {string} [name]
   * @returns {string}
   */
  label(name = this.name) { const k = 'weather.' + name; return this.engine.i18n.has(k) ? this.engine.t(k) : name; }

  // fixed step: transitions, automatic weather, lightning timing (gameplay-relevant randomness all uses engine.random); the flash is the look half's
  /**
   * Advance weather transition, automatic weather and lightning (the module calls this itself every fixed step)
   * @param {number} dt
   * @param {boolean} [quiet] true during engine.skip: same state changes, no lightning event (nobody saw it)
   * @returns {void}
   * @internal
   */
  tick(dt, quiet = false) {
    const rnd = this.engine.random;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const k = this.t * this.t * (3 - 2 * this.t);
      // a finished blend lands on `to` exactly: from + (to - from) * 1 is off by a rounding error that depends on where the blend started, so a load
      // or session.newGame (set(name, 0.01) from whatever the last playthrough left) would not give the same weather twice
      for (const key in this.to) this.current[key] = this.t >= 1 ? this.to[key] : this.from[key] + (this.to[key] - this.from[key]) * k;
    }
    if (this.auto) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoTimer = rnd.range(this.autoInterval[0], this.autoInterval[1]);
        this.set(rnd.pick(this.autoPool), { seconds: this.autoTransition });
      }
    }
    if (this.current.lightning > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.nextBolt = rnd.range(this.lightningInterval[0], this.lightningInterval[1]); if (!quiet) this.engine.events.emit('weather:lightning'); }
    }
  }

}

/**
 * Weather: two modules for one engine.use: the state (engine.weather, type 'world') and its look (engine.weatherLook, type 'look'; needs sky)
 * @param {WeatherOptions} [opts]
 * @returns {[ModuleDef<Weather>, ModuleDef<import('./weatherLook.js').WeatherLook>]}
 * @example engine.use(sky(), weather({ types: presets.weather.temperate.types, start: 'clear' }))
 */
export function weather(opts = {}) {
  readParams('weather', WEATHER_PARAMS, opts);
  let w = null;
  const state = {
    name: 'weather', type: 'world', provides: ['weather'], label: 'Weather', params: WEATHER_PARAMS, options: opts, stage: 'environment', before: ['sky'],
    install(e) {
      e.i18n.add(STRINGS);
      w = new Weather(e, opts);
      if (opts.auto) w.auto = true;
      // the transition is saved too (current / from / to / t / dur): a save made 30% into sun -> rain loads 30% in, not as full rain, and fires no
      // weather:change (nothing changed for the player). An older save without those fields loads as a finished switch to its weather
      e.saves.register('weather', {
        save: () => ({ name: w.name, auto: w.auto, autoTimer: w.autoTimer, nextBolt: w.nextBolt, current: { ...w.current }, from: { ...w.from }, to: { ...w.to }, t: w.t, dur: w.dur }),
        load: d => {
          if (!d) return;
          if (Number.isFinite(d.t) && d.current && d.from && d.to && w.types[d.name]) {
            w.name = d.name; w.current = { ...d.current }; w.from = { ...d.from }; w.to = { ...d.to }; w.t = d.t; w.dur = Math.max(0.01, d.dur ?? 1);
          } else w.set(d.name, { seconds: 0 });
          w.auto = d.auto; w.autoTimer = d.autoTimer ?? 0; w.nextBolt = d.nextBolt ?? w.lightningFirst;
        } });
      return w;
    },
    fixed(dt) { w.tick(dt); },
    // engine.skip: fixed hooks do not run, so the skipped fixed steps are replayed here without events (a bolt nobody saw)
    skip(dt) {   // replay the fixed steps (same random draws, same order as stepping, so checkSkip matches); nothing pending = nothing to replay
      if (w.t >= 1 && !w.auto && !(w.current.lightning > 0.5)) return;
      for (let n = Math.round(dt * 60); n > 0; n--) w.tick(1 / 60, true);   // 60 = the engine's fixed steps per second
    },
    // scenario param weather: switch to this weather at once (no transition) and turn off automatic weather, so the scene is reproducible
    applyState(e, { weather: name }) {
      if (!name) return;
      w.set(name, { seconds: 0 }); w.auto = false;
    },
    describe() {
      const c = w.current, r = v => Math.round(v * 100) / 100;
      return { name: w.name, label: w.label(), progress: r(w.t), auto: w.auto, rain: r(c.rain), snow: r(c.snow), fog: r(c.fog), wind: r(c.wind),
        cloud: r(c.cloud), lightning: r(c.lightning) };
    },
  };
  return [state, weatherLookModule({ ...(opts.particles !== undefined && { particles: opts.particles }), ...(opts.area !== undefined && { area: opts.area }) })];
}
