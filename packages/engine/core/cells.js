// Shared xz grid index.
// The plane is cut into fixed-size cells and each entry is filed under its cell. World records (32 m cells), fixed-position interactions, NPC avoidance
// (cells the size of two NPC radii) and trigger zones all use it, so "what is near this point" has one implementation.
// Cell keys are numbers and cells hold the entries directly: there are hundreds to thousands of moves and neighbor queries per step, and string keys plus id
// lookups would only add garbage and cost.
// Two kinds of entry, one kind per index: points ({ id, position: { x, z } }, put / delete / forEach) and boxes covering every cell they touch
// (cover / uncover / at, for zones larger than a point).

const OFF = 2 ** 20, SPAN = 2 ** 21;   // ±1 million cells in each direction (±30,000 km at 32 m per cell); keys stay safe integers

/** @internal */
export class Cells {
  /** @param {number} size cell edge length (meters) */
  constructor(size) {
    this.size = size;
    this.map = new Map();   // cell key → Set<entry> (deleted when empty, so walked-through areas leave no empty cells)
    this.of = new Map();    // point: id → cell key; box: entry → [x0, x1, z0, z1] cell span
  }
  key(x, z) { return (Math.floor(x / this.size) + OFF) * SPAN + Math.floor(z / this.size) + OFF; }
  /** Put a point entry into / move it to the cell containing its position; returns true if the cell changed */
  put(rec) {
    const k = this.key(rec.position.x, rec.position.z), old = this.of.get(rec.id);
    if (old === k) return false;
    if (old !== undefined) this.out(old, rec);
    this.in(k, rec); this.of.set(rec.id, k);
    return true;
  }
  delete(rec) { const k = this.of.get(rec.id); if (k !== undefined) this.out(k, rec); this.of.delete(rec.id); }
  in(k, rec) { let set = this.map.get(k); if (!set) this.map.set(k, set = new Set()); set.add(rec); }
  out(k, rec) { const set = this.map.get(k); set.delete(rec); if (!set.size) this.map.delete(k); }
  clear() { this.map.clear(); this.of.clear(); }
  /** Call fn(entry, squared distance) for each point entry within radius of c. No allocation, no sorting.
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
  /** File a box entry under every cell its xz bounds touch; false (nothing filed) when that is more than maxCells cells: the caller checks it some other way */
  cover(item, minX, minZ, maxX, maxZ, maxCells = Infinity) {
    const s = this.size, x0 = Math.floor(minX / s), x1 = Math.floor(maxX / s), z0 = Math.floor(minZ / s), z1 = Math.floor(maxZ / s);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > maxCells) return false;
    this.of.set(item, [x0, x1, z0, z1]);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.in((x + OFF) * SPAN + z + OFF, item);
    return true;
  }
  uncover(item) {
    const sp = this.of.get(item); if (!sp) return;
    this.of.delete(item);
    for (let x = sp[0]; x <= sp[1]; x++) for (let z = sp[2]; z <= sp[3]; z++) this.out((x + OFF) * SPAN + z + OFF, item);
  }
  /** Box entries filed under the cell containing (x, z), in the order they were filed; undefined when none */
  at(x, z) { return this.map.get(this.key(x, z)); }
}

function visit(set, cx, cz, r2, fn) {
  for (const rec of set) { const dx = rec.position.x - cx, dz = rec.position.z - cz, d2 = dx * dx + dz * dz; if (d2 <= r2) fn(rec, d2); }
}
