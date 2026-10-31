// Weather: clear, cloudy, overcast, rain, storm, snow, fog. All parameters blend smoothly on change.
// Affects: cloud shadows, sky color, sun intensity, fog distance, wind (plants sway), rain/snow particles, lightning, ambience.
//
// engine.weather.set('rain', 20)   // turn to rain over 20 seconds
// engine.weather.setAuto(true)     // change weather at random (uses engine.random, so step/tests are reproducible and saved)
// Weather display names live in the string table as weather.<name> (describe and the debug panel use them); a game that adds a new weather adds its name with i18n.add.
import * as THREE from 'three';
import { checkOptions, warnMissing } from '../../core/validate.js';
import { rainVert, rainFrag, snowVert, snowFrag } from './shaders.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { WeatherName, WeatherPreset, WeatherOptions } from '../../types/world' */

/**
 * Built-in weather presets
 * @type {Record<WeatherName, WeatherPreset>}
 */
export const WEATHER_PRESETS = {
  clear:  { cloud: 0.15, sun: 1.0, fog: 1.0, wind: 0.8, rain: 0, snow: 0, grey: 0.0, lightning: 0 },
  cloudy: { cloud: 0.45, sun: 0.85, fog: 0.9, wind: 1.1, rain: 0, snow: 0, grey: 0.15, lightning: 0 },
  overcast: { cloud: 0.85, sun: 0.45, fog: 0.75, wind: 1.3, rain: 0, snow: 0, grey: 0.45, lightning: 0 },
  rain:   { cloud: 0.9, sun: 0.35, fog: 0.6, wind: 1.6, rain: 0.6, snow: 0, grey: 0.55, lightning: 0 },
  storm:  { cloud: 1.0, sun: 0.2, fog: 0.45, wind: 2.6, rain: 1.0, snow: 0, grey: 0.7, lightning: 1 },
  snow:   { cloud: 0.85, sun: 0.5, fog: 0.55, wind: 0.9, rain: 0, snow: 1.0, grey: 0.5, lightning: 0 },
  fog:    { cloud: 0.6, sun: 0.55, fog: 0.25, wind: 0.4, rain: 0, snow: 0, grey: 0.5, lightning: 0 },
};
const STRINGS = {
  'zh-CN': { 'weather.clear': '晴', 'weather.cloudy': '多云', 'weather.overcast': '阴', 'weather.rain': '雨', 'weather.storm': '暴雨',
    'weather.snow': '雪', 'weather.fog': '雾', 'weather.auto': '自动变化' },
  en: { 'weather.clear': 'Clear', 'weather.cloudy': 'Cloudy', 'weather.overcast': 'Overcast', 'weather.rain': 'Rain', 'weather.storm': 'Storm',
    'weather.snow': 'Snow', 'weather.fog': 'Fog', 'weather.auto': 'Auto' },
};
const OPTIONS = ['start', 'auto', 'particles', 'presets', 'autoPool', 'autoInterval', 'transition', 'area'];

/** Particle shader material (transparent, no depth write) */
const shaderMat = (vertexShader, fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false });
/** Initial rain/snow particle positions: presentation only, no effect on gameplay */
const scatter = (n, size) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * size; return a; };   // presentation

