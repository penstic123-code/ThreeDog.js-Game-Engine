// One playing sound (a "voice") of engine.audio.sfx / play: source -> voice gain -> [panner] -> bus.
// Split out of Audio.js so the bus / config side and the per-sound side each stay small enough to read in one go.
// Randomness here (variant pick, jitter) only changes what is heard, never gameplay, so it uses Math.random and carries // presentation.
import * as THREE from 'three';
import { xzOf } from './math.js';
import { missingText, warnOnce, checkOptions } from './validate.js';
import { codedError } from './errorHints.js';

const SFX_KEYS = ['volume', 'pitch', 'at', 'bus', 'loop', 'params', 'fadeIn'];
const jit = (v, j) => v * (1 + (Math.random() * 2 - 1) * (j || 0));   // presentation
const SOUND_KEYS = ['src', 'synth', 'params', 'bus', 'volume', 'pitch', 'jitter', 'cooldown', 'voices', 'loop', 'distance'];

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

/** Normalize a sounds entry: string / string[] / { src, synth, ... } -> one shape, so playback code has a single path */
function soundDef(name, v) {
  if (v == null) return null;
  if (v === 'synth') return { synth: name };
  if (typeof v === 'string' || Array.isArray(v)) return { src: v };
  return v.src == null && v.synth == null ? { ...v, synth: name } : v;
}

/** The sounds entry for a name, or a game-registered synth of that name; null = silent (a built-in synth the game did not ask for) */
function resolveDef(audio, name) {
  const def = soundDef(name, audio.config.sounds[name]), synth = audio.synths.get(def?.synth ?? name);
  if (def) {
    checkOptions(`audio.sounds.${name}`, def, SOUND_KEYS);
    if (def.src == null && !synth) { warnOnce(missingText('synth', def.synth, [...audio.synths.keys()])); return null; }
    return def;
  }
  if (synth && !synth.builtIn) return { synth: name };
  if (!synth) warnOnce(`audio.sfx('${name}'): no sound named ${name}. Add it to a content pack's audio.sounds (${name}: an asset pack sound name, or 'synth') `
    + `or to createEngine({ audio: { sounds: { ${name}: '/sfx/${name}.ogg' } } })`);
  return null;
}

/** Pick a variant at random, never the same one twice in a row (a repeated footstep or gunshot sounds mechanical) */
function pickVariant(list, last) {
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
  camera.getWorldPosition(_v); camera.getWorldDirection(_d); _u.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(_q));   // world up, like the world forward above (a camera inside a rotated rig)
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
function startSource(audio, voice, def, { pitch, loop, url, params }) {
  const ctx = audio.ctx;
  if (url) {
    audio.load(url).then(buf => {   // url: a file, or a sound name from an asset pack (audio.load resolves it)
      if (!buf) { voice.endsAt = 0; voice.failed = true; return; }   // an asset that failed and fell back to silence (engine.loading has the error)
      if (voice._stopped || !audio.ctx) return;
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = loop; s.playbackRate.value = pitch;
      s.connect(voice.gain); s.start(); voice.source = s;
      voice.endsAt = loop ? Infinity : ctx.currentTime + buf.duration / pitch;
    }).catch(err => { voice.endsAt = 0; voice.failed = true; audio._warn(err.message); });   // failed: rule loops (ambience) read it and stop retrying
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

/** audio.load body: decode a file once (cached), or load a sound name from an asset pack through engine.assets */
export async function loadSound(audio, url) {
  const asset = audio.engine.assets.entries.get(url);
  // a named sound asset goes through assets (an engine.loading task, fallback to silence); its url is the file, so this never loops back
  if (asset?.named && asset.type === 'sound' && asset.url !== url) return audio.engine.assets._fetch(asset);
  audio._init();
  if (!audio.ctx) throw codedError('audio-unsupported', 'Audio is not supported by this browser; check typeof AudioContext before calling');
  if (!audio.buffers.has(url)) {
    const p = fetch(url).then(r => { if (!r.ok) throw codedError('asset-load', `Audio file failed to load: ${url} (${r.status} ${r.statusText})`); return r.arrayBuffer(); })
      .then(b => audio.ctx.decodeAudioData(b));
    p.catch(() => { if (audio.buffers.get(url) === p) audio.buffers.delete(url); });   // a failed download is not cached: the next play tries again
    audio.buffers.set(url, p);
  }
  return audio.buffers.get(url);
}
/** audio.play body: a file by path or asset name, no sounds entry needed */
export async function playFile(audio, url, opts) {
  checkOptions('audio.play()', opts, ['bus', 'volume', 'loop', 'fadeIn', 'pitch', 'at']);
  const { bus = 'sfx', volume = 1, loop = false, fadeIn = 0, pitch = 1, at } = opts;
  // create the (suspended) context now: a named asset loads through engine.assets, which never creates it, and before the first click
  // there would be no context to build the voice on. The sound starts when the first click / key resumes the context
  audio._init();
  if (!audio.ctx) return null;   // no Web Audio in this browser: nothing to play (audio.load still throws with the fix)
  const buf = await audio.load(url), ctx = audio.ctx;
  if (!ctx) return null;   // the engine was disposed while the file loaded
  const v = new SoundHandle(audio, url, audio._bus(bus), at);
  const src = ctx.createBufferSource(); src.buffer = buf ?? null; src.loop = loop; src.playbackRate.value = pitch;
  v.gain.gain.value = fadeIn ? 0 : volume; if (fadeIn) v.fade(volume, fadeIn);
  src.connect(v.gain); src.start(); v.source = src; v.endsAt = loop ? Infinity : ctx.currentTime + (buf?.duration ?? 0) / pitch;
  return v;
}
/** audio.sfx body: cooldown, voice limit, variant pick, jitter, then start the source */
export function playSound(audio, name, opts) {
  checkOptions('audio.sfx()', opts, SFX_KEYS);
  const def = resolveDef(audio, name);
  if (!def || !audio.running) return null;
  const now = audio.ctx.currentTime, last = audio._last.get(name);
  if (def.cooldown && last && now - last.at < def.cooldown) return null;
  const list = (audio._voices.get(name) || []).filter(v => v.playing);
  if (def.voices && list.length >= def.voices) list.shift().stop(0.03);
  const [url, variant] = def.src != null ? pickVariant(def.src, last?.variant ?? -1) : [null, 0];
  audio._last.set(name, { at: now, variant });
  const bus = audio._bus(opts.bus ?? def.bus ?? audio.synths.get(def.synth)?.bus ?? 'sfx');
  const v = new SoundHandle(audio, name, bus, opts.at, def.distance);
  const vol = jit((def.volume ?? 1) * (opts.volume ?? 1), def.jitter?.volume), pitch = jit((def.pitch ?? 1) * (opts.pitch ?? 1), def.jitter?.pitch);
  v.gain.gain.value = opts.fadeIn ? 0 : vol; if (opts.fadeIn) v.fade(vol, opts.fadeIn);
  startSource(audio, v, def, { pitch, loop: opts.loop ?? def.loop ?? false, url, params: opts.params });
  list.push(v); audio._voices.set(name, list);
  return v;
}
