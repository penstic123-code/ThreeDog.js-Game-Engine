// Collision queries on loaded chunks (mixed into ChunkManager.prototype), read by the collision and physics modules through the ground API.

export const chunkQueries = {
  /** Iterate collision circles near (x,z): fn(cx, cz, r). Only queries loaded chunks near the player */
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

  /** Collision data of a chunk (for the physics module): terrain triangles (chunk-local coordinates) + vegetation collision circles. Returns null if not generated.
   *  token tells whether the chunk was regenerated */
  chunkCollision(cx, cz) {
    const c = this.chunks.get(cx + ',' + cz);
    if (!c || c.state !== 'ready' || !c.solid) return null;   // collision's effective tick not reached yet
    // when the token changes the physics module rebuilds this chunk's collision; edits such as felling a tree issue a new colToken
    return { token: c.colToken ?? c, positions: c.terrain.geometry.attributes.position.array, ox: cx * this.T.CHUNK, oz: cz * this.T.CHUNK, circles: Object.values(c.colliders) };
  },
};
