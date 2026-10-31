// Skipping time (part of Engine, mixed into Engine.prototype): engine.skip({ to: '06:00' }) for "sleep until morning", { seconds } for "wait a while".
// Why not step(): a long skip can be hours of fixed steps. skip moves game seconds in segments that end at each timed thing
// (a clock timer due, a sky clock mark: midnight, an at time, a between edge), so after / every / at / daily / between / day:new / season:change
// fire in the same order and the same number of times as when stepping. The world catches up once at the end: every record with far
// gets the whole span as one far(rec, dt) (records added by a timer mid-skip owe only from when they were added).
// What does not run while skipping: onFixed callbacks, module fixed hooks, physics and near simulation; fixed seconds (engine.elapsed, engine.tick) stay put.
// Modules that keep their own time implement the hook skip(dt, e, done): dt is the segment in fixed seconds, done is true on the last segment (do expensive catch-up once there).
// The jump itself is the op 'time.skip' (logged, replayable, allowed to write saved state); skip() adds the 'skip' input context, optional fade and autosave around it.
import { parseClock } from './dayTime.js';
import { checkOptions } from './validate.js';
import { reportError } from './errors.js';
import { codedError } from './errorHints.js';
import { fadeScreen } from '../ui/UI.js';

const NUDGE = 1e-6;   // game seconds past each mark: land just after it, so float error never leaves a mark uncrossed
const STRINGS = {
  amount: 'engine.skip(): pass { to: "06:00" } (until the sky clock next reads 06:00) or { seconds: 600 } (game seconds, > 0); got {got}',
  noSky: 'engine.skip({ to }) needs the sky module (it reads the sky clock); without sky pass { seconds } (game seconds)',
  hook: 'skip hook of module {name}',
};

/** Game seconds to skip for opts ({ seconds } or { to } = the next time the sky clock reads that time; the current time itself means a full day) */
function amount(e, o) {
  const bad = () => codedError('skip-amount', STRINGS.amount.replace('{got}', JSON.stringify(o)));
  if (o.seconds != null) { if (!(o.seconds > 0) || !Number.isFinite(o.seconds)) throw bad(); return o.seconds; }
  if (o.to == null) throw bad();
  const sky = e.sky; if (!sky) throw codedError('skip-amount', STRINGS.noSky);
  const f = parseClock(o.to, sky.hoursPerDay) % 1;
  if (!Number.isFinite(f)) throw bad();
  return ((((f - sky.timeOfDay) % 1) + 1) % 1 || 1) * sky.dayLength;
}

/** Advance game seconds in segments (see the top of the file). Called by the op 'time.skip' */
function jump(e, seconds) {
  const clock = e.clock, sky = e.sky, ts0 = clock.timeScale, ts = ts0 > 0 ? ts0 : 1;
  clock.timeScale = ts;   // a stopped clock (0) would need infinite fixed seconds: skip as if at 1x
  let left = seconds, ended = false;
  const off = e.events.on('session:end', () => { ended = true; });   // a timer callback ended the playthrough mid-skip: the new one must not be skipped
  try {
    while (left > 0 && !ended) {
      let seg = Math.min(left, clock.untilNext() + NUDGE, sky ? sky.untilMark() + NUDGE : Infinity);
      left -= seg;
      if (left < NUDGE) { seg += left; left = 0; }   // no sliver segment at the end
      const dt = seg / ts, done = left === 0;
      for (const h of e._hooks.skip) {
        try { h.fn(dt, e, done); } catch (err) { reportError(e, err, STRINGS.hook.replace('{name}', h.name), { module: h.mod }); }
      }
      clock.tick(dt);
    }
  } finally { clock.timeScale = ts0; off.remove(); }
  if (ended) return null;
  e.events.emit('time:skip', { seconds });
  return { seconds, clock: sky?.clock ?? null, day: sky?.day ?? null };
}

/** Register the op behind engine.skip (called once by the Engine constructor) */
export function defineSkipOp(e) {
  e.ops.define('time.skip', {
    desc: 'Skip game time forward by seconds game seconds (timers, sky clock events and world far simulation catch up in order)',
    args: { seconds: 'number' },
    can: (_, a) => a.seconds > 0 ? true : 'notForward',
    run: (eng, a) => jump(eng, a.seconds),
    reasons: { notForward: 'seconds must be > 0 (time only skips forward)' },
  });
}

export const skipMethods = {
  /**
   * Skip game time forward (sleep until morning, wait an hour) without stepping every fixed step.
   * Timers fire in time order as if stepped: clock.after / every, sky.at / daily / between, day:new, season:change (each crossing once; catchUp does not apply).
   * World records with far catch up the whole span in one far(rec, dt) (dt in fixed seconds = game seconds / timeScale); growth and respawns measured with clock.now are exact.
   * Not run while skipping: onFixed, module fixed hooks, physics, near simulation. Input is blocked (an opaque 'skip' input context) and gameplay frozen for the whole skip; emits time:skip { seconds } after the jump.
   * With fade 0 (default) the time has already moved when skip returns; with fade > 0 it fades out, jumps, (saves), fades in (through flow.transition when flow is installed),
   * and the Promise resolves after the fade in, which needs frames: in a paused test keep calling engine.step while waiting.
   * @example await engine.skip({ to: '06:00' });                        // sleep: until the sky clock next reads 06:00
   * @example engine.skip({ seconds: 600 });                             // wait 600 game seconds
   * @example await engine.skip({ to: '06:00', fade: 0.6, save: 'auto' }); // fade to black, jump, autosave, fade in
   * @param {{ to?: string | number, seconds?: number, fade?: number, save?: string | boolean }} opts
   * Cancelled cleanly by session.newGame / load / quit (the skip resolves null and time stays where the new playthrough put it).
   * @returns {Promise<{ seconds: number, clock: string | null, day: number | null } | null>}
   */
  skip(opts = {}) {
    checkOptions('engine.skip()', opts, ['to', 'seconds', 'fade', 'save']);
    const { fade = 0, save = null } = opts;
    amount(this, opts);   // throw on bad arguments now, not after the fade
    let out = null, ended = false;
    const go = () => {
      if (ended) return;   // the playthrough ended during the fade out: nothing to skip in the new one
      const r = this.ops.run('time.skip', { seconds: amount(this, opts) });   // measured at jump time: a queued transition may have moved the clock
      if (!r.ok) throw codedError('skip-amount', `engine.skip(): ${r.reason}`);
      out = r.value;
      if (save && out) this.saves.save(save === true ? 'auto' : save);
    };
    const ctx = this.input.push('skip'); this.freeze('skip');   // opaque 'skip' context: gameplay input blocked until the skip ends
    const off = this.events.on('session:end', () => { ended = true; });   // newGame / load / quit cancel the skip cleanly (it resolves null)
    const end = () => { ctx.remove(); this.unfreeze('skip'); off.remove(); };
    if (!(fade > 0)) { try { go(); } finally { end(); } return Promise.resolve(out); }
    const run = this.flow ? this.flow.transition(go, { fade, autosave: false, music: false })
      : (async () => { try { await fadeScreen(this, 1, fade); go(); } finally { await fadeScreen(this, 0, fade); } })();
    return run.finally(end).then(() => out);
  },
};
