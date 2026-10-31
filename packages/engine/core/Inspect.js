// engine.inspect / engine.explain: questions an AI asks while debugging, answered from the ops registry and describe().
//   engine.inspect()               what is around the player and what the player can do now (each op offer checked with can)
//   engine.inspect('npc_3')        the same for another actor (world record id): "why did this enemy not attack?"
//   engine.inspect([x, z])         things around a spot, ops as the player
//   engine.explain({ op: 'shop.buy', args })   why an op can / cannot run now (text: reason + fix first; detail: its last attempt and the events around it)
//   engine.explain({ quest: 'first-light' })  any other key is answered by the module whose definition has explain: { quest(e, id) {...} }
// Built on ops because a failed op already carries its reason; explain turns that into a sentence instead of making the AI read can().
import { closest } from './validate.js';
import { codedError } from './errorHints.js';

const OPS_MAX = 8;

/** Where an actor stands: the player, or a world record */
function placeOf(e, actor) {
  if (actor === 'player') return e.player?.position ?? e.focus;
  return e.world?.get(actor)?.position ?? null;
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
  if (!p) throw codedError('world-record', `engine.inspect('${at}'): no world record with this id${hintIds(e, at)}. Pass a record id, [x, z] or nothing for the player`);
  const near = e.describe({ radius, center: { x: p.x, z: p.z } }).nearby;
  const ops = e.ops.list({ available: true, actor }).sort((a, b) => b.ok - a.ok).slice(0, OPS_MAX)
    .map(o => ({ op: o.name, args: o.args, ok: o.ok, ...(o.ok ? {} : { reason: o.reason, why: note(e, o.name, o.reason) ?? null }) }));
  return { actor, at: { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }, near, ops };
}
const hintIds = (e, id) => { const c = e.world && closest(String(id), e.world.query({}).map(r => r.id)); return c ? ` (did you mean '${c}'?)` : ''; };

/**
 * @param {any} e
 * @param {Record<string, any>} q
 */
export function explain(e, q) {
  if (q?.op) return explainOp(e, q);
  const key = Object.keys(q || {})[0];
  for (const m of e.modules.values()) if (m.explain?.[key]) return m.explain[key](e, q[key], q);
  const keys = ['op', ...[...e.modules.values()].flatMap(m => Object.keys(m.explain || {}))];
  throw codedError('unknown-name', `engine.explain({ ${key}: ... }): nothing explains '${key}'${closest(key, keys) ? ` (did you mean '${closest(key, keys)}'?)` : ''}. Keys: ${keys.join(', ')} (a module adds one with explain: { ${key}(e, value) { return { ok, text } } })`);
}

/** Can this op run now (text: the reason and the op's note on how to fix it), and in detail what happened around its last attempt */
function explainOp(e, { op, args = {}, actor }) {
  const now = e.ops.can(op, args, actor ? { actor } : undefined);
  const recent = e.ops.recent(op).slice(-5);
  const last = recent.at(-1);
  // events within a step of the last attempt: what else changed when it ran / failed
  const events = last ? e.events.recent().filter(h => Math.abs((h.tick ?? 0) - last.tick) <= 1).slice(-8).map(h => h.name) : [];
  const why = now.ok ? 'can run now' : `cannot run now: ${now.reason}${note(e, op, now.reason) ? ` (${note(e, op, now.reason)})` : ''}`;
  const before = last ? `last attempt at tick ${last.tick} (${last.source}, ${last.actor}): ${last.ok ? 'ok' : last.reason}${last.count > 1 ? ` x${last.count}` : ''}` : 'never run';
  const detail = before + (events.length ? `; events around it: ${events.join(', ')}` : '');
  return { ok: now.ok, reason: now.reason ?? null, text: `${op} ${JSON.stringify(args)} ${why}`, detail, recent, events };
}
