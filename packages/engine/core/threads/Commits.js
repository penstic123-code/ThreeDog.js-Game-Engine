// How background results take effect: engine.commits.
// Background results that affect gameplay (chunk collision, spread-over-frames jobs that change gameplay state, future navmesh, entity spawns...) do not take effect "whenever they finish" --
// that depends on machine speed and background-thread queueing -- but on a fixed-step tick decided when the request is made:
//   const t = engine.commits.request({ apply: r => change gameplay state with the result, fallback: () => compute the same result on the main thread now, valid: () => still wanted? });
//   when the background work finishes: t.resolve(result); when no longer wanted: t.remove()
// At the due tick (engine.time.tick at request + lag, default 30 steps = 0.5 s) requests take effect in a stable order (due tick, then request order):
//   finished -> apply(result); not finished -> apply(fallback()) (stats.late +1; a background result that arrives later is ignored); valid() false -> dropped.
// A save load or level change (invalidate) drops the requests that have no valid: they were made for the old world (a load that fails gives them back: the old world stays). A request with valid decides itself
// (terrain colliders survive a load because the terrain is the same; pass valid when your result belongs to state a load replaces).
// So sync, async, delayed or out-of-order returns all give the same gameplay state at the same tick for the same input. Fixed steps do not run while frozen, so due time stops too.
// Requests registered during loading (before engine.ready): start() calls rebase() when done and timing restarts from the playable moment (load time varies by machine and must not count); lag 0 takes effect right then.
// Results that only affect visuals (model upload, far scenery, particles) need not go through here; show them when ready.
const STRINGS = { noFallback: 'commits.request() needs a fallback: it is computed on the main thread when due and the result is not ready (so the outcome never depends on machine speed); pass fallback: () => ...' };

/**
  * engine.commits: background results that affect gameplay take effect on a fixed-step tick decided at request time, in a stable order; if not finished when due, the fallback is computed on the main thread.
  * Sync, async, delayed and out-of-order returns give the same gameplay state at the same tick for the same input. Results that only affect visuals need not go through here.
 */
import { codedError } from '../base/errorHints.js';
import { reportError } from '../base/errors.js';

export class Commits {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** Default delay (fixed steps); 30 = 0.5 s */
    this.lag = 30;
    /** @internal sorted by due, then seq */ this.queue = [];
    /** @internal */ this._seq = 0;
    /** @internal bumped by invalidate (save load, level change); requests without valid from an older epoch are dropped */ this.epoch = 0;
    /** Totals: applied, fallbacks used because not finished when due, dropped because valid() was false */
    this.stats = { applied: 0, late: 0, dropped: 0 };
  }
  /** Number of requests not yet applied @returns {number} */
  get pending() { return this.queue.length; }
  /**
   * Register a request: resolve(result) when the background work finishes, remove() if no longer wanted. apply changes gameplay state with the result; fallback computes the same result on the main thread (required); valid says whether it is still wanted when due
   * @template [T=any]
   * @param {{ apply: (result: T) => void, fallback: () => T, valid?: (() => boolean) | null, lag?: number }} opts
   * @returns {{ due: number, resolve: (result: T) => void, remove: () => void }}
   * @example const t = engine.commits.request({ apply: r => { state.path = r; }, fallback: () => computePath() });
   * pathWorker.then(r => t.resolve(r));
  */
  request(opts) {
    const { apply, fallback, valid = null, lag = this.lag } = opts;
    if (typeof fallback !== 'function') throw codedError('commit-fallback', STRINGS.noFallback);
    const t = { due: this.engine.time.tick + Math.max(1, lag), lag, seq: this._seq++, apply, fallback, valid, epoch: this.epoch, done: false, result: undefined, canceled: false };
    this._insert(t);
    const remove = () => { t.canceled = true; };
    return { due: t.due, resolve: r => { if (!t.done) { t.done = true; t.result = r; } }, remove };
  }
  /** @internal */
  _insert(t) {
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].due > t.due || (this.queue[i - 1].due === t.due && this.queue[i - 1].seq > t.seq))) i--;
    this.queue.splice(i, 0, t);
  }
  /** @internal Called by the engine at the start of each fixed step: due requests take effect in order */
  tick(now) {
    while (this.queue.length && this.queue[0].due <= now) {
      const t = this.queue.shift();
      if (t.canceled || (t.valid ? !t.valid() : t.epoch !== this.epoch)) { this.stats.dropped++; continue; }
      // each request on its own: one that throws must not push the next ones due to a later tick, or to never, in a frozen dev game
      try {
        if (!t.done) { t.result = t.fallback(); t.done = true; this.stats.late++; }
        if (t.canceled) { this.stats.dropped++; continue; }   // the fallback itself gave up on the request (a job that failed): nothing to apply
        t.apply(t.result);
        this.stats.applied++;
      } catch (err) { reportError(this.engine, err, 'background result apply (commits)'); }
    }
  }
  /** @internal Called when start() finishes loading and when a new playthrough restarts the tick: pending requests restart timing from now (due = now + lag); lag 0 takes effect immediately */
  rebase() {
    const now = this.engine.time.tick, list = this.queue.splice(0);
    for (const t of list) { t.due = now + t.lag; this._insert(t); }
    this.tick(now);
  }
  /** @internal Drop all requests (engine.dispose calls it) */
  dispose() { this.queue.length = 0; }
  /** @internal A save load or level change replaced the world: results requested for the old one must not land on the new one (counted as dropped).
   *  Returns undo() for a load that failed; a level change since then keeps them dropped, the world they were for has been rebuilt */
  invalidate() { const was = this.epoch, mine = ++this.epoch; return () => { if (this.epoch === mine) this.epoch = was; }; }
}
