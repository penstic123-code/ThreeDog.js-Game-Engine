// Audio core: buses (master, music, sfx, ambience, ui + the game's own), sounds by name, ducking, and the condition table for rule lists.
// Sounds are the game's: createEngine({ audio: { sounds, ambience, music, footsteps, levels } }) or a content pack's audio table (contentPack,
// audioRules.js), merged into engine.audio.config. The engine ships none and plays nothing the game did not ask for: modules register built-in
// synths with { builtIn: true }, silent until audio.sounds names them. A sound src may be a file or a sound name from an asset pack.
// Usage: recipes/31-audio.md.
// Browsers only allow sound after the first click/keypress; this waits for it automatically.

/** @import { SynthFn, SoundDef, AudioCondition, AudioVolume } from '../types/core' */
import { codedError } from './errorHints.js';
import { missingText, warnOnce, checkOptions } from './validate.js';
import { SoundHandle, playSound, placeListener, synthNoise, synthTone, loadSound, playFile } from './audioVoice.js';
import { matchesWhen, volumeOf, checkRuleName, packAudio } from './audioRules.js';
const AUDIO_KEYS = ['levels', 'sounds', 'ambience', 'music', 'footsteps'];
const DEFAULT_LEVELS = { master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.7, ui: 0.8 };

/** engine.audio: buses, sounds by name, ducking. Sfx play by name from the game's audio.sounds (file, variants or synth). */
export class Audio {
  /** @internal */
  constructor(engine, opts = {}) {
    checkOptions('createEngine({ audio })', opts, AUDIO_KEYS);
    const { levels = {}, sounds = {}, ambience = [], music = {}, footsteps = {} } = opts;
    checkOptions('createEngine({ audio: { music } })', music, ['tracks', 'rules', 'fade', 'duckDialogue', 'duckFade', 'hold', 'interval']);   // a typo (trakcs) would just play nothing
    /** @internal */ this.engine = engine;
    /** The browser AudioContext (exists only after the first click) @type {any} */
    this.ctx = null;
    /** Volume per bus 0-1 ('master' is the total). Every key is a bus: levels: { voice: 1 } adds a 'voice' bus @type {Record<string, number>} */
    this.levels = { ...DEFAULT_LEVELS, ...levels };
    /**
     * The game's sound config from createEngine({ audio }); sounds and footsteps also hold content packs' (copies: the game's object is never changed).
     * Content packs' ambience / music rules go to ambience() / music(), not here
     * @type {import('../types/core').AudioConfig}
     */
    this.config = { sounds: { ...sounds }, ambience, music, footsteps: { ...footsteps } };
    /** Bus input GainNodes by name (connect your own nodes here); empty until audio unlocks @type {Record<string, any>} */
    this.buses = {};
    /** The game's current mode for rule lists, e.g. 'combat' / 'explore' (condition `state` in music and ambience rules) @type {string | null} */
    this.state = null;
    /** @internal */ this.buffers = new Map();
    /** @internal */ this.synths = new Map();
    /** @internal */ this.conditions = new Map([['state', v => [].concat(v).includes(this.state)]]);
    /** @internal name -> (engine) => number: values rule data compares ({ daylight: { gt: 0.15 } }) and data volumes add up */
    this.measures = new Map();
    // names defined in code: the same name in a content pack is an error (one name, one place)
    /** @internal */ this._code = { sounds: new Set(Object.keys(sounds)), footsteps: new Set(Object.keys(footsteps)), tracks: new Set(Object.keys(music.tracks || {})) };
    /** @internal content packs' audio: pack key -> { ambience, music } (ambience() / music() read it at install and follow it after) */
    this.packs = new Map();
    /** @internal */ this._packWatch = new Set();
    /** @internal */ this._duckNodes = {};
    /** @internal */ this._ducks = new Set();
    /** @internal */ this._voices = new Map();      // name -> live voices (voice limit, info)
    /** @internal */ this._last = new Map();        // name -> { at, variant } (cooldown, no-repeat)
    /** @internal */ this._spatial = new Set();     // positional voices: the listener and followed objects update only while any exist
    /** @internal */ this._readySent = false;
    // Create or resume audio on the first click/keypress (a context created earlier is suspended and must be resumed inside a user gesture)
    const stop = new AbortController(), signal = AbortSignal.any([stop.signal, engine.signal]);   // remove after unlocking once, or when the engine is disposed
    const unlock = () => { this._init(); this.ctx?.resume(); stop.abort(); };
    addEventListener('pointerdown', unlock, { signal }); addEventListener('keydown', unlock, { signal });
  }
  /** @internal Close the audio context (engine.dispose calls it): playing sounds and nodes modules attached stop together */
  dispose() { this.ctx?.close(); this.ctx = null; }

