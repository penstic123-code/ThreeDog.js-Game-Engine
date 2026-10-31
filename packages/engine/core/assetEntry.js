// The life of one engine.assets entry, split from Assets.js (which keeps the public API and the manifest):
//   load: fetchEntry runs the load as a task in engine.loading and, for a registered non-critical file that fails, falls back (gray placeholder / silence / the entry's fallback)
//   free: freeEntry gives the GPU memory back, deferred while model copies are still in the scene; shareModel marks what copies share so engine.remove does not dispose it
// Plain functions that take the Assets instance, so they stay out of the class's public surface.
import { warnOnce, fmt } from './validate.js';
import { codedError, coded } from './errorHints.js';
import { loadGltf, loadTexture, loadFont, generated, placeholder, LoadError } from './assetLoad.js';
import { failureText } from './Loading.js';

const STRINGS = {
  failed: 'Asset failed to load: {what}',
  fellBack: '; using {fallback} instead, the game continues (mark it critical: true if the game cannot start without it)',
  missingRefs: 'Asset loaded with missing references: {what} (missing {list}); materials show without those files',
};

/** Mark a model template's geometry and materials as shared (copies share them; engine.remove must not dispose them) */
function shareModel(a, g) {
  g.scene.traverse(o => { if (o.geometry) a.shared.add(o.geometry); for (const m of [].concat(o.material || [])) a.shared.add(m); });
  return g;
}

/** Load an entry as a task in engine.loading; a registered, non-critical file that fails resolves to its fallback */
export function fetchEntry(a, e) {
  if (e.promise) return e.promise;
  const L = a.engine.loading, name = e.variantOf ?? e.name ?? e.url;
  const t = L._begin(name, e.type, { critical: e.opts.critical === true, url: e.opts.build ? null : e.url, manifest: e.manifest ?? null });
  if (e.type === 'model') {
    const load = e.opts.build ? (t.phase('build'), generated(a, e.url, e.opts.build, e.opts.params, t)) : loadGltf(a, e.url, t);
    e.promise = load.then(g => shareModel(a, g));
  } else if (e.type === 'texture') e.promise = loadTexture(a, e, t);
  else if (e.type === 'font') e.promise = loadFont(a, e, t);
  else if (e.type === 'sound') {
    t.phase('download');
    e.promise = a.engine.audio.load(e.url).catch(err => { throw new LoadError(err.message, { url: e.url }); });
  }
  e.promise = e.promise.then(v => {
    L._done(t);
    const what = `${e.type} "${name}" <- ${e.url}`;
    if (t.missing.length) warnOnce(coded('asset-missing-ref', fmt(STRINGS.missingRefs, { what, list: t.missing.join(', ') })));
    return (e.value = v);
  }, err => failedEntry(a, e, t, err));
  return e.promise;
}

/** A load failed: a registered file entry degrades (warn + fallback); anything else is recorded and rethrown to the caller */
function failedEntry(a, e, t, err) {
  e.promise = null;
  const degrade = e.named && !e.opts.build && !e.opts.critical;
  const fb = degrade ? (e.opts.fallback ?? (e.type === 'sound' ? 'silence' : e.type === 'font' ? 'the system font' : 'gray placeholder')) : null;
  a.engine.loading._fail(t, err, fb);
  const msg = fmt(STRINGS.failed, { what: failureText(t) });
  if (!degrade) throw codedError('asset-load', msg);
  warnOnce(coded('asset-load', msg + fmt(STRINGS.fellBack, { fallback: e.opts.fallback ? `"${fb}"` : fb })));
  if (e.opts.fallback) return (e.promise = fetchEntry(a, a._resolve(e.opts.fallback, e.type)));   // e.value stays null: the fallback entry owns the memory
  e.value = e.type === 'model' ? shareModel(a, placeholder('model')) : placeholder(e.type);
  return (e.promise = Promise.resolve(e.value));
}

/** Free an entry's GPU memory; while model copies are still in use it waits (releasePending) and the last engine.remove frees it */
export function freeEntry(e) {
  if (!e.value) return;
  if (e.users > 0) { e.releasePending = true; return; }
  if (e.type === 'texture') e.value.dispose();
  if (e.type === 'font') document.fonts.delete(e.value);   // a released font stops matching its family
  if (e.value.isBufferGeometry) e.value.dispose();   // code-generated geometry
  else if (e.type === 'model') {
    (e.value.scene ?? e.value).traverse?.(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      [].concat(o.material).forEach(m => { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); });
    });
  }
  e.value = null; e.promise = null; e.releasePending = e.pinned = false;
}

/** Load the entries preload() wants and report progress; returns { loaded, failed, ok } (Assets.preload documents it) */
export async function preloadEntries(a, onProgress, onlyMarked) {
  // generators and fonts only when marked: a font pack may hold many faces, and only those style.ui.fonts names (or preload: true) are wanted
  const list = [...a.entries.entries()].filter(([, e]) => e.opts.build || e.type === 'font' ? e.opts.preload : !onlyMarked || e.opts.preload);
  let done = 0;
  onProgress?.(list.length ? 0 : 1, '');
  // critical failures are reported by start(); others not already warned about (generated models) are warned here
  await Promise.all(list.map(([name, e]) => fetchEntry(a, e).catch(err => { if (!e.opts.critical) console.warn(err.message); }).finally(() => {
    done++;
    onProgress?.(done / list.length, name);
  })));
  const failed = list.filter(([name, e]) => a.engine.loading.get(name, e.type)?.phase === 'failed').map(([name]) => name);
  return { loaded: list.length - failed.length, failed, ok: !failed.length };
}
