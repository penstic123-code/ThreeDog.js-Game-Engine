// Automatic batching, engine.batching: the same static model placed many times is drawn as one THREE.InstancedMesh per (cell, geometry, material),
// with no work from the game. It watches what is added directly to the scene (engine.add, world.present views, stream builds, grid items, props, rigid
// meshes...), so every source of placed models goes through it without knowing about it.
//   Rule: once at least minCount meshes with the same geometry, material and shadow flags sit in one cell (cell meters, default engine.stream.cellSize),
//   they become instances of one InstancedMesh; below that they stay plain meshes. A batch dissolves when it drops under half of minCount.
//   The placed object stays in the scene as it was (its userData, record, colliders, interactions are untouched): only its meshes are hidden and marked
//   moved to layer 31 (BATCH_LAYER: not drawn, not in shadows; visible stays the game's). engine.raycast / pick / photo still hit the original and
//   return it, never an instance index (engine.rays tests layer 31 too). Your own THREE.Raycaster: batching.item(hit.object, hit.instanceId).
//   Moving / hiding / removing the object updates its instance next frame (checked each frame on the object's own transform); recolor with tint().
//   Never batched: skinned / instanced / morphing meshes, objects with animations, multi-material, transparent, ShaderMaterial, custom renderOrder /
//   layers / onBeforeRender, meshes with children, anything hlod registered (userData.hlod), and anything marked userData.batch = false (itself or a parent).
//   Safety net: a batched object whose meshes are changed afterwards (material swapped, shown, re-parented, a child part animated) goes back to plain meshes
//   and its geometry is not batched again (dev warns once: mark such models userData.batch = false).
//   Ownership with hlod: batching owns repeated things that are near enough to be built (props, views, stream entries); hlod owns the level geometry it was
//   given and swaps it for merged proxies far away. A mesh belongs to whichever took it first, so they never fight over visibility.
//   createEngine({ batching: false }) turns it off (nothing is watched, zero cost); engine.batching.enabled = false at runtime dissolves every batch.
/** @import { BatchingOptions, BatchingStats, BatchInfo } from '../types/core' */
import * as THREE from 'three';
import { warnOnce } from './validate.js';
import { BATCH_LAYER, build, join, leave, dissolve, color, localTint, bounds, snap, same, stored, under } from './batchGroups.js';

const OPTS = ['minCount', 'cell'];
const STRINGS = {
  evicted: '[batching] a batched copy of "{name}" changed after batching ({why}); it is drawn on its own from now on. Mark models that animate parts or swap materials with userData.batch = false',
  opts: 'createEngine({ batching }) takes false or { minCount, cell }; unknown key "{key}"',
};
const PROTO_BEFORE = THREE.Object3D.prototype.onBeforeRender;
const HIDDEN = (1 << BATCH_LAYER) >>> 0;   // three keeps layer masks unsigned

/** engine.batching: draws repeated static models as InstancedMesh batches (see the top of core/Batching.js). */
export class Batching {
  /** @internal @param {any} engine @param {BatchingOptions | false} [opts] */
  constructor(engine, opts = {}) {
    for (const k of Object.keys(opts || {})) if (!OPTS.includes(k)) throw new Error(STRINGS.opts.replace('{key}', k));
    /** @internal */ this.engine = engine;
    /** Same model at least this many times in one cell becomes a batch (default 8) @type {number} */
    this.minCount = (opts && opts.minCount) || 8;
    /** @internal */ this._cell = (opts && opts.cell) || null;
    /** @internal key -> group */ this.groups = new Map();
    /** @internal root -> info */ this.roots = new Map();
    /** @internal roots with at least one batched mesh (checked every frame) */ this.live = new Set();
    /** @internal */ this.list = [];
    /** @internal */ this.cursor = 0;
    /** @internal roots added since the last update */ this.incoming = new Set();
    /** @internal mesh -> its original material while a local tint clone is on it */ this.orig = new Map();
    /** @internal mesh -> tint color */ this.tints = new WeakMap();
    /** @internal geometries evicted once (never batched again) */ this.banned = new WeakSet();
    /** @internal batch InstancedMesh -> group */ this.byMesh = new WeakMap();
    /** Geometries and materials a live batch draws (engine.remove does not dispose these) @type {Map<any, number>} */ this.held = new Map();
    /** Parent of every batch InstancedMesh (in the scene) @type {THREE.Group} */
    this.root = new THREE.Group();
    this.root.name = 'batching'; this.root.matrixAutoUpdate = false; this.root.userData.batch = false;
    /** @internal */ this._on = false;
    /** @internal */ this._add = ev => { if (ev.child !== this.root) this.incoming.add(ev.child); };
    /** @internal */ this._rem = ev => { this.incoming.delete(ev.child); this._untrack(ev.child); };
    if (opts !== false) this.enabled = true;
  }

