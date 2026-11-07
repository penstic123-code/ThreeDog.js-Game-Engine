// What the world module tells core about its records: engine._things.addSource(...) at install. Core knows only this shape (has / get / set / refuses / refusesUndo / remove /
// explain, plus idOf / view / ids / restore for the model link and undo), never the World class, so engine.thing, thing.set and the shared id space
// work the same whether or not this module is installed.
import { fmt } from '../../core/base/validate.js';

const SAY = {
  defined: 'defined in {at}: edit it there to change the level for good (ops change only this session), or: threedog content set {id} <field> <json>',
  node: 'level {level} node {node}: change it in the level model',
  spawned: 'made during play{op}: not in content, saved whole',
};
const NOT_FIELDS = new Set(['id', 'kind', 'position', 'zone', 'floor', 'offsetY']);

/** The record as a thing to change: id, kind, template, where it was authored (definedAt / level node / spawned by which op), model and its fields */
function describeRecord(w, id) {
  const rec = w.get(id); if (!rec) return null;
  const o = w.origin(id) ?? {}, fields = {};
  for (const k in rec) if (!NOT_FIELDS.has(k)) fields[k] = rec[k];
  const how = o.definedAt ? fmt(SAY.defined, { at: o.definedAt, id }) : o.node ? fmt(SAY.node, { level: o.level, node: o.node })
    : o.spawned ? fmt(SAY.spawned, { op: o.spawned.op ? ` by op ${o.spawned.op} at tick ${o.spawned.tick}` : '' }) : null;
  return { id, kind: rec.kind, template: o.template ?? null, definedAt: o.definedAt ?? null, ...(o.templateAt && { templateAt: o.templateAt }),
    ...(o.node && { level: o.level, node: o.node }), ...(o.spawned && { spawned: o.spawned }), model: o.model ?? rec.model ?? null,
    position: { ...rec.position }, fields, edit: how };
}

/** @param {any} w the World @returns the record source for engine._things.addSource @internal */
export function recordSource(w) {
  return {
    name: 'world',
    has: id => !!w.get(id),
    get: id => w.get(id),
    ids: () => w.query({}).map(r => r.id),
    idOf: obj => w.idOf(obj),
    view: id => w.view(id),
    explain: id => describeRecord(w, id),
    /** Why its owner cannot apply this change, or null: thing.set answers with it in can, because a throw inside an op freezes gameplay */
    refuses: (id, patch) => w.engine.control?.characterOf(id)?.poseProblem(patch) ?? null,
    /** The same for an undo: a placement that ended a ride goes back to that seat, which may be gone or taken by now */
    refusesUndo(id, before) {
      if (!before.ride) return null;
      const ch = w.engine.control?.characterOf(id);
      return ch ? ch.seatProblem(before.ride) : `'${id}' has no model now, so nothing can sit in that seat`;
    },
    /** Change a record (position / rot / scale); returns the values it replaced (set(id, thatValue) is the undo) */
    set(id, patch) {
      // rot / scale are the template instance fields (templates.js); a record without them reads as rot 0, scale 1, and a live character's turn is its facing.
      // Only what the patch writes: the undo of a turn must not place a rider who rode on since
      const rec = w.get(id), live = w.engine.control?.characterOf(id);
      if (patch.ride) { const { position, ...rest } = patch; w.set(id, rest); live.backInSeat(patch.ride); w.move(id, live.root.position); return null; }   // the undo of a placement that ended a ride
      const before = { ...(patch.position && { position: { ...rec.position } }), ...(patch.rot != null && { rot: live ? live.facing : rec.rot ?? 0 }), ...(patch.scale != null && { scale: rec.scale ?? 1 }) };
      // not enumerable: the op's value stays plain, and a vehicle is no record field. The undo reads it back from this object
      if (patch.position && live?.vehicle) Object.defineProperty(before, 'ride', { value: { vehicle: live.vehicle, seat: live.seat } });
      w.set(id, patch);
      return before;
    },
    /** Remove a record; returns what restore needs */
    remove(id) { const rec = structuredClone(w.get(id)), authored = w.authored(id); w.remove(id); return { rec, authored }; },
    restore: ({ rec, authored }) => w.restore(rec, authored),
  };
}
