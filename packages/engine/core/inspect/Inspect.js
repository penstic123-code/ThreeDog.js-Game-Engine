// engine.inspect / engine.explain: questions an AI asks while debugging, answered from the ops registry and describe().
//   engine.inspect()               what is around the player and what the player can do now (each op offer checked with can)
//   engine.inspect('npc_3')        the same for another actor (world record id): "why did this enemy not attack?"
//   engine.inspect([x, z])         things around a spot, ops as the player
//   engine.explain({ op: 'shop.buy', args })   why an op can / cannot run now (text: reason + fix first; detail: its last attempt and the events around it)
//   engine.explain({ picture: 'fog.far' })    which line last changed a picture value (core/inspect/pictureWriters.js); a value not tracked says so
//   engine.explain({ quest: 'first-light' })  any other key is answered by the module whose definition has explain: { quest(e, id) {...} }
//   engine.pick(x, y).thing        point -> thing: the world record a ray hit belongs to, else the engine.add object (thingOf; engine.thing is the same lookup)
// Built on ops because a failed op already carries its reason; explain turns that into a sentence instead of making the AI read can().
import { Vector3 } from 'three';
import { closest } from '../base/validate.js';
import { codedError } from '../base/errorHints.js';
import { findThing, hintThing } from '../scene/thingOps.js';
import { atomicNote } from '../ops/opsAtomic.js';
import { NO_WRITERS } from './describeRender.js';
import { r1 } from '../base/math.js';

const OPS_MAX = 8;

/** Where an actor stands: the player, or a world record */
function placeOf(e, actor) {
  if (actor === 'player') return e.player?.position ?? e.focus;
  return e._things.source(actor)?.get(actor).position ?? e._things.live(actor)?.getWorldPosition(new Vector3()) ?? null;   // a record, else an engine.add object
}
const note = (e, op, reason) => e.ops.defs.get(op)?.reasons?.[reason];

/**
 * @param {any} e
 * @param {string | { x: number, z: number } | number[]} [at] actor id (world record) or a spot; default the player
 * @param {{ radius?: number }} [opts]
 */
export function inspect(e, at, { radius = 10 } = {}) {
  const actor = typeof at === 'string' ? at : 'player';
  const p = typeof at === 'string' ? placeOf(e, at) : Array.isArray(at) ? { x: at[0], z: at[at.length - 1] } : at ?? placeOf(e, 'player');
  if (!p) throw codedError('world-record', `engine.inspect('${at}'): no world record or engine.add object with this id${hintThing(e, at)}. Pass an id engine.thing knows, [x, z] or nothing for the player`);
  const near = e.describe({ radius, center: { x: p.x, z: p.z }, only: ['nearby'] }).nearby;
  const ops = e.ops.list({ available: true, actor }).sort((a, b) => b.ok - a.ok).slice(0, OPS_MAX)
    .map(o => ({ op: o.name, args: o.args, ok: o.ok, ...(o.ok ? {} : { code: o.code, why: note(e, o.name, o.code) ?? null, facts: o.facts, nextActions: o.nextActions }) }));
  const thing = typeof at === 'string' && at !== 'player' ? findThing(e, at) : null;
  return { actor, at: { x: r1(p.x), z: r1(p.z) }, near, ops, ...(thing && { thing }) };
}

/**
 * Point -> thing: what a ray hit is. A hit on a batched instance resolves to its original object first (engine.batching.item).
 * Returns the record's thing (a source's explain), else the engine.add object's (engine.thing), plus the mesh and material names; for an object neither knows
 * (not in the scene, or an engine module's internal mesh) id is null and only those are known.
 * @param {any} e @param {any} obj the hit object @param {{ instanceId?: number }} [hit] @internal
 */
export function thingOf(e, obj, hit) {
  if (obj?.isInstancedMesh && hit?.instanceId != null) obj = e.batching.item(obj, hit.instanceId) ?? obj;
  const t = findThing(e, obj), mat = Array.isArray(obj?.material) ? obj.material[0] : obj?.material;
  const seen = { mesh: obj?.name || null, material: mat?.name || null };
  return t ? Object.assign(t, seen) : { id: null, kind: null, template: null, definedAt: null, model: null, fields: {}, edit: null, ...seen };
}

/**
 * @param {any} e
 * @param {Record<string, any>} q
 */
export function explain(e, q) {
  if (q?.op) return explainOp(e, q);
  if (q?.picture) return e._picture?.why(String(q.picture)) ?? { ok: false, text: `${q.picture}: ${NO_WRITERS}`, detail: null };
  const key = Object.keys(q || {})[0];
  for (const m of e.modules.values()) if (m.explain?.[key]) return m.explain[key](e, q[key], q);
  const keys = ['op', 'picture', ...[...e.modules.values()].flatMap(m => Object.keys(m.explain || {}))];
  throw codedError('unknown-name', `engine.explain({ ${key}: ... }): nothing explains '${key}'${closest(key, keys) ? ` (did you mean '${closest(key, keys)}'?)` : ''}. Keys: ${keys.join(', ')} (a module adds one with explain: { ${key}(e, value) { return { ok, text } } })`);
}

/** Can this op run now (text: the reason and the op's note on how to fix it), and in detail what happened around its last attempt */
function explainOp(e, { op, args = {}, actor }) {
  const now = e.ops.can(op, args, actor ? { actor } : undefined);
  const recent = e.ops.recent(op).slice(-5);
  const last = recent.at(-1);
  // events within a step of the last attempt: what else changed when it ran / failed
  const events = last ? e.events.recent().filter(h => Math.abs((h.tick ?? 0) - last.tick) <= 1).slice(-8).map(h => h.name) : [];
  const why = now.ok ? 'can run now' : `cannot run now: ${now.code}${note(e, op, now.code) ? ` (${note(e, op, now.code)})` : ''}`;
  const target = typeof args.id === 'string' ? e._things.source(args.id)?.explain(args.id) ?? null : null;   // the thing it acts on: where to change it for good
  const before = last ? `last attempt at tick ${last.tick} (${last.source}, ${last.actor}): ${last.ok ? 'ok' : last.code}${last.count > 1 ? ` x${last.count}` : ''}` : 'never run';
  const def = e.ops.defs.get(op), atom = def && atomicNote(def);
  const detail = (atom ? atom + '; ' : '') + before + (events.length ? `; events around it: ${events.join(', ')}` : '');
  return { ok: now.ok, code: now.code ?? null, atomic: def?.atomic === true, revision: e.ops.revision, facts: now.facts ?? {}, nextActions: now.nextActions ?? [], text: `${op} ${JSON.stringify(args)} ${why}${target?.edit ? ` · ${args.id} ${target.edit}` : ''}`, detail, recent, events, ...(target && { thing: target }) };
}
