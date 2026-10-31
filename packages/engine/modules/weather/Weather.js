// Weather: the game's table of weather types (weather({ types })); without one only a calm 'clear' (the engine assumes no climate).
// Seven temperate ones are an opt-in preset: weather(presets.weather.temperate), extend with types: { ...presets.weather.temperate.types, dust: {...} }.
// All fields blend smoothly on change.
// Affects: cloud shadows, sky color, sun intensity, fog distance, wind (plants sway), rain/snow particles, lightning, ambience.
//
// engine.weather.set('rain', 20)   // turn to rain over 20 seconds
// engine.weather.setAuto(true)     // change weather at random (uses engine.random, so step/tests are reproducible and saved)
// Weather display names live in the string table as weather.<name> (describe and the debug panel use them); a game that adds a new weather adds its name with
// i18n.add.
import * as THREE from 'three';
import { checkOptions, warnMissing, warnOnce } from '../../core/validate.js';
import { rainVert, rainFrag, snowVert, snowFrag } from './shaders.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { WeatherName, WeatherPreset, WeatherOptions } from '../../types/world' */

// The table when the game gives none: one calm type, so engine.weather works without assuming rain, snow or storms exist
const ONLY_CLEAR = { clear: {} };
const STRINGS = {
  'zh-CN': { 'weather.clear': '晴', 'weather.cloudy': '多云', 'weather.overcast': '阴', 'weather.rain': '雨', 'weather.storm': '暴雨',
    'weather.snow': '雪', 'weather.fog': '雾', 'weather.auto': '自动变化' },
  en: { 'weather.clear': 'Clear', 'weather.cloudy': 'Cloudy', 'weather.overcast': 'Overcast', 'weather.rain': 'Rain', 'weather.storm': 'Storm',
    'weather.snow': 'Snow', 'weather.fog': 'Fog', 'weather.auto': 'Auto' },
};
const OPTIONS = ['start', 'auto', 'particles', 'types', 'autoPool', 'autoInterval', 'transition', 'area'];
// Fields a type leaves out: calm (no cloud, rain, snow, grey or lightning; normal sun, fog and wind)
const CALM = { cloud: 0, sun: 1, fog: 1, wind: 1, rain: 0, snow: 0, grey: 0, lightning: 0 };
const ERR = {
  types: "weather({ types }): the game's weather table, name -> { cloud, sun, fog, wind, rain, snow, grey, lightning } (left-out fields are calm), at least one; got {got}. Seven temperate ones: weather(presets.weather.temperate) with presets from 'threedog'",
  field: "weather type '{k}': field {f} must be a number (every field blends smoothly on change); got {got}",
  start: "weather({ start }): '{got}' is not one of this game's weather types ({list})",
  pool: "weather({ autoPool }): '{got}' is not one of this game's weather types ({list})",
};

