// Terrain edits (engine.terrain.edit): dig, raise, flatten, and paint the ground type of cells (tilled soil, wet soil, a path).
// Records are plain data owned here: grid-point heights and cell types, saved with the save (key 'terrain'). The main-thread generator reads
// the same maps (so engine.surface / slope / groundType and collision see an edit at once); each worker job carries the edits around its chunk,
// so a chunk generated later -- or regenerated after the player walked away and back -- comes out edited, identically with threads on or off.
// Loaded chunks around an edit are rebuilt on the spot (mesh, vegetation, collision token); a worker result built before the edit is dropped.
import { checkOptions, DEV } from '../../core/validate.js';
import { xzOf } from '../../core/math.js';
import { updateColorMap } from './terrainTexture.js';

const EDIT_KEYS = ['radius', 'shape', 'raise', 'lower', 'flatten', 'paint'];
const STRINGS = {
  none: "terrain.edit(): pass at least one of raise, lower, flatten or paint, e.g. engine.terrain.edit(pos, { radius: 2, lower: 1 })",
  many: 'terrain.edit(): raise, lower and flatten all set the height; pass only one of them',
  shape: "terrain.edit(): shape must be 'circle' or 'square', got {got}",
  num: 'terrain.edit(): {k} must be a finite number, got {got}',
  paint: "terrain.edit(): paint must be a ground type name such as 'tilled', or null to give the cells back their generated type; got {got}",
};
const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
const unkey = k => [Math.floor(k / 100000) - 50000, (k % 100000) - 50000];

/** @internal owned by ChunkManager (engine.terrain.edits) */
export class TerrainEdits {
  constructor(engine, mgr) {
    this.e = engine; this.mgr = mgr;
    this.h = new Map();     // grid key -> height of grid point (i * cell, j * cell)
    this.t = new Map();     // cell key -> ground type of cell [i, i + 1) x [j, j + 1)
    this.ver = new Map();   // chunk key 'cx,cz' -> edit version (jobs carry it; an older result is stale)
    this.attach();
    engine.saves.register('terrain', { save: () => this.save(), load: d => this.load(d) });
  }
  /** Point the main-thread generator at the edit maps (again after the generator is rebuilt, e.g. a height map finished loading) */
  attach() { this.mgr.T.useEdits(this.h, this.t); }

