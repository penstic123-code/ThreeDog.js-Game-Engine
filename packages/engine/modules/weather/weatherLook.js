// The look half of weather() (type 'look', engine.weatherLook): what the current weather looks and sounds like. It only reads engine.weather
// (the state half, Weather.js) and never changes it, so a game can replace this half (engine.use(myRain(), { replaces: 'weatherLook' })) and keep the
// weather table, its save and its events.
//   effects on the look values (effect layer): sun / hemi intensity, fog far, sky tint, lightning flash, snow cover
//   rain / snow particles that follow the camera (look.weather, look.js), cloud shadows and wind uniforms, thunder, audio rule conditions
import * as THREE from 'three';
import { builtInSounds } from '../../core/assetManifest.js';
import { readParams, keysSchema, isOptions } from '../../core/params.js';
import { codedError } from '../../core/errorHints.js';
import { onRendererSwap } from '../../render/backend.js';
import { makeSystem, updateSystem, dropSystem, RAIN, SNOW } from './particles.js';
import { defineWeatherLook } from './look.js';

const LOOK_PARAMS = keysSchema(['particles', 'area']);   // the look options of weather(): the rest are the state's
const STYLE_KEYS = ['area', 'overcastColor', 'lightningBrightness', 'lightning', 'rain', 'snow', 'types'];

/** engine.weatherLook: particles and look effects of the current weather */
export class WeatherLook {
  /**
   * @internal
   * @param {any} engine
   * @param {{ particles?: number, area?: number }} [opts]
   */
  constructor(engine, { particles = 6000, area = undefined } = {}) {
    /** @internal */ this.engine = engine;
    /** @internal the state half: read only */ this.state = engine.weather;
    const st = engine.style.weather || {};
    readParams('style.weather', keysSchema(STYLE_KEYS), st);
    /** @internal */ this.flashStrength = st.lightningBrightness ?? 1;
    // lightning look: flash (1 at the strike, fading over a third of a second) -> how bright the sky flashes; default flickers
    if (st.lightning !== undefined && typeof st.lightning !== 'function') throw codedError('weather-option', 'style.weather.lightning must be a function (flash 0..1, engine) => sky flash amount, e.g. lightning: f => f * 0.6; return 0 and draw your own bolt on the weather:lightning event');
    /** @internal */ this.lightningLook = st.lightning ?? (f => f * (Math.random() > 0.3 ? 1 : 0.4));   // presentation: flash flickers
    /** Sky flash now, 1 at a strike (the weather:lightning event) fading to 0 @type {number} */
    this.flash = 0;
    /** @internal */ this.grey = new THREE.Color(st.overcastColor ?? 0x8c8c8c);
    // the weather's entries on the look points: taken once through ctx.mod (owned by this module, gone with it) and rewritten every frame with
    // handle.change (core/sharedPoint.js), so a frame adds no entry and no cleanup handle. ctx is set by the module's install
    /** @internal */ this._ctx = null; /** @internal */ this._h = {};
    /** @internal */ this._tint = { color: this.grey, amount: 0, horizon: 0 };
    /** Default particle count per system (halved on low-tier devices) @type {number} */
    this.particles = engine.tier === 'low' ? Math.round(particles / 2) : particles;
    /** @internal */ this.area = area ?? st.area ?? 40;
    /** Particle systems drawn now: field -> { field, object, uniforms } (rain / snow when the table has them, plus fields look.weather.replace adds) @type {Map<string, any>} */
    this.systems = new Map();
    // zero cost when unused: a table where nothing ever rains or snows builds no particle meshes
    const { cover, ...snowLook } = st.snow || {};
    for (const [k, base] of /** @type {[string, any][]} */ ([['rain', RAIN], ['snow', SNOW]])) if (Object.values(this.types).some(v => v[k] > 0)) this._build(k, k === 'snow' ? snowLook : st[k] || {}, base);
    // snow cover: foliage / ground season tint moves toward the snow colors as current.snow rises (look.ground.cover)
    if (cover !== undefined) {
      if (isOptions(cover)) readParams('style.weather.snow.cover', keysSchema(['foliage', 'ground', 'strength']), cover);
      if (cover.foliage == null && cover.ground == null) throw codedError('weather-option', "style.weather.snow.cover needs a color for foliage and / or ground, e.g. cover: { foliage: 0xf2f4f6, ground: 0xeef0f2, strength: 0.8 }");
      /** @internal */ this._cover = { strength: cover.strength ?? 0.8 };
      /** @internal */ this._coverMod = { foliage: cover.foliage ?? null, ground: cover.ground ?? null, amount: 0 };
    }
    defineWeatherLook(this);   // look.weather: the style's rain / snow / lightning values are its style layer
  }

  /** @internal the weather table (state half), read by look.js */
  get types() { return this.state.types; }