  /** @internal */
  _init() {
    if (this.ctx || this.engine.disposed) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    /** The master GainNode (every bus ends here) @type {any} */
    this.master = ctx.createGain(); this.master.gain.value = this.levels.master; this.master.connect(ctx.destination);
    for (const name of Object.keys(this.levels)) if (name !== 'master') this._makeBus(name);
    this._applyDucks(0);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;   // presentation
    /** 2 s of white noise, reused by synthesized sounds @type {any} */
    this.noise = buf;
    const ready = () => { if (ctx.state === 'running' && !this._readySent) { this._readySent = true; this.engine.events.emit('audio:ready'); } };
    ctx.addEventListener('statechange', ready); ready();
  }
  /** @internal a bus is two gains: its level (what setVolume sets) then its duck (what duck() lowers), so the two never fight */
  _makeBus(name) {
    const ctx = this.ctx, g = ctx.createGain(), d = ctx.createGain();
    g.gain.value = this.levels[name]; g.connect(d).connect(this.master);
    this.buses[name] = g; this._duckNodes[name] = d;
  }
  /** Is audio usable (the player has clicked/pressed a key)? @returns {boolean} */
  get running() { return this.ctx?.state === 'running'; }
  /** @internal */
  _warn(msg) { warnOnce(msg); }
  /** @internal */
  _bus(name) {
    if (name in this.levels && name !== 'master') return this.buses[name];
    throw codedError('unknown-name', missingText('bus', name, Object.keys(this.levels).filter(n => n !== 'master'))
      + '. Add a bus with createEngine({ audio: { levels: { name: 1 } } }) or engine.audio.addBus(name)');
  }

  /**
   * Add a bus of your own (routed to master). It gets a settings slider like the others (label key settings.vol.<name>)
   * @param {string} name
   * @param {number} [level]
   * @returns {this}
   * @example engine.audio.addBus('voice', 1); engine.audio.sfx('line-01', { bus: 'voice' });
   */
  addBus(name, level = 1) {
    if (!(name in this.levels)) { this.levels[name] = level; if (this.ctx) this._makeBus(name); }
    return this;
  }
  /**
   * Set a bus volume 0-1 ('master' for the total)
   * @param {string} bus
   * @param {number} v
   * @returns {void}
   * @example engine.audio.setVolume('music', 0.3);
  */
  setVolume(bus, v) {
    if (bus !== 'master') this._bus(bus);
    this.levels[bus] = v; if (!this.ctx) return;
    (bus === 'master' ? this.master : this.buses[bus]).gain.value = v;
  }

