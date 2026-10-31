// Load sources, engine.load: the places the world must be loaded around (the streaming-source idea of Unreal World Partition).
// Every distance-based loader reads this list and nothing else: stream entries, world models (present), terrain chunks, hlod near/far and rigid-body terrain colliders.
//   engine.load.player   built in: the gameplay anchor (world.anchor, else the player, else engine.focus); full detail + physics
//   engine.load.camera   built in: engine.focus; full detail, no physics (a cutscene or photo camera far away gets a picture, not colliders)
//   const s = engine.load.source([800, 0, 300], { radius: 64 }); await s.whenReady; ... s.remove();
//   await engine.load.teleport([800, 0, 300]);   // the player moves only after the destination is loaded (terrain, collision, nearby models)
// Display, physics and world data are three separate things: a source decides what is shown and what has colliders; world records are never deleted by unloading,
// and near / far simulation follows world.anchor (recipe 18). Readiness is per source: each loader registers a check with readyCheck.
/** @import { LoadSourceOptions, LoadSource } from '../types/core' */
import { checkOptions } from './validate.js';
import { xzOf } from './math.js';
import { codedError } from './errorHints.js';

const KEYS = ['radius', 'detail', 'physics', 'until', 'name'];
const STRINGS = {
  detail: 'load.source(): detail must be \'full\' (models, stream entries, physics) or \'simple\' (terrain and hlod proxies only), got {got}',
  removed: 'load source "{name}" was removed before it was ready (remove() or its until); nothing waits for it any more',
  timeout: 'load.teleport(): the destination ({x}, {z}) was not ready after {t} s; still waiting on: {checks}. The player was not moved',
};

/** One load source (returned by engine.load.source) @internal */
class Source {
  constructor(load, position, o) {
    /** @internal */ this.load = load;
    /** @internal */ this.pos = position;
    /** Label shown in describe and errors @type {string} */ this.name = o.name ?? 'source';
    /** Reach in meters; null = each loader's own range (terrain view distance, present radius...). A number caps every loader at it @type {number | null} */ this.radius = o.radius ?? null;
    /** 'full' or 'simple' @type {'full' | 'simple'} */ this.detail = o.detail ?? 'full';
    /** Whether colliders are built around it @type {boolean} */ this.physics = o.physics ?? this.detail === 'full';
    /** Current horizontal position (refreshed by every list call) @type {number} */ this.x = 0;
    /** @type {number} */ this.z = 0;
    /** @internal */ this.age = 0;
    /** @internal */ this._ready = false;
    /** @internal */ this._waiters = [];
    /** @internal */ this.removed = false;
    this.until = o.until ?? null;
    if (typeof this.until?.then === 'function') this.until.then(() => this.remove(), () => this.remove());
    this.sync();
  }
  /** @internal Read the live position (an Object3D / Vector3 that moves, or a function) */
  sync() { const p = typeof this.pos === 'function' ? this.pos() : this.pos; [this.x, this.z] = xzOf(p); return this; }
  /** Everything this source asks for is loaded (checked once per frame, at the end of the frame) @type {boolean} */
  get ready() { return this._ready; }
  /** Promise that resolves when ready becomes true @type {Promise<void>} */
  get whenReady() { return this._ready ? Promise.resolve() : new Promise((res, rej) => this._waiters.push({ res, rej })); }
  /** @internal settle every waiter: resolve, or reject with err */
  _settle(err) { for (const w of this._waiters.splice(0)) if (err) w.rej(err); else w.res(); }
  /**
   * Move the source (a live Object3D / Vector3, a function returning a position, or a fixed one); ready is checked again
   * @example engine.load.camera.at(photoCamera)
   * @param {any} position
   * @returns {this}
   */
  at(position) { this.pos = position; this.sync(); this._ready = false; this.age = 0; this.load.version++; return this; }
  /** Stop loading for this source (what nobody else asks for unloads) @returns {void} */
  remove() {
    if (this.removed) return;
    this.removed = true; this.load.sources.delete(this); this.load.version++;
    this._settle(codedError('load-removed', STRINGS.removed.replace('{name}', this.name)));   // an await on whenReady never hangs
  }
}

