// Ambience module: wind, rain, water, birds, night insects; changes automatically with weather, time and place.
// Uses sky/weather/terrain module data when present; otherwise defaults (daytime, no wind, no rain).
//
// Sound sources come from the style pack's style.ambience; each entry can be:
//   'synth'          synthesized (default, no files needed)
//   '/sounds/x.ogg'  a looping recording (wind, rain, water, day, night) or random one-shot clips (birds, insects; an array is allowed)
//   false            off
// Bird and insect timing and pitch randomness only affect sound (not gameplay), so they use Math.random and carry // presentation.
// style.ambience = { wind: 'synth', rain: '/sounds/rain.ogg', water: 'synth', birds: ['/sounds/b1.ogg', '/sounds/b2.ogg'], crickets: 'synth', day: false, night: false }

import { checkOptions } from '../../core/validate.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { AmbienceOptions } from '../../types/gameplay' */

/** engine.ambience */
export class Ambience {
  /** @internal */
  constructor(engine, opts = {}) {
    /** @internal */ this.engine = engine;
    /** Sound source config @type {Record<string, any>} */
    // birds and crickets are a setting's flavor, not every game's: off unless the style pack (lowpoly turns them on) or ambience({ birds }) says so
    this.cfg = { wind: 'synth', rain: 'synth', water: 'synth', birds: false, crickets: false, day: false, night: false, ...(engine.style.ambience || {}), ...opts };
    // Synth parameters (override via style pack style.ambience.synth)
    /** Synth parameters @type {Record<string, any>} */
    this.p = { windVolume: 0.5, rainVolume: 0.22, waterVolume: 0.12, birdPitch: [2200, 4000], birdVolume: 0.04, birdGap: [1.5, 6.5],
      cricketPitch: 4300, cricketVolume: 0.02, cricketGap: [0.4, 1.6], waterRadius: 12, ...(this.cfg.synth || {}) };
    /** @internal */ this.loops = null;
    /** @internal */ this._bird = 2;
    /** @internal */ this._cricket = 1;
  }

