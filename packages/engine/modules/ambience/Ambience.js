// Ambience module: a rule table of background sounds. Each rule names a sound from audio.sounds and says when and how loud it plays:
//
//   createEngine({ audio: {
//     sounds: { wind: 'synth', cave: '/sfx/cave-drip.ogg', crows: ['/sfx/crow1.ogg', '/sfx/crow2.ogg'] },
//     ambience: [
//       { sound: 'wind', volume: e => 0.1 + (e.weather?.current.wind ?? 0) * 0.1 },   // a loop; volume may be a function of the moment
//       { sound: 'cave', when: { zone: 'cave' }, volume: 0.6, fade: 2 },             // condition keys: zone (triggers), time (sky), weather, state
//       { sound: 'crows', when: { time: 'day' }, every: [4, 12] },                  // every: a one-shot at random gaps instead of a loop
//     ] } });
//   engine.use(ambience());          // openWorld() installs it
//
// The engine plays nothing unless a rule asks. Built-in synths (wind, rain, water, birds, crickets) are registered silent and only play
// when the game's audio.sounds names them ('synth'). A rule that is off fades out and its loop stops, so unused rules cost nothing.
// Timing of one-shots only affects sound (not gameplay), so it uses Math.random and carries // presentation.

import * as THREE from 'three';
import { checkOptions } from '../../core/validate.js';
/** @import { ModuleDef, AmbienceRule } from '../../types/core' */
/** @import { AmbienceOptions } from '../../types/gameplay' */
const RULE_KEYS = ['sound', 'when', 'volume', 'fade', 'every', 'bus'];
const gap = r => r.every[0] + Math.random() * (r.every[1] - r.every[0]);   // presentation

/** engine.ambience: the rule table of background sounds */
export class Ambience {
  /** @internal */
  constructor(engine, opts = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.interval = opts.interval ?? 0.25;
    /** @internal */ this._acc = 0;
    /** @internal @type {{ rule: AmbienceRule, voice: any, level: number, offT: number, next: number }[]} */
    this._rules = [];
    /** Where the sounds are heard from: whoever the player controls (engine.actor), else the camera focus @type {THREE.Vector3} */
    this.position = new THREE.Vector3();
    for (const r of [...(engine.audio.config.ambience || []), ...(opts.rules || [])]) this.add(r);
  }

  /**
   * Add one rule; returns a handle whose remove() fades the sound out and drops the rule
   * @param {AmbienceRule} rule
   * @returns {{ remove(): void }}
   * @example const h = engine.ambience.add({ sound: 'storm-wind', when: { weather: 'storm' }, volume: 0.5 });
   */
  add(rule) {
    checkOptions('ambience rule', rule, RULE_KEYS);
    if (typeof rule.sound !== 'string') throw new TypeError(`ambience rule needs sound: a name from audio.sounds, got ${JSON.stringify(rule.sound)}. Example: { sound: 'wind', volume: 0.3 }`);
    const slot = { rule, voice: null, level: 0, offT: 0, next: rule.every ? gap(rule) : 0 };
    this._rules.push(slot);
    return { remove: () => { slot.voice?.stop(rule.fade ?? 1); this._rules = this._rules.filter(s => s !== slot); } };
  }
  /**
   * Replace the whole rule table (null or [] = silence)
   * @param {AmbienceRule[] | null} list
   * @returns {this}
   */
  rules(list) {
    for (const s of this._rules) s.voice?.stop(s.rule.fade ?? 1);
    this._rules = [];
    for (const r of list || []) this.add(r);
    return this;
  }
  /**
   * How much of the ground within `radius` meters of the listener is water (0-1), sampled at 6 points: for a water rule's volume
   * @param {number} [radius]
   * @returns {number}
   * @example { sound: 'river', volume: (e, a) => a.nearWater(12) * 0.12 }
   */
  nearWater(radius = 12) {
    const e = this.engine, p = this.position; let n = 0;
    for (let ang = 0; ang < 6.28; ang += 1.05) {
      const x = p.x + Math.cos(ang) * radius, z = p.z + Math.sin(ang) * radius;
      if (e.surface(x, z) < e.waterAt(x, z)) n += 1 / 6;
    }
    return n;
  }
  /**
   * What each rule is doing (debug, tests): sound name, whether its condition holds, its current target volume
   * @returns {{ sound: string, on: boolean, volume: number }[]}
   */
  get info() { return this._rules.map(s => ({ sound: s.rule.sound, on: s.level > 0, volume: +s.level.toFixed(3) })); }