/** engine.load: the sources the world is loaded around. Loaders (stream, world, terrain, hlod, rigid) read it; games add sources for teleports and far cameras. */
export class Load {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.sources = new Set();
    /** @internal Bumps when a source is added, removed or moved with at() */ this.version = 0;
    /** @internal name -> (source) => boolean */ this.checks = new Map();
    /** Built-in source at the gameplay anchor (world.anchor, else the player, else engine.focus): full detail and physics @type {LoadSource} */
    this.player = this.source(() => engine.player?.position ?? engine.focus, { name: 'player' });
    /** Built-in source at the camera focus engine.focus: full detail, no physics @type {LoadSource} */
    this.camera = this.source(engine.focus, { name: 'camera', physics: false });
  }

  /**
   * Add a load source: the world around position is loaded (terrain chunks, colliders, nearby models, stream entries) until remove() or until.
   * position may be live (an Object3D or Vector3 that moves) or a function. detail 'simple' loads only terrain and hlod proxies (a far view);
   * physics defaults to true for 'full'; pass false for a camera that only needs a picture. radius caps every loader's range (default: each loader's own range).
   * until: a Promise (removed when it settles) or a function checked every frame (removed when it returns true).
   * @example const dest = engine.load.source([800, 0, 300], { radius: 64 }); await dest.whenReady; engine.player.placeAt([800, 0, 300]); dest.remove();
   * @example engine.load.source(photoCam, { physics: false, until: () => !photoMode.active });   // follows a camera, no colliders
   * @param {any} position
   * @param {LoadSourceOptions} [opts]
   * @returns {LoadSource}
   */
  source(position, opts = {}) {
    checkOptions('load.source()', opts, KEYS);
    if (opts.detail != null && opts.detail !== 'full' && opts.detail !== 'simple') throw codedError('load-option', STRINGS.detail.replace('{got}', JSON.stringify(opts.detail)));
    const s = new Source(this, position, opts);
    this.sources.add(s); this.version++;
    return /** @type {any} */ (s);
  }

  /**
   * Load the destination first, then move: resolves after the player (engine.focus without one) is placed. Until the destination is ready
   * (terrain chunks, collision, nearby models) the player stays where it is. move replaces the default placement (for a vehicle or a custom character).
   * timeout (seconds of frame time, default 60; Infinity waits forever): when the destination is still not ready, the Promise rejects (code load-timeout,
   * naming the loaders still waiting) and the player is not moved.
   * @example await engine.load.teleport([800, 0, 300]);
   * @example await engine.load.teleport(door.target, { radius: 40, move: p => engine.player.placeAt(p) });
   * @param {any} position
   * @param {{ radius?: number, move?: (position: any) => void, timeout?: number }} [opts]
   * @returns {Promise<void>}
   */
  async teleport(position, opts = {}) {
    checkOptions('load.teleport()', opts, ['radius', 'move', 'timeout']);
    const e = this.engine, s = this.source(position, { radius: opts.radius ?? 64, name: 'teleport' }), limit = opts.timeout ?? 60;
    let waited = 0;
    const watch = e.onFrame(dt => {
      if ((waited += dt) <= limit || s.ready) return;
      const checks = [...this.checks].filter(([, fn]) => !fn(s)).map(([n]) => n).join(', ') || 'one more frame';
      s._settle(codedError('load-timeout', STRINGS.timeout.replace('{x}', s.x.toFixed(1)).replace('{z}', s.z.toFixed(1)).replace('{t}', String(limit)).replace('{checks}', checks)));
    });
    try {
      await s.whenReady;
      if (opts.move) opts.move(position);
      else if (e.player) e.player.placeAt(position);
      else { const [x, z] = xzOf(position); e.focus.set(x, e.surface(x, z), z); }
    } finally { watch.remove(); s.remove(); }   // the player (or camera) source covers the place from now on
  }

  /**
   * Register a readiness check for loaders: fn(source) returns whether this loader finished what that source asks for.
   * For module authors whose loader reads load sources; games only read source.ready.
   * @example engine.load.readyCheck('props', s => s.detail !== 'full' || props.queued === 0)
   * @param {string} name
   * @param {(source: LoadSource) => boolean} fn
   * @returns {{ remove(): void }}
   */
  readyCheck(name, fn) { this.checks.set(name, fn); return { remove: () => { if (this.checks.get(name) === fn) this.checks.delete(name); } }; }

  /**
   * Sources with fresh positions, filtered: { detail: 'full' } for models and stream entries, { physics: true } for colliders, no filter for terrain
   * @param {{ detail?: 'full' | 'simple', physics?: boolean }} [pick]
   * @returns {LoadSource[]}
   */
  list(pick) {
    const out = [];
    for (const s of this.sources) {
      if (pick?.detail && s.detail !== pick.detail) continue;
      if (pick?.physics != null && s.physics !== pick.physics) continue;
      out.push(s.sync());
    }
    return /** @type {any} */ (out);
  }
  /** A loader's range for a source: its own range, capped by the source radius @param {LoadSource} s @param {number} range @returns {number} */
  reach(s, range) { return s.radius == null ? range : Math.min(s.radius, range); }
  /**
   * @internal For loaders that skip work while nothing moves: true when the picked sources were added / removed or one moved more than eps since the last marked call.
   * memo is the loader's own object; mark false only peeks (for a ready getter).
   */
  changed(memo, eps, pick, mark = true) {
    let diff = memo.v !== this.version || !memo.at, i = 0;
    if (!diff) for (const s of this.sources) {   // walks the sources in place: no array while nothing moved (every loader asks every frame)
      if ((pick?.detail && s.detail !== pick.detail) || (pick?.physics != null && s.physics !== pick.physics)) continue;
      const a = memo.at[i++]; s.sync();
      if (!a || (s.x - a.x) ** 2 + (s.z - a.z) ** 2 > eps * eps) { diff = true; break; }
    }
    if (!diff && i !== memo.at.length) diff = true;
    if (diff && mark) { memo.v = this.version; memo.at = this.list(pick).map(s => ({ x: s.x, z: s.z, s })); }
    return diff;
  }

  /** @internal End of every frame (after loaders ran): until, readiness, whenReady. A source counts only after one full frame, so every loader has seen it. */
  update() {
    for (const s of [...this.sources]) {
      if (typeof s.until === 'function' && s.until()) { s.remove(); continue; }
      if (s.age++ < 1) continue;
      s.sync();
      let ok = true;
      for (const fn of this.checks.values()) if (!fn(s)) { ok = false; break; }
      s._ready = ok;
      if (ok && s._waiters.length) s._settle(null);
    }
  }
  /** @internal Called by engine.dispose: drop added sources (the two built-in ones stay) */
  dispose() { for (const s of [...this.sources]) if (s !== this.player && s !== this.camera) s.remove(); this.checks.clear(); }
}
