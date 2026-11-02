// engine.clock: calendar seconds, after / every.
// Calendar clock, engine.clock: calendar seconds `now` + "after a delay / every interval" timers.
// Calendar seconds = world-channel seconds x the calendar rate engine.clock.rate (core/time.js has the three rulers): change the rate only through
//   engine.mod('clock.rate', { owner: 'game', set: 60 })   // a minute of calendar per second; read engine.clock.rate
// It does not run while paused / frozen and is saved with the save; a calendar day = calendar.dayLength calendar seconds, so one hour = dayLength / hoursPerDay.
// Clock-time / season timers (daily 18:00, time-window switches, season change) belong to the calendar module (modules/calendar, a gameplay
// module, so core never names it): engine.calendar.at / between / daily / onSeason; the sky only draws that time.
//   engine.clock.after(120, 'bread:ready')          // emit an event after 120 calendar seconds (saveable: still fires after a load)
//   engine.clock.after(5, () => door.close())        // a function works too, but functions cannot be saved
//   engine.clock.every(30, () => spawnBird())        // every 30 calendar seconds
//   engine.clock.after(1, 'poison:tick', { id }, { channel: 'enemies' })   // channel seconds instead: slows down with bullet time (core/time.js)
// Which time to use for what: the table in recipes/06-clock-events.md. All timers return a handle { remove() }.
// A timer callback that throws is a gameplay error (errors.js: frozen with engine.error in dev); the other timers still run.
import { reportError } from './errors.js';
import { warnOnce, renamed } from './validate.js';
import { codedError } from './errorHints.js';
import { saveValues } from './saveValues.js';

const STRINGS = {
  after: 'clock.after(seconds): seconds must be a finite number of calendar seconds, got {got}',
  every: 'clock.every(seconds): seconds must be a finite number of calendar seconds > 0, got {got}; for every fixed step use engine.onFixed(dt => ...)',
  where: 'clock timer',
  nowWrite: 'engine.clock.now was written directly: timers jump or fire out of order and the calendar, schedules and far NPCs skip the time between. ' +
    'To pass time use engine.skip({ seconds }) (timers fire in order, everything catches up); the value you wrote is kept',
};

// 0.2 timeScale removed: assigning used to silently do nothing (calendar speed unchanged); in dev both read and write throw and point to the new path (core/validate.js renamed, not installed in release)
const OLD = renamed('engine.clock', { timeScale: "engine.clock.rate to read it and engine.mod('clock.rate', { owner, set }) to change it (h.remove() gives it back)" });
export class Clock {
  constructor(engine) {
    this.engine = engine;
    /** @internal calendar seconds (public: now) */ this._now = 0;
    // the calendar rate is a stack (core/stacks.js): several owners (the game, the debug panel, a sleep skip) can change it without undoing each other
    this._rate = engine.stacks.define('clock.rate', { min: 0 });
    /** @internal after / every: { due, fn?, event?, data?, every? } */ this._timers = [];
    /** @internal earliest due among the timers (ticks with nothing due return early) */ this._next = Infinity;
    engine.saves.register('clock', {
      save: () => ({ now: this.now, timers: this._timers.filter(t => t.event).map(({ due, event, data }) => ({ due, event, data })) }),
      // On load: event timers use the saved due time; function timers (not saveable, still attached to the running game) are shifted onto the new clock by their remaining time
      // saved numbers pass saveValues: a negative / non-finite now ran the calendar backwards and a timer with due 'abc' never fired (durability audit)
      load: d => {
        const old = this._now, v = saveValues('clock');
        this._now = v.num(d?.now ?? 0, 'now', { min: 0, fallback: 0 });
        const fnTimers = this._timers.filter(t => !t.event);
        for (const t of fnTimers) t.due = this.now + (t.due - old);
        const saved = (Array.isArray(d?.timers) ? d.timers : []).filter(t => {
          if (typeof t?.event === 'string' && Number.isFinite(t.due)) return true;
          v.drop('timers[]', t); return false;
        });
        v.done();
        this._set(fnTimers.concat(saved.map(t => ({ ...t }))));
      },
    });
  }

  /** Calendar seconds since the start (saved). Pass time with engine.skip({ seconds }); a direct write is kept and warned once */
  get now() { return this._now; }
  set now(v) { warnOnce(STRINGS.nowWrite); this._now = v; }
  /** Calendar seconds per world-channel second (default 1; 0 stops the calendar). Read-only: engine.mod('clock.rate', { owner, set }) changes it */
  get rate() { return this._rate.value(); }
  /** @internal writing rate must go through mod (several owners stack without overwriting each other); a direct assignment gets the new form instead of an opaque TypeError */
  set rate(v) { throw codedError('mod-owner', `engine.clock.rate is read-only: engine.mod('clock.rate', { owner, set: ${v} }) changes it (h.remove() gives it back)`); }
  /** Calendar seconds per real second right now = rate x the world channel's speed (the calendar and far NPCs advance by it) */
  get speed() { return this._rate.value() * this.engine.time.scale('world'); }
  /**
   * Call fn after `seconds` calendar seconds; when fnOrEvent is an event name, emit that event (with data) when due, which can be saved.
   * { channel } counts that time channel's seconds instead, e.g. a poison tick that slows down in bullet time.
   */
  after(seconds, fnOrEvent, data, { channel } = {}) {
    if (channel) return this.engine.time.after(channel, seconds, fnOrEvent, data);
    if (!Number.isFinite(seconds)) throw codedError('clock-interval', STRINGS.after.replace('{got}', String(seconds)));
    const t = typeof fnOrEvent === 'string' ? { due: this.now + seconds, event: fnOrEvent, data } : { due: this.now + seconds, fn: fnOrEvent };
    return this._add(t);
  }
  /** Call fn every `seconds` calendar seconds (seconds > 0) */
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
  /** Calendar seconds until the next timer is due (Infinity with none); engine.skip ends a segment there so timers fire in time order @internal */
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

  /** @internal Advance by calendar seconds (engine.time._advance every fixed step, engine.skip per segment) */
  _advance(seconds) {
    this._now += seconds;
    if (this._next <= this.now) this._runTimers();
  }
  /** @internal */
  _runTimers() {
    // one pass splits the list: what is due (fired below, in time order) and what stays. The due one-shots leave the list before any of them
    // fires (they all fire in this call), instead of one re-filter of the whole list per fired timer (O(fired x timers) on a busy step).
    // Timers a callback adds or removes go to / from the kept list as usual
    const now = this.now, due = [], keep = [];
    for (const t of this._timers) { if (t.due <= now) due.push(t); if (t.every || t.due > now) keep.push(t); }
    due.sort((a, b) => a.due - b.due);
    this._timers = keep;
    for (const t of due) {
      if (t.every) { while (t.due <= this.now) { t.due += t.every; this._call(t); } continue; }
      if (t.event) this.engine.events.emit(t.event, t.data); else this._call(t);
    }
    this._set(this._timers);
  }
  /** @internal a callback that throws is a gameplay error; the other timers still run */
  _call(t) { try { t.fn(); } catch (err) { reportError(this.engine, err, STRINGS.where); } }
}
OLD.on(Clock.prototype);
