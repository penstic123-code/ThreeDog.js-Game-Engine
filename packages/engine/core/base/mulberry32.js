// mulberry32, the one copy (engine.random and terrain placement both use it). Import-free, so worker code can use it too.

/**
 * Advance r.state by one mulberry32 step and return the next number in [0, 1); allocates nothing.
 * @param {{ state: number }} r
 * @returns {number}
 * @internal
 */
export function mulberry32(r) {
  const s = r.state = (r.state + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
