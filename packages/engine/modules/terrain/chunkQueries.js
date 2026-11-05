// Readiness and collision queries on loaded chunks (mixed into ChunkManager.prototype), read by loading and by the collision and physics
// modules through the ground API.
import { collidersNear, ringsReady } from '../../core/stream/chunkStream.js';

export const chunkQueries = {
  /** @internal Whether chunks within `rings` rings (default 1) of a position are generated (for the loading screen); solid: also their collision has taken effect */
  readyAt(position, { rings = 1, solid = false } = {}) {
    // regrow: plants of a species added later still on the way
    return ringsReady(this.chunks, this.generator.CHUNK, position, rings, c => c?.state === 'ready' && !(c.regrow > 0) && (!solid || c.solid));
  },

  /** @internal Iterate collision circles near (x,z): fn(cx, cz, r). Only queries loaded chunks near the player */
  forEachCollider(x, z, range, fn) { collidersNear(this.chunks, this.generator.CHUNK, x, z, range, fn); },

  /** @internal Collision data of a chunk (for the physics module): terrain triangles (chunk-local coordinates) + vegetation collision circles. Returns null if not generated.
   *  token tells whether the ground was regenerated, treeToken whether its tree circles changed */
  chunkCollision(cx, cz) {
    const c = this.chunks.get(cx + ',' + cz);
    if (!c || c.state !== 'ready' || !c.solid) return null;   // collision's effective tick not reached yet
    // when the token changes the physics module rebuilds this chunk's collision; edits such as felling a tree issue a new colToken
    // an island chunk (terrain({ shape })) leaves out its bottom: a body falls past the underside instead of landing on it from below
    const p = c.data.pos, positions = c.solidCount == null ? p : p.subarray(0, c.solidCount * 3);
    // treeToken: only the tree circles changed (density, a felled tree): physics rebuilds the trunks, not the ground triangles
    const token = c.colToken ?? c;
    return { token, treeToken: c.treeToken ?? token, positions, ox: cx * this.generator.CHUNK, oz: cz * this.generator.CHUNK, circles: Object.values(c.colliders) };
  },
};
