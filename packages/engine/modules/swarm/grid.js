// Spatial grid behind swarm.near (helper of Swarm.js): a hashed uniform grid over x and z, built on the first query after things moved.
// Why hashed and not an array over the world: a game world has no declared bounds and a bullet may leave the map; the table size depends only on capacity.
// Why the lists hang on slots and not rows: swap-remove moves rows, slots stay, so free and spawn keep the cells in O(1) with no rebuild.
// Why cx / cz are kept: two cells can share a bucket; comparing them shows each object once, in its own cell, so a query needs no dedupe.
export class SwarmGrid {
  /** @param {any} s the swarm @param {number} cell cell size in meters */
  constructor(s, cell) {
    this.s = s; this.cell = cell;
    let size = 64;
    while (size < s.capacity * 2) size *= 2;
    this.mask = size - 1;
    this.head = new Int32Array(size);
    this.next = new Int32Array(s.capacity); this.prev = new Int32Array(s.capacity);
    this.cx = new Int32Array(s.capacity); this.cz = new Int32Array(s.capacity);
    /** false: things moved since the last build */ this.ok = false;
  }
  bucket(cx, cz) { return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & this.mask; }
  /** Put a slot into the cell of its row */
  insert(slot, row) {
    const { head, next, prev, s } = this, cx = Math.floor(s.data.x[row] / this.cell), cz = Math.floor(s.data.z[row] / this.cell), b = this.bucket(cx, cz), first = head[b];
    this.cx[slot] = cx; this.cz[slot] = cz;
    next[slot] = first; prev[slot] = -1 - b;   // negative = head of a bucket, keeping its number so unlink need not hash again
    if (first >= 0) prev[first] = slot;
    head[b] = slot;
  }
  /** Take a slot out of its cell */
  unlink(slot) {
    const { head, next, prev } = this, p = prev[slot], n = next[slot];
    if (p < 0) head[-1 - p] = n; else next[p] = n;
    if (n >= 0) prev[n] = p;
  }
  build() {
    const { s } = this, slots = s._slot, gone = s._gone;
    this.head.fill(-1);
    for (let i = 0, n = s._n; i < n; i++) if (!gone[i]) this.insert(slots[i], i);
    this.ok = true;
  }
  /** Calls cb(data, row, dist2) for each live object within r of (x, z); cb returning false stops. Returns how many were visited */
  query(x, z, r, cb) {
    const { s, cell, head, next } = this, d = s.data, X = d.x, Z = d.z, at = s._at, gone = s._gone, r2 = r * r;
    const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell), z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
    let hits = 0;
    // with more cells than objects a row scan is faster; otherwise a wide query would cost by area and not by object count
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > s._n) {
      for (let i = 0, n = s._n; i < n; i++) {
        if (gone[i]) continue;
        const dx = X[i] - x, dz = Z[i] - z, d2 = dx * dx + dz * dz;
        if (d2 <= r2) { hits++; if (cb(d, i, d2) === false) return hits; }
      }
      return hits;
    }
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      for (let k = head[this.bucket(cx, cz)]; k >= 0; k = next[k]) {
        if (this.cx[k] !== cx || this.cz[k] !== cz) continue;
        const i = at[k];
        if (gone[i]) continue;
        const dx = X[i] - x, dz = Z[i] - z, d2 = dx * dx + dz * dz;
        if (d2 <= r2) { hits++; if (cb(d, i, d2) === false) return hits; }
      }
    }
    return hits;
  }
}
