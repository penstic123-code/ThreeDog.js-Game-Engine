// engine.threads: a small worker pool. createEngine({ threads: 'auto' | number | false }) sets how many workers each lane may use (default 'auto').
//   const lane = engine.threads.lane({ create: () => new Worker(new URL('../myWorker.js', import.meta.url), { type: 'module' }), local: makeHandler });
//   lane.broadcast({ type: 'init', cfg }, 'init');   // every worker (and the local handler) gets it, also workers started later
//   const r = await lane.run({ type: 'job', x: 1 });  // least busy worker answers
// The worker file is two lines: import { serve } from 'threedog/worker'; serve(makeHandler());   (the worker-safe entry: serve and compilePure, no three.js or DOM)
// makeHandler() returns msg => reply, the SAME code runs on the main thread when there are no workers (threads: false, Worker unsupported, or the worker crashed),
// so callers never write a second code path. Typed arrays in a reply are transferred (no copy).
// Gameplay must not depend on when a reply arrives: hand results to engine.commits (fixed-tick effect, main-thread fallback), see Commits.js.
// Workers start lazily on the first run / broadcast, so threads: 'auto' costs nothing in a game that never uses a lane; threads: false never creates one.
// shared: true when the page is cross-origin isolated (COOP/COEP headers); then array() hands out SharedArrayBuffer-backed arrays every worker reads without a copy.
import { compilePure, pureHandler } from './threadPure.js';
import { codedError, coded } from '../base/errorHints.js';
import { warnOnce, fmt } from '../base/validate.js';

const STRINGS = { crashed: '[threads] a worker failed ({msg}); its lane now runs on the main thread (same code, slower)',
  transfer: 'lane.run(): the worker died after this task moved its buffers (transfer), so it cannot rerun on the main thread with the same data; send it again',
  bad: 'createEngine({ threads }): use \'auto\', a worker count (0 = none) or false; got {v}' };

/** Resolve the threads option to a worker count per lane. 'auto' leaves one core for the main thread, capped at 4 (more rarely helps a browser game and costs memory). */
function threadCount(v = 'auto') {
  if (v === false || v === 0) return 0;
  if (v === 'auto' || v === true) return Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency || 2) - 1));
  if (typeof v === 'number' && v >= 0) return Math.floor(v);
  throw codedError('threads-option', fmt(STRINGS.bad, { v: String(JSON.stringify(v)) }));
}

/**
 * One kind of worker (one script), up to engine.threads.size instances. run() goes to the least busy one; with no workers the local handler answers on a microtask.
 */
class Lane {
  /** @internal construct through engine.threads.lane() (the class stays in the declarations because lane() returns it) */
  constructor(threads, { create, local, max = Infinity, timeout = 20000 }) {
    this.threads = threads; this.create = create; this.local = local;
    // A worker that never answers (stuck loop, lost message) would leave its tasks pending forever; past this many ms without any reply it counts as crashed
    this.timeout = timeout; this._watch = 0;
    this.max = Math.min(threads.size, max);
    /** @type {{ w: Worker, busy: number }[]} */ this.workers = [];
    this.handler = null;          // the main-thread handler, built when first needed
    this.tasks = new Map();       // id -> { msg, res, rej, moved }
    this.bcast = new Map();       // key -> message, replayed to workers started later and to the local handler
    this._id = 0; this._k = 0;
  }
  /** Workers actually running in this lane (0 = main thread) @returns {number} */
  get size() { return this.workers.length; }
  _start() {
    if (this.workers.length || this.handler || this.max <= 0) return;
    try {
      for (let i = 0; i < this.max; i++) {
        const slot = { w: this.create(), busy: 0 };
        slot.w.onmessage = e => this._reply(slot, e.data);
        slot.w.onerror = e => { e.preventDefault?.(); this._crash(e.message || 'error'); };
        // a reply that cannot be deserialized never reaches onmessage, so its task would hang: same fallback as a crash
        slot.w.onmessageerror = () => this._crash('a reply could not be deserialized');
        for (const m of this.bcast.values()) slot.w.postMessage({ id: 0, data: m });
        this.workers.push(slot);
      }
    } catch (err) { this._crash(err.message); }
  }
  _reply(slot, { id, data, error }) {
    const t = this.tasks.get(id); if (!t) return;
    this.tasks.delete(id); slot.busy--; slot.last = performance.now();   // wall-clock: the worker watchdog counts real time
    if (error) t.rej(new Error(error)); else t.res(data);
  }
  /** A worker died: stop them all and finish every open task on the main thread (results are the same, only slower); a task that transferred buffers rejects instead (its data is gone) */
  _crash(msg) {
    if (!this.workers.length && this.handler) return;
    warnOnce(coded('threads-crash', fmt(STRINGS.crashed, { msg })));
    for (const s of this.workers) s.w.terminate();
    this.workers = []; this.max = 0; clearTimeout(this._watch); this._watch = 0;
    for (const [id, t] of this.tasks) { this.tasks.delete(id); if (t.moved) t.rej(codedError('threads-transfer', STRINGS.transfer)); else this._runLocal(t.msg).then(t.res, t.rej); }
  }
  _local() {
    if (!this.handler) { this.handler = this.local(); for (const m of this.bcast.values()) this.handler(structuredClone(m)); }
    return this.handler;
  }
  // The message is cloned like postMessage would, so a handler that changes its input behaves the same in both places
  _runLocal(msg) { return Promise.resolve().then(() => this._local()(structuredClone(msg))); }
  /**
   * Send a task; resolves with the handler's reply. Typed arrays you list in transfer move to the worker (unusable here afterwards);
   * if that worker then crashes, the task rejects (code threads-transfer) instead of rerunning on the main thread with emptied buffers.
   * @param {any} msg plain data
   * @param {Transferable[]} [transfer]
   * @returns {Promise<any>}
   */
  run(msg, transfer) {
    this._start();
    if (!this.workers.length) return this._runLocal(msg);
    let slot = this.workers[0];
    for (const s of this.workers) if (s.busy < slot.busy) slot = s;
    const id = ++this._id;
    return new Promise((res, rej) => {
      slot.w.postMessage({ id, data: msg }, transfer || []);   // first: a message that cannot be sent rejects here and leaves no task for the watchdog to call stuck
      this.tasks.set(id, { msg, res, rej, moved: !!transfer?.length });
      // the clock counts from the last reply (or from going busy), not per task: tasks queued behind a long one are not stuck
      if (!slot.busy++) slot.last = performance.now();   // wall-clock
      this._arm();
    });
  }
  // One timer per lane while tasks are open: a busy worker silent for longer than timeout -> _crash (its tasks finish on the main thread)
  _arm() {
    if (this._watch || !(this.timeout > 0)) return;
    this._watch = setTimeout(() => {   // wall-clock
      this._watch = 0;
      const now = performance.now();   // wall-clock
      const stuck = this.workers.find(s => s.busy > 0 && now - s.last >= this.timeout);
      if (stuck) this._crash(`no reply for ${this.timeout} ms`);
      else if (this.tasks.size) this._arm();
    }, this.timeout / 2);
  }
  /**
   * Send setup data to every worker (no reply). With a key, a later broadcast of the same key replaces it for workers started afterwards.
   * @param {any} msg
   * @param {string} [key]
   */
  broadcast(msg, key = '#' + this._k++) {
    this._start();   // first: a worker started here replays what was broadcast before, then gets this one below, once
    this.bcast.delete(key); this.bcast.set(key, msg);
    for (const s of this.workers) s.w.postMessage({ id: 0, data: msg });
    if (this.handler) this.handler(structuredClone(msg));
  }
  /** Stop the workers; open tasks never settle */
  dispose() { clearTimeout(this._watch); for (const s of this.workers) s.w.terminate(); this.workers = []; this.tasks.clear(); this.max = 0; this.threads.lanes.delete(this); }
}

