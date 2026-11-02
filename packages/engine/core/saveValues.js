// Load-time number checks. A part's load() passes each saved number through here, so a hand-edited or damaged value (a negative clock, a random
// state 'abc', a count of 1e308) never reaches the running game. Each bad value is clamped to its range (or replaced by a fallback when it is not
// a finite number at all), the rest of the part loads, and the part prints ONE warning listing what it fixed (save-value).
// Why clamp and not refuse: these are scalars with an obvious safe value; refusing the whole save over a clock of -1000 would cost the player the
// rest of the playthrough. Shapes that have no safe value (a record position, world/persist.js) are refused instead (save-bad-record).
//
//   const v = saveValues('clock');
//   this._now = v.num(d?.now, 'now', { min: 0, fallback: 0 });
//   v.done();   // one warning for the part, only when something was fixed
import { warnOnce } from './validate.js';
import { coded } from './errorHints.js';

const STRINGS = {
  warn: "[saves] save part '{part}' had {n} bad value(s), fixed while loading: {list}. The save was edited by hand or damaged; the next save writes the fixed values",
};

/**
 * A checker for one part's load: num() clamps / replaces, done() warns once when anything was fixed.
 * @param {string} part
 * @internal
 */
export function saveValues(part) {
  const fixed = [];
  return {
    /**
     * @param {any} v  the saved value
     * @param {string} path  for the warning
     * @param {{ min?: number, max?: number, int?: boolean, fallback: number }} o
     * @returns {number}
     */
    num(v, path, { min = -Infinity, max = Infinity, int = false, fallback }) {
      if (typeof v !== 'number' || !Number.isFinite(v)) { fixed.push(`${path} ${JSON.stringify(v) ?? 'undefined'} -> ${fallback}`); return fallback; }
      let n = int ? Math.round(v) : v;
      n = Math.min(max, Math.max(min, n));
      if (n !== v) fixed.push(`${path} ${v} -> ${n}`);
      return n;
    },
    /** Note a value dropped by the caller (a timer without a due time) */
    drop(path, v) { fixed.push(`${path} ${String(JSON.stringify(v)).slice(0, 60)} dropped`); },
    /** One warning for the part when anything was fixed; returns how many */
    done() {
      if (fixed.length) warnOnce(coded('save-value', STRINGS.warn.replace('{part}', part).replace('{n}', String(fixed.length)).replace('{list}', fixed.slice(0, 6).join('; ') + (fixed.length > 6 ? '; …' : ''))));
      return fixed.length;
    },
  };
}
