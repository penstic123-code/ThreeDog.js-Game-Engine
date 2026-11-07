// Applying a save (split out of Saves.js): every part is checked and migrated before anything changes (saveVersions.js), then loaded in order;
// if anything in the load throws, every part reloads the state from just before the load (rollback), so a game is never left half-loaded.
// "Anything" is the whole load, not only load() itself: a listener of an event a part emits while loading (world:load) and the modules' afterLoad
// hooks count too. Reported on their own they let the load carry on: a hand-edited player position threw in a world:load listener and left the game
// frozen half-loaded (durability audit 2026-11-02).
// The capture lasts the whole load, past every await: an async part that emits after `await` (async load(d) { apply(d); await res(); emit(...) })
// is part of the load as much as its first line. The browser has no async context to tell whose code emitted after an await, so each load
// carries its own capture scope (Events._scopes): a part's synchronous run puts its load's scope on top; between awaits the load started last
// gets the errors. Only one load runs at a time, inside its turn (stateReplace.js), so that load is this one. Everything here returns a plain value
// while it stays synchronous: a fully synchronous save ends before apply returns. An unrelated listener that throws while a load is still settling
// fails that load too; gameplay is frozen while parts load, so that is rare, and the error is reported.
// The rollback point is a copy (structuredClone of every part's save()): save() may return the live object, which load() then writes into.
// A part about to load whose save() gives nothing to copy (null, or it threw) goes back to its new-game state; with none of that either it cannot go back, and a failed load says so.
import { toast } from '../../ui/UI.js';
import { fmt, warnOnce } from '../base/validate.js';
import { reportError } from '../base/errors.js';
import { codedError, coded } from '../base/errorHints.js';
import { FORMAT, readSave, parseSave, upgradePart, partVersion } from './saveVersions.js';
import { isObject } from '../base/util.js';

const DEV_STRINGS = {
  loadThrew: "load() of save part '{k}' threw ({msg}); the game was rolled back to how it was before loading '{slot}'",
  partAt: "load() of save part '{k}'", adoptAt: "load() of save part '{k}' (registered after the save was loaded)",
  rollback: "rollback of save part '{k}' after a failed load (that part may be half-loaded; the other parts rolled back)",
  noRollback: "save part '{k}' keeps what the failed load gave it: its save() gave nothing before the load and it has no new-game state to go back to (the other parts rolled back)",
  notData: "save() of save part '{k}' returned {got}, which a save cannot hold; return plain data, or null when there is nothing to save",
  notNumber: "save() of save part '{k}' holds {got} at {path}, which a save cannot hold (it would come back as null); save a finite number, or leave the field out",
  listener: 'a listener of event {name} threw while the part loaded: {msg}',
  hook: "afterLoad of module '{k}' threw ({msg}); the game was rolled back to how it was before loading '{slot}'",
  notPlain: "save() of save part '{k}' returned data that cannot be copied ({msg}), so loading '{slot}' could not keep a rollback point and was refused "
    + 'before anything changed. save() must return plain data (no functions, DOM nodes, three objects); return a copy of what the save needs',
};

/** A save part's load threw: the error named after the part (thrown on, so the caller can roll back) */
const loadError = (k, err, slot) => Object.assign(codedError('save-load-threw', fmt(DEV_STRINGS.loadThrew, { k, slot, msg: err?.message ?? String(err) })), { part: k, cause: err });

/**
 * Implementation of saves.apply (see its JSDoc): checked first, applied part by part, rolled back to the pre-load state if any part throws.
 * Runs inside a turn of s._replace; the marker is on from the first read to the last rollback step.
 * @param {any} s  the Saves instance
 * @param {any} data
 * @param {string} slot
 * @returns {boolean | Promise<boolean>}  a plain value when nothing waited
 * @internal
 */
export function applySave(s, data, slot) {
  const q = s._replace, job = q.job;
  q.begin();
  let out;
  try { out = checkAndApply(s, data, slot); } catch (err) { q.end(); throw err; }
  if (typeof out !== 'boolean') return out.finally(() => q.endOf(job));
  q.end();
  return out;
}

