// Asset hot swap (dev): an edited generator (art/tree.js, a function in assets.js), a file model whose path changed or a generator's params tuned
// in the dev panel is built again and every live copy changes in place: content props and template instances, pickups, vegetation instances,
// assets.model() copies (characters included). The page does not reload, so the player, the clock and world state stay as they were.
// Why in place, not "remove and place again": game code, colliders, interactions and things hold the copy objects; only their meshes' geometry
// and material are replaced (the same objects stay in the scene). Why not a page reload: an art iteration loop of one save -> one look needs the
// same camera, time of day and weather every time.
// The vite preset (tools/vite/vite-threedog-live.js) makes the game's assets.js accept its own updates and calls engine.debug.reloadAssets(packs)
// with the new module; a test or a tool can call it directly. Plain Vite + three.js equivalent: import.meta.hot.accept on the module that builds
// the meshes, then mesh.geometry = newGeometry on each copy you kept.
// Limits (said in the report): a copy's collision box keeps the size it was placed with until the next load; an InstancedMesh or a merged batch
// the game built itself from a geometry is not found (only engine paths are).
import { registerManifest, paramValues } from './assetManifest.js';
import { protoCaches, protoOf, cachedModel, list } from './namedModel.js';
import { reportError } from './errors.js';
import { codedError } from './errorHints.js';
import { note } from './validate.js';

// a failed rebuild is reported (soft: the old copies stay on screen) and the swap goes on with the other names
const failWith = e => (err, what) => reportError(e, err, `asset hot swap: ${what}`, { soft: true });
const meshesOf = o => { const out = []; o?.traverse?.(x => { if (x.isMesh || x.isPoints || x.isLine) out.push(x); }); return out; };
/** cached entries are keyed 'cached:<name>:<params>:<palette>:<source hash>'; without the hash, the same build of a new source pairs with the old */
const unhashed = k => k.slice(0, k.lastIndexOf(':'));
const LAST = 10;   // swaps kept for describe().assetSwaps

/**
 * The swap: old model values of `names` (asset entries already replaced by the caller, cached builds and prototypes) are built again and paired
 * with the new ones mesh by mesh; every scene mesh using an old geometry / material gets the new one.
 * @param {any} e @param {{ name: string, type: string, old: any }[]} changed @param {string} why for the report ('edit', 'params')
 */
export async function swapModels(e, changed, why = 'edit') {
  const t0 = performance.now(), a = e.assets, fail = failWith(e);   // measure
  const names = new Set(changed.filter(c => c.type === 'model').map(c => c.name));
  const geo = new Map(), mat = new Map(), tex = new Map(), protoNew = new Map(), structure = new Set(), copies = {};
  const pair = (from, to, name) => {
    if (!from || !to) return;
    if (from.isBufferGeometry || to.isBufferGeometry) {
      const g0 = from.isBufferGeometry ? from : meshesOf(from)[0]?.geometry, g1 = to.isBufferGeometry ? to : meshesOf(to)[0]?.geometry;
      if (g0 && g1 && g0 !== g1) geo.set(g0, { to: g1, name });
      if (!from.isBufferGeometry || !to.isBufferGeometry) pairMeshes([from.isBufferGeometry ? null : from], [to.isBufferGeometry ? null : to], name);
      return;
    }
    const m0 = meshesOf(from), m1 = meshesOf(to);
    if (m0.length !== m1.length) structure.add(name);
    pairMeshes(m0, m1, name);
  };
  const pairMeshes = (m0, m1, name) => m0.forEach((m, i) => {
    const n = m1[i]; if (!m || !n) return;
    if (m.geometry !== n.geometry) geo.set(m.geometry, { to: n.geometry, name });
    const a0 = list(m.material), a1 = list(n.material);
    a0.forEach((x, j) => { const y = a1[j] ?? a1[0]; if (x && y && x !== y) mat.set(x, { to: y, name }); });
  });

  // 1. named entries (assets.model copies) and textures: the caller replaced the entry; load the new one if the old was in use
  for (const { name, type, old } of changed) {
    if (!old?.value) continue;
    const neu = await a._fetch(a.entries.get(name)).catch(err => { fail(err, `${type} "${name}"`); return null; });
    if (type === 'texture' && neu?.isTexture) tex.set(old.value, { to: neu, name });
    if (type === 'model' && neu) pair(old.value.scene, neu.scene, name);
  }
  // 2. cached builds (what content, pickups and vegetation got): drop them, build every name + params asked for so far again
  const oldCached = new Map();
  for (const [k, ent] of [...a.entries]) {
    const n = k.startsWith('cached:') ? k.slice(7, k.indexOf(':', 7)) : null;
    if (n == null || !names.has(n)) continue;
    if (ent.value) oldCached.set(unhashed(k), ent.value);
    a.entries.delete(k);
  }
  for (const n of names) a._cachedSrc?.delete(n);   // a new source under the same name is not a name clash
  for (const n of names) for (const m of a._made?.get(n)?.values() ?? []) {
    try { await cachedModel(e, m); } catch (err) { fail(err, `model ${JSON.stringify(m)}`); }
  }
  for (const [k, ent] of a.entries) if (k.startsWith('cached:') && ent.value && oldCached.has(unhashed(k))) {
    const o = oldCached.get(unhashed(k)), name = k.slice(7, k.indexOf(':', 7));
    pair(o.geometry ?? o.scene, ent.value.geometry ?? ent.value.scene, name);
  }
  // 3. prototypes (content props / templates, pickups): a new prototype per old one; copies point at it from now on
  for (const { api, cache } of protoCaches(e)) for (const [key, p] of [...cache]) {
    const model = JSON.parse(key), name = list(model)[0];
    if (!names.has(name)) continue;
    const old = await p.catch(() => null);
    cache.delete(key);
    const neu = await protoOf(e, api, model).catch(err => { fail(err, `model "${name}"`); return null; });
    if (!old || !neu) continue;
    protoNew.set(old, neu);
    pair(old.obj, neu.obj, name);
  }

  // 4. the scene: batches dissolve first (their InstancedMeshes hold copies of the old geometry) and form again after
  const b = e.batching, batched = !!b?.enabled;
  if (batched) b.enabled = false;
  const count = n => { copies[n] = (copies[n] || 0) + 1; };
  const oldGeo = new Set(geo.keys());
  e.scene.traverse(o => {
    const ud = o.userData;
    if (ud?.proto && protoNew.has(ud.proto)) ud.proto = protoNew.get(ud.proto);   // content copies: later aligns read the new size
    // a model whose part count changed: the copy root stays (code holds it), its parts from the old prototype are replaced by the new ones
    if (ud?.modelKey && structure.has(list(JSON.parse(ud.modelKey))[0]) && !o.isMesh) {
      const neu = [...protoNew.values()].find(p => p.obj.userData.modelKey === ud.modelKey);
      if (neu) {
        for (const c of [...o.children]) if (meshesOf(c).some(m => oldGeo.has(m.geometry))) o.remove(c);
        for (const c of [...neu.obj.clone().children]) { o.add(c); count(list(JSON.parse(ud.modelKey))[0]); }   // a copy: add() takes c out of the live list
      }
    }
  });
  const seenMat = new Set();
  e.scene.traverse(o => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const g = geo.get(o.geometry);
    if (g) { o.geometry = g.to; count(g.name); }
    if (Array.isArray(o.material)) o.material = o.material.map(m => mat.get(m)?.to ?? m);
    else if (mat.has(o.material)) { const m = mat.get(o.material); o.material = m.to; if (!g) count(m.name); }
    if (tex.size) for (const m of list(o.material)) {
      if (!m || seenMat.has(m)) continue;
      seenMat.add(m);
      for (const k of Object.keys(m)) { const t = tex.get(m[k]); if (t) { m[k] = t.to; m.needsUpdate = true; count(t.name); } }
    }
  });
  // 5. module hooks: vegetation rebuilds its species from the new models (its materials are patched copies, not found above)
  for (const fn of a._swapHooks ?? []) {
    try { const r = await fn({ names, geometry: geo, material: mat }); for (const [n, k] of Object.entries(r ?? {})) copies[n] = (copies[n] || 0) + k; }
    catch (err) { fail(err, "a module's own copies"); }
  }
  if (batched) b.enabled = true;

  const report = {
    why, names: [...new Set(changed.map(c => c.name))], copies, ms: Math.round(performance.now() - t0),   // measure
    ...(structure.size && { partsChanged: [...structure] }),
    note: 'collision boxes keep the size they were placed with until the next load',
  };
  remember(e, report);
  return report;
}

