// Per-chunk view of stream sources for loaders that sync whole chunks (physics terrain): has any picked source crossed a chunk border since the last call.

/**
 * Refresh memo (a flat array of [cx, cz, ring, ...] per picked source; chunk size `size`, ring capped at `maxRing`) in place and return true when it
 * differs from the previous call. Builds no array or string while nothing crosses a border, so it can run every fixed step.
 * @param {import('./Stream.js').Stream} stream
 * @param {number[]} memo
 * @param {number} size
 * @param {number} maxRing
 * @param {{ detail?: string, physics?: boolean }} [pick]
 * @internal
 */
export function cellsChanged(stream, memo, size, maxRing, pick) {
  let n = 0, same = true;
  for (const s of stream._sources) {
    if ((pick?.detail && s.detail !== pick.detail) || (pick?.physics != null && s.physics !== pick.physics)) continue;
    s.sync();
    const cx = Math.floor(s.x / size), cz = Math.floor(s.z / size), r = Math.min(maxRing, s.radius == null ? Infinity : Math.max(1, Math.ceil(s.radius / size)));
    if (memo[n] !== cx || memo[n + 1] !== cz || memo[n + 2] !== r) { same = false; memo[n] = cx; memo[n + 1] = cz; memo[n + 2] = r; }
    n += 3;
  }
  if (memo.length !== n) { same = false; memo.length = n; }
  return !same;
}
