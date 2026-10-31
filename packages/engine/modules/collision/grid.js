// Grid index of colliders: register each by bounding circle in the cells it covers; queries look at a few nearby cells instead of scanning all colliders.
// Results are ordered circles first, then boxes, each in insertion order, exactly the callback order of a linear scan (resolve edits the position in turn, so a different order changes the result).
const CELL = 8, MAX_CELLS = 64, KEY = 1048576;   // colliders too large (covering > 64 cells) skip the grid and are scanned linearly, so registration cost does not blow up
const byOrder = (a, b) => a._b - b._b || a._o - b._o;

/** Cell span [x0, x1, z0, z1] that an item (x, z, r) covers */
const cellRange = it => [Math.floor((it.x - it.r) / CELL), Math.floor((it.x + it.r) / CELL), Math.floor((it.z - it.r) / CELL), Math.floor((it.z + it.r) / CELL)];

export class CollisionGrid {
  constructor() { this.cells = new Map(); this.big = []; this.seq = 0; this.stamp = 0; this.out = []; }
  /** Register; item needs x, z, r. isBox puts it after circles in the callback order */
  add(item, isBox) {
    item._o = this.seq++; item._b = isBox ? 1 : 0;
    const [x0, x1, z0, z1] = cellRange(item);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS) { this.big.push(item); return; }
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * KEY + j; let c = this.cells.get(k); if (!c) this.cells.set(k, c = []); c.push(item);
    }
  }
  remove(item) {
    const bi = this.big.indexOf(item); if (bi >= 0) { this.big.splice(bi, 1); return; }
    const [x0, x1, z0, z1] = cellRange(item);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * KEY + j, c = this.cells.get(k); if (!c) continue;
      c.splice(c.indexOf(item), 1); if (!c.length) this.cells.delete(k);
    }
  }
  /** Colliders intersecting the circle at (x, z) with radius range (exactly filtered, sorted). The returned array is reused by the next query, do not keep it */
  query(x, z, range) {
    const out = this.out; out.length = 0;
    const st = ++this.stamp;
    const take = it => { if (it._q === st) return; it._q = st; const dx = it.x - x, dz = it.z - z, rr = range + it.r; if (dx * dx + dz * dz < rr * rr) out.push(it); };
    for (const it of this.big) take(it);
    const x0 = Math.floor((x - range) / CELL), x1 = Math.floor((x + range) / CELL), z0 = Math.floor((z - range) / CELL), z1 = Math.floor((z + range) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const c = this.cells.get(i * KEY + j); if (c) for (const it of c) take(it); }
    if (out.length > 1) out.sort(byOrder);
    return out;
  }
}

/**
 * Does a collider in the grid block a character of `radius` standing at (x, z)? The obstacle half of Collision.walkableAt,
 * shared with the pathfinding worker (it rebuilds a grid from the same colliders), so both answer identically. Worker-safe: no imports.
 */
export function gridBlocks(grid, x, z, radius) {
  for (const it of grid.query(x, z, radius + 1)) {
    if (!it._b) { if (Math.hypot(x - it.x, z - it.z) < radius + it.r) return true; continue; }
    const dx = x - it.x, dz = z - it.z, lx = dx * it.c - dz * it.s, lz = dx * it.s + dz * it.c;
    if (Math.abs(lx) < it.hw + radius && Math.abs(lz) < it.hd + radius) return true;
  }
  return false;
}
