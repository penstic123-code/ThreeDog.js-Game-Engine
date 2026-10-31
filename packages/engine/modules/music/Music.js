// Background music module: plays tracks on the "music" channel with cross-fade on change; ducks during dialogue; picks tracks by rules.
//
//   engine.use(music({ tracks: { day: '/sounds/day.ogg', night: { url: '/sounds/night.ogg', volume: 0.8 }, win: { url: '/sounds/win.ogg', loop: false } } }));
//   engine.music.play('day')                 // 2 s cross-fade by default; play('day', { fade: 0 }) cuts at once
//   engine.music.stop(3)                     // fade out over 3 s
//   engine.music.duck(0.3, 2)                // duck the music to 30%, restore after 2 s (without seconds it stays ducked; duck(1) restores)
//   engine.music.stinger('win')              // layer a short piece over the music (current track keeps playing)
//
// Where tracks come from (later overrides earlier): style pack style.music = { tracks: {...}, fade, duck } -> music({ tracks }) option.
// Browsers need a click/key press before they can play sound: play() before that is only remembered and starts once audio is usable.
//
// Auto track rules (checked about once a second; the highest-priority matching rule wins; a new result must hold for `hold` seconds before switching, to avoid flip-flopping):
//   const { when } = engine.music;
//   engine.music.rules([
//     { track: 'cave',  when: when.inRegion('cave'), priority: 10 },          // trigger zone (trigger:enter/exit events of the triggers module, tag)
//     { track: 'storm', when: when.weather('rain', 'storm'), priority: 5 },   // weather (needs the weather module)
//     { track: 'night', when: when.night(), priority: 2 },                     // night (needs the sky module)
//     { track: 'day',   when: () => true, priority: 0 },                       // fallback
//     { track: null,    when: e => e.dialogue?.active, priority: 20 },        // track: null = silence
//   ], { hold: 2, fade: 3 });
//   engine.music.override('boss')    // pick by hand, pausing the rules; override(null) hands control back
//
// Events: music:change { from, to }, music:stinger { name }

import { inRange } from '../../core/dayTime.js';
import { checkOptions, warnMissing } from '../../core/validate.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { MusicTrack, MusicRule, MusicOptions, MusicCondition } from '../../types/gameplay' */

const DEFAULTS = { fade: 2, duckDialogue: 0.35, duckFade: 0.4, hold: 2, interval: 1 };
const RULE_KEYS = ['track', 'when', 'priority'];

/** engine.music */
export class Music {
  /** @internal */
  constructor(engine, opts = {}) {
    /** @internal */ this.engine = engine;
    const st = engine.style.music || {};
    /** @internal */ this.opts = { ...DEFAULTS, ...st, ...opts };
    /** Registered tracks @type {Map<string, { url: string, volume?: number, loop?: boolean }>} */
    this.tracks = new Map();
    this.addTracks(st.tracks || {});
    this.addTracks(opts.tracks || {});
    /** Name of the track playing (or wanted) @type {string | null} */
    this.current = null;
    /** @internal */ this.playing = null;          // { name, handle, gain (node), token }
    /** @internal */ this.pending = null;          // { name, fade } remembered while audio is still locked
    /** Current duck multiplier @type {number} */
    this.duckLevel = 1;
    /** @internal */ this._duckTimer = null;
    /** @internal */ this._token = 0;
    /** @internal */ this._rules = null;
    /** @internal */ this._ruleOpts = {};
    /** @internal */ this._candidate = undefined;
    /** @internal */ this._candidateT = 0;
    /** @internal */ this._ruleT = 0;
    /** @internal */ this._override = undefined;
    /** Trigger-zone tag the player is in -> count @type {Map<string, number>} */
    this.regions = new Map();
    /**
     * Common conditions (for the `when` of rules; all return a MusicCondition; without the matching module they simply never match)
     * @type {{ weather(...names: string[]): MusicCondition, time(from: string | number, to: string | number): MusicCondition, night(): MusicCondition, day(): MusicCondition, inRegion(tag: string): MusicCondition, dialogue(): MusicCondition, all(...fs: MusicCondition[]): MusicCondition, any(...fs: MusicCondition[]): MusicCondition, not(f: MusicCondition): MusicCondition }}
     */
    this.when = this._helpers();

    const ev = engine.events;
    ev.on('trigger:enter', ({ tag }) => { if (tag != null) this.regions.set(tag, (this.regions.get(tag) || 0) + 1); });
    ev.on('trigger:exit', ({ tag }) => { if (tag == null) return; const n = (this.regions.get(tag) || 0) - 1; if (n > 0) this.regions.set(tag, n); else this.regions.delete(tag); });
    // Auto duck during dialogue: music({ duckDialogue: false }) turns it off, or give a 0-1 multiplier
    if (this.opts.duckDialogue !== false) {
      ev.on('dialogue:start', () => this.duck(this.opts.duckDialogue, 0, this.opts.duckFade));
      ev.on('dialogue:end', () => this.duck(1, 0, this.opts.duckFade * 2));
    }
  }