  /** @internal */
  _build(field, spec, base) {
    const old = this.systems.get(field);
    if (old) dropSystem(this.engine, old);
    const sys = makeSystem(this.engine, field, spec, { area: this.area, count: this.particles, base });
    sys.made = { spec, base };   // what built it: the renderer swap builds it again from the same values (look / replace included)
    this.systems.set(field, sys);
    return sys;
  }

  /**
   * @internal fallback 'webgl': systems built before start() carry WebGPURenderer node materials; rebuild them for the renderer in use.
   * A replace() create(engine) object is the game's own and stays (the scene check names it if WebGL cannot draw it).
   */
  _rendererSwapped() {
    for (const [f, sys] of [...this.systems]) if (!sys.own) this._build(f, sys.made.spec, sys.made.base);
  }

  /**
   * Write the current weather into the 'weather' entries on the look values and move rain / snow with the camera (the module calls this every frame)
   * @param {any} camera
   * @param {number} [dt] real seconds since the last frame (the flash fades with it)
   * @returns {void}
   * @internal
   */
  apply(camera, dt = 0) {
    const c = this.state.current, e = this.engine, T = this._tint;
    const U = e.uniforms, t = e.time.now('real');
    this.flash = Math.max(0, this.flash - dt * 3);
    U.uCloud.value = c.cloud;
    U.uWind.value = c.wind;
    // effects on the look values a game sets: the game's sun 3 in rain shows 3 x c.sun (the effect layer, core/sharedPoint.js)
    this._put('look.lights.sun.intensity', 'mul', c.sun);
    this._put('look.lights.hemi.intensity', 'mul', 0.75 + 0.25 * c.sun);
    if (e.stacks.has('look.fog.far')) this._put('look.fog.far', 'mul', c.fog);
    T.amount = c.grey; T.horizon = c.grey * 0.8; this._put('look.sky.tint', 'value', T);
    this._put('look.sky.flash', 'add', this.flash > 0 ? this.lightningLook(this.flash, e) * this.flashStrength : 0);
    if (this._cover) { this._coverMod.amount = (c.snow ?? 0) * this._cover.strength; this._put('look.ground.cover', 'value', this._coverMod); }   // requires sky: the look points exist
    for (const sys of this.systems.values()) updateSystem(sys, c[sys.field] ?? 0, camera, t, c.wind);
  }
  /** @internal one look contribution: taken on first use (a point may appear later, look.fog.far with fog), then changed in place */
  _put(point, op, v) {
    // change() is false when the entry is gone (a point cleared on a new session): take it again, as the old per-frame take did anyway
    if (this._h[point]?.change(v)) return;
    const o = op === 'value' ? { value: v } : { [op]: v, layer: 'effect' };   // tint / cover are data points (value), the rest effect-layer numbers
    this._h[point] = this._ctx ? this._ctx.mod(point, o) : this.engine.mod(point, { ...o, owner: 'weatherLook' });
  }
}

/**
 * @internal the look half of weather(opts) (weather() returns both; install them together)
 * @param {{ particles?: number, area?: number }} opts
 */
export function weatherLookModule(opts) {
  readParams('weather (look half)', LOOK_PARAMS, opts);
  let L = null;
  return {
    name: 'weatherLook', type: 'look', provides: ['weatherLook'], label: 'Weather look', params: LOOK_PARAMS, options: opts, requires: ['weather', 'sky'], stage: 'environment', before: ['sky'], after: ['weather'],
    install(e, ctx) { e.i18n.add({ 'zh-CN': { 'module.weatherLook': '天气外观' }, en: { 'module.weatherLook': 'weather look' } });
      L = new WeatherLook(e, opts);
      L._ctx = ctx;   // the weather's entries on the look points go with this module (ctx.mod): removing it gives the game's values back unscaled
      ctx.track(onRendererSwap(e, () => L._rendererSwapped()));
      const w = e.weather;
      ctx.track(e.audio.condition('weather', v => [].concat(v).includes(w.name)));   // audio rule condition { weather: 'rain' | ['rain', 'storm'] }
      for (const k of ['rain', 'snow', 'wind']) ctx.track(e.audio.measure(k, () => w.current[k]));   // data rules: { rain: { lt: 0.2 } }, volume add: { rain: 0.22 }
      builtInSounds(e.assets, { thunder: (audio, p, out) => { const dur = p.duration ?? 3.5, delay = 0.4 + Math.random() * 1.5;   // presentation: thunder delay
        audio.noiseBurst({ type: 'lowpass', freq: p.freq ?? 140, vol: p.volume ?? 0.9, dur, rate: 0.4 * p.pitch, delay, out }); return delay + dur; } },
      { bus: 'ambience' });   // sound asset 'thunder', silent until audio.sounds names it
      ctx.track(e.events.on('weather:lightning', () => { L.flash = 1; e.audio.sfx('thunder'); }));
      return L;
    },
    frame(dt, e) { L.apply(e.camera, dt); },
    describe: () => ({ rainVisible: !!L.systems.get('rain')?.object.visible, snowVisible: !!L.systems.get('snow')?.object.visible, flash: Math.round(L.flash * 100) / 100 }),
  };
}
