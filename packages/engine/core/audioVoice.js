// One playing sound (a "voice") of engine.audio.sfx / play: source -> voice gain -> [panner] -> bus.
// Split out of Audio.js so the bus / config side and the per-sound side each stay small enough to read in one go.
// Randomness here (variant pick, jitter) only changes what is heard, never gameplay, so it uses Math.random and carries // presentation.
import * as THREE from 'three';
import { xzOf } from './math.js';
import { missingText, warnOnce, checkOptions } from './validate.js';

const SOUND_KEYS = ['src', 'synth', 'params', 'bus', 'volume', 'pitch', 'jitter', 'cooldown', 'voices', 'loop', 'distance'];

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3();

/** Normalize a sounds entry: string / string[] / { src, synth, ... } -> one shape, so playback code has a single path */
function soundDef(name, v) {
  if (v == null) return null;
  if (v === 'synth') return { synth: name };
  if (typeof v === 'string' || Array.isArray(v)) return { src: v };
  return v.src == null && v.synth == null ? { ...v, synth: name } : v;
}

/** The sounds entry for a name, or a game-registered synth of that name; null = silent (a built-in synth the game did not ask for) */
export function resolveDef(audio, name) {
  const def = soundDef(name, audio.config.sounds[name]), synth = audio.synths.get(def?.synth ?? name);
  if (def) {
    checkOptions(`audio.sounds.${name}`, def, SOUND_KEYS);
    if (def.src == null && !synth) { warnOnce(missingText('synth', def.synth, [...audio.synths.keys()])); return null; }
    return def;
  }
  if (synth && !synth.builtIn) return { synth: name };
  if (!synth) warnOnce(`audio.sfx('${name}'): no sound named ${name}. Add it to createEngine({ audio: { sounds: { ${name}: '/sfx/${name}.ogg' } } })`);
  return null;
}

/** Pick a variant at random, never the same one twice in a row (a repeated footstep or gunshot sounds mechanical) */
export function pickVariant(list, last) {
  if (!Array.isArray(list)) return [list, 0];
  if (list.length < 2) return [list[0], 0];
  let i = Math.floor(Math.random() * (list.length - 1));   // presentation
  if (i >= last) i++;
  return [list[i], i];
}

/** Where a voice sits: a world position ({ x, y, z } / [x, y, z] / Vector3) or an Object3D it follows every frame */
function readPosition(at, out = _v) {
  if (at.isObject3D) return at.getWorldPosition(out);
  if (Array.isArray(at)) return out.set(at[0], at[1] ?? 0, at[2] ?? 0);
  if (at.y === undefined) { const [x, z] = xzOf(at); return out.set(x, 0, z); }
  return out.set(at.x, at.y, at.z);
}
function setParam(p, v, t) { p.setValueAtTime(v, t); }

/** Point the Web Audio listener where the camera is (only called while positional voices exist: zero cost otherwise) */
export function placeListener(ctx, camera) {
  const L = ctx.listener, t = ctx.currentTime;
  camera.getWorldPosition(_v); camera.getWorldDirection(_d); _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
  if (L.positionX) {
    setParam(L.positionX, _v.x, t); setParam(L.positionY, _v.y, t); setParam(L.positionZ, _v.z, t);
    setParam(L.forwardX, _d.x, t); setParam(L.forwardY, _d.y, t); setParam(L.forwardZ, _d.z, t);
    setParam(L.upX, _u.x, t); setParam(L.upY, _u.y, t); setParam(L.upZ, _u.z, t);
  } else { L.setPosition(_v.x, _v.y, _v.z); L.setOrientation(_d.x, _d.y, _d.z, _u.x, _u.y, _u.z); }
}

