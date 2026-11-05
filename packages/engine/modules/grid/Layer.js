// A named per-cell data layer on a grid (grid.layer('zone')): plain data per cell, only non-empty cells stored.
// Why a layer and not world records: a map has hundreds of buildable / painted / powered cells that are state, not things;
// one record per cell would cost a model slot, a sim entry and a save entry each. A layer is one Map.
// Save (part 'grids' version 2): only cells that differ from the authored baseline (content/grids.js layers, like world records diff against content):
//   { set: [[i, j, data], ...] changed or new cells, clear: [[i, j], ...] authored cells the player emptied }. A layer with no baseline saves every cell in set.
//   Version 1 saved every cell whole; its step turns that into { set, whole: true } (cells not listed are empty, whatever content authors now).
// Writes are saved gameplay state, so they pass the ops guard like world.set (write inside an op or a fixed step).
// _ver counts changes so views (tiles) rebuild only when something changed, without events.
import { DEV, needMaterial } from '../../core/base/validate.js';
import { codedError } from '../../core/base/errorHints.js';

const key = (i, j) => i + ',' + j;
const plainErr = (where, v) => `${where}: layer data must be plain values (numbers, strings, booleans, arrays, plain objects); got ${v?.constructor?.name ?? typeof v}. Keep models in tiles / world.present`;
function checkPlain(where, v) {
  if (v == null || typeof v !== 'object') { if (typeof v === 'function' || typeof v === 'symbol') throw codedError('world-plain', plainErr(where, v)); return; }
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw codedError('world-plain', plainErr(where, v));
  for (const x of Object.values(v)) checkPlain(where, x);
}

/**
 * Per-cell plain data on a grid. Create with grid.layer(name). Change it inside an op (it is saved gameplay state).
 * @example
 * engine.ops.define('build.clear', { args: { cell: 'any' },                                  // tower defense: clear a cell to build on
 *   can: (e, { cell }) => field.inside(cell) && !field.at(cell) || 'blocked',
 *   run: (e, { cell }) => field.layer('zone').set(cell, { buildable: true }) });
 * engine.ops.define('power.outage', { run: () => field.layer('zone').updateAll(d => { delete d.powered; }) });   // e.g. at the end of a wave
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
    /** @internal 'i,j' -> authored data (content/grids.js layers): what the save diffs against */ this._base = new Map();
    /** @internal the last save diff applied, so a baseline set after the load (content after the save) still gets it */ this._diff = null;
  }
  /**
   * The three.js material of this layer's tiles (null when it draws none: a data layer, tiles: false or your own part). Set it to swap the picture, used as given.
   * Tile colors are vertex colors, so a material with vertexColors: true shows them; without it, its own color covers every tile.
   * @example field.layer('soil').material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
   * @type {import('three').Material | null}
   */
  get material() { return this.grid._owner._tiles.get(this)?.mesh?.material ?? null; }
  set material(m) {
    const mesh = this.grid._owner._tiles.get(this)?.mesh;
    if (!mesh) throw codedError('grids-misuse', `layer '${this.name}'.material: this layer draws no default tiles; give it a picture first: grid.layer('${this.name}', { tiles: true })`);
    needMaterial('grids-misuse', `layer '${this.name}'.material`, m);
    mesh.material = m;
  }
  /** @internal */
  _guard(what) { DEV && this.grid.engine.ops.guard(`grid layer ${this.grid.name}.${this.name}.${what}`); }
  /**
   * Data of a cell, or undefined. Read only (frozen in dev builds): change it with set / clear / updateAll
   * @example field.layer('zone').get([3, 5])?.buildable
   * @param {[number, number]} cell
   * @returns {Record<string, any> | undefined}
   */
  get([i, j]) { return this._cells.get(key(i, j)); }
  /**
   * Merge fields into a cell's data (created if empty); a field set to null / undefined is deleted, and a cell left with no fields is cleared. Returns the data
   * @example field.layer('zone').set([3, 5], { buildable: true, powered: true })
   * @example field.layer('zone').set([3, 5], { powered: null })   // unpower this one cell
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
   * @example field.layer('zone').query([0, 0], [4, 4]).filter(c => c.data.powered).length
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
   * @example field.layer('zone').updateAll(d => { delete d.powered; })
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
  /** @internal save form: the diff against the authored baseline */
  toJSON() {
    const set = [], clear = [];
    for (const { cell, data } of this.query()) {
      const b = this._base.get(key(cell[0], cell[1]));
      if (!b || JSON.stringify(b) !== JSON.stringify(data)) set.push([cell[0], cell[1], structuredClone(data)]);
    }
    for (const k of this._base.keys()) if (!this._cells.has(k)) clear.push(/** @type {[number, number]} */ (k.split(',').map(Number)));
    return clear.length ? { set, clear } : { set };
  }
  /** @internal true when the layer equals its baseline (nothing to save) */
  get _same() { const d = this.toJSON(); return !d.set.length && !d.clear; }
  /** @internal a save diff (or null = none): baseline first, then the diff */
  fromJSON(d) {
    this._diff = d ?? null;
    this._cells = new Map(d?.whole ? [] : this._base);
    for (const [i, j, v] of d?.set ?? []) this._cells.set(key(i, j), seal(v));
    for (const [i, j] of d?.clear ?? []) this._cells.delete(key(i, j));
    this._ver++;
  }
  /** @internal authored cells ([[i, j, data], ...] from content/grids.js): the baseline; the last loaded diff is applied on top again */
  _setBase(rows) {
    for (const [i, j, v] of rows ?? []) { if (DEV) checkPlain(`content grids layer ${this.name}`, v); this._base.set(key(i, j), seal(structuredClone(v))); }
    this.fromJSON(this._diff);
  }
}

/**
 * Options of grid.layer(name, opts)
 * @typedef {{ tiles?: boolean | { color?: (data: Record<string, any>, cell: [number, number]) => any, colors?: Record<string, number | string>, lift?: number }
 *   | ((engine: any, layer: Layer) => { update?: (cells: { cell: [number, number], data: Record<string, any> }[]) => void, dispose?: () => void }) }} LayerOptions
 */