/** Keep the last swaps for describe().assetSwaps, say it in the console and as a toast (dev aid: the AI and the person both see it) */
function remember(e, r) {
  const a = e.assets;
  if (!a._swaps) {
    a._swaps = [];
    e.describe?.add?.('assetSwaps', () => a._swaps.slice(-3));
  }
  a._swaps.push({ ...r, at: e.clock?.now ?? null });
  if (a._swaps.length > LAST) a._swaps.shift();
  const n = Object.values(r.copies).reduce((s, x) => s + x, 0);
  const text = `asset hot swap (${r.why}): ${r.names.join(', ')} -> ${n} mesh(es) in ${r.ms} ms${r.partsChanged ? ` (parts changed: ${r.partsChanged.join(', ')})` : ''}`;
  note(text);
  try { e.ui?.get?.('toast')?.show({ text, kind: 'info', ms: 1800 }); } catch { /* the toast part may be off */ }
}

/**
 * engine.debug.reloadAssets(packs): register the packs again (the new module of the game's assets.js) and swap what changed. Entries whose
 * build function, url and params are the very objects already registered keep their loaded value: an edited art module re-runs only the modules that
 * import it, so only its generators are new functions.
 * @param {any} e @param {any} packs
 */
export async function reloadAssets(e, packs) {
  const hot = { changed: [] };
  registerManifest(e.assets, packs, hot);
  if (!hot.changed.length) return { why: 'edit', names: [], copies: {}, ms: 0 };
  return swapModels(e, hot.changed, 'edit');
}

/**
 * engine.assets.setParams(name, values): tuned params of a generator (dev panel); the entry keeps them (defaults < tuned < a call's own values)
 * and every copy is built again.
 * @param {any} e @param {string} name @param {Record<string, any>} values
 */
export async function setParams(e, name, values) {
  const ent = e.assets.entries.get(name);
  if (!ent?.schema) throw codedError('asset-misuse', `assets.setParams('${name}'): ${ent ? 'this model declares no params schema ({ build, params: { height: { type: \'number\', default: 2 } } })' : 'no model of that name'}`);
  paramValues(ent, values);   // a typo or a wrong type throws here, before anything is rebuilt
  const old = { ...ent };
  ent.tuned = { ...ent.tuned, ...values };
  e.assets._retire(ent);
  return swapModels(e, [{ name, type: 'model', old }], 'params');
}

