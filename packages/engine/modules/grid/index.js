// grids() module: placement grids for anything placed on cells (furniture, building, crops, crates, tactics tiles). Installed as engine.grids; costs nothing when not installed.
//   engine.use(world(), grids());
//   const room = engine.grids.add('room', { cell: 1, origin: [0, 0], size: [16, 12] });
//   engine.grids.define('table', { size: [2, 1], layer: { floor: 'wood' } });
//   engine.ops.run('grid.place', { grid: 'room', item: 'table', cell: [3, 5] });
// Where state lives (nothing is stored twice):
//   placed things  -> world records with a `grid` field (saved by world); occupancy is an index rebuilt from them (world:add / change / remove / load)
//   per-cell layers -> Layer maps, saved here under the save key 'grids' (version 2) as a per-cell diff against the authored cells (Layer.js)
// The index is the "don't go around it" check: in dev a record's grid field is frozen (editing it in place throws), writes outside ops
// trigger the ops guard, and a record whose footprint overlaps another one is reported with the fix.
import { Grid } from './Grid.js';
import { layerTiles } from './tiles.js';
import { makePreview } from './preview.js';
import { defineGridOps, placed } from './ops.js';

/** Grids save part: version 1 stored every cell of a layer whole ([[i, j, data]]); version 2 stores a diff against the authored cells (Layer.js) */
const GRIDS_MIGRATE = { 1: d => Object.fromEntries(Object.entries(d || {}).map(([g, ls]) => [g, Object.fromEntries(Object.entries(ls || {}).map(([n, rows]) => [n, { set: rows, whole: true }]))])) };
import { checkOptions, closest, DEV } from '../../core/validate.js';

const STRINGS = {
  dup: "grids.add('{name}'): a grid with this name exists",
  noGrid: "grid '{name}': no such grid{hint}. Grids: {list}",
  noItem: "grid item '{name}' is not defined{hint}: engine.grids.define('{name}', { size: [1, 1] }). Defined: {list}",
  overlap: "[engine] grid '{grid}': {id} overlaps {other} at cell {cell}; the cell stays with {other}. Place things with engine.ops.run('grid.place', ...) / 'grid.move', which check can() first",
};
const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const hint = (n, list) => { const c = closest(n, list); return c ? ` (did you mean '${c}'?)` : ''; };
const freeze = p => { Object.freeze(p.cell); Object.freeze(p.size); return Object.freeze(p); };

/**
 * engine.grids: every placement grid, the item rules, previews and the occupancy index
 * @example
 * const farm = engine.grids.add('farm', { cell: 1, origin: [0, 0], size: [16, 12] });
 * engine.grids.define('bed', { size: [2, 1], kind: 'furniture', fields: { model: 'bed' } });
 * engine.ops.run('grid.place', { grid: 'farm', item: 'bed', cell: [4, 4], rotation: 1 });
 * @experimental
 */
