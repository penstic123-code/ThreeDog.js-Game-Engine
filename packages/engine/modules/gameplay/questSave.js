// Quest progress in saves (part 'quests', version 3: visited added; owed is optional, so older saves read as they are): saved by stable step and part ids, never by position, so content may insert or reorder steps.
//   { state: { questId: { step: stepId | null (when done), done, failed?, parts?: [ids of parts met in the current parallel step],
//                         got?: { stepId: [ids of parts met in a finished parallel step] } } } }
// A step's (or parallel part's) id is its `id` field (quests.define / content: steps: [{ id: 'talk-mayor', text, done }]), else its position as text
// ('0', '1', ...): give steps ids before shipping, then edits to the step list never move a player's progress.
// Version 1 saved positions: migrateV1 maps them to ids through the quest definitions known when the save is loaded.
import { warnOnce, fmt } from '../../core/base/validate.js';
import { coded } from '../../core/base/errorHints.js';

const STRINGS = {
  missing: "quests: the save has quest '{q}' at step '{step}', which its definition no longer has; it restarts from the first step. Keep step ids stable, or add a migrate step to the 'quests' save part",
};

/** Stable id of step i @param {any} def @param {number} i @returns {string} */
export const stepId = (def, i) => def.steps[i]?.id ?? String(i);
/** Stable id of part k of a parallel step @param {any} st @param {number} k @returns {string} */
const partId = (st, k) => st?.all?.[k]?.id ?? String(k);
/** [bool per part] -> ids of the parts that are true */
const metIds = (st, flags) => flags.flatMap((on, k) => (on ? [partId(st, k)] : []));
/** ids -> [bool per part] */
const metFlags = (st, ids) => st.all.map((_, k) => ids.includes(partId(st, k)));
const indexOf = (def, id) => def.steps.findIndex((_, i) => stepId(def, i) === id);

/**
 * Runtime state of one quest ({ step: index, parts: [bool], got: { index: [bool] } }) -> its saved form.
 * @param {any} def
 * @param {any} s
 * @returns {any}
 */
export function toSaved(def, s) {
  const out = { step: s.done ? null : stepId(def, s.step), done: !!s.done };
  if (s.failed) out.failed = true;
  if (s.owed) out.owed = { ...s.owed };
  if (s.visited?.length) out.visited = [...s.visited];
  if (s.parts) out.parts = metIds(def.steps[s.step], s.parts);
  if (s.got) out.got = Object.fromEntries(Object.entries(s.got).map(([i, flags]) => [stepId(def, +i), metIds(def.steps[+i], flags)]));
  return out;
}

/**
 * Saved form -> runtime state. A step id the definition no longer has restarts the quest from its first step (with a dev warning).
 * @param {string} id  quest id
 * @param {any} def
 * @param {any} q
 * @returns {any}
 */
export function fromSaved(id, def, q) {
  let step = q.done ? def.steps.length : indexOf(def, q.step);
  if (step < 0) { warnOnce(coded('quest-step', fmt(STRINGS.missing, { q: id, step: String(q.step) }))); step = 0; }
  const s = { step, done: !!q.done };
  if (q.failed) s.failed = true;
  if (q.owed) s.owed = { ...q.owed };
  // a save from before visited went through the list in order, so the steps behind this one are what it left
  s.visited = Array.isArray(q.visited) ? q.visited.filter(v => typeof v === 'string' && indexOf(def, v) >= 0) : def.steps.slice(0, step).map((_, i) => stepId(def, i));
  const st = def.steps[step];
  if (q.parts && st?.all) s.parts = metFlags(st, q.parts);
  for (const [sid, ids] of Object.entries(q.got || {})) {
    const i = indexOf(def, sid);
    if (i >= 0 && def.steps[i].all) (s.got ??= {})[i] = metFlags(def.steps[i], ids);
  }
  return s;
}

/**
 * Version 1 (positions) -> version 2 (ids), through the definitions known now (a quest not defined yet keeps positions as text ids).
 * @param {Map<string, any>} defs
 * @param {any} d
 * @returns {{ state: Record<string, any> }}
 */
export function migrateV1(defs, d) {
  const state = {};
  for (const [id, s] of Object.entries(d?.state || {})) {
    state[id] = toSaved(defs.get(id) ?? { steps: [] }, { ...s, step: s.step ?? 0 });   // version 1 saved the runtime form itself
  }
  return { state };
}
