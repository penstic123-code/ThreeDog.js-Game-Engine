// Navmesh path query: the one Recast search in the engine. engine.nav.findPath calls it with the live mesh,
// the pathfinding worker (characters/pathJob.js) with an imported copy of the same mesh. Worker-safe: no imports.
// computePath would do, but it drops the flags that say a leg is a link; this is its search with the flags kept.

const OPTS = { halfExtents: { x: 2, y: 4, z: 2 } };
const OFF_MESH = 4;   // DT_STRAIGHTPATH_OFFMESH_CONNECTION: this point starts a link, the next one ends it
const OFF_MESH_POLY = 1;   // DT_POLYTYPE_OFFMESH_CONNECTION
const NO_PATH = { status: 'noPath', path: null };

/**
 * @param {{ query: any, navMesh: any, links: { id: string | number }[] }} nav Recast NavMeshQuery and NavMesh, and the links by the index their connections carry
 * @param {{ x: number, y: number, z: number }} s start (y = ground height, looked up by the caller: the worker has no ground)
 * @param {{ x: number, y: number, z: number }} g goal
 * @param {number} reach how far the path's end may stop short of the goal and still count as reaching it (m)
 * @returns {{ status: 'ok' | 'noPath', path: { x: number, z: number, link?: { id: string | number, from: object, to: object } }[] | null }}
 */
export function navSearch(nav, s, g, reach) {
  const q = nav.query, a = q.findNearestPoly(s, OPTS), b = q.findNearestPoly(g, OPTS);
  if (!a.success || !b.success) return NO_PATH;
  const found = q.findPath(a.nearestRef, b.nearestRef, s, g), polys = found.polys;
  let out = NO_PATH;
  if (found.success && polys.size) {
    const last = polys.get(polys.size - 1), close = last === b.nearestRef ? null : q.closestPointOnPoly(last, g);
    if (!close || close.success) out = corners(nav, s, close ? close.closestPoint : g, polys, g, reach);
  }
  polys.destroy();
  return out;
}

/** The corners of a polygon corridor as path points; the point that starts a link says so, with both ends in 3D (the path's own points are x, z only) */
function corners(nav, s, end, polys, g, reach) {
  const r = nav.query.findStraightPath(s, end, polys), { straightPath: v, straightPathFlags: flags, straightPathRefs: refs, straightPathCount: n } = r;
  const at = i => ({ x: v.get(i * 3), y: v.get(i * 3 + 1), z: v.get(i * 3 + 2) });
  // A walker standing on a link's start (it has just landed there, say) gets no corner for it: the funnel's apex is already on it, so only the corridor still shows the link
  const standing = r.success && n > 1 && polys.size > 1 && !((flags.get(0) | flags.get(1)) & OFF_MESH) && nav.navMesh.getTileAndPolyByRef(polys.get(1)).poly.getType() === OFF_MESH_POLY ? polys.get(1) : 0;
  const path = [];
  for (let i = 0; r.success && i < n; i++) {
    const { x, z } = at(i), p = { x, z }, ref = flags.get(i) & OFF_MESH ? refs.get(i) : i ? 0 : standing;
    if (ref && i + 1 < n) { const u = nav.navMesh.getOffMeshConnectionByRef(ref).userId(); p.link = { id: nav.links[u]?.id ?? u, from: at(i), to: at(i + 1) }; }
    path.push(p);
  }
  v.destroy(); flags.destroy(); refs.destroy();
  const tail = path[path.length - 1];
  if (!tail || Math.hypot(tail.x - g.x, tail.z - g.z) > reach) return NO_PATH;   // end point unreachable
  return { status: 'ok', path };
}
