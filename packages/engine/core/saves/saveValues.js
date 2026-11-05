// Load-time number checks. A part's load() passes each saved number through here, so a hand-edited or damaged value (a negative clock, a random
// state 'abc', a count of 1e308) never reaches the running game. Each bad value is clamped to its range (or replaced by a fallback when it is not
// a finite number at all), the rest of the part loads, and the part prints ONE warning listing what it fixed (save-value).
// Why clamp and not refuse: these are scalars with an obvious safe value; refusing the whole save over a clock of -1000 would cost the player the
// rest of the playthrough. Shapes that have no safe value (a record position, world/persist.js) are refused instead (save-bad-record).
//
//   const v = saveValues('clock');
//   this._now = v.num(d?.now, 'now', { min: 0, fallback: 0 });
//   v.done();   // one warning for the part, only when something was fixed
import { warnOnce, fmt } from '../base/validate.js';
import { coded, codedError } from '../base/errorHints.js';

const STRINGS = {
  warn: "[saves] save part '{part}' had {n} bad value(s), fixed while loading: {list}. The save was edited by hand or damaged; the next save writes the fixed values",
};

/** Positions and speeds beyond this are damage, not a big world: float32 models are already centimetres off at 1e5 and useless far before 1e7 */
export const SAVE_MAX = 1e7;
/** A saved number the running game can take. Past SAVE_MAX the ground loops around it never end, or a step later a position goes out of range */
export const saveNumberOk = v => Number.isFinite(v) && Math.abs(v) <= SAVE_MAX;
/**
 * Refuse a damaged save: throw save-bad-record, and saves.apply rolls the whole load back and reports this message. For shapes with no safe value.
 * @param {string} part  'world', 'scene'...
 * @param {string} path  where in the part
 * @param {string} why  'must be ...'
 * @param {any} got
 * @returns {never}
 * @internal
 */
export function refuseSave(part, path, why, got) {
  throw codedError('save-bad-record', `${part} save: ${path} ${why} (got ${String(JSON.stringify(got)).slice(0, 120)}); the save was refused and the game was rolled back. The save was edited by hand or damaged: fix that field, or load another save`);
}

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
      if (fixed.length) warnOnce(coded('save-value', fmt(STRINGS.warn, { part, n: fixed.length, list: fixed.slice(0, 6).join('; ') + (fixed.length > 6 ? '; …' : '') })));
      return fixed.length;
    },
  };
}
