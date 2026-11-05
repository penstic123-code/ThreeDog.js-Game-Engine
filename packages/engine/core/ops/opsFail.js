// Structured op failures. can may return a reason string (kept working) or { code, facts?, nextActions? }:
//   can: () => cond ? true : { code: 'noMoney', facts: { need: 5, have: 2 }, nextActions: [{ op: 'job.work', args: {} }] }
// facts: an object ({ need: 5, have: 2 }) or a list [{ id, field, actual, expected? }] (which record / field was wrong, and what it should have been). nextActions are declared by the game here, never guessed by the engine.
// run may fail the same way: return or throw { ok: false, code, facts?, nextActions? } (the op then counts as failed; an atomic op is rolled back).
// Every failed result from run / can / undo is normalized to { ok: false, code, facts, nextActions }; `code` is the name to read.
const NONE = Object.freeze([]), NO_FACTS = Object.freeze({});

/** @param {string | { code: string, facts?: object, nextActions?: any[] }} r a code string or a structured failure @returns {{ ok: false, code: string, facts: object, nextActions: any[] }} */
export function failure(r) {
  const out = typeof r === 'string' ? { ok: false, code: r, facts: NO_FACTS, nextActions: NONE }
    : { ok: false, code: r.code, facts: r.facts ?? NO_FACTS, nextActions: r.nextActions ?? NONE };
  return out;
}
/**
 * Freeze owner held while a save's parts load (saveApply.js). A part's load() may return a Promise (an async terrain, a streamed world): until the
 * last part is applied the game is half old, half new, so fixed steps stop (freeze) and ops refuse with code 'loading' (a click or a net message
 * arriving in that gap would change the old state and be wiped, or act on a mix). Shared here so ops and the loader name the same owner.
 * @internal
 */
export const PARTS_LOADING = 'threedog:load-parts';
/** Why ops refuse right now: 'halted' (a gameplay error froze the game), 'loading' (save parts still loading), or null @internal */
export function opsBlocked(e) {
  const f = e.stacks.get('freeze');
  return f.has('error') ? 'halted' : f.has(PARTS_LOADING) ? 'loading' : null;
}
/** True when can returned a usable structured failure */
export const isStructured = r => r !== null && typeof r === 'object' && typeof r.code === 'string' && r.code.length > 0;
/** True when run returned or threw a structured failure: { ok: false, code, ... } (plain values with a code field are not failures) */
export const isRunFailure = r => r !== null && typeof r === 'object' && r.ok === false && typeof r.code === 'string' && r.code.length > 0;
