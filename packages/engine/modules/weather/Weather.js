// Weather: the game's table of weather types (weather({ types })); without one only a calm 'clear' (the engine assumes no climate).
// Seven temperate ones are an opt-in preset: weather(presets.weather.temperate), extend with types: { ...presets.weather.temperate.types, dust: {...} }.
// All fields blend smoothly on change.
// Affects: cloud shadows, sky color, sun intensity, fog distance, wind (plants sway), rain/snow particles, lightning, ambience.
// Particle and lightning looks: style.weather.rain / snow / lightning, engine.look.weather.replace (particles.js, recipes/44).
//
// engine.weather.set('rain', 20)   // turn to rain over 20 seconds
// engine.weather.setAuto(true)     // change weather at random (uses engine.random, so step/tests are reproducible and saved)
// Weather display names live in the string table as weather.<name> (describe and the debug panel use them); a game that adds a new weather adds its name with
// i18n.add.
import * as THREE from 'three';
import { checkOptions, warnMissing, warnOnce } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { makeSystem, updateSystem, dropSystem, RAIN, SNOW } from './particles.js';
import { STRINGS, ERR } from './strings.js';
import { defineWeatherLook } from './look.js';
import { renamed } from '../../core/errorHints.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { WeatherName, WeatherPreset, WeatherOptions } from '../../types/world' */

// The table when the game gives none: one calm type, so engine.weather works without assuming rain, snow or storms exist
const ONLY_CLEAR = { clear: {} };
const STYLE_KEYS = ['area', 'overcastColor', 'lightningBrightness', 'lightning', 'rain', 'snow', 'types'];
const OPTIONS = ['start', 'auto', 'particles', 'types', 'autoPool', 'autoInterval', 'transition', 'area'];
const WEATHER_PARAMS = keysSchema(OPTIONS);
// Fields a type leaves out: calm (no cloud, rain, snow, grey or lightning; normal sun, fog and wind)
const CALM = { cloud: 0, sun: 1, fog: 1, wind: 1, rain: 0, snow: 0, grey: 0, lightning: 0 };
/** engine.weather */
export class Weather {
  /**
   * start: initial weather (default 'clear', or the table's first type); particles: rain/snow particle count; types: the game's weather table (default only a
   * calm 'clear'; seven temperate ones in presets.weather.temperate)
   * autoPool autoPool: candidates for automatic weather (repeat a name to make it likelier); autoInterval [min, max] seconds
   * @internal
   */
  constructor(engine, { start, particles = 6000, types, autoPool, autoInterval = [90, 240], transition = 25, area } = {}) {
    /** @internal */ this.engine = engine;
    const st = engine.style.weather || {};
    checkOptions('style.weather', st, STYLE_KEYS);
    // The game's table is the whole list (a desert game has no snow, a space station no rain); without one only a calm 'clear'.
    // The style pack only fills fields of types the table has (its look of 'storm'), it never adds a kind of weather to a game.
    if (types !== undefined && (!types || typeof types !== 'object' || !Object.keys(types).length)) throw new Error(ERR.types.replace('{got}', JSON.stringify(types)));
    const table = types ?? ONLY_CLEAR;
    /**
     * The weather types this game has: name -> numbers (the standard fields plus any of the game's own, all blended on change) @type {Record<string,
     * WeatherPreset>}
     */
    this.types = {};
    for (const k of Object.keys(table)) {
      // calm, then the style's look, then the game's own numbers (a preset the game picked counts as the game's)
      const v = { ...CALM, ...(st.types?.[k] || {}), ...table[k] };
      for (const f in v) if (typeof v[f] !== 'number') throw new Error(ERR.field.replace('{k}', k).replace('{f}', f).replace('{got}', JSON.stringify(v[f])));
      this.types[k] = v;
    }
    // a game field one type has ('heat' on 'heatwave') is 0 on the others, so a change always blends between two numbers
    for (const v of Object.values(this.types)) for (const o of Object.values(this.types)) for (const f in o) v[f] ??= 0;
    start ??= this.types.clear ? 'clear' : Object.keys(this.types)[0];
    if (!this.types[start]) throw new Error(ERR.start.replace('{got}', start).replace('{list}', Object.keys(this.types).join(', ')));
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
    for (const k of this.autoPool) if (!this.types[k]) throw new Error(ERR.pool.replace('{got}', k).replace('{list}', Object.keys(this.types).join(', ')));
    /** Automatic weather interval [min, max] seconds @type {number[]} */
    this.autoInterval = autoInterval;
    /** Transition seconds for automatic weather @type {number} */
    this.autoTransition = transition;
    /** @internal */ this.flashStrength = st.lightningBrightness ?? 1;
    // lightning look: flash (1 at the strike, fading over a third of a second) -> how bright the sky flashes; default flickers
    if (st.lightning !== undefined && typeof st.lightning !== 'function') throw new Error('style.weather.lightning must be a function (flash 0..1, engine) => sky flash amount, e.g. lightning: f => f * 0.6; return 0 and draw your own bolt on the weather:lightning event');
    /** @internal */ this.lightningLook = st.lightning ?? (f => f * (Math.random() > 0.3 ? 1 : 0.4));   // presentation: flash flickers
    /** @internal */ this.flash = 0;
    /** @internal */ this.nextBolt = 5;
    /** @internal */ this.grey = new THREE.Color(st.overcastColor ?? 0x8c8c8c);
    /** @internal */ this._layer = { sun: 1, ambient: 1, fog: 1, tint: this.grey, tintAmount: 0, horizonTintAmount: 0, flash: 0 };   // reused every frame
    /** Default particle count per system (halved on low-tier devices) @type {number} */
    this.particles = engine.tier === 'low' ? Math.round(particles / 2) : particles;
    /** @internal */ this.area = area ?? st.area ?? 40;
    /** Particle systems drawn now: field -> { field, object, uniforms } (rain / snow when the table has them, plus define()) @type {Map<string, any>} */
    this.systems = new Map();
    // zero cost when unused: a table where nothing ever rains or snows builds no particle meshes
    const { cover, ...snowLook } = st.snow || {};
    for (const [k, base] of [['rain', RAIN], ['snow', SNOW]]) if (Object.values(this.types).some(v => v[k] > 0)) this._build(k, k === 'snow' ? snowLook : st[k] || {}, base);
    // snow cover: foliage / ground season tint moves toward the snow colors as current.snow rises (sky layer cover, layers.js applyCover)
    if (cover !== undefined) {
      checkOptions('style.weather.snow.cover', cover, ['foliage', 'ground', 'strength']);
      if (cover.foliage == null && cover.ground == null) throw new Error("style.weather.snow.cover needs a color for foliage and / or ground, e.g. cover: { foliage: 0xf2f4f6, ground: 0xeef0f2, strength: 0.8 }");
      /** @internal */ this._cover = { strength: cover.strength ?? 0.8 };
      Object.assign(this._layer, { foliageCover: cover.foliage ?? null, groundCover: cover.ground ?? null, coverAmount: 0 });
    }
    defineWeatherLook(this);   // look.weather: the style's rain / snow / lightning values are its style layer
  }

