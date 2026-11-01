// Atomic ops (op definition atomic: true): world records, inventory / containers and vars written during run are kept or all undone.
// How: the save parts declared atomic are copied before run and loaded back (as an op write) if run fails or throws. Honest limits, also in recipe 23:
//   - it costs one save of those parts per atomic run: fine for a shop / craft op, not for a per-frame op in a huge world;
//   - events already emitted, and anything outside the atomic parts (sound, animation, DOM, other modules' saves), are NOT undone: put such side effects in the op's `after`;
//   - ops called from an atomic run join it: their `after` hooks wait for the outermost commit.
// Which parts: the ones whose module declared saves.register(key, { atomic: true }) (core names no module; a game's own part can opt in the same way).
// Rollback does not run afterLoad hooks (no model rebuild): atomic state must be plain data a load restores by itself. Events the load would emit are muted
// (the run's own events already went out and cannot be recalled), and the trace gets one 'ops:rollback' note.

/** Copy the atomic parts that exist now: [[provider, plain copy]] @internal */
export function snapshot(e) {
  const out = [];
  for (const p of e.saves.providers.values()) if (p.atomic) out.push([p, JSON.parse(JSON.stringify(p.save() ?? null))]);
  return out;
}

/** Put a snapshot back (guarded writes allowed, change events muted) @internal */
export function rollback(e, snap) {
  const ev = e.events;
  ev.muted = (ev.muted || 0) + 1;
  try { e.ops.allow(() => { for (const [p, d] of snap) p.load(JSON.parse(JSON.stringify(d))); }); } finally { ev.muted--; }
  if (ev.traceSize > 0) ev.note('ops:rollback', { data: { parts: snap.length } });
}

/** Mark the history entries a rolled-back run left behind (committed nested ops deeper than it) as failed with code 'rolledBack' @internal */
export function markRolledBack(ops, seq, depth) {
  for (const h of ops._ring) if (h.seq > seq && h.depth > depth && h.ok) { h.ok = false; h.code = 'rolledBack'; }
}

/** Which state an op definition covers, for list / explain / the catalog: honest about what atomic means */
export const atomicNote = d => d.atomic ? 'atomic: the parts declared atomic (world, inventory, containers, vars, quests, grids, random, scene) roll back if run fails; events, sound and other state do not (use after)' : null;
