// Atomic ops (op definition atomic: true): world records, inventory / containers and vars written during run are kept or all undone.
// How: the save parts declared atomic are copied before run and loaded back (as an op write) if run fails or throws. Honest limits, also in recipe 23:
//   - it costs one save of those parts per atomic run: fine for a shop / craft op, not for a per-frame op in a huge world;
//   - events already emitted, and anything outside the atomic parts (sound, animation, DOM, other modules' saves), are NOT undone: put such side effects in the op's `after`;
//   - ops called from an atomic run join it: their `after` hooks wait for the outermost commit.
// Which parts: the ones whose module declared saves.register(key, { atomic: true }) (core names no module; a game's own part can opt in the same way). An engine part that does
// not says why in notAtomic: a part nobody asked stays changed while the rest rolls back (rule R66).
// Rollback does not run afterLoad hooks (no model rebuild): atomic state must be plain data a load restores by itself. Events the load would emit are muted
// (the run's own events already went out and cannot be recalled), and the trace gets one 'ops:rollback' note.

import { reportError } from '../base/errors.js';
import { codedError } from '../base/errorHints.js';

/** Copy the atomic parts: [[key, provider, plain copy or null]] @internal */
export function snapshot(e) {
  const out = [];
  // an exact copy, as a load's rollback point takes: through JSON a NaN came back as null
  for (const [k, p] of e.saves.providers) if (p.atomic) { const d = p.save(); out.push([k, p, d == null ? null : structuredClone(d)]); }
  return out;
}

/** What a part goes back to. load() is never handed null, so a part that had nothing and has something now takes its new-game data, as in a load's rollback (saveApply.js); with none it cannot go back, and says so */
function restored(e, k, p, d) {
  if (d != null || p.save() == null) return d;
  const S = e.session, parts = S._base ? S._baseData().parts : {}, base = Object.hasOwn(parts, k) ? parts[k] : null;
  if (base == null) reportError(e, codedError('save-load-threw', `atomic op rollback: save part '${k}' keeps what the op wrote: its save() gave nothing before the op and it has no new-game state to go back to`), 'ops rollback', { soft: true });
  return base ?? null;
}

/** Put a snapshot back (guarded writes allowed, change events muted) @internal */
export function rollback(e, snap) {
  const ev = e.events;
  ev.muted = (ev.muted || 0) + 1;
  try { e.ops.allow(() => { for (const [k, p, d] of snap) { const back = restored(e, k, p, d); if (back != null) p.load(structuredClone(back)); } }); } finally { ev.muted--; }
  if (ev.traceSize > 0) ev.note('ops:rollback', { data: { parts: snap.length } });
}

/** Mark the history entries a rolled-back run left behind (committed nested ops deeper than it) as failed with code 'rolledBack' @internal */
export function markRolledBack(ops, seq, depth) {
  for (const h of ops._ring) if (h.seq > seq && h.depth > depth && h.ok) { h.ok = false; h.code = 'rolledBack'; }
}

/** Which state an op definition covers, for list / explain / the catalog: honest about what atomic means */
export const atomicNote = d => d.atomic ? 'atomic: the parts declared atomic (world, inventory, containers, vars, quests, interactions, content, grids, random, scene) roll back if run fails; events, sound and other state do not (use after)' : null;
