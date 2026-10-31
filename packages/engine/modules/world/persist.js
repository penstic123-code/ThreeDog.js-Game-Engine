// World saves and initial records. Rules (independent of the order of content.load):
//   Things written in content (props, pickups, NPCs…) are initial records: add(def, { initial: true }), which needs a stable id.
//   A save only keeps "which fields changed" and "which were removed" (tombstones) for them; runtime-created ones (a tree the player planted, a spawned monster) are saved whole.
//   Load: runtime records are replaced wholesale by the save's; initial records first go back to their original content, then the save's changes are applied; records removed in the save do not reappear.
//   Orphans: a change or removal in the save whose id the content no longer produces (renamed / deleted entry) is kept in _pending / _removed and
//   written back by the next save, never dropped, so reverting the content change gets the player's data back; dev warns once (world.orphans()).
//   Loading before content is loaded works too: changes and removals are remembered and applied / skipped when content is added. Things newly added to content after a game update still show up with an old save.
//   Temporary things (data for effects, one-off spawns): add(def, { save: false }) — not saved, cleared on load.
//   Changes are found by comparing JSON against the original content, not by events: fields changed directly inside simulate are saved too.
// Save format (part 'world', version 3): every record is keyed by its stable id, and only what play changed is stored:
//   { seq, step, time, records: { id: whole runtime record without id }, changed: { id: { set?: changed fields, del?: [removed fields] } },
//     removed: [ids of removed initial records], owed: { id: simulation seconds owed, only for kinds simulated with far } }
//   Version 1 kept records as an array: migrate step 1 (WORLD_MIGRATE) turns it into the id-keyed object.
//   Version 2 numbered runtime records `<kind>-<n>`; version 3 uses `<kind>#<n>`, so a runtime id can never equal an authored one (authored ids may not
//   contain `#`, content/ids.js). Step 2 renames them (legacyRuntimeIds says which), and the containers part follows with the same map (a template
//   instance's container is keyed by the record id).
//   Removed fields are recorded separately (not saved as null): after loading it is "no such field", same as in a live run; a field that was null stays null.
//   step / time are the simulation step count and accumulated seconds: far simulation takes turns by step-count buckets, so one save advances the same way every time (see sim.js).

import { legacyRuntimeIds, renameIdKeys, renameIdValues } from '../../core/saveIds.js';

const PLAIN_STRINGS = {
  msg: 'world data must be plain values (number, string, boolean, array, plain object): {path} is {what}. Put models in world.present() and logic in world.simulate()',
  fn: 'a function', obj: 'a three.js object', asset: 'a three.js asset', dom: 'a DOM element',
};
/** Dev-time check: data must not contain three.js objects, functions or DOM elements (saves can only store plain values) @internal */
export function checkPlain(v, path, depth = 0) {
  const fail = what => { throw new Error(PLAIN_STRINGS.msg.replace('{path}', path).replace('{what}', what)); };
  if (v == null || typeof v !== 'object') { if (typeof v === 'function') fail(PLAIN_STRINGS.fn); return; }
  const what = v.isObject3D ? PLAIN_STRINGS.obj : v.isMaterial || v.isBufferGeometry || v.isTexture ? PLAIN_STRINGS.asset : typeof Element !== 'undefined' && v instanceof Element ? PLAIN_STRINGS.dom : null;
  if (what) fail(what);
  if (depth > 6) return;
  for (const k in v) checkPlain(v[k], `${path}.${k}`, depth + 1);
}

/** Compare an initial record with its original: which top-level fields changed, which were removed (null if neither) */
function diff(rec, base) {
  let set = null, del = null;
  for (const k in rec) {
    if (rec[k] === undefined) { if (k in base) (del ||= []).push(k); continue; }   // set to undefined = removed
    if (JSON.stringify(rec[k]) !== JSON.stringify(base[k])) (set ||= {})[k] = rec[k];
  }
  for (const k in base) if (!(k in rec)) (del ||= []).push(k);
  return set || del ? { set: set ?? undefined, del: del ?? undefined } : null;
}

/** Upgrade steps of the world save part (saves.register version 3) @internal */
export const WORLD_MIGRATE = {
  1: d => ({ ...d, records: Object.fromEntries((d?.records || []).map(({ id, ...r }) => [id, r])) }),   // array of records -> keyed by id
  2: d => {   // runtime ids `<kind>-<n>` -> `<kind>#<n>`: record keys, owed keys, and field values that name a renamed record
    const map = legacyRuntimeIds(d);
    if (!map.size) return d;
    return { ...d, records: renameIdValues(renameIdKeys(d.records, map), map), changed: renameIdValues(d.changed, map), owed: renameIdKeys(d.owed, map) };
  },
};



/** @param {import('./World.js').World} w @internal */
export function saveWorld(w) {
  const records = {}, changed = {};
  for (const rec of w.records.values()) {
    if (w._unsaved.has(rec.id)) continue;
    const base = w._base.get(rec.id);
    if (!base) { const { id, ...r } = rec; records[id] = r; continue; }
    const d = diff(rec, base);
    if (d) changed[rec.id] = d;
  }
  for (const [id, d] of w._pending) changed[id] = d;   // from a save, content not loaded yet this time (e.g. another level): keep as is
  return { seq: w._seq, ...w._s.toJSON(), records, changed, removed: [...w._removed] };
}

/** Load: replace runtime records wholesale; loaded initial records go back to the original then get the save's changes; unloaded content waits for its add. Independent of the order of content.load @internal */
export function loadWorld(w, d) {
  w._v.clear();
  w.records.clear(); w._cells.clear(); w._unsaved.clear();
  for (const id of [...w._origin.keys()]) if (!w._base.has(id)) w._origin.delete(id);   // runtime records come from the save now (no op to name)
  w._seq = d?.seq ?? 0;
  w._removed = new Set(d?.removed);
  w._pending = new Map(Object.entries(d?.changed || {}));
  w._s.fromJSON(d);
  renamePending(w);   // content/renames.js, before initial records take their diffs
  for (const [id, base] of w._base) if (!w._removed.has(id)) w._insert(w._fromBase(id, base));
  for (const [id, r] of Object.entries(d?.records || {})) w._insert({ id, ...r });
  w.engine.events.emit('world:load', { count: w.records.size });
}

/**
 * Apply content/renames.js to the save data waiting for content: changed fields (_pending), removals (_removed) and owed simulation time move from the old
 * id to the new one; a null target drops them (deleted on purpose, so they are no orphans). Skipped, and returned as 'old (why)', when the old id is still
 * authored (the rename would steal its data) or the new id already has saved data (two saves' worth of state cannot merge): those stay orphans. @internal
 * @param {import('./World.js').World} w
 * @returns {string[]}
 */
export function renamePending(w) {
  const stuck = [], owed = w._s.owed;
  for (const [a, b] of w._renames) {
    const has = w._pending.has(a) || w._removed.has(a) || owed.has(a);
    if (!has) continue;
    if (w._base.has(a)) { stuck.push(`${a} (still defined by content)`); continue; }
    if (b != null && (w._pending.has(b) || w._removed.has(b) || owed.has(b))) { stuck.push(`${a} (${b} already has saved changes)`); continue; }
    if (w._pending.has(a)) { if (b != null) w._pending.set(b, w._pending.get(a)); w._pending.delete(a); }
    if (w._removed.delete(a) && b != null) w._removed.add(b);
    if (owed.has(a)) { if (b != null) owed.set(b, owed.get(a)); owed.delete(a); }
  }
  return stuck;
}
