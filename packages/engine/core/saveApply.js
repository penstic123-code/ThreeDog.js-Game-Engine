// Applying a save (split out of Saves.js): every part is checked and migrated before anything changes (saveVersions.js), then loaded in order;
// if any part's load throws, every part reloads the state from just before the load (rollback), so a game is never left half-loaded.
import { toast } from '../ui/UI.js';
import { fmt } from './validate.js';
import { reportError } from './errors.js';
import { codedError, coded } from './errorHints.js';
import { readSave, parseSave, upgradePart } from './saveVersions.js';

const DEV_STRINGS = {
  loadThrew: "load() of save part '{k}' threw ({msg}); the game was rolled back to how it was before loading '{slot}'",
  partAt: "load() of save part '{k}'", adoptAt: "load() of save part '{k}' (registered after the save was loaded)",
  rollback: "rollback of save part '{k}' after a failed load (that part may be half-loaded; the other parts rolled back)",
};

/** A save part's load threw: the error named after the part (thrown on, so the caller can roll back) */
const loadError = (k, err, slot) => Object.assign(codedError('save-load-threw', fmt(DEV_STRINGS.loadThrew, { k, slot, msg: err?.message ?? String(err) })), { part: k, cause: err });

/**
 * Implementation of saves.apply (see its JSDoc): checked first, applied part by part, rolled back to the pre-load state if any part throws.
 * @param {any} s  the Saves instance
 * @param {any} data
 * @param {string} slot
 * @returns {Promise<boolean>}
 * @internal
 */
export function applySave(s, data, slot) {
  const r = readSave(data, s.providers, slot);
  if ('reason' in r) {
    if (r.reason !== 'missing') { console.warn(coded('save-refused', r.dev));   // handled: the player is told, nothing changed
      toast(s.engine, s.engine.t('saves.' + r.reason), { kind: 'error', ms: 5000 }); }
    return Promise.resolve(false);
  }
  const e = s.engine, before = s._collect().data, foreign0 = s._foreign;   // the rollback point
  e.commits.invalidate(); e.ops._mark('(load)');   // old background results die with the old world; the op log shows where the load cut in
  s._foreign = r.foreign;
  const fail = err => {
    reportError(e, err, err?.part ? fmt(DEV_STRINGS.partAt, { k: err.part }) : `saves.apply('${slot}')`);
    s._foreign = foreign0;
    const back = readSave(before, s.providers, '(rollback)');
    // every part reloads its pre-load state; a part that throws again is reported (once) and the rest still roll back
    const onPart = er => reportError(e, er, fmt(DEV_STRINGS.rollback, { k: er.part }), { soft: true });
    return Promise.resolve('list' in back ? e.ops.allow(() => runParts(back.list, '(rollback)', onPart)) : null).then(() => false);
  };
  let out;
  try { out = e.ops.allow(() => runParts(r.list, slot)); } catch (err) { return fail(err); }   // loading writes state outside ops on purpose (guard allows it)
  return Promise.resolve(out).then(() => true, fail);
}

/**
 * Load parts in order; a part returning a Promise makes the rest wait for it. A failing part throws (or rejects) with the part named,
 * unless onFail is given (rollback): then onFail(err) is called and the next part loads anyway.
 */
function runParts(list, slot, onFail = null) {
  const failed = (k, err) => { const er = loadError(k, err, slot); if (!onFail) throw er; onFail(er); };
  const step = i => {
    for (; i < list.length; i++) {
      const [k, p, d] = list[i];
      let r;
      try { r = p.load(d); } catch (err) { failed(k, err); continue; }
      if (r && typeof r.then === 'function') return r.then(() => step(i + 1), err => { failed(k, err); return step(i + 1); });
    }
    return true;
  };
  return step(0);
}

/**
 * A part registered after a save was loaded (a module installed later): hand it its data from that save now.
 * @param {any} s  the Saves instance
 * @param {string} key
 * @internal
 */
export function adoptPart(s, key) {
  const p = s.providers.get(key), d = s._foreign.parts[key], v = s._foreign.versions[key] ?? 1;
  delete s._foreign.parts[key]; delete s._foreign.versions[key];
  const where = fmt(DEV_STRINGS.adoptAt, { k: key });
  try {
    if (v > p.version) throw codedError('save-refused', `save part '${key}' is version ${v}, this build reads up to ${p.version}`);
    const r = s.engine.ops.allow(() => p.load(upgradePart(key, p, d, v)));
    if (r && typeof r.then === 'function') r.catch(err => reportError(s.engine, err, where));
  } catch (err) { reportError(s.engine, err, where); }
}


/**
 * Load a slot; with base (a collect() result) the save goes on top of it, so a part missing from the save gets base's state (session.load).
 * @param {any} s  the Saves instance
 * @param {string} slot
 * @param {any} [base]
 * @returns {Promise<boolean>}
 * @internal
 */
export function loadSlot(s, slot, base) {
  let data = s._json.get(slot);
  if (base && data != null) {
    try {
      const sv = parseSave(data);
      if (sv?.parts && typeof sv.parts === 'object' && !Array.isArray(sv.parts)) {
        const own = Object.fromEntries(Object.keys(sv.parts).map(k => [k, sv.versions?.[k] ?? 1]));   // a part without a version is version 1, not base's
        data = { ...sv, parts: { ...base.parts, ...sv.parts }, versions: { ...base.versions, ...own } };
      }
    } catch { /* unreadable: apply refuses the text itself with the reason */ }
  }
  return s.apply(data, slot).then(async ok => {
    if (ok) await afterLoad(s.engine);
    if (ok) s.engine.events.emit('save:loaded', slot);
    return ok;
  });
}

/** Modules with an afterLoad hook rebuild what the loaded state needs nearby (models and the colliders their build adds); gameplay waits frozen
 *  until every one resolves, so the first step after `await saves.load()` never runs on missing ground or walls */
async function afterLoad(e) {
  const hooks = [...e.modules.values()].filter(m => m.afterLoad);
  if (!hooks.length) return;
  e.freeze('load');
  try { await Promise.all(hooks.map(m => m.afterLoad(e))); } finally { e.unfreeze('load'); }
}
