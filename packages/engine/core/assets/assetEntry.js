// The life of one engine.assets entry, split from Assets.js (which keeps the public API and the manifest):
//   load: fetchEntry runs the load as a task in engine.loading and, for a registered non-critical file that fails, falls back (gray placeholder / silence / the entry's fallback)
//   free: freeEntry gives the GPU memory back, deferred while model copies are still in the scene; shareModel marks what copies share so engine.remove does not dispose it
//   sounds: freeing one needs no count. A playing voice holds its own buffer, so it plays on and the memory goes when it ends; the next play loads the file again
// Plain functions that take the Assets instance, so they stay out of the class's public surface.
//
// Who decides what a failed file means: the caller. An entry only says what it can fall back to, because it cannot know who asks: a prop on a gray box is a game that goes on, a level on a gray box
// is not a level. A caller that cannot use a stand-in waits with { whole: true } (Assets.wholeModel); e.fellBack is the failure the stand-in hides, and such a caller gets that instead, and tries the file
// again on its next ask. Internal on purpose: a game names `critical` for start(), and asks for a stand-in or not by what it does with the result.
//
// Who owns what. An entry is a name; a load is one attempt at its data, and the load is what owns that data:
//   { owner, type, gameOwned, task, stop, value, users, settled, pinned }, reached as e.load.
//   - One rule for freed, replaced and disposed: whoever ends a load aborts `stop`; a result arriving for an aborted load is freed and never written
//     back. Why a record per load and not a counter on the entry: a palette write, a hot swap and a release all leave a load behind while the
//     name moves on, and only the load knows which copies still hold its data.
//   - Each copy counts on the load its data came from, so a name that fell back to another (e.load is then the other entry's load, e.value stays null)
//     keeps that entry's data alive, and freeing the data sends every name reading it back to a fresh load.
//   - e.users is the count Assets._users reads: leases (takeLease) asked for by this name plus leases that borrow its data; a model copy is one lease. load.users frees an old build.
//
// A caller already awaiting a load that was ended:
//   - release, trim, a palette write, a name registered again: the game is alive and asked for this asset, so the wait carries on with a fresh load
//     (release says "reloaded on next use", and a wait is a use). It gets a live value, or the failure of that fresh load. Why not reject: every
//     model() in the game would need a catch for a normal level change, and a rejected promise stays cached in the prototype tables.
//   - the limit: a load that shows no sign of life for engine.loading.timeoutMs fails, by the path any failure takes (fallback, or asset-load). The limit sits on the load and not on each
//     waiter, so every wait above it, a level, a pack, a preload, a save's part, ends by inheritance and none needs a timer of its own. Silence and not total time: a big file on a slow
//     network that still arrives is not stuck.
//   - leaving: a waiter with a signal (waitLoad) may stop waiting. When every waiter on a load has left, nobody wants it and it is aborted; a load shared with a waiter that stays goes on.
//   - assets.dispose: the promise stays pending for good. Why not reject or resolve null: `model(x).then(add)` with no catch would be an unhandled
//     rejection in teardown, and null would be a TypeError in the same place; the code after the await belongs to a disposed engine.
import { warnOnce, fmt } from '../base/validate.js';
import { codedError, coded } from '../base/errorHints.js';
import { loadGltf, loadTexture, loadFont, loadAudio, generated, placeholder } from './assetLoad.js';
import { failureText } from '../engine/Loading.js';
import { paramValues } from './assetManifest.js';

const STRINGS = {
  failed: 'Asset failed to load: {what}',
  fellBack: '; using {fallback} instead, the game continues (mark it critical: true if the game cannot start without it)',
  cycle: '; its fallbacks loop back on themselves ({chain}). Break the loop: give one of them no fallback, or a fallback that is a different file',
  missingRefs: 'Asset loaded with missing references: {what} (missing {list}); materials show without those files',
};

/** From this many seconds a decoded sound is music or a long loop, worth loading again; shorter ones are effects, played often and small, and stay */
const LONG_SOUND = 10;
/** Decoded long sounds kept at once, in bytes: about 6 minutes of stereo at 48 kHz (a decoded minute is 21 MB, whatever the file's size) */
const SOUND_BUDGET = 128 * 2 ** 20;
const soundBytes = b => b.length * b.numberOfChannels * 4;
/** A decoded long sound trim and the budget may free; preload: true keeps it, as it keeps a model */
export const longSound = e => e.type === 'sound' && e.value?.duration >= LONG_SOUND && !e.opts.preload;

/** What a caller holds once the engine is gone: never settles, so nothing runs against a disposed engine (the rule is at the top of this file) */
const NEVER = new Promise(() => {});

