// Game clock, engine.clock: game seconds `now` + "after a delay / every interval" timers.
// Game seconds = fixed-step seconds x clock.timeScale (default 1; the sky's time of day follows it too); it does not run while paused / frozen, and is saved with the save;
// a sky day = sky.dayLength game seconds, so one sky hour = dayLength / 24 game seconds (independent of timeScale: the time scale only makes game seconds run faster).
// Clock-time / season timers (daily 18:00, time-window switches, season change) belong to the sky: engine.sky.at / between / daily / onSeason.
//   engine.clock.after(120, 'bread:ready')          // emit an event after 120 game seconds (saveable: still fires after a load)
//   engine.clock.after(5, () => door.close())        // a function works too, but functions cannot be saved
//   engine.clock.every(30, () => spawnBird())        // every 30 game seconds
// For fixed seconds (ignore the time scale; cooldowns, action timing): accumulate dt in engine.onFixed(dt => ...). Which time to use for what: the table in recipes/06-clock-events.md. All timers return a handle { remove() }.
// A timer callback that throws is a gameplay error (errors.js: frozen with engine.error in dev); the other timers still run.
import { reportError } from './errors.js';
import { codedError } from './errorHints.js';

const STRINGS = {
  after: 'clock.after(seconds): seconds must be a finite number of game seconds, got {got}',
  every: 'clock.every(seconds): seconds must be a finite number of game seconds > 0, got {got}; for every fixed step use engine.onFixed(dt => ...)',
  where: 'clock timer',
};

export class Clock {
  constructor(engine) {
    this.engine = engine;
    this.now = 0;            // game seconds
    /** Game seconds per fixed-step second: 0 stops game time (sky included), 60 = a minute per second. Fixed-step dt and engine.elapsed ignore it @type {number} */
    this.timeScale = 1;
    /** @internal after / every: { due, fn?, event?, data?, every? } */ this._timers = [];
    /** @internal earliest due among the timers (ticks with nothing due return early) */ this._next = Infinity;
    engine.saves.register('clock', {
      save: () => ({ now: this.now, timers: this._timers.filter(t => t.event).map(({ due, event, data }) => ({ due, event, data })) }),
      // On load: event timers use the saved due time; function timers (not saveable, still attached to the running game) are shifted onto the new clock by their remaining time
      load: d => {
        const old = this.now;
        this.now = d?.now ?? 0;
        const fnTimers = this._timers.filter(t => !t.event);
        for (const t of fnTimers) t.due = this.now + (t.due - old);
        this._set(fnTimers.concat((d?.timers || []).map(t => ({ ...t }))));
      },
    });
  }

  /** Call fn after `seconds` game seconds; when fnOrEvent is an event name, emit that event (with data) when due, which can be saved */
  after(seconds, fnOrEvent, data) {
    if (!Number.isFinite(seconds)) throw codedError('clock-interval', STRINGS.after.replace('{got}', String(seconds)));
    const t = typeof fnOrEvent === 'string' ? { due: this.now + seconds, event: fnOrEvent, data } : { due: this.now + seconds, fn: fnOrEvent };
    return this._add(t);
  }
  /** Call fn every `seconds` game seconds (seconds > 0) */
  every(seconds, fn) {
    if (!(seconds > 0) || !Number.isFinite(seconds)) throw codedError('clock-interval', STRINGS.every.replace('{got}', String(seconds)));
    return this._add({ due: this.now + seconds, fn, every: seconds });
  }
  /** @internal */
  _add(t) {
    this._timers.push(t);
    if (t.due < this._next) this._next = t.due;
    return { remove: () => { this._set(this._timers.filter(x => x !== t)); } };
  }
  /** @internal replace the timer list and recompute the next due time */
  _set(list) { this._timers = list; this._next = Infinity; for (const t of list) if (t.due < this._next) this._next = t.due; }
  /** Game seconds until the next timer is due (Infinity with none); engine.skip ends a segment there so timers fire in time order @internal */
  untilNext() { return Math.max(0, this._next - this.now); }
  /** Number of registered timers (after / every), used by engine.counts() */
  get size() { return this._timers.length; }
  /** Clear all timers (engine.dispose calls it) */
  dispose() { this._set([]); }
  /**
   * @internal For engine.session: the function timers now, each with its remaining delay (what a new playthrough starts with).
   * @returns {{ t: object, rem: number }[]}
   */
  snapshotFnTimers() { return this._timers.filter(t => !t.event).map(t => ({ t, rem: t.due - this.now })); }
  /**
   * @internal For engine.session: keep the event timers (they came with the save) and put back exactly the snapshotted function timers, each with its original delay.
   * A function timer removed during play comes back too: a new playthrough starts as if the page had just opened.
   * @param {{ t: object, rem: number }[]} list
   */
  restoreFnTimers(list) { this._set(this._timers.filter(t => t.event).concat(list.map(({ t, rem }) => Object.assign(t, { due: this.now + rem })))); }

  /** Called by the engine every fixed step (after module hooks) */
  tick(dt) {
    this.now += dt * this.timeScale;
    if (this._next <= this.now) this._runTimers();
  }
  /** @internal */
  _runTimers() {
    const due = this._timers.filter(t => t.due <= this.now).sort((a, b) => a.due - b.due);
    for (const t of due) {
      if (t.every) { while (t.due <= this.now) { t.due += t.every; this._call(t); } continue; }
      this._timers = this._timers.filter(x => x !== t);
      if (t.event) this.engine.events.emit(t.event, t.data); else this._call(t);
    }
    this._set(this._timers);
  }
  /** @internal a callback that throws is a gameplay error; the other timers still run */
  _call(t) { try { t.fn(); } catch (err) { reportError(this.engine, err, STRINGS.where); } }
}