  /**
   * Register tracks: { name: url | { url, volume, loop } }
   * @param {Record<string, MusicTrack>} map
   * @returns {this}
   */
  addTracks(map) {
    for (const [name, v] of Object.entries(map)) this.tracks.set(name, typeof v === 'string' ? { url: v } : { ...v });
    return this;
  }
  /**
   * Whether audio is usable
   * @returns {boolean}
   */
  get ready() { return this.engine.audio.running; }
  /** Auto track rules are in use */
  get ruled() { return !!this._rules; }
  /**
   * State (for debugging)
   * @returns {{ current: string | null, playing: string | null, pending: string | null, duck: number, regions: string[], override: string | null, gain: number, outGain: number }}
   */
  get state() {
    return { current: this.current, playing: this.playing?.name ?? null, pending: this.pending?.name ?? null, duck: this.duckLevel, regions: [...this.regions.keys()], override: this._override ?? null,
      gain: this.playing?.gain ? +this.playing.gain.gain.value.toFixed(3) : 0, outGain: this.output ? +this.output.gain.value.toFixed(3) : 0 };
  }

  // ---------- playback ----------
  /**
   * Play a track (cross-fade over fade seconds). Does nothing if it is already playing; force replays it
   * @param {string | null} name
   * @param {{ fade?: number, force?: boolean }} [opts]
   * @returns {void}
   */
  play(name, opts = {}) {
    const { fade = this.opts.fade, force = false } = opts;
    if (name == null) return this.stop(fade);
    const tr = this.tracks.get(name);
    if (!tr) { warnMissing('track', name, [...this.tracks.keys()]); return; }
    if (!force && this.current === name && (this.playing?.name === name || this.pending?.name === name)) return;
    const from = this.current;
    this.current = name;
    if (from !== name) this.engine.events.emit('music:change', { from, to: name });
    const audio = this.engine.audio;
    if (!audio.running || !this._ensureOutput()) { this.pending = { name, fade }; return; }   // cannot sound yet: remember it
    this.pending = null;
    this._fadeOutCurrent(fade);
    const token = ++this._token;
    const ctx = audio.ctx, g = ctx.createGain(), vol = tr.volume ?? 1;
    g.gain.setValueAtTime(fade > 0 ? 0 : vol, ctx.currentTime);
    g.connect(this.output);
    const slot = { name, gain: g, src: null, token };
    this.playing = slot;
    audio.load(tr.url).then(buf => {
      if (this._token !== token || this.playing !== slot) { g.disconnect(); return; }   // another track was chosen while loading
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = tr.loop !== false;
      src.connect(g); src.start();
      slot.src = src;
      if (fade > 0) { g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(vol, ctx.currentTime + fade); }
      if (!src.loop) src.onended = () => { if (this.playing === slot) { this.playing = null; this.current = null; this.engine.events.emit('music:change', { from: name, to: null }); } };
    }).catch(err => { console.warn('[music]', err.message); if (this.playing === slot) this.playing = null; });
  }
  /**
   * Fade out and stop (fade over fade seconds)
   * @param {number} [fade]
   * @returns {void}
   */
  stop(fade = this.opts.fade) {
    const from = this.current;
    this.pending = null; this.current = null; this._token++;
    this._fadeOutCurrent(fade);
    if (from) this.engine.events.emit('music:change', { from, to: null });
  }
  /** @internal */
  _fadeOutCurrent(fade) {
    const p = this.playing; this.playing = null;
    if (!p) return;
    const ctx = this.engine.audio.ctx, t = ctx.currentTime, f = Math.max(0.02, fade);
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(p.gain.gain.value, t);
    p.gain.gain.linearRampToValueAtTime(0, t + f);
    try { p.src?.stop(t + f + 0.05); } catch { /* already stopped */ }
    setTimeout(() => { try { p.gain.disconnect(); } catch { /* ignore */ } }, (f + 0.2) * 1000);   // presentation: follows the actual audio fade
  }
  /** Total music output (for ducking), connected to the core's music channel */
  /** @internal */
  _ensureOutput() {
    const a = this.engine.audio;
    if (this.output) return true;
    if (!a.ctx) return false;
    this.output = a.ctx.createGain(); this.output.gain.value = this.duckLevel;
    this.output.connect(a.bus.music);
    return true;
  }