/** engine.weather */
export class Weather {
  /**
   * start start: initial weather; particles: rain/snow particle count; presets: add/override weather presets
   * autoPool autoPool: candidates for automatic weather (repeat a name to make it likelier); autoInterval [min, max] seconds
   * @internal
   */
  constructor(engine, { start = 'clear', particles = 6000, presets = {}, autoPool, autoInterval = [90, 240], transition = 25, area } = {}) {
    /** @internal */ this.engine = engine;
    const st = engine.style.weather || {};
    // weather parameters (cloud cover, wind...) are mechanism; adjust them in module options or the style pack
    /** All weather presets @type {Record<string, WeatherPreset>} */
    this.presets = {};
    for (const k of new Set([...Object.keys(WEATHER_PRESETS), ...Object.keys(st.presets || {}), ...Object.keys(presets)]))
      this.presets[k] = { ...WEATHER_PRESETS.clear, ...(WEATHER_PRESETS[k] || {}), ...((st.presets || {})[k] || {}), ...(presets[k] || {}) };
    /** Current (mid-transition) weather parameters @type {WeatherPreset} */
    this.current = { ...this.presets[start] };
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
    this.autoPool = autoPool || ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'overcast', 'rain', 'storm', 'fog'].filter(k => this.presets[k]);
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
    this._makeParticles(st, area ?? st.area ?? 40);
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
    if (ss.texture) engine.assets.texture(ss.texture).then(t => { this.snowU.uMap.value = t; this.snowU.uUseMap.value = 1; }).catch(err => console.warn(err.message));
    /** @internal */ this.snow = new THREE.Points(sg, shaderMat(snowVert, snowFrag, this.snowU));
    // rain can also be drawn with a texture (cartoon drops etc.): style pack weather.rain.texture; rain and snow then share the same point-sprite shader
    /** @internal */ this.rainIsPoints = !!rs.texture;
    if (this.rainIsPoints) {
      this.rainU = { ...this.rainU, uPx: { value: rs.size ?? 14 }, uMaxPx: { value: rs.maxSize ?? 8 }, uSway: this.snowU.uSway, uMap: { value: null }, uUseMap: { value: 0 } };
      this.rain.geometry.dispose(); this.rain.material.dispose();   // switched to textured drops, line rain no longer needed
      this.rain = new THREE.Points(sg.clone(), shaderMat(snowVert, snowFrag, this.rainU));
      engine.assets.texture(rs.texture).then(t => { this.rainU.uMap.value = t; this.rainU.uUseMap.value = 1; }).catch(err => console.warn(err.message));
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
   * @param {WeatherName | (string & {})} name
   * @param {number} [seconds]
   * @returns {void}
   */
  set(name, seconds = 15) {
    const p = this.presets[name];
    if (!p) { warnMissing('weather', name, Object.keys(this.presets)); return; }
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

  // per frame (before sky): weather effects go into the sky's 'weather' modifier layer, which sky composites with the others; rain/snow particles follow the camera
  /**
   * Write weather effects into the sky modifier layer and make rain/snow particles follow the camera (the module calls this itself every frame)
   * @param {any} camera
   * @returns {void}
   */
  apply(camera) {
    const c = this.current, L = this._layer;
    const U = this.engine.uniforms, t = this.engine.elapsed;
    U.uCloud.value = c.cloud;
    U.uWind.value = c.wind;
    // fall distance and sway time wrapped here in double precision (see shaders.js)
    this.rainU.uFallOff.value = (t * this.speeds.rain) % this.size;
    this.snowU.uFallOff.value = (t * this.speeds.snow) % this.size;
    this.snowU.uSway.value = t % (20 * Math.PI);
    L.sun = c.sun; L.ambient = 0.75 + 0.25 * c.sun; L.fog = c.fog;
    L.tintAmount = c.grey; L.horizonTintAmount = c.grey * 0.8;
    L.flash = this.flash > 0 ? this.flash * (Math.random() > 0.3 ? 1 : 0.4) * this.flashStrength : 0;   // presentation: flash flickers
    this.engine.sky.modify('weather', L);   // weather depends on sky (requires), so it is always present
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
      if (opts.auto) w.auto = true;
      e.audio.register('thunder', (audio, v, p) => audio.noiseBurst({ type: 'lowpass', freq: p.freq ?? 140, vol: p.volume ?? 0.9, dur: p.duration ?? 3.5,
        bus: 'ambience', rate: 0.4, delay: 0.4 + Math.random() * 1.5 }));   // presentation: thunder delay
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
        cloud: r(c.cloud), lightning: r(c.lightning), rainVisible: w.rain.visible, snowVisible: w.snow.visible };
    },
  };
}