/** The body of applySave, under the marker */
function checkAndApply(s, data, slot) {
  const r = readSave(data, s.providers, slot);
  if ('reason' in r) {
    if (r.reason !== 'missing') { warnOnce(coded('save-refused', r.dev));   // handled: the player is told, nothing changed
      toast(s.engine, s.engine.t('saves.' + r.reason), { kind: 'error', ms: 5000 }); }
    return false;
  }
  const e = s.engine, foreign0 = s._foreign;
  let before;   // the rollback point, a copy (rollbackPoint)
  try { before = rollbackPoint(s, slot, r.list); } catch (err) { reportError(e, err, `saves.apply('${slot}')`); return false; }
  const ev = e.events, scope = [];   // this load's capture scope: listener errors from now until the load settled (top of the file)
  ev._scopes.push(scope);
  const settled = () => { const i = ev._scopes.lastIndexOf(scope); if (i >= 0) ev._scopes.splice(i, 1); };
  let out;
  try { out = applyParts(s, e, r, slot, before, foreign0, scope); } catch (err) { settled(); throw err; }
  if (typeof out !== 'boolean') return out.finally(settled);
  settled();
  return out;
}

/** The rest of applySave, under the load's capture scope */
function applyParts(s, e, r, slot, before, foreign0, scope) {
  const q = s._replace;
  const keepResults = e.commits.invalidate(); e.ops._mark('(load)');   // old background results die with the old world; the op log shows where the load cut in
  const generation = q.generation++;
  q.changed();
  s._foreign = r.foreign;
  const fail = err => {
    keepResults(); q.generation = generation; q.changed(true);   // the old world stays, and what it was waiting for with it
    // a malformed save (refuseSave, save-bad-record) is the save's fault, not the game's: refused like a corrupt save (warning + toast), so it
    // does not freeze gameplay as a code error would; a load() / listener / afterLoad that throws is a bug and goes through the error tiers
    const refused = err?.cause?.code === 'save-bad-record';
    if (refused) { warnOnce(err.message); toast(e, e.t('saves.corrupt'), { kind: 'error', ms: 5000 }); }
    else reportError(e, err, err?.part ? fmt(DEV_STRINGS.partAt, { k: err.part }) : `saves.apply('${slot}')`);
    s._foreign = foreign0;
    const back = readSave(before, s.providers, '(rollback)');
    // every part reloads its pre-load state; a part that throws again is reported (once) and the rest still roll back
    const onPart = er => reportError(e, er, fmt(DEV_STRINGS.rollback, { k: er.part }), { soft: true });
    const undone = 'list' in back ? e.ops.allow(() => runParts(s, back.list, '(rollback)', scope, onPart)) : true;
    // a part that refused its data took none of it: it has nothing to go back from
    for (const [k] of r.list) if (!Object.hasOwn(before.parts, k) && !(refused && k === err.part)) reportError(e, codedError('save-load-threw', fmt(DEV_STRINGS.noRollback, { k })), `saves.apply('${slot}')`, { soft: true });
    // a session door announces its own failure, after its clocks came back
    const failed = () => { if (!e.session._busy) e.events.emit('session:failed', { kind: 'quick', slot }); return false; };
    if (undone === true) return failed();
    q.hold();   // a rollback that waits on an async part holds gameplay too, whichever way the load failed
    return undone.then(failed);
  };
  // a load is a state change: ops.revision moves. afterLoad belongs to the load (Saves.apply doc): a hook that throws fails it like a part's load()
  const partsDone = () => {
    e.ops.revision++;
    let hooks;
    try { hooks = afterLoad(s, e, slot, scope); } catch (err) { return fail(err); }
    return hooks === true ? true : hooks.then(() => true, fail);
  };
  let out;
  try { out = e.ops.allow(() => runParts(s, r.list, slot, scope)); } catch (err) { return fail(err); }   // loading writes state outside ops on purpose (guard allows it)
  if (out === true) return partsDone();
  q.hold();   // a part still loading (its load() returned a Promise): gameplay waits until every part is applied. A fully sync load never takes it
  return out.then(partsDone, fail);
}

/** The rollback point: every part's save(), copied so a load() writing into the object its save() returned cannot change it.
 *  A part whose data cannot be copied throws (save-part-threw): without a true copy a failed load could not be undone.
 *  list: the parts about to load; those with nothing to copy take their new-game data (top of the file) */
