// Stream sources (internal half of engine.stream): the places the world must be loaded around (the streaming-source idea of Unreal World Partition).
// Every distance-based loader reads this list and nothing else: stream entries, world models (present), terrain chunks, hlod near/far and rigid-body terrain colliders.
//   engine.stream.player   built in: the player (engine.focus without one); full detail + physics
//   engine.stream.camera   built in: engine.focus; full detail, no physics (a cutscene or photo camera far away gets a picture, not colliders)
//   const s = engine.stream.source([800, 0, 300], { radius: 64 }); await s.whenReady; ... s.remove();
//   await engine.stream.teleport([800, 0, 300]);   // the player moves only after the destination is loaded (terrain, collision, nearby models)
// Display, physics and world data are three separate things: a source decides what is shown and what has colliders; world records are never deleted by unloading,
// and near / far simulation follows world.anchor (recipe 18). Readiness is per source: each loader registers a check with addReadyCheck.
import { xzOf } from '../base/math.js';
import { codedError } from '../base/errorHints.js';
import { fmt } from '../base/validate.js';

const removedError = s => codedError('stream-removed', fmt(SOURCE_STRINGS.removed, { name: s.name }));

export const SOURCE_KEYS = ['radius', 'detail', 'physics', 'until', 'name'];
export const SOURCE_STRINGS = {
  detail: 'stream.source(): detail must be \'full\' (models, stream entries, physics) or \'simple\' (terrain and hlod proxies only), got {got}',
  removed: 'stream source "{name}" was removed before it was ready (remove(), its until, or engine.dispose()); nothing waits for it any more',
  timeout: 'stream.teleport(): the destination ({x}, {z}) was not ready after {t} s; still waiting on: {checks}. The player was not moved',
};

/** One stream source (returned by engine.stream.source) @internal */
export class Source {
  constructor(stream, position, o) {
    /** @internal */ this.stream = stream;
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
  get whenReady() {
    if (this._ready) return Promise.resolve();
    return new Promise((res, rej) => { this._waiters.push({ res, rej }); if (this.removed) this._settle(removedError(this)); });   // asked after remove(): nothing would settle it
  }
  /** @internal settle every waiter: resolve, or reject with err */
  _settle(err) { for (const w of this._waiters.splice(0)) if (err) w.rej(err); else w.res(); }
  /**
   * Move the source (a live Object3D / Vector3, a function returning a position, or a fixed one); ready is checked again
   * @example engine.stream.camera.at(photoCamera)
   * @param {any} position
   * @returns {this}
   */
  at(position) { this.pos = position; this.sync(); this._ready = false; this.age = 0; this.stream._version++; return this; }
  /** A loader's range for this source: the loader's own range, capped by the source radius @param {number} range @returns {number} */
  reach(range) { return this.radius == null ? range : Math.min(this.radius, range); }
  /** Stop loading for this source (what nobody else asks for unloads) @returns {void} */
  remove() {
    if (this.removed) return;
    this.removed = true; this.stream._sources.delete(this); this.stream._version++;
    this._settle(removedError(this));   // an await on whenReady never hangs
  }
}