  /**
   * Renamed in 0.2: throws and names the new call, engine.look.weather.replace({ [field]: spec }) (recipes/44-water-weather-look-hooks.md)
   * @param {string} _field
   * @param {import('../../types/style').StyleWeatherParticles} [_spec]
   * @returns {never}
   */
  define(_field, _spec) { return renamed('weatherDefine'); }

  /** @internal */
  _build(field, spec, base) {
    const old = this.systems.get(field);
    if (old) dropSystem(this.engine, old);
    const sys = makeSystem(this.engine, field, spec, { area: this.area, count: this.particles, base });
    this.systems.set(field, sys);
    return sys;
  }

  /**
   * Automatic weather on/off
   * @param {boolean} on
   * @returns {void}
   */
  setAuto(on) { this.auto = on; if (on) this.autoTimer = 0; }

  /**
   * Switch weather. seconds: transition seconds, default 15
   * @param {WeatherName} name
   * @param {number} [seconds]
   * @returns {void}
   */
  set(name, seconds = 15) {
    const p = this.types[name];
    if (!p) { warnMissing('weather', name, Object.keys(this.types)); return; }
    const from = this.name;
    this.name = name; this.from = { ...this.current }; this.to = { ...p }; this.t = 0; this.dur = Math.max(0.01, seconds);
    // once per change of name (the blend then runs over `seconds`); setting the same weather again is not a change
    if (from !== name) this.engine.events.emit('weather:change', { from, to: name });
  }
  /**
   * Display name of a weather (string table weather.<name>, falls back to the name itself); defaults to the current weather
   * @param {string} [name]
   * @returns {string}
   */
  label(name = this.name) { const k = 'weather.' + name; return this.engine.i18n.has(k) ? this.engine.t(k) : name; }

