// Spatial index for world: the xz plane is cut into fixed-size cells (default 32 m) and each record is filed under its cell. Distance queries and focus-based model building both pre-filter by cell.
// Cell keys are numbers and cells hold record objects directly: there are hundreds to thousands of moves and neighbor queries per step, and string keys plus id lookups would only add garbage and cost.

const OFF = 2 ** 20, SPAN = 2 ** 21;   // ±1 million cells in each direction (±30,000 km at 32 m per cell); keys stay safe integers

/** @internal */
export class Cells {
  /** @param {number} size cell edge length (meters) */
  constructor(size) {
    this.size = size;
    this.map = new Map();   // cell key → Set<record> (deleted when empty, so walked-through areas leave no empty cells)
    this.of = new Map();    // id → cell key
  }
  key(x, z) { return (Math.floor(x / this.size) + OFF) * SPAN + Math.floor(z / this.size) + OFF; }
  /** Put into / move to the cell containing the position; returns true if the cell changed */
  put(rec) {
    const k = this.key(rec.position.x, rec.position.z), old = this.of.get(rec.id);
    if (old === k) return false;
    if (old !== undefined) this.out(old, rec);
    let set = this.map.get(k); if (!set) this.map.set(k, set = new Set());
    set.add(rec); this.of.set(rec.id, k);
    return true;
  }
  delete(rec) { const k = this.of.get(rec.id); if (k !== undefined) this.out(k, rec); this.of.delete(rec.id); }
  out(k, rec) { const set = this.map.get(k); set.delete(rec); if (!set.size) this.map.delete(k); }
  clear() { this.map.clear(); this.of.clear(); }
  /** Call fn(rec, squared distance) for each record within radius of c. No allocation, no sorting.
   *  When the circle covers more cells than exist (huge radius, even Infinity) scan all cells instead, so it cannot hang */
  forEach(c, radius, fn) {
    const s = this.size, r2 = radius * radius, cx = c.x, cz = c.z;
    const x0 = Math.floor((cx - radius) / s), x1 = Math.floor((cx + radius) / s), z0 = Math.floor((cz - radius) / s), z1 = Math.floor((cz + radius) / s);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > this.map.size) { for (const set of this.map.values()) visit(set, cx, cz, r2, fn); return; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const set = this.map.get((x + OFF) * SPAN + z + OFF);
      if (set) visit(set, cx, cz, r2, fn);
    }
  }
}

function visit(set, cx, cz, r2, fn) {
  for (const rec of set) { const dx = rec.position.x - cx, dz = rec.position.z - cz, d2 = dx * dx + dz * dz; if (d2 <= r2) fn(rec, d2); }
}
