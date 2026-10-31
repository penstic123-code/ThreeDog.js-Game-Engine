// Audio core: three channels (ambience, sfx, music), audio file playback, and the sfx registry.
//
// Sound effects play by name: engine.audio.sfx('footstep', 'grass'). Where a sound comes from, in order:
//   1. style pack style.sounds[name] ([variant]): a file path, or an array to pick one at random
//   2. the synthesized fallback a module registers: audio.register('footstep', (audio, variant, params) => {...})
//      synth params can be tuned in the style pack's style.sounds.synth[name]
// Browsers only allow sound after the player's first click/keypress; this waits for it automatically.

/** @import { AudioChannel, SoundHandle, SynthFn } from '../types/core' */
import { codedError } from './errorHints.js';
import { missingText, warnOnce } from './validate.js';

/** engine.audio: sound. Sfx play by name (style pack file first, else synthesized), and audio files can play too. */
export class Audio {
  /** @internal */
  constructor(engine, { volume = 0.8, ambience = 0.7, sfx = 0.8, music = 0.5 } = {}) {
    /** @internal */ this.engine = engine;
    /** The browser AudioContext (exists only after the first click) @type {any} */
    this.ctx = null;
    /** Volume per channel, 0-1 */
    this.levels = { volume, ambience, sfx, music };
    /** @internal */ this.buffers = new Map();
    /** @internal */ this.synths = new Map();
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
    /** @internal */ this.master = ctx.createGain(); this.master.gain.value = this.levels.volume; this.master.connect(ctx.destination);
    /** @internal @type {Record<string, any>} */ this.bus = {};
    for (const ch of ['ambience', 'sfx', 'music']) { const g = ctx.createGain(); g.gain.value = this.levels[ch]; g.connect(this.master); this.bus[ch] = g; }
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;   // presentation
    /** @internal */ this.noise = buf;   // 2 s of white noise, reused by synthesized sfx
    const ready = () => { if (ctx.state === 'running' && !this._readySent) { this._readySent = true; this.engine.events.emit('audio:ready'); } };
    ctx.addEventListener('statechange', ready); ready();
  }
  /** Is audio usable (the player has clicked/pressed a key)? @returns {boolean} */
  get running() { return this.ctx?.state === 'running'; }

  /**
   * Set volume: 'volume' (master) | 'ambience' | 'sfx' | 'music', 0-1
   * @param {AudioChannel | 'volume'} channel
   * @param {number} v
   * @example engine.audio.setVolume('music', 0.3);
  */
  setVolume(channel, v) {
    this.levels[channel] = v; if (!this.ctx) return;
    (channel === 'volume' ? this.master : this.bus[channel]).gain.value = v;
  }

  /**
   * Register a synthesized fallback sfx
   * @param {string} name
   * @param {SynthFn} synthFn
   * @returns {this}
   * @example engine.audio.register('ding', a => a.tone({ freq: 880, dur: 0.2 }));
  */
  register(name, synthFn) { this.synths.set(name, synthFn); return this; }

  /**
   * Play an sfx by name (uses the style.sounds file if the style pack has one, else synthesizes)
   * @param {string} name
   * @param {any} [variant]
   * @param {{ volume?: number }} [opts]
   * @example engine.audio.sfx('ding');
  */
  sfx(name, variant, opts = {}) {
    const { volume = 1 } = opts;
    let v = this.engine.style.sounds?.[name];
    if (variant !== undefined && v && typeof v === 'object' && !Array.isArray(v)) v = v[variant] ?? v.default;
    if (v) {
      const url = Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v;   // presentation
      this.play(url, { channel: 'sfx', volume: volume * (0.85 + Math.random() * 0.15) }).catch(err => warnOnce(err.message));   // presentation: a missing sound is said once, the game goes on
      return;
    }
    const synth = this.synths.get(name);
    if (synth && this.running) synth(this, variant, this.engine.style.sounds?.synth?.[name] || {});
  }

  /**
   * Synth: a burst of filtered noise (footsteps, shutter, rain, thunder all use it). dur in seconds, freq in Hz, vol 0-1
   * @param {{ dur?: number, type?: string, freq?: number, vol?: number, bus?: AudioChannel, rate?: number, delay?: number }} [opts]
  */
  noiseBurst(opts = {}) {
    const { dur = 0.1, type = 'bandpass', freq = 1000, vol = 0.2, bus = 'sfx', rate = 1, delay = 0 } = opts;
    if (!this.running) return;
    const ctx = this.ctx, t0 = ctx.currentTime + delay, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; src.playbackRate.value = rate; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    src.connect(f).connect(g).connect(this.bus[bus]); src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);   // presentation
  }
  /**
   * Synth: a short tone (bird call, notification). freq/to in Hz, dur in seconds, pan -1..1
   * @param {{ freq?: number, to?: number | null, dur?: number, vol?: number, type?: string, bus?: AudioChannel, delay?: number, pan?: number }} [opts]
   * @example engine.audio.tone({ freq: 660, to: 880, dur: 0.15 });
  */
  tone(opts = {}) {
    const { freq = 880, to = null, dur = 0.1, vol = 0.05, type = 'sine', bus = 'sfx', delay = 0, pan = 0 } = opts;
    if (!this.running) return;
    const ctx = this.ctx, t0 = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur * 0.9);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.bus[bus]); o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // ---------- audio files ----------
  /** Download and decode an audio file @param {string} url @returns {Promise<any>} */
  async load(url) {
    this._init();
    if (!this.ctx) throw codedError('audio-unsupported', 'Audio is not supported by this browser; check typeof AudioContext before calling');
    if (!this.buffers.has(url)) {
      const p = fetch(url).then(r => { if (!r.ok) throw codedError('asset-load', `Audio file failed to load: ${url} (${r.status} ${r.statusText})`); return r.arrayBuffer(); }).then(b => this.ctx.decodeAudioData(b));
      p.catch(() => { if (this.buffers.get(url) === p) this.buffers.delete(url); });   // a failed download is not cached: the next play tries again
      this.buffers.set(url, p);
    }
    return this.buffers.get(url);
  }
  /**
   * Play an audio file; returns { stop(fadeSeconds), gain, source }
   * @param {string} url
   * @param {{ channel?: AudioChannel, volume?: number, loop?: boolean, fadeIn?: number }} [opts]
   * @returns {Promise<SoundHandle>}
   * @example const h = await engine.audio.play('/sfx/door.ogg', { channel: 'sfx' });
  */
  async play(url, opts = {}) {
    const { channel = 'sfx', volume = 1, loop = false, fadeIn = 0 } = opts;
    if (!this.bus?.[channel] && this.ctx) throw codedError('unknown-name', missingText('channel', channel, Object.keys(this.bus)));
    const buf = await this.load(url);
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.loop = loop;
    g.gain.setValueAtTime(fadeIn ? 0 : volume, ctx.currentTime); if (fadeIn) g.gain.linearRampToValueAtTime(volume, ctx.currentTime + fadeIn);
    src.connect(g).connect(this.bus[channel]); src.start();
    const handle = { source: src, gain: g, stop: (fadeOut = 0.5) => { g.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fadeOut / 3)); src.stop(ctx.currentTime + fadeOut + 0.05); } };
    return handle;
  }
}