function rollbackPoint(s, slot, list) {
  const data = s._collect().data, S = s.engine.session, base = S._base ? S._baseData() : { parts: {}, versions: {} };
  for (const [k] of list) if (!Object.hasOwn(data.parts, k) && Object.hasOwn(base.parts, k)) { data.parts[k] = base.parts[k]; data.versions[k] = base.versions[k]; }
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
function callLoad(s, fn, scope) {
  const ev = s.engine.events, from = scope.length;
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
function runParts(s, list, slot, scope, onFail = null) {
  const failed = (k, err) => { const er = loadError(k, err, slot); if (!onFail) throw er; onFail(er); }, { turn } = s._replace.job;
  const step = i => {
    for (; i < list.length; i++) {
      const [k, p, d] = list[i];
      let r;
      try { r = callLoad(s, () => p.load(d, turn), scope); } catch (err) { failed(k, err); continue; }
      if (r && typeof r.then === 'function') return r.then(() => step(i + 1), err => { failed(k, err); return step(i + 1); });
    }
    return true;
  };
  return step(0);
}

/**
 * A part registered after a save was loaded (a module installed later): hand it its data from that save in a turn of its own. Idle that is now. During a
 * replacement it is after it, whole: its first line would write into a half-loaded state, and a newer load waits for it instead of having this older data
 * land on top. A load that replaced the state while it waited took this data with it. The data stays unattached until then, so a save still carries it.
 * @param {any} s  the Saves instance
 * @param {string} key
 * @internal
 */
export function adoptPart(s, key) {
  const f = s._foreign, q = s._replace, where = fmt(DEV_STRINGS.adoptAt, { k: key });
  q.run(null, () => {
    const p = s.providers.get(key);
    if (s._foreign !== f || !p || !Object.hasOwn(f.parts, key)) return;
    const d = f.parts[key], v = f.versions[key] ?? 1;
    delete f.parts[key]; delete f.versions[key];
    // data the part could not take stays unattached, and collectParts writes it instead of the part's empty state: the next save must not lose it
    const refused = err => { if (s._foreign === f) { f.parts[key] = d; f.versions[key] = v; } reportError(s.engine, err, where); };
    try {
      if (v > p.version) throw codedError('save-refused', `save part '${key}' is version ${v}, this build reads up to ${p.version}`);
      const r = s.engine.ops.allow(() => p.load(upgradePart(key, p, d, v, f.whole), q.job.turn));
      if (r && typeof r.then === 'function') return r.catch(refused);
    } catch (err) { refused(err); }
  }, true);
}


/**
 * Load a slot; with base (a collect() result) the save goes on top of it, so a part missing from the save gets base's state (session.load).
 * @param {any} s  the Saves instance
 * @param {string} slot
 * @param {any} [base]
 * @returns {Promise<boolean>}
 * @internal Runs inside a turn of s._replace
 */
export function loadSlot(s, slot, base) {
  let data = s._json.get(slot);
  if (base && data != null) {
    try {
      const sv = parseSave(data);
      if (isObject(sv?.parts) && (sv.versions === undefined || isObject(sv.versions))) {   // other shapes go on as they are: apply refuses them with the reason
        const own = Object.fromEntries(Object.keys(sv.parts).map(k => [k, partVersion(sv.versions, k)]));   // a part without a version is version 1, not base's
        data = { ...sv, parts: { ...base.parts, ...sv.parts }, versions: { ...base.versions, ...own } };
      }
    } catch { /* unreadable: apply refuses the text itself with the reason */ }
  }
  return applyAnnounced(s, data, slot, () => s._adopt(slot));   // continuing from it: this tab may overwrite it now (Saves._put)
}

/**
 * Apply a save onto the running playthrough and say so: what is not saved ends on save:loaded, derived state rebuilds on it, and the playthrough runs from here, whichever door the save came through (session.js lists them).
 * @param {any} s  the Saves instance
 * @param {any} data
 * @param {string} slot
 * @param {() => void} [done]  on success, before the event
 * @returns {Promise<boolean>}
 * @internal Runs inside a turn of s._replace
 */
export function applyAnnounced(s, data, slot, done) {
  const q = s._replace, job = q.job, applied = applySave(s, data, slot);
  if (typeof applied === 'boolean') q.pause();   // only the save:loaded below is left, a microtask on
  return Promise.resolve(applied).then(ok => {   // apply already ran the modules' afterLoad hooks
    // not when a newer load took over: the game holds that one's state, and it announces itself
    if (ok && q.job === job) { done?.(); s.engine.session._started(); s.engine.events.emit('save:loaded', slot); }
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
 *  collected since its parts finished fails the load (the last check before apply resolves true).
 *  Returns true when no module has a hook (nothing waited), else a Promise. The hooks start a microtask after the parts, and the marker and the
 *  freeze with them: the lines right after an unawaited apply can still step, run ops and apply again (stateReplace.js, pause). */
function afterLoad(s, e, slot, scope) {
  const hooks = [...e.modules.values()].filter(m => m.afterLoad), q = s._replace;
  if (!hooks.length) { takeListenerError(scope, 0); return true; }
  const job = q.pause();
  const run = () => {
    if (!q.resume(job)) return null;
    q.hold();
    return Promise.allSettled(hooks.map(m => Promise.resolve().then(() => m.afterLoad(e, job.turn))));
  };
  return Promise.resolve().then(run).then(res => {
    // taken over: the state is the newer load's, so nothing here may fail or roll back; what the scope caught is a listener error like any other
    if (!res) { for (const { name, err } of scope.splice(0)) e.events.onError(name, err); return; }
    const i = res.findIndex(r => r.status === 'rejected');
    if (i >= 0) {
      scope.length = 0;
      const err = /** @type {PromiseRejectedResult} */ (res[i]).reason, k = hooks[i].name;
      throw Object.assign(codedError('save-load-threw', fmt(DEV_STRINGS.hook, { k, slot, msg: err?.message ?? String(err) })), { cause: err });
    }
    takeListenerError(scope, 0);
  });
}

/** Where inside a part's data JSON would turn a number into null, as 'pos[0]', else null. seen: a cycle is JSON.stringify's to refuse, not this walk's to chase */
function badNumberAt(v, path = '', seen = new Set()) {
  if (typeof v === 'number') return Number.isFinite(v) ? null : { path, got: String(v) };
  if (v === null || typeof v !== 'object' || seen.has(v)) return null;
  seen.add(v);
  const list = Array.isArray(v);
  for (const k of Object.keys(v)) {
    const bad = badNumberAt(v[k], list ? `${path}[${k}]` : path ? `${path}.${k}` : k, seen);
    if (bad) return bad;
  }
  return null;
}

/**
 * What a part's save() gave, once it passed what a save can hold; throws save-part-threw otherwise. Everything that keeps a part's data goes through here, so no path turns a number into null.
 * @param {string} k
 * @param {{ save(): any }} p
 * @returns {any}
 * @internal
 */
export function partData(k, p) {
  const d = p.save();
  // what JSON turns into null (read back as damage, so the whole save would never load again) or drops is not save data
  if (typeof d === 'function' || typeof d === 'symbol' || (typeof d === 'number' && !Number.isFinite(d))) throw codedError('save-part-threw', fmt(DEV_STRINGS.notData, { k, got: String(d) }));
  // a whole save is not given up for a field: the slot keeps its last good save, by name, the way a part whose save() threw does. A silent null reads back as hp null, position null
  const bad = badNumberAt(d);
  if (bad) throw codedError('save-part-threw', fmt(DEV_STRINGS.notNumber, { k, ...bad }));
  return d;
}

/** Collect every part: { data, failed: [[key, error]] }. Parts of the loaded save that no module owns are carried along. */
export function collectParts(s) {
  const f = s._foreign, failed = [];
  const data = { format: FORMAT, savedAt: Date.now(), versions: { ...f.versions }, parts: { ...f.parts } };   // wall-clock: real time of the save
  for (const [k, p] of s.providers) {
    // a part with nothing to save (save() returns null / undefined) is left out, so a null part in a save always means damage (readSave refuses it);
    // loading a save without it keeps that part as it is (saves.load) or gives it its new-game state (session.load)
    if (Object.hasOwn(f.parts, k)) continue;   // data this part could not take when it joined (adoptPart): it rides along until a load replaces it
    try {
      const d = partData(k, p);
      if (d == null) { delete data.parts[k]; delete data.versions[k]; } else { data.parts[k] = d; data.versions[k] = p.version; }
    } catch (e) { failed.push([k, e]); delete data.parts[k]; delete data.versions[k]; }
  }
  return { data, failed };
}
