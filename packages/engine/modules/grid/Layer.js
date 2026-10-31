// A named per-cell data layer on a grid (grid.layer('soil')): plain data per cell, only non-empty cells stored.
// Why a layer and not world records: a farm has hundreds of tilled / watered cells that are state, not things;
// one record per cell would cost a model slot, a sim entry and a save entry each. A layer is one Map, saved as [[i, j, data], ...].
// Writes are saved gameplay state, so they pass the ops guard like world.set (write inside an op or a fixed step).
// _ver counts changes so views (tiles) rebuild only when something changed, without events.
import { DEV } from '../../core/validate.js';

const key = (i, j) => i + ',' + j;
const plainErr = (where, v) => `${where}: layer data must be plain values (numbers, strings, booleans, arrays, plain objects); got ${v?.constructor?.name ?? typeof v}. Keep models in tiles / world.present`;
function checkPlain(where, v) {
  if (v == null || typeof v !== 'object') { if (typeof v === 'function' || typeof v === 'symbol') throw new Error(plainErr(where, v)); return; }
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw new Error(plainErr(where, v));
  for (const x of Object.values(v)) checkPlain(where, x);
}

/**
 * Per-cell plain data on a grid. Create with grid.layer(name). Change it inside an op (it is saved gameplay state).
 * @example
 * engine.ops.define('farm.till', { args: { cell: 'any' },
 *   can: (e, { cell }) => farm.inside(cell) && !farm.at(cell) || 'blocked',
 *   run: (e, { cell }) => farm.layer('soil').set(cell, { tilled: true }) });
 * engine.ops.define('farm.dryAll', { run: () => farm.layer('soil').updateAll(d => { delete d.watered; }) });   // e.g. from sky.daily at 06:00
 */
/** Stored cell data is never edited in place (writes go through set / updateAll, which the ops guard and the tile redraw see); dev builds freeze it so a stray write throws */
const seal = d => DEV ? Object.freeze(d) : d;

/** @experimental */
export class Layer {
  /** @internal */
  constructor(grid, name, opts = {}) {
    /** @internal */ this.grid = grid;
    /** Layer name @type {string} */
    this.name = name;
    /** @internal */ this.opts = opts;
    /** @internal 'i,j' -> data */ this._cells = new Map();
    /** @internal bumped on every change */ this._ver = 0;
  }
  /** @internal */
  _guard(what) { DEV && this.grid.engine.ops.guard(`grid layer ${this.grid.name}.${this.name}.${what}`); }
  /**
   * Data of a cell, or undefined. Read only (frozen in dev builds): change it with set / clear / updateAll
   * @example farm.layer('soil').get([3, 5])?.watered
   * @param {[number, number]} cell
   * @returns {Record<string, any> | undefined}
   */
  get([i, j]) { return this._cells.get(key(i, j)); }
  /**
   * Merge fields into a cell's data (created if empty); a field set to null / undefined is deleted, and a cell left with no fields is cleared. Returns the data
   * @example farm.layer('soil').set([3, 5], { tilled: true, watered: true })
   * @example farm.layer('soil').set([3, 5], { watered: null })   // dry this one cell
   * @param {[number, number]} cell
   * @param {Record<string, any>} patch
   * @returns {Record<string, any> | undefined}
   */
  set([i, j], patch) {
    this._guard('set');
    if (DEV) checkPlain(`layer ${this.name}.set`, patch);
    const k = key(i, j), d = { ...this._cells.get(k) };
    for (const [f, v] of Object.entries(patch)) { if (v == null) delete d[f]; else d[f] = v; }
    if (Object.keys(d).length) this._cells.set(k, seal(d)); else this._cells.delete(k);
    this._ver++;
    return this._cells.get(k);
  }
  /**
   * Empty a cell
   * @param {[number, number]} cell
   * @returns {void}
   */
  clear([i, j]) { this._guard('clear'); if (this._cells.delete(key(i, j))) this._ver++; }
  /**
   * Non-empty cells, optionally only those in an area (min corner + size), in i then j order
   * @example farm.layer('soil').query([0, 0], [4, 4]).filter(c => c.data.watered).length
   * @param {[number, number]} [cell]
   * @param {[number, number]} [size]
   * @returns {{ cell: [number, number], data: Record<string, any> }[]}
   */
  query(cell, size = [1, 1]) {
    const out = [];
    for (const [k, data] of this._cells) {
      const c = /** @type {[number, number]} */ (k.split(',').map(Number));
      if (!cell || (c[0] >= cell[0] && c[1] >= cell[1] && c[0] < cell[0] + size[0] && c[1] < cell[1] + size[1])) out.push({ cell: c, data });
    }
    return out.sort((a, b) => a.cell[0] - b.cell[0] || a.cell[1] - b.cell[1]);
  }
  /**
   * Change every non-empty cell at once (call it inside an op, e.g. a daily reset). fn may edit the data it gets (a copy) in place;
   * returning null clears the cell, returning an object replaces the data. A cell left with no fields is cleared
   * @example farm.layer('soil').updateAll(d => { delete d.watered; })
   * @param {(data: Record<string, any>, cell: [number, number]) => any} fn
   * @returns {number} cells left
   */
  updateAll(fn) {
    this._guard('updateAll');
    for (const [k, d] of [...this._cells]) {
      const copy = { ...d }, r = fn(copy, /** @type {[number, number]} */ (k.split(',').map(Number)));
      const v = r === undefined ? copy : r;
      if (v == null || !Object.keys(v).length) this._cells.delete(k);
      else { if (DEV) checkPlain(`layer ${this.name}.updateAll`, v); this._cells.set(k, seal(v === d ? { ...v } : v)); }
    }
    this._ver++;
    return this._cells.size;
  }
  /** Number of non-empty cells @returns {number} */
  get count() { return this._cells.size; }
  /** @internal compact save form */
  toJSON() { return this.query().map(({ cell, data }) => [cell[0], cell[1], structuredClone(data)]); }
  /** @internal */
  fromJSON(rows) { this._cells.clear(); for (const [i, j, d] of rows ?? []) this._cells.set(key(i, j), seal(d)); this._ver++; }
}

/**
 * Options of grid.layer(name, opts)
 * @typedef {{ tiles?: boolean | { look?: (data: Record<string, any>, cell: [number, number]) => any, lift?: number }
 *   | ((engine: any, layer: Layer) => { update?: (cells: { cell: [number, number], data: Record<string, any> }[]) => void, dispose?: () => void }) }} LayerOptions
 */