  /** Global switch: false dissolves every batch and stops watching; true starts again (scans what is already in the scene) @type {boolean} */
  get enabled() { return this._on; }
  set enabled(on) {
    if (on === this._on) return;
    const s = this.engine.scene;
    this._on = on;
    if (on) {
      s.addEventListener('childadded', this._add); s.addEventListener('childremoved', this._rem);
      s.add(this.root);
      for (const c of s.children) if (c !== this.root) this.incoming.add(c);
    } else {
      s.removeEventListener('childadded', this._add); s.removeEventListener('childremoved', this._rem);
      for (const r of [...this.roots.keys()]) this._untrack(r);
      this.incoming.clear(); this.root.removeFromParent();
    }
  }
  /** Cell edge in meters (default engine.stream.cellSize) @type {number} */
  get cell() { return this._cell ?? this.engine.stream.cellSize; }
  set cell(v) { this._cell = v; this._rescan(); }

  /** Every batch: { mesh: InstancedMesh, cell, count, items } (items[i] is the placed object drawn by instance i) @returns {BatchInfo[]} */
  get batches() {
    const out = [];
    for (const g of this.groups.values()) if (g.mesh) out.push({ mesh: g.mesh, cell: g.cell, count: g.items.length, items: g.items.map(e => e.info.root) });
    return out;
  }
  /** batches: InstancedMesh count, instances: meshes drawn through them, saved: draw calls saved per pass (instances - batches) @returns {BatchingStats} */
  get stats() {
    let batches = 0, instances = 0;
    for (const g of this.groups.values()) if (g.mesh) { batches++; instances += g.items.length; }
    return { batches, instances, saved: instances - batches };
  }
  /**
   * Where an object is drawn: [{ mesh, index }] for each of its meshes that is batched ([] when drawn on its own).
   * @param {THREE.Object3D} obj placed object (or one of its meshes)
   * @returns {{ mesh: THREE.InstancedMesh, index: number }[]}
   */
  of(obj) {
    const info = this._infoOf(obj), out = [];
    if (info) for (const e of info.entries) if (e.slot >= 0 && (obj === info.root || e.mesh === obj)) out.push({ mesh: e.group.mesh, index: e.slot });
    return out;
  }
  /**
   * The placed object drawn by instance `index` of a batch mesh (for a three.js Raycaster you run yourself; engine.raycast already returns the original).
   * @param {THREE.Object3D} mesh batch InstancedMesh
   * @param {number} index instanceId
   * @returns {THREE.Object3D | null}
   */
  item(mesh, index) { return this.byMesh.get(mesh)?.items[index]?.info.root ?? null; }
  /**
   * Recolor one placed object: its color is multiplied by `color` (instance color when batched, a cloned material otherwise); null restores it.
   * @param {THREE.Object3D} obj
   * @param {THREE.ColorRepresentation | null} c
   * @example engine.batching.tint(engine.world.view('crate_3'), 0xff8080)
   */
  tint(obj, c) {
    obj.traverse(m => {
      if (!m.isMesh) return;
      if (c == null) this.tints.delete(m); else this.tints.set(m, new THREE.Color(c));
      const e = this._entryOf(m);
      if (e && e.slot >= 0) color(this, e); else localTint(this, m);
    });
  }
  /** Re-check one object now (after you changed its parts by hand); normally automatic @param {THREE.Object3D} obj */
  refresh(obj) { const info = this._infoOf(obj); if (info) { this._detach(info); this._untrack(info.root); } if (obj.parent === this.engine.scene) this.incoming.add(obj); }

  /** @internal Called by the engine each frame after frame hooks / stream / jobs, before rendering */
  update() {
    if (!this._on) return;
    if (this.incoming.size) { for (const r of this.incoming) if (r.parent === this.engine.scene) this._track(r); this.incoming.clear(); }
    for (const info of this.live) this._check(info);
    // round robin: look for parts changed behind our back (bounded per frame)
    const L = this.list, n = Math.min(L.length, 256);
    for (let i = 0; i < n; i++) { if (this.cursor >= L.length) this.cursor = 0; this._verify(L[this.cursor++]); }
    for (const g of this.groups.values()) if (g.dirty) { g.dirty = false; bounds(g); }
  }
  /** @internal */
  dispose() { this.enabled = false; this.groups.clear(); }

