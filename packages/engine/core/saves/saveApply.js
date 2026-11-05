// Applying a save (split out of Saves.js): every part is checked and migrated before anything changes (saveVersions.js), then loaded in order;
// if anything in the load throws, every part reloads the state from just before the load (rollback), so a game is never left half-loaded.
// "Anything" is the whole load, not only load() itself: a listener of an event a part emits while loading (world:load) and the modules' afterLoad
// hooks count too. Reported on their own they let the load carry on: a hand-edited player position threw in a world:load listener and left the game
// frozen half-loaded (durability audit 2026-11-02).
// The capture lasts the whole load, past every await: an async part that emits after `await` (async load(d) { apply(d); await res(); emit(...) })
// is part of the load as much as its first line. The browser has no async context to tell whose code emitted after an await, so each load
// carries its own capture scope (Events._scopes): a part's synchronous run puts its load's scope on top; between awaits the load started last
// gets the errors. Loads are not queued: apply changes the state synchronously when every part is synchronous (callers rely on that), and two
// overlapping loads were never sound anyway (the second one's rollback point is the first one's half-applied state). An unrelated listener that
// throws while a load is still settling fails that load too; gameplay is frozen while parts load, so that is rare, and the error is reported.
// The rollback point is a copy (structuredClone of every part's save()): save() may return the live object, which load() then writes into.
import { toast } from '../../ui/UI.js';
import { fmt, warnOnce } from '../base/validate.js';
import { reportError } from '../base/errors.js';
import { codedError, coded } from '../base/errorHints.js';
import { FORMAT, readSave, parseSave, upgradePart } from './saveVersions.js';
import { PARTS_LOADING } from '../ops/opsFail.js';
import { isObject } from '../base/util.js';

const DEV_STRINGS = {
  loadThrew: "load() of save part '{k}' threw ({msg}); the game was rolled back to how it was before loading '{slot}'",
  partAt: "load() of save part '{k}'", adoptAt: "load() of save part '{k}' (registered after the save was loaded)",
  rollback: "rollback of save part '{k}' after a failed load (that part may be half-loaded; the other parts rolled back)",
  listener: 'a listener of event {name} threw while the part loaded: {msg}',
  hook: "afterLoad of module '{k}' threw ({msg}); the game was rolled back to how it was before loading '{slot}'",
  notPlain: "save() of save part '{k}' returned data that cannot be copied ({msg}), so loading '{slot}' could not keep a rollback point and was refused "
    + 'before anything changed. save() must return plain data (no functions, DOM nodes, three objects); return a copy of what the save needs',
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
  const e = s.engine, foreign0 = s._foreign;
  let before;   // the rollback point, a copy (rollbackPoint)
  try { before = rollbackPoint(s, slot); } catch (err) { reportError(e, err, `saves.apply('${slot}')`); return Promise.resolve(false); }
  const ev = e.events, scope = [];   // this load's capture scope: listener errors from now until the load settled (top of the file)
  ev._scopes.push(scope);
  const settled = () => { const i = ev._scopes.lastIndexOf(scope); if (i >= 0) ev._scopes.splice(i, 1); };
  return Promise.resolve(applyParts(s, e, r, slot, before, foreign0, scope)).finally(settled);
}

/** The rest of applySave, under the load's capture scope */
function applyParts(s, e, r, slot, before, foreign0, scope) {
  e.commits.invalidate(); e.ops._mark('(load)');   // old background results die with the old world; the op log shows where the load cut in
  s._foreign = r.foreign;
  const fail = err => {
    // a malformed save (refuseSave, save-bad-record) is the save's fault, not the game's: refused like a corrupt save (warning + toast), so it
    // does not freeze gameplay as a code error would; a load() / listener / afterLoad that throws is a bug and goes through the error tiers
    if (err?.cause?.code === 'save-bad-record') { warnOnce(err.message); toast(e, e.t('saves.corrupt'), { kind: 'error', ms: 5000 }); }
    else reportError(e, err, err?.part ? fmt(DEV_STRINGS.partAt, { k: err.part }) : `saves.apply('${slot}')`);
    s._foreign = foreign0;
    const back = readSave(before, s.providers, '(rollback)');
    // every part reloads its pre-load state; a part that throws again is reported (once) and the rest still roll back
    const onPart = er => reportError(e, er, fmt(DEV_STRINGS.rollback, { k: er.part }), { soft: true });
    const undone = 'list' in back ? e.ops.allow(() => runParts(e, back.list, '(rollback)', scope, onPart)) : true;
    // a rollback that waits on an async part holds gameplay too, whichever way the load failed (the load's own hold may be gone or never taken)
    const fz = undone !== true ? e.freeze(PARTS_LOADING) : null;
    return Promise.resolve(undone).then(() => false).finally(() => fz?.remove());
  };
  let out;
  try { out = e.ops.allow(() => runParts(e, r.list, slot, scope)); } catch (err) { return fail(err); }   // loading writes state outside ops on purpose (guard allows it)
  // a part still loading (its load() returned a Promise): gameplay waits until every part is applied -- no fixed step, no op (opsFail.js
  // PARTS_LOADING). A fully sync load never takes it.
  const fz = out !== true ? e.freeze(PARTS_LOADING) : null;
  const partsDone = () => { fz?.remove(); };
  // a load is a state change: ops.revision moves. afterLoad belongs to the load (Saves.apply doc): a hook that throws fails it like a part's load()
  return Promise.resolve(out).then(() => { partsDone(); e.ops.revision++; return afterLoad(e, slot, scope).then(() => true, fail); },
    err => Promise.resolve(fail(err)).finally(partsDone));
}

