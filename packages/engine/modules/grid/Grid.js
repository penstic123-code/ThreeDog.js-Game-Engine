// One placement grid (engine.grids.add returns it): world <-> cell math, footprints, occupancy, per-cell layers, can().
// Occupancy is not stored: it is an index derived from world records that carry a `grid` field
// ({ id, cell, size, rotation, item, occupy?, level? }), so a save holds each placed thing once (in world) and can never disagree with it.
// Occupancy has layers (an item's `occupy`: 'floor', 'furniture', 'wall'...; default 'main') and levels (storeys, integer, default 0): a cell is taken
// per (occupy, level), so a rug and a table share a cell while two tables do not, and a second floor holds its own furniture.
// Cells are integer pairs [i, j]; by default cell [0, 0] spans origin.x..origin.x+cell on x and origin.z..origin.z+cell on z. The cell <-> world
// mapping is one replaceable pair (grids.add({ mapping })), so a game with another lattice swaps two functions instead of every caller's math.
// A footprint is anchored at its min corner cell; rotation is in quarter turns (0-3) and odd turns swap width and depth.
import { Layer } from './Layer.js';
import { xzOf } from '../../core/base/math.js';

/** The default occupancy layer of an item that names none */
export const MAIN = 'main';
/** Occupancy index key: one per (layer, level, cell) */
export const occKey = (occupy, level, i, j) => `${occupy}|${level}|${i},${j}`;
const cap = s => s[0].toUpperCase() + s.slice(1);
const FLAT_SAMPLES = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
// [x, z] here (a grid is flat), [x, y, z] / Vector3 / Object3D / { x, z } as everywhere else
const planar = v => (Array.isArray(v) && v.length === 2 ? v : xzOf(v));

/**
 * A placement grid. Several can exist at once (a yard outdoors, a room indoors); each has its own cell size, origin and bounds.
 * @example
 * const room = engine.grids.add('room', { cell: 1, origin: [0, 0], size: [16, 12] });
 * room.toCell(engine.player.position);            // [3, 5]
 * room.can('table', [3, 5]);                      // true or a reason: 'occupied' 'outOfBounds' 'notFlat' 'wrongGround' or a layer reason ...
 * engine.ops.run('grid.place', { grid: 'room', item: 'table', cell: [3, 5] });
 * engine.ops.run('grid.place', { grid: 'room', item: 'rug', cell: [3, 5] });   // rug: occupy 'floor', so it shares the table's cell
 * @experimental
 */
export class Grid {
  /** @internal */
  constructor(engine, owner, name, opts) {
    /** @internal */ this.engine = engine;
    /** @internal */ this._owner = owner;
    /** Grid name (the `grid` arg of the grid.* ops) @type {string} */
    this.name = name;
    /** Cell edge length (meters) @type {number} */
    this.cell = opts.cell ?? 1;
    const [ox, oz] = planar(opts.origin ?? [0, 0]);
    /** World position of the min corner of cell [0, 0] @type {{ x: number, z: number }} */
    this.origin = { x: ox, z: oz };
    /** Cell count [width, depth]; null = unbounded @type {[number, number] | null} */
    this.size = opts.size ?? null;
    /** Level name this grid belongs to (null = everywhere); its tiles show only while engine.world.zone matches @type {string | null} */
    this.zone = opts.zone ?? null;
    /** Max height difference (m) allowed under a footprint before can() says 'notFlat' @type {number} */
    this.flat = opts.flat ?? 0.5;
    /** Height of level 0 (m); null = the ground under each cell (engine.surface) @type {number | null} */
    this.y = opts.y ?? null;
    /** Height of one level (m): level n stands at (y or the ground) + n * levelHeight @type {number} */
    this.levelHeight = opts.levelHeight ?? 3;
    /** @internal { toCell(x, z) => [i, j], center([i, j]) => [x, z] }: the one place cell <-> world math lives */
    this._map = opts.mapping ?? {
      toCell: (x, z) => [Math.floor((x - this.origin.x) / this.cell), Math.floor((z - this.origin.z) / this.cell)],
      center: ([i, j]) => [this.origin.x + (i + 0.5) * this.cell, this.origin.z + (j + 0.5) * this.cell],
    };
    /** @internal occKey(occupy, level, i, j) -> world record id */ this._occ = new Map();
    /** @internal name -> Layer */ this._layers = new Map();
  }

