// Time channels, engine.time: separate speeds for separate groups of things, changed only through engine.mod (core/stacks.js).
//   engine.mod('time.enemies', { owner: 'bullet-time', mul: 0.35, for: 2 });          // bullet time: enemies at 35% for 2 real seconds
//   engine.mod('time.player', { owner: 'haste', mul: 1.2, for: 5 });                  // haste on the player
//   engine.mod('time.local', { owner: 'stopwatch', id: 'e1', set: 0, priority: 'effect' });   // stop one record only
//   engine.onFixed(dt => moveEnemies(dt), { channel: 'enemies' });                     // this dt is already scaled
// Three rulers, and only these three words in docs:
//   real seconds   engine.time.real (= engine.elapsed): fixed seconds, no scale; stop while frozen. UI, cooldowns that ignore bullet time.
//   channel secs   engine.time.now(ch) / engine.time.dt(ch, id?): each fixed step adds STEP x the effective scale = parent x the channel's
//                  stack ('time.<ch>') x the record's own stack ('time.local', by id). Movement, AI, projectiles, status effects.
//   calendar secs  engine.clock.now: world-channel seconds x the calendar rate (stack 'clock.rate'). Sky, schedules, crops.
// Why channels and not one global scale: the old global scale only moved the calendar, so bullet time was hand-written dt * 0.35 in every system,
// and two effects that each saved / restored it broke each other. A channel's speed is a stack: every effect is an entry, ending one recomputes.
// Freeze is not "scale 0": a frozen engine runs no fixed step at all (loop.js), so no channel and no `for` timer moves; describe shows both apart.
// A plain onFixed without { channel } gets real seconds (always 1 / 60): the stated default, so cooldowns and UI are never slowed by accident.
// Built in: world (the root) and player (parent world). Physics (rapier) has one world step and follows nothing here.
import { codedError } from './errorHints.js';
import { reportError } from './errors.js';
import { saveValues } from './saveValues.js';

export const STEP = 1 / 60;
const STRINGS = { where: 'time channel timer' };