  // fixed step: transitions, automatic weather, lightning (gameplay-relevant randomness all uses engine.random)
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
      for (const key in this.to) this.current[key] = this.from[key] + (this.to[key] - this.from[key]) * k;
    }
    if (this.auto) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoTimer = rnd.range(this.autoInterval[0], this.autoInterval[1]);
        this.set(rnd.pick(this.autoPool), this.autoTransition);
      }
    }
    if (this.current.lightning > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = rnd.range(6, 20); if (!quiet) this.engine.events.emit('weather:lightning'); }
    }
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  // per frame (before sky): weather effects go into the sky's 'weather' modifier layer, which sky composites with the others; rain/snow particles follow the
  // camera
  /**
   * Write weather effects into the sky modifier layer and make rain/snow particles follow the camera (the module calls this itself every frame)
   * @param {any} camera
   * @returns {void}
   * @internal
   */
  apply(camera) {
    const c = this.current, L = this._layer;
    const U = this.engine.uniforms, t = this.engine.elapsed;
    U.uCloud.value = c.cloud;
    U.uWind.value = c.wind;
    L.sun = c.sun; L.ambient = 0.75 + 0.25 * c.sun; L.fog = c.fog;
    L.tintAmount = c.grey; L.horizonTintAmount = c.grey * 0.8;
    L.flash = this.flash > 0 ? this.lightningLook(this.flash, this.engine) * this.flashStrength : 0;
    if (this._cover) L.coverAmount = (c.snow ?? 0) * this._cover.strength;
    this.engine.sky.modify('weather', L);   // weather depends on sky (requires), so it is always present
    for (const sys of this.systems.values()) updateSystem(sys, c[sys.field] ?? 0, camera, t, c.wind);
  }
}

/**
 * Weather → engine.weather (install sky first)
 * @param {WeatherOptions} [opts]
 * @returns {ModuleDef<Weather>}
 */
export function weather(opts = {}) {
  readParams('weather', WEATHER_PARAMS, opts);
  let w = null;
  return {
    name: 'weather', label: 'Weather', params: WEATHER_PARAMS, options: opts, requires: ['sky'], stage: 'environment', before: ['sky'],
    install(e) {
      e.i18n.add(STRINGS);
      w = new Weather(e, opts);
      e.audio.condition('weather', v => [].concat(v).includes(w.name));   // audio rule condition { weather: 'rain' | ['rain', 'storm'] }
      for (const k of ['rain', 'snow', 'wind']) e.audio.measure(k, () => w.current[k]);   // data rules: { rain: { lt: 0.2 } }, volume add: { rain: 0.22 }
      if (opts.auto) w.auto = true;
      e.audio.register('thunder', (audio, p, out) => { const dur = p.duration ?? 3.5, delay = 0.4 + Math.random() * 1.5;   // presentation: thunder delay
        audio.noiseBurst({ type: 'lowpass', freq: p.freq ?? 140, vol: p.volume ?? 0.9, dur, rate: 0.4 * p.pitch, delay, out }); return delay + dur; },
      { builtIn: true, bus: 'ambience' });
      e.events.on('weather:lightning', () => e.audio.sfx('thunder'));
      e.saves.register('weather', { save: () => ({ name: w.name, auto: w.auto, autoTimer: w.autoTimer, nextBolt: w.nextBolt }),
        load: d => { if (!d) return; w.set(d.name, 0.01); w.auto = d.auto; w.autoTimer = d.autoTimer ?? 0; w.nextBolt = d.nextBolt ?? 5; } });
      return w;
    },
    fixed(dt) { w.tick(dt); },
    // engine.skip: fixed hooks do not run, so the skipped fixed steps are replayed here without events (a bolt nobody saw)
    skip(dt) {   // replay the fixed steps (same random draws, same order as stepping, so checkSkip matches); nothing pending = nothing to replay
      if (w.t >= 1 && !w.auto && !(w.current.lightning > 0.5)) return;
      for (let n = Math.round(dt * 60); n > 0; n--) w.tick(1 / 60, true);   // 60 = the engine's fixed steps per second
    },
    frame(dt, e) { w.apply(e.camera); },
    // scenario param weather: switch to this weather at once (no transition) and turn off automatic weather, so the scene is reproducible
    applyState(e, { weather: name }) {
      if (!name) return;
      w.set(name, 0.01); w.auto = false;
      if (w.name === name) { w.current = { ...w.to }; w.t = 1; }
    },
    describe() {
      const c = w.current, r = v => Math.round(v * 100) / 100;
      return { name: w.name, label: w.label(), progress: r(w.t), auto: w.auto, rain: r(c.rain), snow: r(c.snow), fog: r(c.fog), wind: r(c.wind),
        cloud: r(c.cloud), lightning: r(c.lightning), rainVisible: !!w.systems.get('rain')?.object.visible, snowVisible: !!w.systems.get('snow')?.object.visible };
    },
  };
}
