// Running condition and effect words: content.test and content.run. The vocabulary is rules.js, the built-in meanings are in loader.js.
import { warnMissing } from '../../core/base/validate.js';
import { parseClock } from '../../core/time/dayTime.js';
import { list } from '../../core/base/util.js';

/** Convert content notation to runtime values by ref (clock time -> fraction, place -> { x, z }) */
const norm = (e, api, ref, v) => ref === 'clock' ? parseClock(v, e.calendar?.hoursPerDay ?? 24) : ref === 'position' ? api.where(typeof v === 'string' ? { place: v } : v) : v;

/** content.test */
export function testWords(e, api, conds, c, actor) {
  if (!c) return true;
  const ctx = { actor };
  if (typeof c === 'function') return !!c(e, ctx);
  return list(c).every(x => Object.entries(x).every(([k, v]) => {
    const d = conds.get(k);
    if (!d) { warnMissing('condition', k, [...conds.keys()]); return false; }
    return !!d.test(e, norm(e, api, d.ref, v), v, ctx);
  }));
}

/** content.run */
export function runWords(e, api, effects, a, actor) {
  if (!a) return;
  const ctx = { actor };
  if (typeof a === 'function') return a(e, ctx);
  // One failing effect must not drop the ones after it (a reward with give + spawn would be half given): run them all, then rethrow the first error
  let first = null, failed = 0;
  for (const x of list(a)) for (const [k, v] of Object.entries(x)) {
    const d = effects.get(k);
    if (!d) { warnMissing('effect', k, [...effects.keys()]); continue; }
    try { d.run(e, d.raw ? v : norm(e, api, d.ref, v), v, ctx); } catch (err) { first ??= err; failed++; }
  }
  if (first) { if (failed > 1) first.message += ` (${failed} effects failed; the others ran)`; throw first; }
}