  /**
   * World position (Vector3 / object / [x, z] / [x, y, z] / (x, z)) -> cell [i, j]
   * @example room.toCell(engine.player.position)
   * @param {any} x
   * @param {number} [z]
   * @returns {[number, number]}
   */
  toCell(x, z) {
    if (typeof x === 'object') [x, z] = planar(x);
    return this._map.toCell(x, z);
  }
  /**
   * Center of a footprint in world space; y is the level's height (grid y, else the ground under it, plus level * levelHeight). Without size it is the
   * center of one cell
   * @example obj.position.copy(room.toWorld([3, 5]))
   * @example room.toWorld([3, 5], [1, 1], 0, 1)   // the same cell one storey up
   * @param {[number, number]} cell
   * @param {[number, number]} [size]
   * @param {number} [rotation]  quarter turns
   * @param {number} [level]  storey, default 0
   * @returns {{ x: number, y: number, z: number }}
   */
  toWorld(cell, size = [1, 1], rotation = 0, level = 0) {
    const [w, d] = rotation & 1 ? [size[1], size[0]] : size;
    // the middle of the first and last cell's centers: the footprint center for the square lattice, a sane anchor for a replaced mapping
    const [ax, az] = this._map.center(cell), [bx, bz] = this._map.center([cell[0] + w - 1, cell[1] + d - 1]);
    const x = (ax + bx) / 2, z = (az + bz) / 2;
    return { x, y: (this.y ?? this.engine.surface(x, z)) + level * this.levelHeight, z };
  }
  /**
   * Snap a world position to the center of the cell it is in
   * @example mesh.position.copy(room.snap(hit.point))
   * @param {any} pos
   * @returns {{ x: number, y: number, z: number }}
   */
  snap(pos) { return this.toWorld(this.toCell(pos)); }
  /**
   * Is the cell inside the grid bounds (always true for an unbounded grid)
   * @param {[number, number]} cell
   * @returns {boolean}
   */
  inside([i, j]) { return !this.size || (i >= 0 && j >= 0 && i < this.size[0] && j < this.size[1]); }
  /**
   * Cells covered by a footprint anchored at cell (min corner)
   * @example room.footprint([2, 2], [2, 1], 1)   // [[2,2],[2,3]]: a 2x1 bench turned a quarter covers two cells along z
   * @param {[number, number]} cell
   * @param {[number, number]} [size]
   * @param {number} [rotation]  quarter turns
   * @returns {[number, number][]}
   */
  footprint(cell, size = [1, 1], rotation = 0) {
    const [w, d] = rotation & 1 ? [size[1], size[0]] : size, out = [];
    for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) out.push([cell[0] + a, cell[1] + b]);
    return out;
  }
  /**
   * Id of the world record occupying a cell in one occupancy layer and level, or null. Without occupy: the 'main' layer
   * @example engine.world.get(room.at([3, 5]))                      // the table there
   * @example room.at([3, 5], { occupy: 'floor', level: 1 })         // the rug on that cell upstairs
   * @param {[number, number]} cell
   * @param {{ occupy?: string, level?: number }} [opts]
   * @returns {string | null}
   */
  at([i, j], { occupy = MAIN, level = 0 } = {}) { return this._occ.get(occKey(occupy, level, i, j)) ?? null; }
  /**
   * Everything on a cell at one level, by occupancy layer: { floor: 'rec1', main: 'rec2' } ({} when empty)
   * @example room.stack([3, 5])
   * @param {[number, number]} cell
   * @param {{ level?: number }} [opts]
   * @returns {Record<string, string>}
   */
  stack([i, j], { level = 0 } = {}) {
    const out = {}, tail = `|${level}|${i},${j}`;
    for (const [k, id] of this._occ) if (k.endsWith(tail)) out[k.slice(0, k.length - tail.length)] = id;
    return out;
  }
  /**
   * Ids of the records occupying any cell of an area in one occupancy layer and level (each once)
   * @example room.area([0, 0], [4, 4])
   * @param {[number, number]} cell  min corner
   * @param {[number, number]} [size]
   * @param {{ occupy?: string, level?: number }} [opts]
   * @returns {string[]}
   */
  area(cell, size = [1, 1], opts) {
    const ids = new Set();
    for (const c of this.footprint(cell, size)) { const id = this.at(c, opts); if (id) ids.add(id); }
    return [...ids];
  }
  /**
   * Can this go here? Returns true or a reason: outOfBounds, occupied, wrongGround, not<Field> (a layer rule such as notPowered), notFlat, or the item's own can reason.
   * what is an item name registered with engine.grids.define, a size [w, d], or an inline rule { size, occupy, ground, layer, flat, can }.
   * Occupied means taken in the item's own occupancy layer at that level: a 'floor' tile does not block a 'main' table.
   * @example room.can('table', [3, 5])                        // 'occupied' when another table stands there, true over a rug
   * @example field.can('tower', [3, 5])                       // 'notBuildable' until the zone layer marks the cell buildable
   * @example room.can([2, 1], [0, 0], { rotation: 1 })       // only bounds, occupancy and flatness
   * @param {string | [number, number] | GridRule} what
   * @param {[number, number]} cell
   * @param {{ rotation?: number, ignore?: string, level?: number }} [opts]  ignore: a record id to skip (moving a thing over its own cells); level: storey
   * @returns {true | string}
   */
  can(what, cell, opts) { return this.check(what, cell, opts).code ?? true; }
  /**
   * can() with the details behind the answer (used by engine.explain): { code, cell, by } where by is the occupying record id
   * @param {string | [number, number] | GridRule} what
   * @param {[number, number]} cell
   * @param {{ rotation?: number, ignore?: string, level?: number }} [opts]
   * @returns {{ code: string | null, cell?: [number, number], by?: string, text?: string }}
   */
  check(what, cell, { rotation = 0, ignore, level = 0 } = {}) {
    const rule = this._owner._rule(what), e = this.engine, cells = this.footprint(cell, rule.size, rotation), occupy = rule.occupy ?? MAIN;
    for (const c of cells) if (!this.inside(c)) return { code: 'outOfBounds', cell: c };
    for (const c of cells) { const by = this.at(c, { occupy, level }); if (by && by !== ignore) return { code: 'occupied', cell: c, by }; }
    // ground type and flatness are about the terrain: only level 0 on a grid that follows the ground stands on it
    const onGround = level === 0 && this.y == null;
    const ground = rule.ground == null || !onGround ? null : [].concat(rule.ground);
    for (const c of cells) {
      const p = this.toWorld(c);
      if (ground && !ground.includes(e.groundType(p.x, p.z))) return { code: 'wrongGround', cell: c, text: `ground is ${e.groundType(p.x, p.z)}, needs ${ground.join(' / ')}` };
      for (const [layer, field] of Object.entries(rule.layer ?? {})) {
        if (!this.layer(layer).get(c)?.[field]) return { code: 'not' + cap(field), cell: c, text: `layer ${layer} has no ${field} here` };
      }
    }
    const flat = rule.flat ?? this.flat;
    if (flat < Infinity && onGround) {
      let lo = Infinity, hi = -Infinity;
      // each cell's center and the four points half a cell off it (the corners on the square lattice): a step inside the footprint counts too
      const h2 = this.cell / 2;
      for (const c of cells) {
        const [x, z] = this._map.center(c);
        for (const [dx, dz] of FLAT_SAMPLES) { const h = e.surface(x + dx * h2, z + dz * h2); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      }
      if (hi - lo > flat) return { code: 'notFlat', text: `height varies ${(hi - lo).toFixed(2)} m, allowed ${flat}` };
    }
    const own = rule.can?.(e, { grid: this, cell, rotation, cells, level });
    if (own != null && own !== true) return { code: String(own) };
    return { code: null };
  }
  /**
   * A named per-cell data layer on this grid (created on first use): buildable zones, paint, ownership, power, soil, anything plain.
   * Writes go through ops like other saved gameplay state; the data is saved with the game (only non-empty cells).
   * @example const zone = field.layer('zone');   // in an op: zone.set([3, 5], { buildable: true })
   * @example room.layer('paint', { tiles: false })   // no tile visuals for this layer
   * @param {string} name
   * @param {import('./Layer.js').LayerOptions} [opts]  only read on creation
   * @returns {Layer}
   */
  layer(name, opts) {
    let l = this._layers.get(name);
    if (!l) { l = new Layer(this, name, opts); this._layers.set(name, l); this._owner._layerAdded(l); }
    else if (opts && l._byContent) { l.opts = opts; this._owner._retile(l); }   // made early for content/grids.js cells: the game's first opts still count
    if (opts) l._byContent = false;
    return l;
  }
  /** Layers created so far @returns {Layer[]} */
  get layers() { return [...this._layers.values()]; }
  /** Number of occupied cells @returns {number} */
  get occupied() { return this._occ.size; }
}

/**
 * Placement rule: what engine.grids.define registers, or an inline rule for can()
 * @typedef {{ size?: [number, number], kind?: string, occupy?: string, ground?: string | string[], layer?: Record<string, string>, flat?: number,
 *   fields?: Record<string, any>, can?: (e: any, info: { grid: Grid, cell: [number, number], rotation: number, cells: [number, number][], level: number }) => true | string }} GridRule
 */