export class Grids {
  /** @internal */
  constructor(e) {
    /** @internal */ this.engine = e;
    /** @internal */ this._grids = new Map();
    /** @internal */ this._defs = new Map();
    /** @internal id -> { g, keys } */ this._byId = new Map();
    /** @internal */ this._tiles = new Map();
    /** @internal */ this._previews = new Set();
    /** @internal layer data from a save, for layers created after the load */ this._loaded = null;
  }
  /**
   * Create a grid. cell: edge length (m, default 1); origin: world [x, z] of the min corner of cell [0, 0]; size: [cells wide, cells deep] (omit = unbounded);
   * zone: level name (tiles only show there); flat: max height difference under a footprint (m, default 0.5);
   * layers: authored cells { soil: [[i, j, { tilled: true }], ...] } (content/grids.js): the baseline a save diffs against, so a save keeps only changed cells
   * @example const room = engine.grids.add('room', { cell: 0.5, origin: [-3, -3], size: [12, 12], zone: 'house' })
   * @param {string} name
   * @param {{ cell?: number, origin?: any, size?: [number, number], zone?: string, flat?: number, layers?: Record<string, [number, number, Record<string, any>][]> }} [opts]
   * @returns {Grid}
   */
  add(name, opts = {}) {
    checkOptions(`grids.add('${name}')`, opts, ['cell', 'origin', 'size', 'zone', 'flat', 'layers']);
    if (this._grids.has(name)) throw new Error(fmt(STRINGS.dup, { name }));
    const g = new Grid(this.engine, this, name, opts);
    this._grids.set(name, g);
    for (const [ln, rows] of Object.entries(opts.layers ?? {})) { const l = g.layer(ln); l._byContent = true; l._setBase(rows); }
    this._rebuild();   // records placed on it before it existed (content, a loaded save) now count
    return g;
  }
  /**
   * A grid by name, or null when there is none
   * @param {string} name
   * @returns {Grid | null}
   */
  get(name) { return this._grids.get(name) ?? null; }
  /** @internal A grid by name; throws with the names that exist */
  _must(name) {
    const g = this._grids.get(name);
    if (!g) throw new Error(fmt(STRINGS.noGrid, { name, hint: hint(name, [...this._grids.keys()]), list: [...this._grids.keys()].join(', ') || 'none' }));
    return g;
  }
  /**
   * @internal The record a placement makes (kind + fields), the same math as the grid.place op; content uses it for pre-placed grid items (props entries with grid)
   * @param {string} grid @param {string} item @param {[number, number]} cell @param {number} rotation
   */
  placement(grid, item, cell, rotation) {
    const g = this._must(grid), rule = this._rule(item);
    return { kind: rule.kind ?? item, fields: { ...structuredClone(rule.fields ?? {}), ...placed(g, rule, item, cell, rotation) } };
  }
  /** All grids (a new array) @returns {Grid[]} */
  list() { return [...this._grids.values()]; }
  /**
   * Register what can be placed and its rules. size [w, d] in cells (default [1, 1]); kind of the world record (default the item name);
   * ground: allowed engine.groundType values; layer: { layerName: field } that must be truthy on every cell (reason 'not' + Field, e.g. notTilled);
   * flat: max height difference (overrides the grid's); fields: copied into the record; can(e, { grid, cell, rotation, cells }): your own rule
   * @example engine.grids.define('crop', { size: [1, 1], layer: { soil: 'tilled' }, fields: { plantedAt: 0 } })
   * @example engine.grids.define('shed', { size: [3, 2], ground: ['grass', 'dirt'], flat: 0.2 })
   * @param {string} name
   * @param {import('./Grid.js').GridRule} rule
   * @returns {void}
   */
  define(name, rule) {
    checkOptions(`grids.define('${name}')`, rule, ['size', 'kind', 'ground', 'layer', 'flat', 'fields', 'can']);
    this._defs.set(name, { size: [1, 1], ...rule });
  }
  /** @internal item name / size / inline rule -> rule */
  _rule(what) {
    if (typeof what === 'string') {
      const r = this._defs.get(what);
      if (!r) throw new Error(fmt(STRINGS.noItem, { name: what, hint: hint(what, [...this._defs.keys()]), list: [...this._defs.keys()].join(', ') || 'none' }));
      return r;
    }
    return Array.isArray(what) ? { size: what } : { size: [1, 1], ...what };
  }
  /**
   * Show where an item would go: the target cell under the pointer ('pointer', default), in front of the player ('front') or from your
   * function, turned by the input action rotate (default name 'rotate'; the game binds it, or pass rotateKeys / ...presets.keys.gridRotate, the engine binds no key itself), light when can() passes, dark otherwise (neutral tool colors; style.grid.ok / bad override them).
   * look: false = no visual; (engine) => ({ update(view), hide(), dispose() }) = your own. place() runs grid.place with what is shown
   * @example engine.input.define('place', ['Mouse0']);   // the game's own binding
   *   const pv = engine.grids.preview({ grid: 'farm', item: 'crop', ...presets.keys.gridRotate });
   *   engine.onFrame(() => { if (engine.input.pressed('place')) { const r = pv.place(); if (!r.ok) toast(engine, engine.t('grid.' + r.reason)); } });
   * @param {{ grid: string, item: string, from?: 'pointer' | 'front' | ((e: any) => any), rotate?: string | false, rotateKeys?: string[], rotation?: number, look?: false | ((e: any) => any) }} opts
   * @returns {{ cell: [number, number] | null, rotation: number, ok: boolean, reason: string | null, rotate(n?: number): void, place(fields?: object): { ok: boolean, value?: any, reason?: string }, remove(): void }}
   */
  preview(opts) {
    checkOptions('grids.preview()', opts, ['grid', 'item', 'from', 'rotate', 'rotateKeys', 'rotation', 'look']);
    return makePreview(this.engine, this, opts);
  }

