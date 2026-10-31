// One placement grid (engine.grids.add returns it): world <-> cell math, footprints, occupancy, per-cell layers, can().
// Occupancy is not stored: it is an index derived from world records that carry a `grid` field
// ({ id, cell, size, rotation, item }), so a save holds each placed thing once (in world) and can never disagree with it.
// Cells are integer pairs [i, j]; cell [0, 0] spans origin.x..origin.x+cell on x and origin.z..origin.z+cell on z.
// A footprint is anchored at its min corner cell; rotation is in quarter turns (0-3) and odd turns swap width and depth.
import { Layer } from './Layer.js';
import { xzOf } from '../../core/math.js';

const key = (i, j) => i + ',' + j;
const cap = s => s[0].toUpperCase() + s.slice(1);
// [x, z] here (a grid is flat), [x, y, z] / Vector3 / Object3D / { x, z } as everywhere else
const planar = v => (Array.isArray(v) && v.length === 2 ? v : xzOf(v));

/**
 * A placement grid. Several can exist at once (a farm outdoors, a room indoors); each has its own cell size, origin and bounds.
 * @example
 * const farm = engine.grids.add('farm', { cell: 1, origin: [0, 0], size: [16, 12] });
 * farm.toCell(engine.player.position);            // [3, 5]
 * farm.can('crop', [3, 5]);                       // true or a reason: 'occupied' 'outOfBounds' 'notFlat' 'wrongGround' 'notTilled' ...
 * engine.ops.run('grid.place', { grid: 'farm', item: 'crop', cell: [3, 5] });
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
    /** @internal 'i,j' -> world record id */ this._occ = new Map();
    /** @internal name -> Layer */ this._layers = new Map();
  }

  /**
   * World position (Vector3 / object / [x, z] / [x, y, z] / (x, z)) -> cell [i, j]
   * @example farm.toCell(engine.player.position)
   * @param {any} x
   * @param {number} [z]
   * @returns {[number, number]}
   */
  toCell(x, z) {
    if (typeof x === 'object') [x, z] = planar(x);
    return [Math.floor((x - this.origin.x) / this.cell), Math.floor((z - this.origin.z) / this.cell)];
  }
  /**
   * Center of a footprint in world space, y on the ground (engine.surface). Without size it is the center of one cell
   * @example obj.position.copy(farm.toWorld([3, 5]))
   * @param {[number, number]} cell
   * @param {[number, number]} [size]
   * @param {number} [rotation]  quarter turns
   * @returns {{ x: number, y: number, z: number }}
   */
  toWorld(cell, size = [1, 1], rotation = 0) {
    const [w, d] = rotation & 1 ? [size[1], size[0]] : size;
    const x = this.origin.x + (cell[0] + w / 2) * this.cell, z = this.origin.z + (cell[1] + d / 2) * this.cell;
    return { x, y: this.engine.surface(x, z), z };
  }
  /**
   * Snap a world position to the center of the cell it is in
   * @example mesh.position.copy(farm.snap(hit.point))
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
   * @example farm.footprint([2, 2], [2, 1], 1)   // [[2,2],[2,3]]: a 2x1 bed turned a quarter covers two cells along z
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
   * Id of the world record occupying a cell, or null
   * @example engine.world.get(farm.at([3, 5]))
   * @param {[number, number]} cell
   * @returns {string | null}
   */
  at([i, j]) { return this._occ.get(key(i, j)) ?? null; }
  /**
   * Ids of the records occupying any cell of an area (each once)
   * @example farm.area([0, 0], [4, 4])
   * @param {[number, number]} cell  min corner
   * @param {[number, number]} [size]
   * @returns {string[]}
   */
  area(cell, size = [1, 1]) {
    const ids = new Set();
    for (const c of this.footprint(cell, size)) { const id = this.at(c); if (id) ids.add(id); }
    return [...ids];
  }
  /**
   * Can this go here? Returns true or a reason: outOfBounds, occupied, wrongGround, not<Field> (a layer rule such as notTilled), notFlat, or the item's own can reason.
   * what is an item name registered with engine.grids.define, a size [w, d], or an inline rule { size, ground, layer, flat, can }.
   * @example farm.can('crop', [3, 5])                        // 'notTilled' until the soil layer says tilled
   * @example farm.can([2, 1], [0, 0], { rotation: 1 })       // only bounds, occupancy and flatness
   * @param {string | [number, number] | GridRule} what
   * @param {[number, number]} cell
   * @param {{ rotation?: number, ignore?: string }} [opts]  ignore: a record id to skip (moving a thing over its own cells)
   * @returns {true | string}
   */
  can(what, cell, opts) { return this.check(what, cell, opts).reason ?? true; }
  /**
   * can() with the details behind the answer (used by engine.explain): { reason, cell, by } where by is the occupying record id
   * @param {string | [number, number] | GridRule} what
   * @param {[number, number]} cell
   * @param {{ rotation?: number, ignore?: string }} [opts]
   * @returns {{ reason: string | null, cell?: [number, number], by?: string, text?: string }}
   */
  check(what, cell, { rotation = 0, ignore } = {}) {
    const rule = this._owner._rule(what), e = this.engine, cells = this.footprint(cell, rule.size, rotation);
    for (const c of cells) if (!this.inside(c)) return { reason: 'outOfBounds', cell: c };
    for (const c of cells) { const by = this.at(c); if (by && by !== ignore) return { reason: 'occupied', cell: c, by }; }
    const ground = rule.ground == null ? null : [].concat(rule.ground);
    for (const c of cells) {
      const p = this.toWorld(c);
      if (ground && !ground.includes(e.groundType(p.x, p.z))) return { reason: 'wrongGround', cell: c, text: `ground is ${e.groundType(p.x, p.z)}, needs ${ground.join(' / ')}` };
      for (const [layer, field] of Object.entries(rule.layer ?? {})) {
        if (!this.layer(layer).get(c)?.[field]) return { reason: 'not' + cap(field), cell: c, text: `layer ${layer} has no ${field} here` };
      }
    }
    const flat = rule.flat ?? this.flat;
    if (flat < Infinity) {
      let lo = Infinity, hi = -Infinity;
      const [w, d] = rotation & 1 ? [rule.size[1], rule.size[0]] : rule.size;
      for (let a = 0; a <= w; a++) for (let b = 0; b <= d; b++) {   // corners of every cell: a step inside the footprint counts too
        const h = e.surface(this.origin.x + (cell[0] + a) * this.cell, this.origin.z + (cell[1] + b) * this.cell);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (hi - lo > flat) return { reason: 'notFlat', text: `height varies ${(hi - lo).toFixed(2)} m, allowed ${flat}` };
    }
    const own = rule.can?.(e, { grid: this, cell, rotation, cells });
    if (own != null && own !== true) return { reason: String(own) };
    return { reason: null };
  }
  /**
   * A named per-cell data layer on this grid (created on first use): soil state, wetness, ownership, anything plain.
   * Writes go through ops like other saved gameplay state; the data is saved with the game (only non-empty cells).
   * @example const soil = farm.layer('soil');   // in an op: soil.set([3, 5], { tilled: true })
   * @example farm.layer('soil', { tiles: false })   // no tile visuals for this layer
   * @param {string} name
   * @param {import('./Layer.js').LayerOptions} [opts]  only read on creation
   * @returns {Layer}
   */
  layer(name, opts) {
    let l = this._layers.get(name);
    if (!l) { l = new Layer(this, name, opts); this._layers.set(name, l); this._owner._layerAdded(l); }
    return l;
  }
  /** Layers created so far @returns {Layer[]} */
  get layers() { return [...this._layers.values()]; }
  /** Number of occupied cells @returns {number} */
  get occupied() { return this._occ.size; }
}

/**
 * Placement rule: what engine.grids.define registers, or an inline rule for can()
 * @typedef {{ size?: [number, number], kind?: string, ground?: string | string[], layer?: Record<string, string>, flat?: number,
 *   fields?: Record<string, any>, can?: (e: any, info: { grid: Grid, cell: [number, number], rotation: number, cells: [number, number][] }) => true | string }} GridRule
 */
