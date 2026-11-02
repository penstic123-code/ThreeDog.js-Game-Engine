// Applying a save (split out of Saves.js): every part is checked and migrated before anything changes (saveVersions.js), then loaded in order;
// if anything in the load throws, every part reloads the state from just before the load (rollback), so a game is never left half-loaded.
// "Anything" is the whole load, not only load() itself: a listener of an event a part emits while loading (world:load) and the modules' afterLoad
// hooks count too. Reported on their own they let the load carry on: a hand-edited player position threw in a world:load listener and left the game
// frozen half-loaded (durability audit 2026-11-02).
import { toast } from '../ui/UI.js';
import { fmt, warnOnce } from './validate.js';
import { reportError } from './errors.js';
import { codedError, coded } from './errorHints.js';
import { FORMAT, readSave, parseSave, upgradePart } from './saveVersions.js';

const DEV_STRINGS = {
  loadThrew: "load() of save part '{k}' threw ({msg}); the game was rolled back to how it was before loading '{slot}'",
  partAt: "load() of save part '{k}'", adoptAt: "load() of save part '{k}' (registered after the save was loaded)",
  rollback: "rollback of save part '{k}' after a failed load (that part may be half-loaded; the other parts rolled back)",
  listener: 'a listener of event {name} threw while the part loaded: {msg}',
  hook: "afterLoad of module '{k}' threw ({msg}); the game was rolled back to how it was before loading '{slot}'",
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
    if (r.reason !== 'missing') { warnOnce(coded('save-refused', r.dev));   // handled: the player is told, nothing changed
      toast(s.engine, s.engine.t('saves.' + r.reason), { kind: 'error', ms: 5000 }); }
    return Promise.resolve(false);
  }
  const e = s.engine, before = s._collect().data, foreign0 = s._foreign;   // the rollback point
  e.commits.invalidate(); e.ops._mark('(load)');   // old background results die with the old world; the op log shows where the load cut in
  s._foreign = r.foreign;
  const fail = err => {
    // a malformed save (world/persist.js save-bad-record) is the save's fault, not the game's: refused like a corrupt save (warning + toast), so it
    // does not freeze gameplay as a code error would; a load() / listener / afterLoad that throws is a bug and goes through the error tiers
    if (err?.cause?.code === 'save-bad-record') { warnOnce(err.message); toast(e, e.t('saves.corrupt'), { kind: 'error', ms: 5000 }); }
    else reportError(e, err, err?.part ? fmt(DEV_STRINGS.partAt, { k: err.part }) : `saves.apply('${slot}')`);
    s._foreign = foreign0;
    const back = readSave(before, s.providers, '(rollback)');
    // every part reloads its pre-load state; a part that throws again is reported (once) and the rest still roll back
    const onPart = er => reportError(e, er, fmt(DEV_STRINGS.rollback, { k: er.part }), { soft: true });
    return Promise.resolve('list' in back ? e.ops.allow(() => runParts(e, back.list, '(rollback)', onPart)) : null).then(() => false);
  };
  let out;
  try { out = e.ops.allow(() => runParts(e, r.list, slot)); } catch (err) { return fail(err); }   // loading writes state outside ops on purpose (guard allows it)
  // a load is a state change: ops.revision moves. afterLoad belongs to the load (Saves.apply doc): a hook that throws fails it like a part's load()
  return Promise.resolve(out).then(() => { e.ops.revision++; return afterLoad(e, slot).then(() => true, fail); }, fail);
}

/** Run one part's load with event-listener errors collected (Events._catch): the first one counts as the load throwing, so it rolls back */
function callLoad(e, fn) {
  const ev = e.events, prev = ev._catch, mine = ev._catch = [];
  let r;
  try { r = fn(); } finally { ev._catch = prev; }
  if (mine.length) {
    const { name, err } = mine[0];
    throw Object.assign(new Error(fmt(DEV_STRINGS.listener, { name, msg: err?.message ?? String(err) })), { cause: err });
  }
  return r;
}

/**
 * Load parts in order; a part returning a Promise makes the rest wait for it. A failing part throws (or rejects) with the part named,
 * unless onFail is given (rollback): then onFail(err) is called and the next part loads anyway.
 */
function runParts(e, list, slot, onFail = null) {
  const failed = (k, err) => { const er = loadError(k, err, slot); if (!onFail) throw er; onFail(er); };
  const step = i => {
    for (; i < list.length; i++) {
      const [k, p, d] = list[i];
      let r;
      try { r = callLoad(e, () => p.load(d)); } catch (err) { failed(k, err); continue; }
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
    const r = s.engine.ops.allow(() => p.load(upgradePart(key, p, d, v, s._foreign.whole)));
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
  return s.apply(data, slot).then(ok => {   // apply already ran the modules' afterLoad hooks
    if (ok) { s._adopt(slot); s.engine.events.emit('save:loaded', slot); }   // continuing from it: this tab may overwrite it now (Saves._put)
    return ok;
  });
}

/** Modules with an afterLoad hook rebuild what the loaded state needs nearby (models and the colliders their build adds); gameplay waits frozen
 *  until every one resolves, so the first step after `await saves.load()` never runs on missing ground or walls.
 *  applySave runs it (not only saves.load): session.newGame() / quit() apply the base data the same way and need the same rebuild.
 *  Every hook settles before the result (allSettled): a rollback must not start while another hook is still building the state being replaced.
 *  The first failure rejects, named after its module (save-load-threw), and applySave rolls back. Rollback itself does not rerun afterLoad
 *  (the world rebuilds nearby models over the next frames). */
async function afterLoad(e, slot) {
  const hooks = [...e.modules.values()].filter(m => m.afterLoad);
  if (!hooks.length) return;
  const fz = e.freeze('threedog:load');   // a namespaced owner: a game's own freeze('load') must not be released by (or release) the engine's
  let res;
  try { res = await Promise.allSettled(hooks.map(m => Promise.resolve().then(() => callLoad(e, () => m.afterLoad(e))))); } finally { fz.remove(); }
  const i = res.findIndex(r => r.status === 'rejected');
  if (i >= 0) {
    const err = /** @type {PromiseRejectedResult} */ (res[i]).reason, k = hooks[i].name;
    throw Object.assign(codedError('save-load-threw', fmt(DEV_STRINGS.hook, { k, slot, msg: err?.message ?? String(err) })), { cause: err });
  }
}

/** Collect every part: { data, failed: [[key, error]] }. Parts of the loaded save that no module owns are carried along. */
export function collectParts(s) {
  const f = s._foreign, failed = [];
  const data = { format: FORMAT, savedAt: Date.now(), versions: { ...f.versions }, parts: { ...f.parts } };   // wall-clock: real time of the save
  for (const [k, p] of s.providers) {
    // a part with nothing to save (save() returns null / undefined) is left out, so a null part in a save always means damage (readSave refuses it);
    // loading a save without it keeps that part as it is (saves.load) or gives it its new-game state (session.load)
    try { const d = p.save(); if (d == null) { delete data.parts[k]; delete data.versions[k]; } else { data.parts[k] = d; data.versions[k] = p.version; } }
    catch (e) { failed.push([k, e]); delete data.parts[k]; delete data.versions[k]; }
  }
  return { data, failed };
}
