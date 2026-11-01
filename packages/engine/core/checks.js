// Consistency checks a game (or an AI) can call in dev and tests, mixed into Engine.prototype. They never throw on a mismatch: they return { ok, diffs }, so a test
// or the dev bridge prints the first differing paths instead of a bare "false".
//   await engine.checkSkip(600)   // engine.skip(600 game seconds) vs stepping the same time in fixed steps: same saved state?
//   await engine.checkSave()      // save -> load: same saved state?
// "State" is what engine.saves.collect() returns (every save part), so a module that keeps state outside its save part is invisible here: that is the point
// of the check, a skip or a load that loses it shows up as a diff of the part's data.

const MAX_DIFFS = 20;

/** Flatten two JSON values into the paths where they differ: [{ path, a, b }] (at most MAX_DIFFS; numbers within 1e-6 are equal) */
export function diffState(a, b, ignore = []) {
  const out = [];
  const walk = (x, y, path) => {
    if (out.length >= MAX_DIFFS || ignore.some(p => path === p || path.startsWith(p + '.'))) return;
    if (typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > 1e-6 && !(Number.isNaN(x) && Number.isNaN(y))) out.push({ path, a: x, b: y }); return; }
    if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? path + '.' + k : k);
      return;
    }
    if (x !== y) out.push({ path, a: x, b: y });
  };
  walk(a, b, '');
  return out;
}

/** The comparable state: a JSON copy of collect() without the timestamp */
function snapshot(e) { const d = JSON.parse(JSON.stringify(e.saves.collect())); delete d.savedAt; return d; }

export const checkMethods = {
  /**
   * Is skipping time the same as living through it? Saves the state, runs engine.skip({ seconds }), saves it again, rewinds to the first state, steps the same
   * span in fixed steps (engine.step, no rendering) and compares the two end states. The world is left at the stepped state, so call it on a scratch playthrough
   * or a test, not in the middle of a real one. A diff usually means a module that keeps its own time lacks (or has a wrong) skip hook.
   * @param {number} seconds game seconds, > 0
   * @param {{ ignore?: string[] }} [opts] ignore: state paths (or their prefix, e.g. 'random') not to compare
   * Refuses ({ ok: false, reason: 'frozen' | 'timeScale0' }) while gameplay is frozen or paused, or the clock is stopped.
   * @returns {Promise<{ ok: boolean, reason?: string, diffs: { path: string, a: any, b: any }[] }>} a = after skip, b = after stepping
   * @example const r = await engine.checkSkip(600); if (!r.ok) console.log(r.diffs);
   */
  async checkSkip(seconds, { ignore = [] } = {}) {
    // Refuse where the two paths cannot be the same thing: frozen gameplay does not step, and a stopped clock (timeScale 0) makes "seconds" mean nothing
    const refuse = (why, b) => ({ ok: false, reason: why, diffs: [{ path: '(precondition)', a: why, b }] });
    if (this.frozen) return refuse('frozen', 'unfreeze first (stepping obeys freezes): ' + [...this._freezers.keys()].join(', '));
    if (!(this.clock.timeScale > 0)) return refuse('timeScale0', 'set clock.timeScale > 0');
    this.commits.tick(Infinity);   // pending background results land first, so they cannot sit in one path's state and not the other's
    const before = JSON.parse(JSON.stringify(this.saves.collect()));
    await this.skip({ seconds });
    const skipped = snapshot(this);
    if (!(await this.saves.apply(before, 'checkSkip'))) return { ok: false, diffs: [{ path: '(rewind)', a: 'applied', b: 'refused' }] };
    this.step(seconds / this.clock.timeScale, { render: false });
    const diffs = diffState(skipped, snapshot(this), ignore);
    return { ok: diffs.length === 0, diffs };
  },
  /**
   * Does save -> load give the same state back? Collects the state, applies it as a load and compares with a second collect (nothing is written to the browser).
   * A diff names a save part whose load() does not restore what its save() wrote.
   * @param {{ ignore?: string[] }} [opts] ignore: state paths (or their prefix) not to compare
   * @returns {Promise<{ ok: boolean, diffs: { path: string, a: any, b: any }[] }>} a = before the load, b = after
   * @example const r = await engine.checkSave(); if (!r.ok) console.log(r.diffs);
   */
  async checkSave({ ignore = [] } = {}) {
    const before = snapshot(this);
    if (!(await this.saves.apply(JSON.parse(JSON.stringify(this.saves.collect())), 'checkSave'))) return { ok: false, diffs: [{ path: '(load)', a: 'applied', b: 'refused' }] };
    const diffs = diffState(before, snapshot(this), ignore);
    return { ok: diffs.length === 0, diffs };
  },
};