  edit(position, o = {}) {
    DEV && this.e.ops.guard('terrain.edit');
    checkOptions('terrain.edit()', o, EDIT_KEYS);
    const ops = ['raise', 'lower', 'flatten'].filter(k => o[k] != null);
    if (!ops.length && !('paint' in o)) throw new Error(STRINGS.none);
    if (ops.length > 1) throw new Error(STRINGS.many);
    for (const k of [...ops, 'radius']) if (o[k] != null && !Number.isFinite(o[k])) throw new Error(fmt(STRINGS.num, { k, got: o[k] }));
    if (o.shape != null && o.shape !== 'circle' && o.shape !== 'square') throw new Error(fmt(STRINGS.shape, { got: JSON.stringify(o.shape) }));
    if ('paint' in o && o.paint !== null && typeof o.paint !== 'string') throw new Error(fmt(STRINGS.paint, { got: JSON.stringify(o.paint) }));
    const T = this.mgr.T, C = T.CELL, [x, z] = xzOf(position), r = o.radius ?? C / 2, sq = o.shape === 'square';
    const inside = (px, pz) => sq ? Math.abs(px - x) <= r && Math.abs(pz - z) <= r : (px - x) ** 2 + (pz - z) ** 2 <= r * r;
    // grid indices covered: points use (i * C), cells their center ((i + 0.5) * C); an edit smaller than a cell still takes the nearest one
    const pick = (off, fallback) => {
      const out = [];
      for (let j = Math.floor((z - r) / C) - 1; j <= Math.ceil((z + r) / C); j++)
        for (let i = Math.floor((x - r) / C) - 1; i <= Math.ceil((x + r) / C); i++) if (inside((i + off) * C, (j + off) * C)) out.push(i, j);
      return out.length ? out : fallback;
    };
    let heights = 0, cells = 0, i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    const grow = (i, j) => { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); };
    if (ops.length) {
      const pts = pick(0, [Math.round(x / C), Math.round(z / C)]);
      // read every height first, then write: the result does not depend on visiting order
      const cur = []; for (let n = 0; n < pts.length; n += 2) cur.push(T.gridH(pts[n], pts[n + 1]));
      for (let n = 0; n < pts.length; n += 2) {
        const h = o.flatten ?? cur[n / 2] + (o.raise ?? 0) - (o.lower ?? 0);
        this.h.set(T.key(pts[n], pts[n + 1]), h); heights++; grow(pts[n], pts[n + 1]);
      }
    }
    if ('paint' in o) {
      const cs = pick(0.5, [Math.floor(x / C), Math.floor(z / C)]);
      for (let n = 0; n < cs.length; n += 2) {
        const k = T.key(cs[n], cs[n + 1]);
        if (o.paint === null) this.t.delete(k); else this.t.set(k, o.paint);
        cells++; grow(cs[n], cs[n + 1]);
      }
    }
    this._touch(i0, i1, j0, j1);
    return { heights, cells };
  }

  /** Edits a worker needs to build chunk (cx, cz): those of the chunk and its 8 neighbors (normals and borders read one grid point past the edge) */
  forChunk(cx, cz) {
    if (!this.h.size && !this.t.size) return null;
    const R = this.mgr.T.RES, near = (i, j) => Math.abs(Math.floor(i / R) - cx) <= 1 && Math.abs(Math.floor(j / R) - cz) <= 1;
    const h = [], t = [];
    for (const [k, v] of this.h) { const [i, j] = unkey(k); if (near(i, j)) h.push(i, j, v); }
    for (const [k, v] of this.t) { const [i, j] = unkey(k); if (near(i, j)) t.push([i, j, v]); }
    return h.length || t.length ? { h, t } : null;
  }
  version(key) { return this.ver.get(key) ?? 0; }

  /** Grid range [i0, i1] x [j0, j1] changed: bump the version of every chunk it reaches, rebuild loaded ones now, tell listeners */
  _touch(i0, i1, j0, j1) {
    if (i0 > i1) return;
    const m = this.mgr, R = m.T.RES, C = m.T.CELL;
    // a grid point is shared by the cells on both sides, and smooth normals read one point further
    for (let cz = Math.floor((j0 - 2) / R); cz <= Math.floor((j1 + 2) / R); cz++)
      for (let cx = Math.floor((i0 - 2) / R); cx <= Math.floor((i1 + 2) / R); cx++) {
        const k = cx + ',' + cz, c = m.chunks.get(k);
        this.ver.set(k, this.version(k) + 1);
        if (c?.state === 'ready') this._rebuild(c);
      }
    this.e.events.emit('ground:change', { x0: (i0 - 1) * C, z0: (j0 - 1) * C, x1: (i1 + 2) * C, z1: (j1 + 2) * C });
  }

  // same code as the worker on the full edit maps, so a rebuilt chunk equals a freshly generated one
  _rebuild(c) {
    const m = this.mgr, T = m.T, t = T.buildChunk(c.cx, c.cz), g = c.terrain.geometry;
    for (const [n, a] of [['position', t.pos], ['normal', t.nor], ['color', t.col], ['uv', t.uv]]) { g.attributes[n].array.set(a); g.attributes[n].needsUpdate = true; }
    if (t.tex) updateColorMap(c, t.tex);
    g.computeBoundingSphere(); g.boundingBox = null;
    c.sphere.center.set(t.sphere[0], t.sphere[1], t.sphere[2]); c.sphere.radius = t.sphere[3];
    const veg = this.e.vegetation;
    if (veg) for (const sp of veg.list()) {
      if (sp.nearOnly && !c.veg[sp.name]) continue;   // detail not loaded here; when it is, its job carries the edits
      const r = T.place(c.cx, c.cz, sp.rule, m.density), old = c.veg[sp.name];
      if (!r.n && old) { c.group.remove(old); old.dispose(); delete c.veg[sp.name]; }
      m._applyVeg(c, sp.name, r);
    }
    c.colToken = {}; c.level = -1; c.detailDone.clear();   // edits can change what grows here: re-ask for the near-only species   // new token: the physics module rebuilds this chunk's collision
  }

  save() {
    const h = [], t = [];
    for (const [k, v] of this.h) h.push(...unkey(k), v);
    for (const [k, v] of this.t) t.push([...unkey(k), v]);
    return { h, t };
  }
  load(d) {
    const T = this.mgr.T, before = [...this.h.keys(), ...this.t.keys()];
    this.h.clear(); this.t.clear();
    for (let n = 0; n < (d?.h?.length ?? 0); n += 3) this.h.set(T.key(d.h[n], d.h[n + 1]), d.h[n + 2]);
    for (const [i, j, v] of d?.t || []) this.t.set(T.key(i, j), v);
    // rebuild what changed: chunks that had edits before and chunks that have them now
    const seen = new Set(), R = T.RES;
    for (const k of [...before, ...this.h.keys(), ...this.t.keys()]) {
      const [i, j] = unkey(k), cx = Math.floor(i / R), cz = Math.floor(j / R);
      if (seen.has(cx + ',' + cz)) continue;
      seen.add(cx + ',' + cz); this._touch(cx * R, cx * R + R, cz * R, cz * R + R);
    }
  }
}
