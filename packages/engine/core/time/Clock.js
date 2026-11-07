// Calendar clock, engine.clock: the calendar view of the time source (core/time/time.js) and the one timer API.
// Calendar seconds = world-channel seconds x the calendar rate engine.clock.rate; change the rate only through
//   engine.mod('clock.rate', { owner: 'game', set: 60 })   // a minute of calendar per second; read engine.clock.rate
// It does not run while frozen and is saved with the save; a calendar day = calendar.dayLength calendar seconds, so one hour = dayLength / hoursPerDay.
// Clock-time / season timers (daily 18:00, time-window switches, season change) belong to the calendar module (modules/calendar, a gameplay
// module, so core never names it): engine.calendar.at / between / daily / onSeason; the sky only draws that time.
//   engine.clock.after(120, 'bread:ready')          // emit an event after 120 calendar seconds (saveable: still fires after a load)
//   engine.clock.after(5, () => door.close(), { channel: 'real' }) // a function works too, but functions cannot be saved
//   engine.clock.every(30, () => spawnBird())        // every 30 calendar seconds
//   engine.clock.after(1, 'poison:tick', { data: { id }, channel: 'enemies' })   // channel seconds instead: slows down with bullet time
//   engine.clock.after(3, () => respawn(), { channel: 'real' })  // real seconds: ignores bullet time and the calendar rate
// Which time to use for what: the table in recipes/06-clock-events.md. All timers return a handle { remove() }; a removed timer never fires,
// not even later in the same step. Why this file holds no time and no timer list of its own: it used to, and skip / new game / load had to
// keep two clocks and two queues in step (review 0.4, B). Now it only forwards to engine.time.
// A timer callback that throws is a gameplay error (errors.js: frozen with engine.error in dev); the other timers still run.
import { codedError } from '../base/errorHints.js';
import { fmt } from '../base/validate.js';
import { readParams, keysSchema } from '../base/params.js';

const AFTER_KEYS = ['data', 'channel'];
const STRINGS = {
  after: 'clock.after(seconds): seconds must be a finite number of {unit} seconds, got {got}',
  every: 'clock.every(seconds): seconds must be a finite number of {unit} seconds > 0, got {got}; for every fixed step use engine.onFixed(dt => ...)',
  nowWrite: 'engine.clock.now was written directly: it is a read-only view of the time source (engine.time), nothing to write. ' +
    'To pass time use engine.skip({ seconds }) (timers fire in order, everything catches up)',
};

export class Clock {
  constructor(engine) { this.engine = engine; }

  /** Calendar seconds since the start (saved) = engine.time.now('calendar'). Read-only: pass time with engine.skip({ seconds }) */
  get now() { return this.engine.time.now('calendar'); }
  /** @internal a direct write throws (like rate): a view has no value of its own to change, and a silently ignored write is worse */
  set now(v) { throw codedError('engine-misuse', STRINGS.nowWrite); }
  /** Calendar seconds per world-channel second (default 1; 0 stops the calendar). Read-only: engine.mod('clock.rate', { owner, set }) changes it */
  get rate() { return this.engine.stacks.get('clock.rate').value(); }
  /** @internal writing rate must go through mod (several owners stack without overwriting each other); a direct assignment gets the new form instead of an opaque TypeError */
  set rate(v) { throw codedError('mod-owner', `engine.clock.rate is read-only: engine.mod('clock.rate', { owner, set: ${v} }) changes it (h.remove() gives it back)`); }
  /** Calendar seconds per real second right now = rate x the world channel's speed (the calendar and far NPCs advance by it) */
  get speed() { return this.engine.time.scale('calendar'); }
  /**
   * Call fn after `seconds` calendar seconds; when fnOrEvent is an event name, emit that event (with { data }) when due, which can be saved.
   * { channel } counts that view instead: a time channel ('enemies': slows down in bullet time) or 'real'.
   * @example engine.clock.after(1, 'poison:tick', { data: { id }, channel: 'enemies' })
   * @param {number} seconds @param {string | (() => void)} fnOrEvent @param {{ data?: any, channel?: string }} [opts]
   */
  after(seconds, fnOrEvent, opts = {}) {
    // Why strict: data read as options would make the event fire empty, with no error
    readParams('clock.after()', keysSchema(AFTER_KEYS), opts);
    const { data, channel = 'calendar' } = opts;
    if (!Number.isFinite(seconds)) throw codedError('clock-interval', fmt(STRINGS.after, { unit: channel, got: String(seconds) }));
    return this.engine.time._add(channel, seconds, fnOrEvent, data);
  }
  /** Call fn every `seconds` calendar seconds (seconds > 0); { channel } as in after @param {number} seconds @param {() => void} fn @param {{ channel?: string }} [opts] */
  every(seconds, fn, { channel = 'calendar' } = {}) {
    if (!(seconds > 0) || !Number.isFinite(seconds)) throw codedError('clock-interval', fmt(STRINGS.every, { unit: channel, got: String(seconds) }));
    return this.engine.time._add(channel, seconds, fn, undefined, seconds);
  }
  /** Number of registered timers on every channel, used by engine.counts() */
  get size() { return this.engine.time.size; }
}

export const handRolled = [{ kind: 'timers', seen: 'setInterval / setTimeout used for game timing', use: 'engine.clock.after(seconds, fn) / engine.clock.every(seconds, fn), or accumulate dt in engine.onFixed (they follow pause, step and saves); to await one: new Promise(r => engine.clock.after(s, r))', code: /\b(setInterval|setTimeout)\s*\(/, not: /setTimeout\s*\([^,]*,\s*0\s*\)/ }];   // debug: words for the tools, no timer runs here