  /**
   * Duck the music to amount (0-1), restore automatically after `seconds` (0 = stay ducked), fade is the fade seconds
   * @param {number} [amount]
   * @param {number} [seconds]
   * @param {number} [fade]
   * @returns {void}
   */
  duck(amount = 0.35, seconds = 0, fade = this.opts.duckFade) {
    clearTimeout(this._duckTimer);
    this.duckLevel = amount;
    if (this.output) {
      const ctx = this.engine.audio.ctx, t = ctx.currentTime, g = this.output.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(amount, t + Math.max(0.02, fade));
    }
    if (seconds > 0) this._duckTimer = setTimeout(() => this.duck(1, 0, fade), seconds * 1000);   // presentation: follows actual playback
  }

  /**
   * Layer a one-shot piece (victory, discovered place...), ducking the background music slightly while it plays
   * @param {string} name
   * @param {{ duck?: number, volume?: number }} [opts]
   * @returns {void}
   */
  stinger(name, opts = {}) {
    const { duck = 0.5, volume } = opts;
    const tr = this.tracks.get(name);
    if (!tr) { warnMissing('track', name, [...this.tracks.keys()]); return; }
    const a = this.engine.audio;
    if (!a.running) return;          // a one-shot piece is not worth queueing
    this.engine.events.emit('music:stinger', { name });
    a.play(tr.url, { channel: 'music', volume: volume ?? tr.volume ?? 1 }).then(h => {
      const d = h.source.buffer?.duration || 1;
      if (duck < 1) this.duck(duck, d, 0.15);
    }).catch(err => console.warn('[music]', err.message));
  }

