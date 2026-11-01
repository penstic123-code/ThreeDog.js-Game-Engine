// Readiness and collision queries on loaded chunks (mixed into ChunkManager.prototype), read by loading and by the collision and physics
// modules through the ground API.
import { xzOf } from '../../core/math.js';

export const chunkQueries = {
  /** Whether chunks within `rings` rings (default 1) of a position are generated (for the loading screen); solid: also their collision has taken effect */
  isReadyAround(position, { rings = 1, solid = false } = {}) {
    const [x, z] = xzOf(position), CH = this.T.CHUNK, pcx = Math.floor(x / CH), pcz = Math.floor(z / CH);
    for (let dz = -rings; dz <= rings; dz++) for (let dx = -rings; dx <= rings; dx++) {
      const c = this.chunks.get((pcx + dx) + ',' + (pcz + dz));
      if (!c || c.state !== 'ready' || solid && !c.solid) return false;
    }
    return true;
  },

  /** @internal Iterate collision circles near (x,z): fn(cx, cz, r). Only queries loaded chunks near the player */
  forEachCollider(x, z, range, fn) {
    const CH = this.T.CHUNK, x0 = Math.floor((x - range) / CH), x1 = Math.floor((x + range) / CH), z0 = Math.floor((z - range) / CH), z1 = Math.floor((z + range) / CH);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const c = this.chunks.get(cx + ',' + cz);
      if (!c?.solid) continue;
      for (const n in c.colliders) {
        const k = c.colliders[n];
        for (let i = 0; i < k.length; i += 3) {
          const dx = k[i] - x, dz = k[i + 1] - z, rr = range + k[i + 2];
          if (dx * dx + dz * dz < rr * rr) fn(k[i], k[i + 1], k[i + 2]);
        }
      }
    }
  },

  /** @internal Collision data of a chunk (for the physics module): terrain triangles (chunk-local coordinates) + vegetation collision circles. Returns null if not generated.
   *  token tells whether the chunk was regenerated */
  chunkCollision(cx, cz) {
    const c = this.chunks.get(cx + ',' + cz);
    if (!c || c.state !== 'ready' || !c.solid) return null;   // collision's effective tick not reached yet
    // when the token changes the physics module rebuilds this chunk's collision; edits such as felling a tree issue a new colToken
    // an island chunk (terrain({ shape })) leaves out its bottom: a body falls past the underside instead of landing on it from below
    const p = c.terrain.geometry.attributes.position.array, positions = c.solidCount == null ? p : p.subarray(0, c.solidCount * 3);
    return { token: c.colToken ?? c, positions, ox: cx * this.T.CHUNK, oz: cz * this.T.CHUNK, circles: Object.values(c.colliders) };
  },
};
