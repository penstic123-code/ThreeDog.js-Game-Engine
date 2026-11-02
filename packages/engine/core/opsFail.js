// Structured op failures. can may return a reason string (kept working) or { code, facts?, nextActions? }:
//   can: () => cond ? true : { code: 'noMoney', facts: { need: 5, have: 2 }, nextActions: [{ op: 'job.work', args: {} }] }
// facts: an object ({ need: 5, have: 2 }) or a list [{ id, field, actual, expected? }] (which record / field was wrong, and what it should have been). nextActions are declared by the game here, never guessed by the engine.
// run may fail the same way: return or throw { ok: false, code, facts?, nextActions? } (the op then counts as failed; an atomic op is rolled back).
// Every failed result from run / can / undo is normalized to { ok: false, code, facts, nextActions }; `code` is the name to read.
import { renamed } from './validate.js';
const NONE = Object.freeze([]), NO_FACTS = Object.freeze({});

/** @param {string | { code: string, facts?: object, nextActions?: any[] }} r a code string or a structured failure @returns {{ ok: false, code: string, facts: object, nextActions: any[] }} */
export function failure(r) {
  const out = typeof r === 'string' ? { ok: false, code: r, facts: NO_FACTS, nextActions: NONE }
    : { ok: false, code: r.code, facts: r.facts ?? NO_FACTS, nextActions: r.nextActions ?? NONE };
  // 0.2 .reason read: every failed result (op, trade, grid) comes out here, so the old name throws in this one place instead of silently being undefined everywhere
  return OLD.on(out);
}
const OLD = renamed('result', { reason: '.code (plus .facts, .nextActions)' });
/** True when can returned a usable structured failure */
export const isStructured = r => r !== null && typeof r === 'object' && typeof r.code === 'string' && r.code.length > 0;
/** True when run returned or threw a structured failure: { ok: false, code, ... } (plain values with a code field are not failures) */
export const isRunFailure = r => r !== null && typeof r === 'object' && r.ok === false && typeof r.code === 'string' && r.code.length > 0;