/** Mark a model template's geometry and materials as shared (copies share them; engine.remove must not dispose them) */
function shareModel(a, g) {
  g.scene.traverse(o => { if (o.geometry) a.shared.add(o.geometry); for (const m of [].concat(o.material || [])) a.shared.add(m); });
  return g;
}

/**
 * Shadow flags of a model copy, one rule for files, generators and content props: an explicit castShadow / receiveShadow (the model() call,
 * then the manifest entry) wins; otherwise a generator that set either flag on any of its meshes decided for itself and is kept as built
 * (a decal that must not cast stays that way); otherwise (a file, or a generator that set nothing) every mesh casts and receives.
 * @param {import('three').Object3D} root
 * @param {{ castShadow?: boolean, receiveShadow?: boolean }} [set]
 */
export function shadowDefaults(root, { castShadow, receiveShadow } = {}) {
  let decided = false;
  root.traverse(o => { if (/** @type {any} */ (o).isMesh && (o.castShadow || o.receiveShadow)) decided = true; });
  const cast = castShadow ?? (decided ? null : true), recv = receiveShadow ?? (decided ? null : true);
  root.traverse(o => { if (/** @type {any} */ (o).isMesh) { if (cast != null) o.castShadow = cast; if (recv != null) o.receiveShadow = recv; } });
  return root;
}

/** Load an entry as a task in engine.loading; a registered, non-critical file that fails resolves to its fallback */
export function fetchEntry(a, e) {
  if (a._disposed) return NEVER;
  if (a._stale(e)) retireEntry(a, e);
  if (e.promise) { if (e.load) e.load.waits++; return e.promise; }
  e.palette = a._paletteKey;
  const L = a.engine.loading, name = e.variantOf ?? e.name ?? e.url;
  const t = L._begin(name, e.type, { critical: e.opts.critical === true, url: e.opts.build || e.opts.texture ? null : e.url, manifest: e.manifest ?? null });
  const load = e.load = { owner: e, type: e.type, gameOwned: !!e.opts.texture, task: t, stop: new AbortController(), value: null, users: 0, settled: false, pinned: false, waits: 1, left: false, stuck: false, whole: false };
  t.signal = load.stop.signal;   // the loaders read it between phases, and a download passes it to fetch
  let work;
  if (e.type === 'model') {
    const got = e.opts.build ? (t.phase('build'), new Promise(res => res(generated(a, e.url, e.opts.build, e.schema ? paramValues(e) : e.opts.params, t))))   /* a sync throw takes the failure path below */ : loadGltf(a, e.url, t);
    work = got.then(g => shareModel(a, g));
  } else if (e.type === 'texture') work = loadTexture(a, e, t);
  else if (e.type === 'font') work = loadFont(a, e, t);
  else if (e.type === 'sound' && e.opts.build) work = Promise.resolve(e.opts.build);   // a synth function: nothing to download
  else if (e.type === 'sound') work = loadAudio(a, e, t);
  // a._disposed too: an entry a hot swap dropped from the table is not reached by dispose, so its load was never aborted
  const ended = () => cancelled(load) || a._disposed;
  e.promise = limited(a, load, work).then(v => {
    if (ended()) { freeValue(load, v); return again(a, e, load); }
    L._done(t);
    const what = `${e.type} "${name}" <- ${e.url}`;
    if (t.missing.length) warnOnce(coded('asset-missing-ref', fmt(STRINGS.missingRefs, { what, list: t.missing.join(', ') })));
    load.settled = true;
    load.value = e.value = v;
    if (e.type === 'sound') capSounds(a, e);
    return v;
  }, err => (ended() ? again(a, e, load) : failedEntry(a, e, load, err)));   // a failure nobody wants any more is not reported
  return e.promise;
}

/** A load ended under its waiters: they carry on with a fresh one (top of the file). Not when every waiter left: that is why it ended, and nobody is here to answer */
const again = (a, e, load) => load.left ? NEVER : fetchEntry(a, e);

/** Someone ended this load on purpose. A load stopped by its limit is aborted too, and that one failed: it takes the failure path */
const cancelled = load => load.stop.signal.aborted && !load.stuck;

/** The one limit on a load (top of the file). A build that ignores the abort may still answer: what it gives then is freed */
function limited(a, load, work) {
  const t = load.task, L = a.engine.loading;
  work.then(v => { if (load.stuck) freeValue(load, v); }, () => {});
  return L._limit(work, () => cancelled(load) ? null : t.at, () => {
    load.stuck = true;
    queueMicrotask(() => load.stop.abort());   // after the failure below won the race, so a download that rejects on abort is not what the waiters hear
    return new Error(`no answer for ${Math.round(L.timeoutMs / 1000)} s (engine.loading.timeoutMs)`);
  });
}