/** The rollback point: every part's save(), copied so a load() writing into the object its save() returned cannot change it.
 *  A part whose data cannot be copied throws (save-part-threw): without a true copy a failed load could not be undone */
function rollbackPoint(s, slot) {
  const data = s._collect().data;
  for (const k of Object.keys(data.parts)) {
    try { data.parts[k] = structuredClone(data.parts[k]); }
    catch (err) { throw Object.assign(codedError('save-part-threw', fmt(DEV_STRINGS.notPlain, { k, slot, msg: err?.message ?? String(err) })), { cause: err }); }
  }
  return data;
}

/** A listener error collected in scope since index from: the first counts as the load throwing (and the scope forgets them) */
function takeListenerError(scope, from) {
  if (scope.length <= from) return;
  const { name, err } = scope[from];
  scope.length = from;
  throw Object.assign(new Error(fmt(DEV_STRINGS.listener, { name, msg: err?.message ?? String(err) })), { cause: err });
}

/** Run one part's load with event-listener errors collected in the load's scope (on top while it runs synchronously, see the top of the file);
 *  an async load is checked once it settled, so a listener that throws after its await fails the part too */
function callLoad(e, fn, scope) {
  const ev = e.events, from = scope.length;
  ev._scopes.push(scope);
  let r;
  try { r = fn(); } catch (err) { scope.length = from; throw err; } finally { ev._scopes.splice(ev._scopes.lastIndexOf(scope), 1); }
  if (r && typeof r.then === 'function') return r.then(v => { takeListenerError(scope, from); return v; }, err => { scope.length = from; throw err; });
  takeListenerError(scope, from);
  return r;
}

/**
 * Load parts in order; a part returning a Promise makes the rest wait for it. A failing part throws (or rejects) with the part named,
 * unless onFail is given (rollback): then onFail(err) is called and the next part loads anyway.
 */
function runParts(e, list, slot, scope, onFail = null) {
  const failed = (k, err) => { const er = loadError(k, err, slot); if (!onFail) throw er; onFail(er); };
  const step = i => {
    for (; i < list.length; i++) {
      const [k, p, d] = list[i];
      let r;
      try { r = callLoad(e, () => p.load(d), scope); } catch (err) { failed(k, err); continue; }
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
      if (isObject(sv?.parts)) {
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
 *  (the world rebuilds nearby models over the next frames).
 *  The hooks run side by side, so a listener error in this phase is not pinned on one hook: once all settled, any error the load's scope
 *  collected since its parts finished fails the load (the last check before apply resolves true). */
async function afterLoad(e, slot, scope) {
  const hooks = [...e.modules.values()].filter(m => m.afterLoad);
  let res = [];
  if (hooks.length) {
    const fz = e.freeze('threedog:load');   // a namespaced owner: a game's own freeze('load') must not be released by (or release) the engine's
    try { res = await Promise.allSettled(hooks.map(m => Promise.resolve().then(() => m.afterLoad(e)))); } finally { fz.remove(); }
  }
  const i = res.findIndex(r => r.status === 'rejected');
  if (i >= 0) {
    scope.length = 0;
    const err = /** @type {PromiseRejectedResult} */ (res[i]).reason, k = hooks[i].name;
    throw Object.assign(codedError('save-load-threw', fmt(DEV_STRINGS.hook, { k, slot, msg: err?.message ?? String(err) })), { cause: err });
  }
  takeListenerError(scope, 0);
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