  /**
   * Lower buses until the handle is removed (dialogue, pause menu, a cutscene). Several ducks stack (their levels multiply).
   * @param {Record<string, number>} levels bus -> multiplier 0-1
   * @param {{ fade?: number }} [opts] fade seconds both ways (0.3)
   * @returns {{ remove(fade?: number): void }}
   * @example const d = engine.audio.duck({ music: 0.3, ambience: 0.5 }); engine.events.once('dialogue:end', () => d.remove());
   */
  duck(levels, opts = {}) {
    checkOptions('audio.duck()', opts, ['fade']);
    for (const b of Object.keys(levels)) if (b === 'master' || !(b in this.levels)) this._bus(b);
    const { fade = 0.3 } = opts, entry = { levels };
    this._ducks.add(entry); this._applyDucks(fade);
    return { remove: (f = fade) => { if (this._ducks.delete(entry)) this._applyDucks(f); } };
  }
  /** @internal */
  _applyDucks(fade) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [bus, node] of Object.entries(this._duckNodes)) {
      let v = 1; for (const d of this._ducks) v *= d.levels[bus] ?? 1;
      const g = node.gain; g.cancelScheduledValues(t);
      if (fade > 0) { g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + fade); } else g.value = v;
    }
  }

  /**
   * Register a synthesized sound: synthFn(audio, params, out) connects its nodes to `out` and returns its length in seconds
   * (or { stop(time) } for a loop). Plays for sounds entries that name it ('synth' or { synth: name }); a name with no sounds entry
   * plays it too unless builtIn (engine modules pass builtIn: true so their synths stay silent until the game asks).
   * @param {string} name
   * @param {SynthFn} synthFn
   * @param {{ builtIn?: boolean, bus?: string, params?: Record<string, any> }} [opts] bus: default bus ('sfx'); params: default params
   * @returns {this}
   * @example engine.audio.register('ding', (a, p, out) => { a.tone({ freq: 880 * p.pitch, dur: 0.2, out }); return 0.2; });
  */
  register(name, synthFn, opts = {}) {
    checkOptions('audio.register()', opts, ['builtIn', 'bus', 'params']);
    this.synths.set(name, { fn: synthFn, builtIn: !!opts.builtIn, bus: opts.bus, params: opts.params || {} }); return this;
  }

  /**
   * Add a condition key for music / ambience rule lists: `when: { [name]: value }` calls test(value, engine). Modules add theirs
   * (sky: time, weather: weather, triggers: zone); the engine has `state` (engine.audio.state).
   * @param {string} name
   * @param {(value: any, e: any) => boolean} test
   * @returns {{ remove(): void }}
   * @example engine.audio.condition('inside', v => engine.vars.flag('indoors') === v);
   */
  condition(name, test) { checkRuleName(this, name, false); this.conditions.set(name, test); return { remove: () => this.conditions.delete(name) }; }
  /**
   * Add a measure: a number rule data compares (`when: { daylight: { gt: 0.15 } }`; gt / gte / lt / lte) and adds up (`volume: { add: { wind: 0.08 } }`).
   * sky adds daylight, weather rain / snow / wind, ambience nearWater / altitude. A name is a condition or a measure, not both
   * @param {string} name
   * @param {(e: any) => number} fn
   * @returns {{ remove(): void }}
   * @example engine.audio.measure('danger', e => e.vars.counter('alarm') / 10);   // data: when: { danger: { gt: 0.5 } }
   */
  measure(name, fn) { checkRuleName(this, name, true); this.measures.set(name, fn); return { remove: () => this.measures.delete(name) }; }
  /**
   * The current value of a measure (debug, tests); undefined when none is registered under that name
   * @param {string} name
   * @returns {number | undefined}
   */
  value(name) { return this.measures.get(name)?.(this.engine); }
  /**
   * Does a rule's `when` hold now? An object needs every key to hold (condition keys, or measure comparisons); a function gets
   * (engine, ...extra); missing = always.
   * @param {AudioCondition | undefined} when
   * @param {...any} extra
   * @returns {boolean}
   * @example engine.audio.matches({ time: 'night', zone: 'forest', rain: { lt: 0.2 } });
   */
  matches(when, ...extra) { return matchesWhen(this, when, extra); }
  /**
   * A rule's volume now: a number, a function (engine, ...extra), or data { base, add: { measure: factor }, min, max }; missing = 1
   * @param {AudioVolume | undefined} volume
   * @param {...any} extra
   * @returns {number}
   * @example engine.audio.volumeOf({ base: 0, add: { rain: 0.22 } });   // 0.22 in full rain
   */
  volumeOf(volume, ...extra) { return volumeOf(this, volume, extra); }
  /**
   * @internal content.load hands each pack's audio table here (audioRules.js packAudio): sounds / footsteps merge into config, rules go to
   * ambience() / music() through onPack; a pack loaded again under the same key replaces its rules
   * @param {any} key  'pack:<name>', or the pack's data object for an unnamed pack (loading the same object again replaces its rules)
   * @param {string} from  'pack "forest"' for messages
   * @param {any} data
   */
  contentPack(key, from, data) {
    const p = packAudio(this, data, from);
    Object.assign(this.config.sounds, p.sounds); Object.assign(this.config.footsteps, p.footsteps);
    const pack = { from, ambience: p.ambience, music: p.music };
    this.packs.set(key, pack);
    for (const fn of this._packWatch) fn(key, pack);
  }
  /** @internal ambience() / music() follow content packs' rules: fn(key, pack) per pack, now for each loaded one and later for new ones */
  onPack(fn) {
    for (const [k, p] of this.packs) fn(k, p);
    this._packWatch.add(fn); return { remove: () => this._packWatch.delete(fn) };
  }

  /**
   * Play a sound by name from audio.sounds (file, variants, or a synth). Returns a SoundHandle (stop, fade, setPosition), or null when it is
   * silent: not configured, audio still locked, or held back by the sound's cooldown. Over its `voices` limit the oldest voice stops.
   * @param {string} name
   * @param {{ volume?: number, pitch?: number, at?: any, bus?: string, loop?: boolean, params?: Record<string, any>, fadeIn?: number }} [opts]
   *   at: a position or an Object3D to follow (3D sound); params: extra synth params
   * @returns {SoundHandle | null}
   * @example engine.audio.sfx('hit', { at: enemy.root, volume: 0.8 });
  */
  sfx(name, opts = {}) { return playSound(this, name, opts); }
  /** @internal per frame (loop.js): positional voices follow their objects and the listener follows the camera; nothing to do without them */
  _tick() {
    if (!this._spatial.size || !this.ctx) return;
    placeListener(this.ctx, this.engine.camera);
    for (const v of this._spatial) { if (!v.playing) this._spatial.delete(v); else if (v.follow) v.setPosition(v.follow); }
  }
  /**
   * What is playing (for describe and tests): bus levels, the duck multiplier per bus, live voices per sound name
   * @returns {{ running: boolean, state: string | null, levels: Record<string, number>, ducks: Record<string, number>, voices: Record<string, number> }}
   */
  get info() {
    const ducks = {}, voices = {};
    for (const [b, n] of Object.entries(this._duckNodes)) ducks[b] = +n.gain.value.toFixed(3);
    for (const [name, list] of this._voices) { const n = list.filter(v => v.playing).length; if (n) voices[name] = n; }
    return { running: this.running, state: this.state, levels: { ...this.levels }, ducks, voices };
  }

  /**
   * Synth building block: a burst of filtered noise (footsteps, shutter, rain, thunder). dur seconds, freq Hz, vol 0-1; out: the node to
   * connect to (a synth's `out`), else the named bus
   * @param {{ dur?: number, type?: string, freq?: number, vol?: number, bus?: string, out?: any, rate?: number, delay?: number }} [opts]
   * @returns {void}
  */
  noiseBurst(opts = {}) { synthNoise(this, opts); }
  /**
   * Synth building block: a short tone (bird call, notification). freq/to Hz, dur seconds, pan -1..1; out as in noiseBurst
   * @param {{ freq?: number, to?: number | null, dur?: number, vol?: number, type?: string, bus?: string, out?: any, delay?: number, pan?: number }} [opts]
   * @returns {void}
   * @example engine.audio.tone({ freq: 660, to: 880, dur: 0.15, bus: 'ui' });
  */
  tone(opts = {}) { synthTone(this, opts); }

  // ---------- audio files ----------
  /**
   * Download and decode an audio file (cached). A sound name registered in an asset pack (manifest sounds) loads that file as an
   * engine.loading task, so sounds entries and music tracks may name assets instead of paths
   * @param {string} url  a file path or an asset pack sound name
   * @returns {Promise<any>}
   */
  load(url) { return loadSound(this, url); }
  /**
   * Play an audio file by path (no sounds entry needed); resolves to a SoundHandle once the file is decoded
   * @param {string} url
   * @param {{ bus?: string, volume?: number, loop?: boolean, fadeIn?: number, pitch?: number, at?: any }} [opts]
   * @returns {Promise<SoundHandle | null>} null only without Web Audio; called before the first click it still resolves and the sound starts once audio unlocks
   * @example const h = await engine.audio.play('/sfx/door.ogg', { bus: 'ui' }); h.stop(0.5);
  */
  play(url, opts = {}) { return playFile(this, url, opts); }
}