  /**
   * Per-frame update: checks the rules every `interval` seconds and fades sounds toward their targets
   * @param {number} dt
   * @returns {void}
   * @internal
   */
  update(dt) {
    const e = this.engine, a = e.audio;
    if (!a.running || !this._rules.length) return;
    if ((this._acc += dt) < this.interval) return;
    dt = this._acc; this._acc = 0;
    const p = e.actorPosition() ?? e.focus; this.position.set(p.x, p.y ?? 0, p.z);
    for (const s of this._rules) this._step(s, dt);
  }
  /** @internal */
  _step(s, dt) {
    const r = s.rule, a = this.engine.audio, fade = r.fade ?? 1;
    const on = a.matches(r.when, this);
    s.level = on ? Math.max(0, typeof r.volume === 'function' ? r.volume(this.engine, this) : r.volume ?? 1) : 0;
    if (r.every) {
      if ((s.next -= dt) > 0) return;
      s.next = gap(r);
      if (s.level > 0) a.sfx(r.sound, { bus: r.bus ?? 'ambience', volume: s.level });
      return;
    }
    if (s.level > 0.001) {
      s.offT = 0;
      if (!s.voice?.playing) s.voice = a.sfx(r.sound, { bus: r.bus ?? 'ambience', loop: true, volume: 0 });
      s.voice?.fade(s.level, fade);
    } else if (s.voice) {
      if (s.offT === 0) s.voice.fade(0, fade);
      if ((s.offT += dt) > fade) { s.voice.stop(0); s.voice = null; s.offT = 0; }   // faded out: stop the loop so an idle rule costs nothing
    }
  }
}

// ---------- built-in synths (silent until the game's audio.sounds names them, e.g. wind: 'synth') ----------
/** A filtered noise loop with an optional slow wobble on its level (wind gusts) */
function noiseLoop(audio, out, filters, wobble = 0) {
  const ctx = audio.ctx, src = ctx.createBufferSource(), mix = ctx.createGain(), nodes = [src];
  src.buffer = audio.noise; src.loop = true; src.playbackRate.value = 0.5 + Math.random() * 0.5;   // presentation
  for (const [type, freq, q, vol = 1] of filters) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
    src.connect(f).connect(g).connect(mix);
  }
  if (wobble) {   // two slow oscillators on the level: the gusting of the old per-frame code, without per-frame work
    for (const hz of [0.37, 0.13]) { const o = ctx.createOscillator(), d = ctx.createGain(); o.frequency.value = hz; d.gain.value = wobble / 2; o.connect(d).connect(mix.gain); o.start(); nodes.push(o); }
    mix.gain.value = 1 - wobble / 2;
  }
  mix.connect(out); src.start(0, Math.random());   // presentation
  return { stop: t => { for (const n of nodes) n.stop(t); } };
}
const SYNTHS = {
  wind: (a, p, out) => noiseLoop(a, out, [['bandpass', p.freq ?? 330, 0.6]], p.gust ?? 0.3),
  rain: (a, p, out) => noiseLoop(a, out, [['highpass', 1800, 0.3], ['lowpass', 500, 0.5, 0.8]]),
  water: (a, p, out) => noiseLoop(a, out, [['lowpass', p.freq ?? 700, 1]]),
  birds: (a, p, out) => {
    const [lo, hi] = p.pitch ?? [2200, 4000], base = lo + Math.random() * (hi - lo), notes = 2 + Math.floor(Math.random() * 4), pan = Math.random() * 2 - 1;   // presentation
    let t = 0;
    for (let i = 0; i < notes; i++) { a.tone({ freq: base * (1 + Math.random() * 0.3), to: base * (0.7 + Math.random() * 0.6), dur: 0.08, vol: p.volume ?? 0.04, delay: t, pan, out }); t += 0.09 + Math.random() * 0.06; }   // presentation
    return t + 0.1;
  },
  crickets: (a, p, out) => {
    const pan = Math.random() * 2 - 1;   // presentation
    for (let i = 0; i < 3; i++) a.tone({ freq: (p.pitch ?? 4300) + Math.random() * 200, dur: 0.035, vol: p.volume ?? 0.02, delay: i * 0.05, pan, out });   // presentation
    return 0.2;
  },
};

/**
 * Ambience -> engine.ambience. Rules come from createEngine({ audio: { ambience: [...] } }) plus opts.rules
 * @param {AmbienceOptions} [opts]
 * @returns {ModuleDef<Ambience>}
 * @example engine.use(ambience({ rules: [{ sound: 'hum', when: { zone: 'lab' }, volume: 0.4 }] }));
 */
export function ambience(opts = {}) {
  let a = null;
  return { name: 'ambience', label: 'Ambience', stage: 'late', presentation: true,
    install(e) {
      checkOptions('ambience()', opts, ['rules', 'interval']);
      for (const [name, fn] of Object.entries(SYNTHS)) e.audio.register(name, fn, { builtIn: true, bus: 'ambience' });
      a = new Ambience(e, opts); return a;
    },
    frame(dt) { a.update(dt); } };
}