/** Particle shader material (transparent, no depth write) */
const shaderMat = (vertexShader, fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false });
/** Initial rain/snow particle positions: presentation only, no effect on gameplay */
const scatter = (n, size) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * size; return a; };   // presentation

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
    /** @internal */ this.rainSlant = st.rain?.slant ?? 1;
    /** @internal */ this.flash = 0;
    /** @internal */ this.nextBolt = 5;
    /** @internal */ this.grey = new THREE.Color(st.overcastColor ?? 0x8c8c8c);
    /** @internal */ this._layer = { sun: 1, ambient: 1, fog: 1, tint: this.grey, tintAmount: 0, horizonTintAmount: 0, flash: 0 };   // reused every frame
    /** Rain/snow particle count @type {number} */
    this.particles = engine.tier === 'low' ? Math.round(particles / 2) : particles;
    // zero cost when unused: a table where nothing ever rains or snows builds no particle meshes (rain / snow stay null)
    /** @internal */ this.rain = null;
    /** @internal */ this.snow = null;
    if (Object.values(this.types).some(v => v.rain > 0 || v.snow > 0)) this._makeParticles(st, area ?? st.area ?? 40);
  }

  // rain (line segments or textured points), snow (points); area: coverage in meters (a cube centered on the camera)
  /** @internal */
  _makeParticles(st, size) {
    const engine = this.engine, rs = st.rain || {}, ss = st.snow || {}, n = this.particles;
    // rain: each drop is a short line (two vertices); position loops downward in the shader, zero CPU cost
    const p3 = scatter(n * 3, size), rp = new Float32Array(n * 6), re = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { rp.set([p3[i * 3], p3[i * 3 + 1], p3[i * 3 + 2]], i * 6); rp.set([p3[i * 3], p3[i * 3 + 1], p3[i * 3 + 2]], i * 6 + 3); re[i * 2 + 1] = 1; }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    /** @internal */ this.size = size;
    /** @internal fall speeds (m/s); the shaders get the fall distance wrapped on the CPU */ this.speeds = { rain: rs.speed ?? 22, snow: ss.speed ?? 1.6 };
    /** @internal */ this.rainU = { uCam: { value: new THREE.Vector3() }, uSize: { value: size }, uFallOff: { value: 0 },
      uWindDir: { value: new THREE.Vector2(1, 0.3) }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(rs.color ?? 0xc8c8c8) }, uLen: { value: rs.length ?? 0.7 } };
    /** @internal */ this.rainOpacity = rs.opacity ?? 0.55;
    /** @internal */ this.rain = new THREE.LineSegments(rg, shaderMat(rainVert, rainFrag, this.rainU));

    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(scatter(n * 3, size), 3));
    /** @internal */ this.snowU = { uCam: this.rainU.uCam, uSize: { value: size }, uPx: { value: ss.size ?? 20 }, uMaxPx: { value: ss.maxSize ?? 5 },
      uFallOff: { value: 0 }, uSway: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(ss.color ?? 0xffffff) }, uMap: { value: null }, uUseMap: { value: 0 } };
    /** @internal */ this.snowOpacity = ss.opacity ?? 0.9;
    if (ss.texture) engine.assets.texture(ss.texture).then(t => { this.snowU.uMap.value = t; this.snowU.uUseMap.value = 1; }).catch(err => warnOnce(err.message));
    /** @internal */ this.snow = new THREE.Points(sg, shaderMat(snowVert, snowFrag, this.snowU));
    // rain can also be drawn with a texture (cartoon drops etc.): style pack weather.rain.texture; rain and snow then share the same point-sprite shader
    /** @internal */ this.rainIsPoints = !!rs.texture;
    if (this.rainIsPoints) {
      this.rainU = { ...this.rainU, uPx: { value: rs.size ?? 14 }, uMaxPx: { value: rs.maxSize ?? 8 }, uSway: this.snowU.uSway, uMap: { value: null }, uUseMap: { value: 0 } };
      this.rain.geometry.dispose(); this.rain.material.dispose();   // switched to textured drops, line rain no longer needed
      this.rain = new THREE.Points(sg.clone(), shaderMat(snowVert, snowFrag, this.rainU));
      engine.assets.texture(rs.texture).then(t => { this.rainU.uMap.value = t; this.rainU.uUseMap.value = 1; }).catch(err => warnOnce(err.message));
    }
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.visible = false; o.userData.budgetTag = 'weather'; }
    this.rain.name = 'weather-rain'; this.snow.name = 'weather-snow';
    engine.scene.add(this.rain, this.snow);
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
    this.name = name; this.from = { ...this.current }; this.to = { ...p }; this.t = 0; this.dur = Math.max(0.01, seconds);
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
   * @returns {void}
   * @internal
   */
  tick(dt) {
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
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = rnd.range(6, 20); this.engine.events.emit('weather:lightning'); }
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
    L.flash = this.flash > 0 ? this.flash * (Math.random() > 0.3 ? 1 : 0.4) * this.flashStrength : 0;   // presentation: flash flickers
    this.engine.sky.modify('weather', L);   // weather depends on sky (requires), so it is always present
    if (!this.rain) return;   // this game's weather never rains or snows: no particles were built
    // fall distance and sway time wrapped here in double precision (see shaders.js)
    this.rainU.uFallOff.value = (t * this.speeds.rain) % this.size;
    this.snowU.uFallOff.value = (t * this.speeds.snow) % this.size;
    this.snowU.uSway.value = t % (20 * Math.PI);
    this.rainU.uCam.value.copy(camera.position);
    this.rainU.uOpacity.value = c.rain * this.rainOpacity; this.rain.visible = c.rain > 0.02;
    this.rain.geometry.setDrawRange(0, Math.floor(this.particles * Math.min(1, c.rain * 1.2)) * (this.rainIsPoints ? 1 : 2));
    this.rainU.uWindDir.value.set(c.wind * this.rainSlant, c.wind * this.rainSlant * 0.3);
    this.snowU.uOpacity.value = c.snow * this.snowOpacity; this.snow.visible = c.snow > 0.02;
  }
}

/**
 * Weather → engine.weather (install sky first)
 * @param {WeatherOptions} [opts]
 * @returns {ModuleDef<Weather>}
 */
export function weather(opts = {}) {
  let w = null;
  return {
    name: 'weather', label: 'Weather', requires: ['sky'], stage: 'environment', before: ['sky'],
    install(e) {
      checkOptions('weather()', opts, OPTIONS);
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
        cloud: r(c.cloud), lightning: r(c.lightning), rainVisible: !!w.rain?.visible, snowVisible: !!w.snow?.visible };
    },
  };
}
