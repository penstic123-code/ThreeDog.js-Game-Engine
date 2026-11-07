// A copy of another owner's data, checked when it is read: rigid's mirror of the walls, a level's walls in the collision module, nav's obstacles, chunks on the ground.
// Why identity first and then version: a version counts per owner, so a new owner can match the old number with other data in it. Why on read: a frozen engine runs no
// step and a skip runs no frame, so a copy kept by hooks answers from the past exactly when a menu or a timer asks.

/**
 * @internal sync(update) answers false while the copy is current; else it runs update(change), change being 'source' (another owner, or the first read: what was built in the
 * old one is gone) or 'version' (the same owner changed), and answers change. The copy counts as current only once update returned: one that throws is built again by the next
 * read. A read from inside update answers false, so a rebuild that asks its own owner does not start over. reset() makes the next read stale: the copy was thrown away.
 * @template S @param {() => S} source who holds the data now @param {(s: S) => any} [version] that owner's change count
 */
export function follows(source, version) {
  let held, at, read = false, busy = false;
  return {
    sync(update) {
      if (busy) return false;
      const s = source(), v = version?.(s);
      if (read && s === held && v === at) return false;
      const change = read && s === held ? 'version' : 'source';
      busy = true;
      try { update(change); } finally { busy = false; }
      held = s; at = v; read = true;
      return change;
    },
    reset() { read = false; },
  };
}