  // ---------- tracking ----------
  /** @internal */
  _track(root) {
    if (this.roots.has(root) || root.userData.batch === false || root.animations?.length) return;
    const meshes = [];
    let ok = true;
    const walk = (o, top) => {
      if (!ok) return;
      if (o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) { ok = false; return; }
      const u = o.userData;
      if (u.batched) { o.layers.set(0); delete u.batched; }   // a clone of a batched mesh: draw it again
      if (!top && (u.batch === false || !o.visible)) return;   // a hidden root is tracked anyway (it joins when shown)
      if (o.isMesh && this._eligible(o)) meshes.push(o);
      for (const c of o.children) walk(c, false);
    };
    walk(root, true);
    if (!ok || !meshes.length) return;
    const info = { root, entries: [], snap: [], cell: null, shown: false, idx: this.list.length };
    for (const mesh of meshes) info.entries.push({ mesh, info, group: null, slot: -1 });
    this.roots.set(root, info); this.list.push(info);
    snap(root, info.snap);
    if (root.visible) this._attach(info);
  }
  /** @internal */
  _eligible(m) {
    const mat = this.orig.get(m) ?? m.material;
    return !m.children.length && !Array.isArray(mat) && mat && !mat.transparent && !mat.isShaderMaterial && m.geometry?.attributes.position
      && !m.morphTargetInfluences && !Object.keys(m.geometry.morphAttributes).length && !m.userData.hlod && !this.banned.has(m.geometry)
      && m.renderOrder === 0 && m.layers.mask === 1 && m.frustumCulled && m.onBeforeRender === PROTO_BEFORE;
  }
  /** @internal */
  _untrack(root) {
    const info = this.roots.get(root); if (!info) return;
    this._detach(info);
    this.roots.delete(root);
    const last = this.list.pop(); if (last !== info) { this.list[info.idx] = last; last.idx = info.idx; }
  }
  /** @internal */
  _infoOf(obj) { for (let o = obj; o; o = o.parent) { const i = this.roots.get(o); if (i) return i; } return null; }
  /** @internal */
  _entryOf(m) { return this._infoOf(m)?.entries.find(e => e.mesh === m) ?? null; }
  /** @internal */
  _rescan() { if (!this._on) return; this.enabled = false; this.enabled = true; }

  /** @internal put a root's meshes into the groups of its cell */
  _attach(info) {
    const p = info.root.position, cs = this.cell;
    info.cell = Math.floor(p.x / cs) + ',' + Math.floor(p.z / cs); info.shown = true;
    info.root.updateMatrixWorld(true);
    for (const e of info.entries) {
      const m = e.mesh, mat = this.orig.get(m) ?? m.material;
      const key = `${info.cell}|${m.geometry.id}|${mat.id}|${+m.castShadow}${+m.receiveShadow}`;
      let g = this.groups.get(key);
      if (!g) this.groups.set(key, g = { key, cell: info.cell, geometry: m.geometry, material: mat, cast: m.castShadow, receive: m.receiveShadow, members: new Set(), items: [], mesh: null, dirty: false, colored: false });
      e.group = g; g.members.add(e);
      if (g.mesh) join(this, e);
      else if (g.members.size >= this.minCount) build(this, g);
    }
  }
  /** @internal take a root's meshes out of their groups (they draw on their own again) */
  _detach(info) {
    info.shown = false;
    for (const e of info.entries) {
      const g = e.group; if (!g) continue;
      e.group = null; g.members.delete(e);
      if (e.slot >= 0) leave(this, g, e);
      if (g.mesh && g.members.size < Math.ceil(this.minCount / 2)) dissolve(this, g);
      if (!g.members.size) this.groups.delete(g.key);
    }
    this.live.delete(info);
  }

  // ---------- per-frame checks ----------
  /** @internal the object's own transform / visibility changed: move its instances (or regroup when it changed cell) */
  _check(info) {
    const r = info.root;
    if (same(r, info.snap)) return;
    snap(r, info.snap);
    if (!r.visible) { this._detach(info); return; }
    const cs = this.cell, cell = Math.floor(r.position.x / cs) + ',' + Math.floor(r.position.z / cs);
    if (cell !== info.cell || !info.shown) { this._detach(info); this._attach(info); return; }
    r.updateMatrixWorld(true);
    for (const e of info.entries) if (e.slot >= 0) { e.group.mesh.setMatrixAt(e.slot, e.mesh.matrixWorld); e.group.mesh.instanceMatrix.needsUpdate = true; e.group.dirty = true; }
  }
  /** @internal slow round robin: hidden roots coming back, pending roots that moved cell, batched parts changed behind our back */
  _verify(info) {
    const r = info.root;
    if (!this.live.has(info)) {   // not batched: only keep its cell right (so counting stays honest)
      if (!same(r, info.snap)) { snap(r, info.snap); this._detach(info); if (r.visible) this._attach(info); }
      return;
    }
    for (const e of info.entries) {
      if (e.slot < 0) continue;
      const m = e.mesh, g = e.group;
      let why = m.layers.mask !== HIDDEN ? 'layers' : !m.visible ? 'hidden' : m.material !== g.material ? 'material' : m.geometry !== g.geometry ? 'geometry' : m.children.length ? 'children'
        : m.castShadow !== g.cast || m.receiveShadow !== g.receive ? 'shadow flags' : !under(m, r) ? 're-parented' : '';
      if (!why) {
        m.updateWorldMatrix(true, false);
        if (!stored(g.mesh.instanceMatrix.array, e.slot, m.matrixWorld) && same(r, info.snap)) why = 'a part moved';
      }
      if (why) { this._evict(info, why); return; }
    }
  }
  /** @internal */
  _evict(info, why) {
    warnOnce(STRINGS.evicted.replace('{name}', info.root.name || info.entries[0].mesh.name || 'model').replace('{why}', why));
    for (const e of info.entries) this.banned.add(e.mesh.geometry);
    this._untrack(info.root);
  }
}