/**
 * engine.threads: worker pool behind createEngine({ threads }). Lanes start their workers lazily; size 0 means everything runs on the main thread.
 * @experimental
 */
export class Threads {
  /** @internal */
  constructor(opt) {
    /** Workers per lane (0 = main thread only) */
    this.size = threadCount(opt);
    /** True when SharedArrayBuffer can be shared with workers (page is cross-origin isolated) */
    this.shared = this.size > 0 && globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
    /** @internal */ this.lanes = new Set();
    /** @internal */ this._pure = null;
  }
  /**
   * A lane of workers running one script. create must contain the literal new Worker(new URL('../file.js', import.meta.url), { type: 'module' }) so bundlers find the file.
   * local builds the same handler on the main thread (used when there are no workers).
   * timeout (ms, default 20000, 0 = never): a busy worker silent that long counts as crashed and its open tasks finish on the main thread (one warning, code threads-crash).
   * @param {{ create: () => Worker, local: () => (msg: any) => any, max?: number, timeout?: number }} opts
   * @returns {Lane}
   * @example
   * const lane = engine.threads.lane({ create: () => new Worker(new URL('../chunkWorker.js', import.meta.url), { type: 'module' }), local: chunkHandler });
   * lane.run({ cx: 0, cz: 0 }).then(r => engine.commits ...);
   */
  lane(opts) { const l = new Lane(this, opts); this.lanes.add(l); return l; }
  /**
   * A typed array other threads can read without a copy: on a SharedArrayBuffer when shared, else an ordinary one (postMessage then copies it).
   * @template {Float32ArrayConstructor | Int32ArrayConstructor | Uint8ArrayConstructor | Uint16ArrayConstructor | Float64ArrayConstructor} T
   * @param {T} Type
   * @param {number} length
   * @returns {InstanceType<T>}
   * @example const heights = engine.threads.array(Float32Array, 256 * 256);
   */
  array(Type, length) {
    const bytes = length * Type.BYTES_PER_ELEMENT;
    return /** @type {any} */ (new Type(this.shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes)));
  }
  /**
   * Turn a self-contained function into one that can run in a worker. It is recompiled from its source text, so it sees only its parameters and globals like Math:
   * a closure variable fails here with a pure-function error naming it (threads on or off behave the same). Used by world.simulate(kind, { far, worker: true }).
   * @param {Function} fn
   * @param {string} label where it came from, used in error messages
   * @returns {{ fn: Function, src: string, label: string }}
   * @example const grow = engine.threads.pure((rec, dt) => { rec.growth = Math.min(1, rec.growth + dt / 600); }, "world.simulate('crop') far");
   */
  pure(fn, label) { return compilePure(fn, label); }
  /** @internal the shared lane that runs pure functions (core/threads/pureWorker.js) */
  pureLane() {
    return this._pure ??= this.lane({ create: () => new Worker(new URL('./pureWorker.js', import.meta.url), { type: 'module' }), local: pureHandler });
  }
  /** @internal engine.dispose calls it */
  dispose() { for (const l of [...this.lanes]) l.dispose(); this._pure = null; }
}