/**
 * The one wait on an entry that can say more than "give me what you have" (top of the file).
 * @param {any} a  the Assets instance
 * @param {any} e
 * @param {{ whole?: boolean, signal?: AbortSignal | null }} [o]  whole: a stand-in is no answer; signal: this waiter may leave, rejecting with its reason
 * @returns {Promise<any>}
 * @internal
 */
export function waitLoad(a, e, { whole = false, signal = null } = {}) {
  if (whole && e.fellBack) retireEntry(a, e);   // the last answer was a stand-in: this caller wants the file
  const got = fetchEntry(a, e), load = e.load;
  if (whole && load) load.whole = true;
  if (!signal) return got;
  return new Promise((res, rej) => {
    const leave = () => {
      rej(signal.reason);
      if (load && --load.waits === 0 && !load.settled) { load.left = true; letGoAll(a, load); cancelLoad(a, load); }
    };
    if (signal.aborted) return leave();
    signal.addEventListener('abort', leave, { once: true });
    const stay = fn => v => { signal.removeEventListener('abort', leave); fn(v); };
    got.then(stay(res), stay(rej));
  });
}

/** The fallback chain from e if it comes back to a name already on it (e -> ... -> e or into a ring), as names; null if it ends */
function fallbackCycle(a, e) {
  const chain = [e.name ?? e.url];
  for (let x = e; x?.opts.fallback;) {
    const next = a.entries.get(x.opts.fallback);
    chain.push(x.opts.fallback);
    if (chain.indexOf(x.opts.fallback) < chain.length - 1) return chain;
    x = next;
  }
  return null;
}

/** A load failed: a registered file entry degrades (warn + fallback); anything else is recorded and rethrown to the caller */
function failedEntry(a, e, load, err) {
  const t = load.task;
  e.promise = null;
  const degrade = e.named && !e.opts.build && !e.opts.critical;
  const fb = degrade ? (e.opts.fallback ?? (e.type === 'sound' ? 'silence' : e.type === 'font' ? 'the system font' : 'gray placeholder')) : null;
  a.engine.loading._fail(t, err, load.whole ? null : fb);   // whole: its caller says what the failure means, no stand-in is promised to the reader
  const msg = fmt(STRINGS.failed, { what: failureText(t) });
  const loop = degrade && e.opts.fallback ? fallbackCycle(a, e) : null;
  // A -> B -> A: each would wait for the other's fallback forever, so fail once and name the chain (the fix is in the manifest)
  if (loop) { e.load = null; throw codedError('asset-fallback-cycle', msg + fmt(STRINGS.cycle, { chain: loop.join(' -> ') })); }
  if (!degrade) { e.load = null; throw codedError('asset-load', msg); }
  e.fellBack = codedError('asset-load', msg);
  if (!load.whole) warnOnce(coded('asset-load', msg + fmt(STRINGS.fellBack, { fallback: e.opts.fallback ? `"${fb}"` : fb })));
  if (e.opts.fallback) return (e.promise = borrow(a, e, load, a._resolve(e.opts.fallback, e.type)));
  load.settled = true;
  load.value = e.value = e.type === 'model' ? shareModel(a, placeholder('model')) : placeholder(e.type);
  return (e.promise = Promise.resolve(e.value));
}

/** e falls back to `from`: until `from` answers, e's own failed load stays the token a release ends; then e reads from's load, which owns the data */
function borrow(a, e, load, from) {
  const ended = () => cancelled(load);
  return fetchEntry(a, from).then(v => {
    if (ended()) return again(a, e, load);
    if (from.load?.value !== v) { letGo(e); return fetchEntry(a, e); }   // released between its load finishing and this line
    e.load = from.load;
    return v;
  }, err => {
    if (ended()) return again(a, e, load);
    letGo(e);   // not kept as a rejected promise: the next use tries again
    throw err;
  });
}

/** This name reads nothing now; its next use loads again */
function letGo(e) { e.load = e.value = e.promise = e.fellBack = null; }
/** Every name reading this load, the owner and any that fell back to it, lets go of it */
function letGoAll(a, load) { for (const x of a.entries.values()) if (x.load === load) letGo(x); }

/** End a load still running. Its task goes too: nobody is waiting for that attempt, and a loading screen must not stay on it */
function cancelLoad(a, load) {
  load.stop.abort();
  a.engine.loading._drop(load.task);
}