  // ---------- rules ----------
  /**
   * Set the auto track rules (null turns them off). opts: hold how many seconds a new result must be stable before switching, fade switch fade seconds, interval check interval
   * @param {MusicRule[] | null} list
   * @param {{ hold?: number, fade?: number, interval?: number }} [opts]
   * @returns {this}
   */
  rules(list, opts = {}) {
    checkOptions('music.rules()', opts, ['hold', 'fade', 'interval']);
    for (const r of list || []) checkOptions('music.rules() rule', r, RULE_KEYS);
    this._rules = list ? [...list] : null;
    this._ruleOpts = opts;
    this._candidate = undefined; this._candidateT = 0; this._ruleT = 0;
    if (list) this._evaluate(true);
    return this;
  }
  /**
   * Pick a track by hand, pausing the rules; override(null) hands control back
   * @param {string | null} name
   * @param {{ fade?: number, force?: boolean }} [opts]
   * @returns {void}
   */
  override(name, opts) {
    if (name == null) { this._override = undefined; if (this._rules) this._evaluate(true); return; }
    this._override = name; this.play(name, opts);
  }
  /**
   * Which track the current rules would pick (without switching)
   * @returns {string | null | undefined}
   */
  pick() {
    if (!this._rules) return undefined;
    let best = null;
    for (const r of this._rules) {
      let ok = false;
      try { ok = !!r.when?.(this.engine, this); } catch (err) { console.error('[music] rule threw', err); }
      if (ok && (!best || (r.priority ?? 0) > (best.priority ?? 0))) best = r;
    }
    return best ? best.track ?? null : undefined;
  }
  /** @internal */
  _evaluate(immediate = false) {
    if (this._override !== undefined) return;
    const want = this.pick();
    if (want === undefined) return;                       // no rule matches: keep the current state
    const cur = this.current ?? null;
    if (want === cur) { this._candidate = undefined; this._candidateT = 0; return; }
    const hold = this._ruleOpts.hold ?? this.opts.hold;
    if (want !== this._candidate) { this._candidate = want; this._candidateT = 0; }
    if (immediate || this._candidateT >= hold) {
      this._candidate = undefined; this._candidateT = 0;
      const fade = this._ruleOpts.fade ?? this.opts.fade;
      want == null ? this.stop(fade) : this.play(want, { fade });
    }
  }
  /**
   * Per-frame update (plays queued tracks, picks tracks by rules; the module calls it every frame)
   * @param {number} dt
   * @returns {void}
   * @internal
   */
  frame(dt) {
    // Once audio is usable, play the queued track
    if (this.pending && this.engine.audio.running) { const p = this.pending; this.pending = null; this.play(p.name, { fade: p.fade, force: true }); }
    if (!this._rules) return;
    const iv = this._ruleOpts.interval ?? this.opts.interval;
    if (this._candidate !== undefined) this._candidateT += dt;
    if ((this._ruleT -= dt) > 0) return;
    this._ruleT = iv;
    this._evaluate(false);
  }

  /**
   * Common conditions (the matching modules need not be installed; they just never match)
   * @internal
   * @returns {any}
   */
  _helpers() {
    const m = this;
    return {
      /** The current weather is one of these (weather module) */
      weather: (...names) => e => names.includes(e.weather?.name),
      /** Time-of-day range: 'HH:MM' or 0-1 (0.5 is noon); wraps past midnight when from > to (sky module) */
      time: (from, to) => e => (e.sky ? inRange(e.sky.timeOfDay, from, to, e.sky.hoursPerDay) : false),
      night: () => e => e.sky ? !e.sky.isDay : false,
      day: () => e => e.sky ? !!e.sky.isDay : false,
      /** The player is inside a trigger zone with this tag (trigger:enter/exit events) */
      inRegion: tag => () => m.regions.has(tag),
      dialogue: () => e => !!e.dialogue?.active,
      all: (...fs) => (e, mm) => fs.every(f => f(e, mm)),
      any: (...fs) => (e, mm) => fs.some(f => f(e, mm)),
      not: f => (e, mm) => !f(e, mm),
    };
  }
}

/**
 * Background music -> engine.music. tracks: tracks; fade: default fade seconds (2); duckDialogue: how far to duck during dialogue (0.35, false = off); duckFade; hold: rule debounce seconds (2)
 * @param {MusicOptions} [opts]
 * @returns {ModuleDef<Music>}
 */
export function music(opts = {}) {
  let m = null;
  return {
    name: 'music', label: 'Music', optional: ['weather', 'sky', 'dialogue'], stage: 'audio', presentation: true,
    install(e) {
      checkOptions('music()', opts, ['tracks', ...Object.keys(DEFAULTS)]); m = new Music(e, opts);
      e.events.on('session:end', () => m.stop(0));   // a playthrough ends: its music stops at once
      return m;
    },
    frame(dt) { m.frame(dt); },
    dispose() { clearTimeout(m._duckTimer); },
  };
}
