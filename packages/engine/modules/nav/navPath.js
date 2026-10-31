// Navmesh path query: the one Recast search in the engine. engine.nav.findPath calls it with the live query,
// the pathfinding worker (characters/pathJob.js) with a query on an imported copy of the same mesh. Worker-safe: no imports.

/**
 * @param {any} query a Recast NavMeshQuery
 * @param {{ x: number, y: number, z: number }} s start (y = ground height, looked up by the caller: the worker has no ground)
 * @param {{ x: number, y: number, z: number }} g goal
 * @param {number} reach how far the path's end may stop short of the goal and still count as reaching it (m)
 * @returns {{ status: 'ok' | 'noPath', path: { x: number, z: number }[] | null }}
 */
export function navSearch(query, s, g, reach) {
  const r = query.computePath(s, g, { halfExtents: { x: 2, y: 4, z: 2 } });
  if (!r.success || !r.path.length) return { status: 'noPath', path: null };
  const end = r.path[r.path.length - 1];
  if (Math.hypot(end.x - g.x, end.z - g.z) > reach) return { status: 'noPath', path: null };   // end point unreachable
  return { status: 'ok', path: r.path.map(p => ({ x: p.x, z: p.z })) };
}
