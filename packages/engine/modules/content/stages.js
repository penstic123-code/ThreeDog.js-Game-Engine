// Template stages (content/templates.js `stages`): a placeable that moves through named steps over game time — a crop seed -> sprout -> ripe,
// a turret cold -> warming -> armed, a building scaffold -> frame -> done, a door closed -> opening -> open.
//   crop: { model: 'crop-seed', state: { watered: false },
//     stages: [{ name: 'seed', duration: 600 }, { name: 'sprout', duration: 900, scale: 0.6 }, { name: 'ripe', model: 'crop-ripe' }],
//     canGrow: (rec, e) => rec.watered }
// Why the stage lives on the record and not on a separate registry: the record is what world saves, what content-check / content.fields() describe
// and what the editor edits, so `stage` is an ordinary state field (default 0, range 0..n-1) and `stageAt` (engine.clock.now when it entered the stage)
// sits beside it. Growth is counted in game seconds (clock.now), so a far record, a loaded save or a time skip all catch up in one pass.
// Node-safe (no three): content-check imports this file directly, so the engine and the check accept the same stages.
import { closest } from '../../core/validate.js';
import { isModelName } from '../../core/util.js';

const STAGE_KEYS = ['name', 'duration', 'scale', 'model'];

/**
 * Problems of a template's stages list (empty list = fine). Every stage but the last needs a duration (game seconds spent there); the last may omit it
 * (stays there). model is a model name like the template's own model (no functions: stages are data an editor can show and content-check can read).
 * @param {string} where e.g. "template 'crop'"
 * @param {any} stages
 * @returns {string[]}
 */
export function stagesProblems(where, stages) {
  if (stages === undefined) return [];
  if (!Array.isArray(stages) || !stages.length) {
    return [`${where}: stages must be a non-empty list, e.g. stages: [{ name: 'seed', duration: 60 }, { name: 'ripe' }]`];
  }
  const out = [], names = new Set();
  stages.forEach((s, i) => {
    const at = `${where} stages[${i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { out.push(`${at} must be an object { name, duration?, scale?, model? }`); return; }
    for (const k of Object.keys(s)) {
      if (STAGE_KEYS.includes(k)) continue;
      const c = closest(k, STAGE_KEYS);
      out.push(`${at}: unknown key '${k}'${c ? ` (did you mean '${c}'?)` : ''}. Keys: ${STAGE_KEYS.join(', ')}`);
    }
    if (typeof s.name !== 'string' || !s.name) out.push(`${at} needs a name (a string such as 'sprout')`);
    else if (names.has(s.name)) out.push(`${at}: name '${s.name}' is used by an earlier stage; stage names must differ`);
    else names.add(s.name);
    const last = i === stages.length - 1;
    if (s.duration === undefined) { if (!last) out.push(`${at} needs duration (game seconds spent in this stage); only the last stage may leave it out`); }
    else if (!Number.isFinite(s.duration) || s.duration <= 0) out.push(`${at}: duration must be a positive number of game seconds, got ${JSON.stringify(s.duration)}`);
    if (s.scale !== undefined && (!Number.isFinite(s.scale) || s.scale <= 0)) {
      out.push(`${at}: scale must be a positive number (multiplies the instance scale), got ${JSON.stringify(s.scale)}`);
    }
    if (s.model !== undefined && !isModelName(s.model)) out.push(`${at}: model must be a model name (like the template's model), got ${JSON.stringify(s.model)}`);
  });
  return out;
}

/**
 * State and fields of a template with its stage field added: `stage` defaults to 0 (unless state sets it) and is an int in 0..n-1 (unless fields
 * describes it). Used by the engine and content-check alike, so a placement's { stage: 2 } is checked the same in both.
 * @returns {{ state: Record<string, any>, fields: Record<string, any> | undefined }}
 */
export function stagedFields(t) {
  const state = t?.state && typeof t.state === 'object' ? t.state : {};
  if (!Array.isArray(t?.stages) || !t.stages.length) return { state, fields: t?.fields };
  return {
    state: { stage: 0, ...state },
    fields: { stage: { type: 'int', min: 0, max: t.stages.length - 1, desc: `stage: ${t.stages.map((s, i) => `${i} ${s?.name}`).join(', ')}` }, ...(t.fields || {}) },
  };
}

/**
 * Catch a record up to now: advance through every stage whose duration has passed (several at once after a long time far, a load or a skip).
 * canGrow (optional) is asked once per call (every fixed step near, every far pass): false holds the stage and restarts its clock (stageAt = now), so
 * time spent blocked (a crop not watered, a site without builders) does not count and the full duration runs from when it turns true.
 * A record without stageAt starts counting from now (placements set none, so their first fixed step marks the start; written straight on the record,
 * which world still saves). Returns the new { stage, stageAt } when the stage changed, else null: the caller writes it through world.set so
 * world:change fires like any other gameplay change.
 */
export function growStages(rec, stages, now, canGrow) {
  if (!Number.isFinite(rec.stageAt)) rec.stageAt = now;
  const from = rec.stage ?? 0;
  let s = Math.max(0, Math.min(stages.length - 1, from | 0)), at = rec.stageAt;
  if (s >= stages.length - 1) return null;   // last stage: nothing to count
  if (canGrow && !canGrow()) { rec.stageAt = now; return null; }
  while (s < stages.length - 1 && stages[s].duration != null && now - at >= stages[s].duration) { at += stages[s].duration; s++; }
  return s === from ? null : { stage: s, stageAt: at };
}
