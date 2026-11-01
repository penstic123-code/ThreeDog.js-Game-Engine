// World record mutations (add / rest / orphans / set / remove): the bodies behind the World methods of the same names. World.js keeps the public
// JSDoc and signatures; these functions take the world as `w` and reach its internals the same way sim.js / views.js / persist.js do.
import { DEV, checkOptionsArg, fmt } from '../../core/validate.js';
import { checkPlain } from './persist.js';
import { putPos, centerOf } from './pos.js';
import { claimId } from '../../core/things.js';

export const STRINGS = {
  noKind: 'world.add() needs a kind (what sort of thing this is), e.g. world.add({ kind: "crate", position: [0, 0, 0] })',
  dupId: 'world.add(): id "{id}" already exists. Omit id to auto-number; to change an existing record use world.set("{id}", { … })',
  initialId: 'world.add(def, { initial: true }) needs a stable id (saves match content by id), e.g. world.add({ id: "chest_1", kind: "{kind}", … }, { initial: true })',
  noId: 'world.{fn}(): no record with id "{id}" (world.query({ kind }) lists what exists)',
  setKey: 'world.set("{id}", patch): patch must not contain id / kind (they are the identity of the record). To change the kind, remove then add',
};

export function addRecord(w, def, opts) {
  DEV && w.engine.ops.guard('world.add');
  if (!def?.kind) throw new Error(STRINGS.noKind);
  if (DEV) { checkOptionsArg('world.add(def, opts)', opts, ['initial', 'save']); checkPlain({ ...def, position: undefined }, def.kind); }
  const { id: given, kind, position, ...rest } = def, initial = !!opts?.initial;
  if (initial && given == null) throw new Error(fmt(STRINGS.initialId, { kind }));
  const id = given ?? `${kind}#${++w._seq}`, have = w.records.get(id), p = { x: 0, y: 0, z: 0 };
  if (position) putPos('world.add()', position, p);
  const rec = { id, kind, position: p, ...rest };
  if (initial) {
    if (!w._base.has(id)) w._base.set(id, structuredClone(rec));
    if (have) return have;
    claimId(w.engine, id);
    if (w._removed.has(id)) return null;
    return w._insert(w._fromBase(id, w._base.get(id)), true);
  }
  if (have) throw new Error(fmt(STRINGS.dupId, { id }));
  claimId(w.engine, id);
  if (opts?.save === false) w._unsaved.add(id);
  if (DEV) w._origin.set(id, { spawned: { op: w.engine.ops.running, tick: w.engine.tick } });   // who made it (inspect / pick)
  return w._insert(rec, true);
}

export function restRecord(w, id, position, tolerance) {
  const rec = w.records.get(id), base = w._base.get(id); if (!rec) return;
  const a = rec.position, b = base?.position;
  const same = !!b && Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.z - b.z) <= tolerance;
  putPos(`world.rest("${id}")`, position, rec.position); w._index(rec);
  if (same) base.position = { ...rec.position };
}

export function orphanIds(w) {
  const out = [], known = id => w._base.has(id) || w.records.has(id);
  const due = id => { const i = id.indexOf('/'); return i < 0 || w._levels.has(id.slice(0, i)); };
  for (const id of w._pending.keys()) if (!known(id) && due(id)) out.push(id);
  for (const id of w._removed) if (!known(id) && !w._base.has(id) && due(id)) out.push(id);
  return out;
}

export function setRecord(w, id, patch) {
  DEV && w.engine.ops.guard('world.set');
  const rec = w._need(id, 'set');
  if (DEV) { if ('id' in patch || 'kind' in patch) throw new Error(fmt(STRINGS.setKey, { id })); checkPlain({ ...patch, position: undefined }, id); }
  const { position, ...rest } = patch;
  Object.assign(rec, rest);
  if (position) w.move(id, position);
  if (w._v.presenters.get(rec.kind)?.show) w._v.dirty = true;
  w.engine.events.emit('world:change', { id, kind: rec.kind, keys: Object.keys(patch) });
  return rec;
}

export function removeRecord(w, id) {
  DEV && w.engine.ops.guard('world.remove');
  const rec = w.records.get(id); if (!rec) return;
  w._v.unview(id);
  w._cells.delete(rec);
  w.records.delete(id);
  w._s.removed(id);
  w._unsaved.delete(id);
  if (w._base.has(id)) w._removed.add(id); else w._origin.delete(id);
  w.engine.events.emit('world:remove', { id, kind: rec.kind });
}

export function queryRecords(w, opts) {
  const { kind, near, radius = 30, where, zone } = opts, out = [];
  const ok = r => (!kind || r.kind === kind) && (zone === undefined || (r.zone ?? null) === zone) && (!where || where(r));
  if (near) {
    w._cells.forEach(centerOf(near), radius, (r, d2) => { if (ok(r)) out.push([d2, r]); });
    return out.sort((a, b) => a[0] - b[0]).map(a => a[1]);
  }
  if (!kind) return [...w.records.values()].filter(ok);
  for (const e of w._s.kinds.get(kind)?.set ?? []) if (ok(e.rec)) out.push(e.rec);   // table grouped by kind: no full scan
  return out;
}