export class Time {
  constructor(engine) {
    this.engine = engine;
    /** @internal fixed seconds since start (not saved, like engine.elapsed): the 'real' clock of mod({ for }) */ this._real = 0;
    /** @type {Map<string, { name: string, parent: string | null, now: number, timers: any[], manual: ((id?: string) => number) | null }>} */
    this._ch = new Map();
    /** @internal saved now / event timers of channels the game has not defined yet (a load before channel()): applied when it does */ this._pending = {};
    this._local = engine.stacks.define('time.local', { per: true, min: 0 });
    engine.stacks._nowOf = clock => clock === 'real' ? this._real : this.now(clock);
    this.channel('world', { parent: null });
    this.channel('player');
    engine.saves.register('time', {
      save: () => ({ channels: Object.fromEntries([...this._ch.values()].map(c => [c.name, c.now])),
        timers: [...this._ch.values()].flatMap(c => c.timers.filter(t => t.event).map(({ due, event, data }) => ({ channel: c.name, due, event, data }))) }),
      load: d => {
        // saved seconds pass saveValues first: a negative / non-finite channel time ran its timers backwards (durability audit); clamped to >= 0, one warning
        const v = saveValues('time'), chans = {};
        for (const [name, now] of Object.entries(d?.channels ?? {})) chans[name] = v.num(now, `channels.${name}`, { min: 0, fallback: 0 });
        const timers = (Array.isArray(d?.timers) ? d.timers : []).filter(t => { if (Number.isFinite(t?.due) && typeof t.event === 'string') return true; v.drop('timers[]', t); return false; });
        v.done();
        d = { channels: chans, timers };
        // in the save but not yet defined by the game (channel('enemies') only after load): note it down, fill in when channel() defines it, same as stacks' _pending; otherwise its now and event timing are lost
        this._pending = {};
        for (const [name, now] of Object.entries(d?.channels ?? {})) if (!this._ch.has(name))
          this._pending[name] = { now, timers: (d?.timers ?? []).filter(t => t.channel === name).map(({ due, event, data }) => ({ due, event, data })) };
        for (const c of this._ch.values()) {
          const now = d?.channels?.[c.name] ?? 0, delta = now - c.now;
          c.now = now; engine.stacks._rebase(c.name, delta);
          const fn = c.timers.filter(t => !t.event); for (const t of fn) t.due += delta;   // function timers (not saveable) keep their time left
          c.timers = fn.concat((d?.timers ?? []).filter(t => t.channel === c.name).map(({ due, event, data }) => ({ due, event, data })));
        }
      },
    });
  }
  /**
   * Define a channel (its speed stack is 'time.<name>'). parent: the channel whose speed it multiplies (default 'world').
   * @param {string} name @param {{ parent?: string | null }} [o]
   * @example engine.time.channel('enemies');  engine.mod('time.enemies', { owner: 'bullet-time', mul: 0.35, for: 2 });
   */
  channel(name, { parent = 'world' } = {}) {
    if (this._ch.has(name)) return this;
    if (parent != null && !this._ch.has(parent)) throw codedError('unknown-name', `engine.time.channel('${name}', { parent: '${parent}' }): no channel '${parent}'. Channels: ${this.channels().join(', ')}`);
    const saved = this._pending[name]; delete this._pending[name];
    // put now in place before defining the speed stack: entries in the stack saved against this channel's clock restore the remaining time from its now
    this._ch.set(name, { name, parent, now: saved?.now ?? 0, timers: saved?.timers ?? [], manual: null });
    this.engine.stacks.define('time.' + name, { min: 0 });
    return this;
  }
  /** Channel names */
  channels() { return [...this._ch.keys()]; }
  /** @internal */
  _get(name) {
    const c = this._ch.get(name);
    if (!c) throw codedError('unknown-name', `engine.time: no channel '${name}'. Channels: ${this.channels().join(', ')}; add one with engine.time.channel('${name}')`);
    return c;
  }
  /**
   * The effective speed of a channel (parent x its own stack), times the record's own stack when id is given. Read-only: change it with engine.mod.
   * @param {string} name @param {string} [id]
   */
  scale(name, id) {
    const c = this._get(name);
    let s = c.manual ? c.manual(id) : (c.parent ? this.scale(c.parent) : 1) * this.engine.stacks.get('time.' + name).value();
    if (id != null) s *= this._local.value(id);
    return s;
  }
  /** Fixed seconds since start: no scale, stops while frozen (= engine.elapsed) */
  get real() { return this._real; }
  /** Seconds lived by a channel @param {string} name */
  now(name) { return this._get(name).now; }
  /** This fixed step's dt on a channel (STEP x scale), for a record when id is given @param {string} name @param {string} [id] */
  dt(name, id) { return STEP * this.scale(name, id); }
  /**
   * Manual level: the engine stops computing this channel's speed from its stack; fn(id?) returns the speed (the game owns it) until the handle is removed.
   * Why a handle: giving back has only handle.remove(), like elsewhere (the old manual(name, null) was a second form, removed); when a later caller takes over, an earlier handle's remove() does not hand back by mistake.
   * @param {string} name @param {(id?: string) => number} fn @param {{ owner?: string }} [opts]
   * @returns {{ owner?: string, remove(): void }}
   */
  manual(name, fn, { owner } = {}) {
    const c = this._get(name);
    if (typeof fn !== 'function') throw codedError('engine-misuse', `engine.time.manual('${name}', fn): fn must be a function (id?) => speed, got ${typeof fn}; hand the channel back with the handle's remove()`);
    c.manual = fn;
    return { owner, remove: () => { if (c.manual === fn) c.manual = null; } };
  }
  /**
   * @internal The public timer is engine.clock.after(s, fnOrEvent, data, { channel }) (one timer entry): it calls this.
   * Call fn (or emit event with data, which saves) after seconds on a channel: a poison tick on 'enemies' slows down in bullet time. Returns { remove() }.
   */
  after(name, seconds, fnOrEvent, data) {
    const c = this._get(name);
    if (!Number.isFinite(seconds)) throw codedError('clock-interval', `clock.after(seconds, ..., { channel: '${name}' }): seconds must be a finite number of channel seconds, got ${seconds}`);
    const t = typeof fnOrEvent === 'string' ? { due: c.now + seconds, event: fnOrEvent, data } : { due: c.now + seconds, fn: fnOrEvent };
    c.timers.push(t);
    return { remove: () => { c.timers = c.timers.filter(x => x !== t); } };
  }
  /** Timers on every channel (engine.counts) */
  get size() { let n = 0; for (const c of this._ch.values()) n += c.timers.length; return n; }
  /**
   * @internal Advance every clock by `fixed` fixed seconds (the loop: one STEP after the step's gameplay; engine.skip: one segment).
   * Speeds are read once before anything moves, so every channel advances with the scales this step's gameplay saw; then timed mods end
   * (earliest first, mod:end each), then channel timers fire, then the calendar (engine.clock) advances with the world speed of this step.
   */
  _advance(fixed, calendar) {
    const scales = [...this._ch.values()].map(c => [c, this.scale(c.name)]);
    const world = this.scale('world');
    this._real += fixed;
    for (const [c, s] of scales) c.now += fixed * s;
    this.engine.stacks._expire();
    for (const [c] of scales) this._runTimers(c);
    // engine.skip passes the calendar span itself (exact segment ends; a stopped calendar skips as if at 1x)
    this.engine.clock._advance(calendar ?? fixed * world * this.engine.clock.rate);
  }
  /** @internal */
  _runTimers(c) {
    if (!c.timers.length) return;
    const at = c.now + 1e-9;   // float sums of STEP x scale land a hair short of a whole second: due within 1e-9 counts as due
    const due = c.timers.filter(t => t.due <= at).sort((a, b) => a.due - b.due);
    if (!due.length) return;
    c.timers = c.timers.filter(t => t.due > at);
    for (const t of due) {
      if (t.event) this.engine.events.emit(t.event, t.data);
      else { try { t.fn(); } catch (err) { reportError(this.engine, err, STRINGS.where); } }
    }
  }
  /**
   * @internal engine.skip: game (calendar) seconds until the next channel timer or timed mod ends, at the current speeds (a segment ends there so
   * they fire in the same order as when stepping).
   */
  _untilNext(gamePerFixed) {
    let best = Infinity;
    for (const c of this._ch.values()) {
      const s = this.scale(c.name); if (!(s > 0)) continue;
      for (const t of c.timers) best = Math.min(best, Math.max(0, t.due - c.now) / s * gamePerFixed);
    }
    const toGame = (clock, left) => { if (clock === 'real') return left * gamePerFixed; const s = this.scale(clock); return s > 0 ? left / s * gamePerFixed : Infinity; };
    return Math.min(best, this.engine.stacks._untilNext(toGame));
  }
  /** describe().time.channels: { name: { scale, now, holders? } } */
  describe() {
    const out = {};
    for (const c of this._ch.values()) {
      const h = this.engine.stacks.get('time.' + c.name).holders();
      out[c.name] = { scale: Math.round(this.scale(c.name) * 1000) / 1000, now: Math.round(c.now * 100) / 100, ...(h.length ? { holders: h } : {}), ...(c.manual ? { manual: true } : {}) };
    }
    return out;
  }
  /** Clear all channel timers (engine.dispose) */
  dispose() { for (const c of this._ch.values()) c.timers = []; }
}
