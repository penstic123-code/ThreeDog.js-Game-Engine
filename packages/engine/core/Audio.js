// Audio core: buses (master, music, sfx, ambience, ui + the game's own), sounds by name, ducking, and the condition table for rule lists.
// Sounds are the game's: createEngine({ audio: { sounds, ambience, music, footsteps, levels } }) or a content pack's audio table (contentPack,
// audioRules.js), merged into engine.audio.config. Where a sound comes from is the asset manifest's job (assets.manifest({ sounds: { step:
// '/sfx/step.ogg', ding: synthFn } }): a file or a synth function, used by name); audio.sounds only says how it plays (src, variants, volume, bus...).
// The engine plays nothing the game did not ask for: modules register their synths as built-in sound assets, silent until audio.sounds names them.
// Usage: recipes/31-audio.md.
// Browsers only allow sound after the first click/keypress; this waits for it automatically.

/** @import { SynthFn, SoundDef, AudioCondition, AudioVolume } from '../types/core' */
import { codedError } from './errorHints.js';
import { missingText, warnOnce } from './validate.js';
import { readParams, keysSchema } from './params.js';
import { SoundHandle, playSound, placeListener, synthNoise, synthTone, loadSound, playFile, soundDef } from './audioVoice.js';
import { matchesWhen, volumeOf, checkRuleName, packAudio, applyDucks, audioInfo } from './audioRules.js';
// createEngine({ audio }) 的 schema：未知键开发时抛错带 did-you-mean。对象 / 数组默认值不放这里：放了会被所有引擎共用同一个对象
const AUDIO_PARAMS = { levels: 'object?', sounds: 'object?', ambience: 'array?', music: 'object?', footsteps: 'object?' };
// music 里的值形状多（duckDialogue 是数字或 false），这里只管键名拼写；值由 music() 自己查
const MUSIC_PARAMS = keysSchema(['tracks', 'rules', 'fade', 'duckDialogue', 'duckFade', 'hold', 'interval']);
const BUS_PARAMS = { level: { type: 'number', default: 1, min: 0, desc: 'bus volume 0-1' }, owner: 'string?' };
const DUCK_PARAMS = { fade: { type: 'number', default: 0.3, min: 0, desc: 'fade seconds both ways' } };
const DEFAULT_LEVELS = { master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.7, ui: 0.8 };

/** engine.audio: buses, sounds by name, ducking. Sfx play by name from the game's audio.sounds (file, variants or synth). */
export class Audio {
  /** @internal */
  constructor(engine, opts = {}) {
    const { levels = {}, sounds = {}, ambience = [], music = {}, footsteps = {} } = readParams('createEngine({ audio })', AUDIO_PARAMS, opts);
    // a typo (trakcs) would just play nothing
    readParams('createEngine({ audio: { music } })', MUSIC_PARAMS, music);
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
    for (const [n, v] of Object.entries(sounds)) soundDef(n, v);   // the old synth forms fail here, at createEngine, not at the first play
    this.config = { sounds: { ...sounds }, ambience, music, footsteps: { ...footsteps } };
    /** Bus input GainNodes by name (connect your own nodes here); empty until audio unlocks @type {Record<string, any>} */
    this.buses = {};
    /** The game's current mode for rule lists, e.g. 'combat' / 'explore' (condition `state` in music and ambience rules) @type {string | null} */
    this.state = null;
    /** @internal */ this.buffers = new Map();
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
   * until the handle is removed (the one give-back form, like every other handle). A name that is already a bus throws: two owners of one bus
   * could not both remove it.
   * @param {string} name
   * @param {{ level?: number, owner?: string }} [opts] level 0-1 (1)
   * @returns {{ owner?: string, remove(): void }}
   * @example const voice = engine.audio.addBus('voice', { level: 1 }); engine.audio.sfx('line-01', { bus: 'voice' }); voice.remove();
   */
  addBus(name, opts = {}) {
    const { level, owner } = readParams('audio.addBus()', BUS_PARAMS, opts);
    if (name === 'master' || name in this.levels) throw codedError('engine-misuse', `audio.addBus('${name}'): '${name}' is already a bus (${Object.keys(this.levels).join(', ')}); use it by name, or remove the handle that added it first`);
    this.levels[name] = level; if (this.ctx) this._makeBus(name);
    return { owner, remove: () => {
      if (!(name in this.levels)) return;
      delete this.levels[name];
      this.buses[name]?.disconnect(); this._duckNodes[name]?.disconnect();   // 正在这条总线上响的声音随节点一起断开（总线没了，声音不该还出声）
      delete this.buses[name]; delete this._duckNodes[name];
    } };
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
    for (const b of Object.keys(levels)) if (b === 'master' || !(b in this.levels)) this._bus(b);
    const { fade } = readParams('audio.duck()', DUCK_PARAMS, opts), entry = { levels };
    this._ducks.add(entry); this._applyDucks(fade);
    return { remove: (f = fade) => { if (this._ducks.delete(entry)) this._applyDucks(f); } };
  }
  /** @internal */
  _applyDucks(fade) { applyDucks(this, fade); }

  /**
   * Add a condition key for music / ambience rule lists: `when: { [name]: value }` calls test(value, engine). Modules add theirs
   * (calendar: time, weather: weather, triggers: zone); the engine has `state` (engine.audio.state).
   * @param {string} name
   * @param {(value: any, e: any) => boolean} test
   * @returns {{ remove(): void }}
   * @example engine.audio.condition('inside', v => engine.vars.flag('indoors') === v);
   */
  condition(name, test) { checkRuleName(this, name, false); this.conditions.set(name, test); return { remove: () => this.conditions.delete(name) }; }
  /**
   * Add a measure: a number rule data compares (`when: { daylight: { gt: 0.15 } }`; gt / gte / lt / lte) and adds up (`volume: { add: { wind: 0.08 } }`).
   * calendar adds daylight, weather rain / snow / wind, ambience nearWater / altitude. A name is a condition or a measure, not both
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
    for (const [n, v] of Object.entries(data?.sounds || {})) soundDef(n, v);   // same early check for a content pack's rules
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
   * Play a sound by name: its audio.sounds rule (src / variants, volume, bus...), or with no rule the asset pack sound of that name (file or synth
   * function from assets.manifest({ sounds })). Returns a SoundHandle (stop, fade, setPosition), or null when it is silent: not configured, a
   * built-in synth the game did not name, audio still locked, or held back by the sound's cooldown. Over its `voices` limit the oldest voice stops.
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
  get info() { return audioInfo(this); }

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