/** Give back what one load made. A font that never reached document.fonts is a no-op here */
function freeValue(load, v) {
  if (!v) return;
  if (load.type === 'texture' && !load.gameOwned) v.dispose();   // a Texture the game registered is the game's: never disposed here
  if (load.type === 'font') document.fonts.delete(v);   // a released font stops matching its family
  if (load.type === 'model') {   // always { scene, ... }: generated() wraps a bare geometry too
    v.scene.traverse(o => {
      if (!o.geometry) return;
      o.geometry.dispose();
      [].concat(o.material).forEach(m => { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); });
    });
  }
}

/** Free an entry's GPU memory; while model copies are still in use it waits (releasePending) and the last engine.remove frees it. A load in flight ends here */
export function freeEntry(a, e) {
  const load = e.load;
  if (!load) return;
  if (load.owner !== e) { letGo(e); return; }   // fell back: the data is the other entry's, and this name only stops reading it
  if (!load.settled) { letGoAll(a, load); cancelLoad(a, load); return; }
  if (e.users > 0) { e.releasePending = true; return; }
  freeValue(load, load.value);
  letGoAll(a, load);
  e.releasePending = false;
}

/**
 * The name moves on from its current load (a palette write, a new registration, tuned params): an unfinished load ends, and finished data goes as soon as
 * nothing holds it. Only what is counted can be judged: copies and leases count and geometry() pins. A texture is handed out uncounted, so without a lease a material may still show it: it
 * is left to the game. Loads kept here wait in a._retired for their last copy, and for dispose
 */
export function retireEntry(a, e) {
  const load = e.load;
  if (!load) return;
  if (load.owner !== e) { letGo(e); return; }
  letGoAll(a, load);
  if (!load.settled) cancelLoad(a, load);
  else if (load.users > 0 || load.pinned) a._retired.add(load);
  else if (load.type === 'model') freeValue(load, load.value);
}

/**
 * The one count of who holds an entry's data: a model copy holds a lease (Assets._copy, ended by engine.remove), and assets.lease hands one to a module (content models). Why one count and not
 * a lease table beside the copies: release, trim and a retired build would then have two answers to "is anybody using this". The handle is idempotent, so a module may
 * end it itself and still have it tracked.
 * @returns {{ name: string, remove(): void }}
 */
export function takeLease(a, e, name = e.name) {
  const load = e.load, owner = load.owner;
  load.users++; e.users = (e.users || 0) + 1;
  if (owner !== e) owner.users = (owner.users || 0) + 1;
  e.releasePending = owner.releasePending = false;
  let held = true;
  return { name, remove() {
    if (!held) return;
    held = false;
    load.users--; e.users--;
    if (owner !== e) owner.users--;
    if (load.users <= 0 && !load.pinned && a._retired.delete(load)) freeValue(load, load.value);
    if (owner.users <= 0 && owner.releasePending) freeEntry(a, owner);
  } };
}

/** e just loaded: while long sounds are over the budget, the one asked for longest ago goes (never e itself) */
function capSounds(a, e) {
  const long = [...a.entries.values()].filter(longSound).sort((x, y) => (x.usedAt ?? 0) - (y.usedAt ?? 0));
  let bytes = long.reduce((n, x) => n + soundBytes(x.value), 0);
  for (const x of long) {
    if (bytes <= SOUND_BUDGET) break;
    if (x !== e) { bytes -= soundBytes(x.value); freeEntry(a, x); }
  }
}

/** Everything goes, copies or not, and no load finishing later may bring anything back (engine.dispose) */
export function disposeEntries(a) {
  a._disposed = true;
  for (const e of a.entries.values()) { e.users = 0; freeEntry(a, e); }
  for (const load of a._retired) freeValue(load, load.value);
  a._retired.clear();
}

/** Load the entries preload() wants and report progress; returns { loaded, failed, ok } (Assets.preload documents it) */
export async function preloadEntries(a, onProgress, onlyMarked) {
  // generators and fonts only when marked: a font pack may hold many faces, and only those ui.fonts names (or preload: true) are wanted
  const list = [...a.entries.entries()].filter(([, e]) => e.opts.build || e.type === 'font' ? e.opts.preload : !onlyMarked || e.opts.preload);
  let done = 0;
  onProgress?.(list.length ? 0 : 1, '');
  // critical failures are reported by start(); others not already warned about (generated models) are warned here
  await Promise.all(list.map(([name, e]) => fetchEntry(a, e).catch(err => { if (!e.opts.critical) warnOnce(err.message); }).finally(() => {
    done++;
    onProgress?.(done / list.length, name);
  })));
  const failed = list.filter(([name, e]) => a.engine.loading.get(name, e.type)?.phase === 'failed').map(([name]) => name);
  return { loaded: list.length - failed.length, failed, ok: !failed.length };
}
