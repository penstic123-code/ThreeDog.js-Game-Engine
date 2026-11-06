// Async pathfinding batch solver: the same code answers in the path worker (pathWorker.js), in the lane's main-thread fallback,
// and in engine.commits' fallback when a worker reply is late (pathAsync.js). Worker-safe: no three.js, no engine objects.
// A batch carries everything that is not mirrored in the worker: start / goal (with ground heights), and for A* a raster of the ground half of walkability.
// The worker mirrors the rest: the navmesh (imported from the bytes the nav module exports) and the collision module's colliders (rebuilt into the same grid).
import { findPath as astar, astarDefaults } from './astar.js';
export { astarDefaults };
import { CollisionGrid, gridBlocks } from '../collision/grid.js';
import { navSearch } from '../nav/navPath.js';

/** Ground shape raster (water, slope): one byte per RES-meter cell, TILE x TILE cells per tile, keyed `${tx}:${tz}` */
export const RES = 1, TILE = 32;
export const tileOf = v => Math.floor(Math.round(v / RES) / TILE);

/**
 * Walkability from a batch: ground shape from the raster (nearest cell; outside the sent tiles counts as blocked, both sides see the same tiles),
 * colliders tested exactly: the ground's own (terrain trees, sent with the batch) and the collision module's (mirrored grid).
 */
function snapshotWalkable(tiles, radius, grid, trees) {
  return (x, z) => {
    const ix = Math.round(x / RES), iz = Math.round(z / RES), tx = Math.floor(ix / TILE), tz = Math.floor(iz / TILE);
    const t = tiles[tx + ':' + tz];
    if (!t || !t[(iz - tz * TILE) * TILE + (ix - tx * TILE)]) return false;
    return !gridBlocks(trees, x, z, radius) && !(grid && gridBlocks(grid, x, z, radius));
  };
}

/**
 * Answer every request of a batch: [{ status, path }...] in request order.
 * @param {{ reqs: any[], tiles: Record<string, Uint8Array> }} batch
 * @param {{ nav: any, grid: any }} ctx navmesh (query, navMesh, links) and collider grid (live ones on the main thread, mirrored ones in the worker)
 */
export function solveBatch(batch, ctx) {
  let trees = null;
  return batch.reqs.map(q => {
    if (q.mode === 'nav') return navSearch(ctx.nav, q.s, q.g, q.reach);
    if (q.mode !== 'grid') return { status: 'notReady', path: null };
    if (!trees) { trees = new CollisionGrid(); for (let i = 0; i < batch.trees.length; i += 3) trees.add({ x: batch.trees[i], z: batch.trees[i + 1], r: batch.trees[i + 2] }, false); }
    const path = astar(snapshotWalkable(batch.tiles, q.radius, ctx.grid, trees), q.s.x, q.s.z, q.g.x, q.g.z, q);
    return { status: q.navPending ? 'notReady' : path ? 'ok' : 'noPath', path };
  });
}

/**
 * Lane handler: { type: 'mesh', data, links } (navmesh bytes or null, the links its connections index), { type: 'colliders', items }, { type: 'batch', reqs, tiles } → results.
 * @param {() => Promise<any> | any} load gives the Recast module: the worker passes its static import (a worker bundle cannot split chunks);
 * the main-thread fallback imports it on demand so games without nav never download it
 */
export function pathHandler(load = () => import('@recast-navigation/core')) {
  const ctx = { nav: null, grid: null };
  let lib = null, chain = Promise.resolve();
  // Recast loads asynchronously; every message waits for the ones before it, so a batch always sees the mesh / colliders sent before it
  const then = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };   // one failed message must not block the rest
  return msg => {
    if (msg.type === 'mesh') return void then(async () => {
      if (!lib) { const m = await load(); await m.init(); lib = m; }
      ctx.nav?.query.destroy(); ctx.nav?.navMesh.destroy(); ctx.nav = null;
      if (msg.data) { const navMesh = lib.importNavMesh(msg.data).navMesh; ctx.nav = { navMesh, query: new lib.NavMeshQuery(navMesh), links: msg.links }; }
    });
    if (msg.type === 'colliders') return void then(() => { const g = new CollisionGrid(); for (const it of msg.items) g.add(it, it.box); ctx.grid = g; });
    return then(() => solveBatch(msg, ctx));
  };
}