/** A playing sound. engine.audio.sfx / play return one; the game keeps it to stop, fade or move the sound */
export class SoundHandle {
  /** @internal */
  constructor(audio, name, out, at, distance = {}) {
    const ctx = audio.ctx;
    /** @internal */ this.audio = audio;
    /** Sound name (sfx) or file path (play) */
    this.name = name;
    /** The voice's GainNode (volume of this one sound) @type {any} */
    this.gain = ctx.createGain();
    /** The PannerNode of a positional sound, else null @type {any} */
    this.panner = null;
    /** The AudioBufferSourceNode once a file started (null for synths and while loading) @type {any} */
    this.source = null;
    /** @internal */ this.endsAt = Infinity;
    /** @internal */ this.loop = null;   // a synth loop's { stop(t) }
    /** @internal */ this.follow = null;
    /** @internal */ this.startedAt = ctx.currentTime;
    if (at) {
      const p = this.panner = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = distance.ref ?? 2; p.maxDistance = distance.max ?? 60; p.rolloffFactor = distance.rolloff ?? 1;
      this.gain.connect(p).connect(out);
      this.setPosition(at);
      audio._spatial.add(this);
    } else this.gain.connect(out);
  }
  /** Still sounding (not stopped and not finished)? @returns {boolean} */
  get playing() { return !this._stopped && this.audio.ctx != null && this.audio.ctx.currentTime < this.endsAt; }
  /**
   * Move a positional sound: a position, or an Object3D to follow every frame (no effect on a non-positional sound)
   * @param {any} at
   * @returns {this}
   */
  setPosition(at) {
    if (!this.panner) return this;
    this.follow = at?.isObject3D ? at : null;
    const p = readPosition(at), t = this.audio.ctx.currentTime, n = this.panner;
    if (n.positionX) { setParam(n.positionX, p.x, t); setParam(n.positionY, p.y, t); setParam(n.positionZ, p.z, t); } else n.setPosition(p.x, p.y, p.z);
    return this;
  }
  /**
   * Fade this sound's volume to `to` (0-1) over `seconds`; it keeps playing (use stop to end it)
   * @param {number} to
   * @param {number} [seconds]
   * @returns {this}
   * @example h.fade(0.2, 1.5);
   */
  fade(to, seconds = 0.5) {
    const ctx = this.audio.ctx; if (!ctx || this._stopped) return this;
    const g = this.gain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(to, t + Math.max(0.01, seconds));
    return this;
  }
  /**
   * Stop, fading out over `fade` seconds (0 = at once)
   * @param {number} [fade]
   * @returns {void}
   * @example const h = engine.audio.sfx('engine-hum', { loop: true }); h.stop(1);
   */
  stop(fade = 0.05) {
    const ctx = this.audio.ctx; if (!ctx || this._stopped) return;
    this.fade(0, fade); this._stopped = true;
    const end = ctx.currentTime + Math.max(0.01, fade) + 0.05;
    try { this.source?.stop(end); } catch { /* already ended: nothing to stop */ }
    this.loop?.stop?.(end);
    this.endsAt = Math.min(this.endsAt, end);
    this.audio._spatial.delete(this);
  }
}

/** Start a synth or file for a voice. Synths get (audio, params, out) and return their length in seconds, or { stop(t) } when looping */
export function startSource(audio, voice, def, { pitch, loop, url, params }) {
  const ctx = audio.ctx;
  if (url) {
    audio.load(url).then(buf => {
      if (voice._stopped || !audio.ctx) return;
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = loop; s.playbackRate.value = pitch;
      s.connect(voice.gain); s.start(); voice.source = s;
      voice.endsAt = loop ? Infinity : ctx.currentTime + buf.duration / pitch;
    }).catch(err => { voice.endsAt = 0; audio._warn(err.message); });
    return;
  }
  const synth = audio.synths.get(def.synth);
  const r = synth.fn(audio, { ...synth.params, ...def.params, ...params, pitch, loop }, voice.gain);
  if (r && typeof r === 'object') voice.loop = r;
  else voice.endsAt = typeof r === 'number' ? ctx.currentTime + r : loop ? Infinity : ctx.currentTime + 1;   // a one-shot synth asked to loop still ends
}

/** Synth building block behind audio.noiseBurst: a burst of filtered noise */
export function synthNoise(audio, opts) {
  const { dur = 0.1, type = 'bandpass', freq = 1000, vol = 0.2, bus = 'sfx', out, rate = 1, delay = 0 } = opts;
  if (!audio.running) return;
  const ctx = audio.ctx, t0 = ctx.currentTime + delay, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = audio.noise; src.playbackRate.value = rate; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  src.connect(f).connect(g).connect(out ?? audio._bus(bus)); src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);   // presentation
}
/** Synth building block behind audio.tone: a short enveloped tone */
export function synthTone(audio, opts) {
  const { freq = 880, to = null, dur = 0.1, vol = 0.05, type = 'sine', bus = 'sfx', out, delay = 0, pan = 0 } = opts;
  if (!audio.running) return;
  const ctx = audio.ctx, t0 = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
  o.type = /** @type {any} */ (type); o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur * 0.9);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  p.pan.value = pan;
  o.connect(g).connect(p).connect(out ?? audio._bus(bus)); o.start(t0); o.stop(t0 + dur + 0.02);
}