  /** @internal a layer was created: load saved data waiting for it, build its tiles */
  _layerAdded(l) {
    const d = this._loaded?.[l.grid.name]?.[l.name];
    if (d) l.fromJSON(d);
    const t = layerTiles(this.engine, l);
    if (t) this._tiles.set(l, t);
  }
  /** @internal a layer's options changed after content created it: rebuild its tiles */
  _retile(l) { this._tiles.get(l)?.dispose(); this._tiles.delete(l); const t = layerTiles(this.engine, l); if (t) this._tiles.set(l, t); }
  /** @internal */
  _index(rec) {
    const p = rec.grid, g = this._grids.get(p.id);
    if (DEV && !Object.isFrozen(p)) freeze(p);
    if (!g) return;
    const keys = [];
    for (const [i, j] of g.footprint(p.cell, p.size, p.rotation)) {
      const k = i + ',' + j, other = g._occ.get(k);
      if (other && other !== rec.id) { if (DEV) console.warn(fmt(STRINGS.overlap, { grid: g.name, id: rec.id, other, cell: k })); continue; }
      g._occ.set(k, rec.id); keys.push(k);
    }
    this._byId.set(rec.id, { g, keys });
  }
  /** @internal */
  _unindex(id) {
    const x = this._byId.get(id); if (!x) return;
    for (const k of x.keys) if (x.g._occ.get(k) === id) x.g._occ.delete(k);
    this._byId.delete(id);
  }
  /** @internal */
  _reindex(id) { this._unindex(id); const r = this.engine.world.get(id); if (r?.grid) this._index(r); }
  /** @internal whole index from world records, by id so overlaps resolve the same way every time */
  _rebuild() {
    for (const g of this._grids.values()) g._occ.clear();
    this._byId.clear();
    const recs = [...this.engine.world.records.values()].filter(r => r.grid).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const r of recs) this._index(r);
  }
  /** @internal */
  toJSON() {
    // orphans kept: a loaded diff for a grid or layer that does not exist (yet) this run is written back as it was, so nothing is lost
    const out = structuredClone(this._loaded ?? {});
    for (const g of this._grids.values()) for (const l of g._layers.values()) {
      if (l._same) { if (out[g.name]) delete out[g.name][l.name]; } else (out[g.name] ??= {})[l.name] = l.toJSON();
    }
    for (const k of Object.keys(out)) if (!Object.keys(out[k]).length) delete out[k];
    return out;
  }
  /** @internal */
  fromJSON(d) {
    this._loaded = d ?? {};
    for (const g of this._grids.values()) for (const l of g._layers.values()) l.fromJSON(this._loaded[g.name]?.[l.name]);
  }
  /** @internal one line per grid for describe() */
  _describe() {
    const out = {};
    for (const g of this._grids.values()) {
      const items = {};
      for (const [id, x] of this._byId) if (x.g === g) { const it = this.engine.world.get(id)?.grid?.item ?? 'other'; items[it] = (items[it] || 0) + 1; }
      const layers = {};
      for (const l of g._layers.values()) layers[l.name] = l.count;
      out[g.name] = { cell: g.cell, size: g.size, occupied: g.occupied, items, layers };
    }
    return out;
  }
  /** @internal engine.explain({ grid: { grid, item, cell, rotation } }) */
  _explain(q) {
    const g = this.get(q?.grid);
    if (!g) return { ok: false, text: `no grid '${q?.grid}' (grids: ${[...this._grids.keys()].join(', ') || 'none'})` };
    const r = g.check(q.item, q.cell, { rotation: q.rotation ?? 0 });
    const head = `${q.item} at ${g.name} [${q.cell}] rotation ${q.rotation ?? 0}`;
    if (!r.reason) return { ok: true, text: `${head} can be placed` };
    const by = r.by ? ` by ${r.by} (${this.engine.world.get(r.by)?.grid?.item ?? this.engine.world.get(r.by)?.kind})` : '';
    return { ok: false, reason: r.reason, text: `${head} cannot be placed: ${r.reason}${r.cell ? ` at cell [${r.cell}]` : ''}${by}${r.text ? ` (${r.text})` : ''}` };
  }
}

/**
 * Grid placement module: installed as engine.grids. Needs world(). Adds the ops grid.place / grid.remove / grid.move and the save key 'grids' (layers).
 * @example engine.use(world(), grids())
 * @returns {import('../../types/core').ModuleDef<Grids>}
 * @experimental
 */
export function grids() {
  let G = null, offOps = null;
  const subs = [];
  return {
    name: 'grids', label: 'Grid placement', stage: 'gameplay', requires: ['world'],
    install(e) {
      G = new Grids(e);
      e.saves.register('grids', { atomic: true, version: 2, migrate: GRIDS_MIGRATE, save: () => G.toJSON(), load: d => G.fromJSON(d) });
      offOps = defineGridOps(e, G);
      subs.push(
        e.events.on('world:add', ({ id }) => G._reindex(id)),
        e.events.on('world:remove', ({ id }) => G._unindex(id)),
        e.events.on('world:change', ({ id, keys }) => { if (keys.includes('grid')) G._reindex(id); }),
        e.events.on('world:load', () => G._rebuild()),
      );
      return G;
    },
    frame() { for (const t of G._tiles.values()) t.frame(); for (const p of G._previews) p.frame(); },
    explain: { grid: (e, q) => G._explain(q) },
    describe() { return G._describe(); },
    dispose() {
      for (const s of subs) s.remove();
      offOps?.();
      for (const t of G._tiles.values()) t.dispose();
      for (const p of [...G._previews]) p.remove();
    },
  };
}
