// The history of engine.ops (split out of Ops.js): a ring of entries allocated once, so logging a run allocates nothing.
// Entry: { seq, tick, phase, name, args, source, actor, ok, code, depth, count }. Ops keeps the ring fields (_ring, _head, _len, _seq); these functions work on them.

/** A fresh ring of n empty entries @param {number} n */
export const newRing = n => Array.from({ length: Math.max(1, n | 0) }, () => ({ seq: 0, tick: 0, phase: 'between', name: '', args: null, source: '', actor: '', ok: false, code: null, depth: 0, count: 1 }));

/** Write a history entry in place (no allocation); consecutive identical failures (same actor, op, code) merge into one with count */
export function logEntry(ops, name, args, ctx, ok, code, depth) {
  const n = ops._ring.length, last = ops._len ? ops._ring[(ops._head - 1 + n) % n] : null;
  if (!ok && last && !last.ok && last.name === name && last.code === code && last.actor === ctx.actor) { last.count++; return last; }
  const h = ops._ring[ops._head];
  h.seq = ++ops._seq; h.tick = ctx.tick; h.phase = ops.engine._inFixed ? 'fixed' : 'between'; h.name = name; h.args = args;
  h.source = ctx.source; h.actor = ctx.actor; h.ok = ok; h.code = code; h.depth = depth; h.count = 1;
  ops._head = (ops._head + 1) % n;
  if (ops._len < n) ops._len++;
  return h;
}

/** Copies of the kept entries, old to new, optionally of one op */
export function recentEntries(ops, name) {
  const out = [], n = ops._ring.length;
  for (let i = 0; i < ops._len; i++) {
    const h = ops._ring[(ops._head - ops._len + i + n) % n];
    if (!name || h.name === name) out.push({ ...h });
  }
  return out;
}