  /** @internal */
  _setup() {
    const a = this.engine.audio, ctx = a.ctx, cfg = this.cfg;
    this.loops = {};
    const synth = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = a.noise; src.loop = true; src.playbackRate.value = 0.5 + Math.random() * 0.5;   // presentation
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(a.bus.ambience); src.start();
      return { g, f };
    };
    const file = url => {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(a.bus.ambience);
      a.load(url).then(buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(g); s.start(); }).catch(err => console.warn(err.message));
      return { g, f: null };
    };
    const make = (key, ...synthArgs) => { const v = cfg[key]; if (!v) return null; return v === 'synth' ? synth(...synthArgs) : file(v); };
    this.loops.wind = make('wind', 'bandpass', 400, 0.6);
    this.loops.rain = make('rain', 'highpass', 1800, 0.3);
    this.loops.rainLow = cfg.rain === 'synth' ? synth('lowpass', 500, 0.5) : null;
    this.loops.water = make('water', 'lowpass', 700, 1.0);
    this.loops.day = cfg.day && cfg.day !== 'synth' ? file(cfg.day) : null;
    this.loops.night = cfg.night && cfg.night !== 'synth' ? file(cfg.night) : null;
  }

  /** @internal */
  _ramp(loop, v, t = 0.8) { if (loop) loop.g.gain.setTargetAtTime(v, this.engine.audio.ctx.currentTime, t); }

  /**
   * Per-frame update: tunes each sound by weather, time and place (the module calls it every frame)
   * @param {number} dt
   * @returns {void}
   */
  update(dt) {
    const e = this.engine, a = e.audio;
    if (!a.ctx || a.ctx.state !== 'running') { if (a.ctx?.state === 'suspended') a.ctx.resume(); return; }
    if (!this.loops) this._setup();
    this._acc = (this._acc || 0) + dt;
    if (this._acc < 0.25) return;   // ambience only needs updating every 0.25 s
    dt = this._acc; this._acc = 0;
    const w = e.weather?.current || { wind: 0.8, rain: 0, snow: 0 };
    const day = e.sky ? e.sky.daylight : 1;   // daylight comes from sky only
    const p = e.actorPosition() ?? e.focus;   // sounds around whoever the user controls (engine.actor)
    const h = e.surface(p.x, p.z), alt = Math.max(0, h) / 40, t = e.elapsed;
    const gust = 0.7 + 0.3 * Math.sin(t * 0.37) * Math.sin(t * 0.13);
    const L = this.loops;
    this._ramp(L.wind, Math.min(this.p.windVolume, (0.05 + w.wind * 0.08 + alt * 0.15) * gust));
    if (L.wind?.f) L.wind.f.frequency.setTargetAtTime(250 + w.wind * 180 * gust, a.ctx.currentTime, 0.8);
    this._ramp(L.rain, w.rain * this.p.rainVolume, 1); this._ramp(L.rainLow, w.rain * this.p.rainVolume * 0.8, 1);
    let nearWater = 0;
    for (let ang = 0; ang < 6.28; ang += 1.05) { const qx = p.x + Math.cos(ang) * this.p.waterRadius, qz = p.z + Math.sin(ang) * this.p.waterRadius; if (e.surface(qx, qz) < e.waterAt(qx, qz)) nearWater += 1 / 6; }
    this._ramp(L.water, nearWater * this.p.waterVolume, 1);
    this._ramp(L.day, day * (1 - w.rain) * 0.3, 2); this._ramp(L.night, (1 - Math.min(1, day * 5)) * (1 - w.rain) * 0.3, 2);

    this._bird -= dt; this._cricket -= dt;
    if (this._bird <= 0) { this._bird = this.p.birdGap[0] + Math.random() * (this.p.birdGap[1] - this.p.birdGap[0]); if (day > 0.15 && w.rain < 0.2) this._oneShot('birds', () => this._synthBird()); }   // presentation
    if (this._cricket <= 0) { this._cricket = this.p.cricketGap[0] + Math.random() * (this.p.cricketGap[1] - this.p.cricketGap[0]); if (day < 0.05 && w.rain < 0.2 && w.snow < 0.2) this._oneShot('crickets', () => this._synthCricket()); }   // presentation
  }

  /** @internal */
  _oneShot(key, synth) {
    const v = this.cfg[key]; if (!v) return;
    if (v === 'synth') return synth();
    const url = Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v;   // presentation
    this.engine.audio.play(url, { channel: 'ambience', volume: 0.5 + Math.random() * 0.5 }).catch(err => console.warn(err.message));   // presentation
  }
  /** @internal */
  _synthBird() {
    const a = this.engine.audio, [lo, hi] = this.p.birdPitch, base = lo + Math.random() * (hi - lo), notes = 2 + Math.floor(Math.random() * 4), pan = Math.random() * 2 - 1;   // presentation
    let t = 0;
    for (let i = 0; i < notes; i++) { a.tone({ freq: base * (1 + Math.random() * 0.3), to: base * (0.7 + Math.random() * 0.6), dur: 0.08, vol: this.p.birdVolume, bus: 'ambience', delay: t, pan }); t += 0.09 + Math.random() * 0.06; }   // presentation
  }
  /** @internal */
  _synthCricket() {
    const a = this.engine.audio, pan = Math.random() * 2 - 1;   // presentation
    for (let i = 0; i < 3; i++) a.tone({ freq: this.p.cricketPitch + Math.random() * 200, dur: 0.035, vol: this.p.cricketVolume, bus: 'ambience', delay: i * 0.05, pan });   // presentation
  }
}

/**
 * Ambience -> engine.ambience
 * @param {AmbienceOptions} [opts]
 * @returns {ModuleDef<Ambience>}
 */
export function ambience(opts = {}) {
  let a = null;
  return { name: 'ambience', label: 'Ambience', optional: ['sky', 'weather'], stage: 'late', presentation: true, install(e) { checkOptions('ambience()', opts, ['wind', 'rain', 'water', 'birds', 'crickets', 'day', 'night', 'synth']); a = new Ambience(e, opts); return a; }, frame(dt) { a.update(dt); } };
}
