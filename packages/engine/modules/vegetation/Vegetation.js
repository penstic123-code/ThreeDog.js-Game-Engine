// Vegetation module: defines what to plant, where, how far before switching to low-poly, and how far before not drawing. Models (the look) come from the game
// or style pack.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeMaterial, applyEffects } from '../../render/materials.js';
import { copyPatches } from '../../render/patches.js';
import { checkOptions, checkOptionsArg, warnMissing } from '../../core/validate.js';
import { xzOf } from '../../core/math.js';
import { GroundChunks } from './groundChunks.js';
// parameters read by vegetation.add(); keys inside rule (sent to the worker thread)
const ADD_KEYS = ['geometry', 'model', 'lodGeometry', 'rule', 'wind', 'nearOnly', 'maxRing', 'lodRing', 'castShadow', 'shadowRing', 'receiveShadow', 'material', 'effects', 'doubleSided'];
const RULE_KEYS = ['perChunk', 'chance', 'minHeight', 'maxHeight', 'maxSlope', 'cluster', 'scale', 'stretch', 'sink', 'tintJitter', 'tints', 'biomes', 'collider', 'avoidFlat', 'salt'];

// Single-instance removal/restore (chop a tree, mine a rock): records are owned by vegetation and saved with the save (save key 'vegetation', entry
// 'veg:<name>:<cx>,<cz>:<id>'), and reapplied when a chunk reloads.
// The id is this tree's stable number (independent of quality and vegetation density), not its index in the instance array.
//   const hit = engine.vegetation.instanceAt(position, { radius: 2, species: '松树' });   // → { species, cx, cz, id, position } or null
//   engine.vegetation.removeInstance(hit.species, hit.cx, hit.cz, hit.id, { regrowSeconds: 300 });  // grows back after 300 game seconds
//   engine.vegetation.restoreInstance(...)   // restore immediately
// Hiding: scale this instance's matrix to 0 (count unchanged) and drop it from the chunk's collision circles.
// Regrowth: the record stores the expiry time (engine.clock game seconds), checked once per second; the clock is saved, so the countdown continues after
// reload.
const KEY_RE = /^veg:(.*):(-?\d+),(-?\d+):(\d+)$/;
const ZERO16 = new Float32Array(16);
const hashName = s => { let h = 7; for (const ch of s) h = (Math.imul(h, 31) + ch.codePointAt(0)) | 0; return h & 0x7fffffff; };
// Multi-material model (bark trunk + alpha-cut leaf cards) -> one geometry with a group per mesh + a material array, so a species stays
// one InstancedMesh: instance matrices, felling and LOD swaps work unchanged for every part. Only attributes all meshes share are kept.
function fromModel(root, label) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), geos = [], mats = [];
  root.traverse(n => {
    if (!n.isMesh) return;
    if (Array.isArray(n.material)) throw new Error(`${label}: model mesh '${n.name}' has several materials; split it into one mesh per material`);
    geos.push(n.geometry.clone().applyMatrix4(n.matrixWorld.clone().premultiply(inv)));
    mats.push(copyPatches(n.material, n.material.clone()));   // the clone keeps the model material's own shader patches
  });
  if (!geos.length) throw new Error(`${label}: model has no meshes`);
  const names = Object.keys(geos[0].attributes).filter(k => geos.every(g => g.attributes[k]));
  const indexed = geos.every(g => g.index);
  const ready = geos.map(g => { const h = indexed ? g : g.toNonIndexed(); for (const k in h.attributes) if (!names.includes(k)) h.deleteAttribute(k); return h; });
  return { geometry: mergeGeometries(ready, true), materials: mats };
}

// stable id -> instance index (built once per InstancedMesh)
function slotOf(im, id) {
  if (!im.userData.slot) { im.userData.slot = new Map(); const ids = im.userData.ids; if (ids) for (let i = 0; i < ids.length; i++) im.userData.slot.set(ids[i], i); }
  return im.userData.slot.get(id);
}

export class Vegetation {
  constructor(engine, opts = {}) {
    this.engine = engine; this.species = new Map();
    // where it grows: on terrain chunks when the terrain module is installed (placed in its workers), else on vegetation's own chunks over
    // whatever provides the ground (a level, a code-built ground, flat). Both hosts keep chunks of one shape, so everything below is shared
    if (engine.terrain && Object.keys(opts).length) throw new Error(`vegetation({ ${Object.keys(opts).join(', ')} }): with terrain() installed vegetation grows on the terrain chunks, and density / view distance are terrain options (terrain({ density, viewChunks })). The vegetation() options are for ground without terrain (a level, a code-built ground)`);
    /** @internal the chunk table vegetation lives in: engine.terrain, or its own GroundChunks */
    this.host = engine.terrain ?? new GroundChunks(engine, this, opts);
    this._removed = new Map();   // 'name:cx,cz' -> Map(id -> regrow time (clock game seconds), null = permanent)
    this._acc = 0;
    engine.saves.register('vegetation', {
      save: () => {
        const removed = {};
        for (const [ck, m] of this._removed) { for (const [id, until] of m) removed[`veg:${ck}:${id}`] = until; }
        return { removed };
      },
      load: d => {
        this._removed.clear();
        for (const [k, until] of Object.entries(d?.removed || {})) {
          const m = KEY_RE.exec(k); if (!m) continue;
          const ck = `${m[1]}:${m[2]},${m[3]}`;
          if (!this._removed.has(ck)) this._removed.set(ck, new Map());
          this._removed.get(ck).set(+m[4], until);
        }
        for (const c of this.host.chunks.values()) for (const n in c.veg) this.applyEdits(c, n);
      },
    });
  }

  /**
   * Register one kind of vegetation.
   * @param {string} name
   * @param {object} o
   *   geometry      high-detail model (this or model is required)
   *   model         Object3D with one material per mesh (e.g. assets.model('oak')): trunk and leaves keep their own materials, still one draw per part
   * lodGeometry low-detail model (optional), used beyond the lodRing ring; with model it is a geometry (drawn with the first material) or an Object3D with the
   * same mesh order
   *   rule          placement rule: perChunk attempts per chunk, minHeight/maxHeight, maxSlope, cluster('forest'|'meadow'|'none'),
   *                 scale[min,max], stretch[min,max], sink, tintJitter, tints[{color:[r,g,b],chance}]
   *   wind          wind sway amplitude (0 disables)
   *   nearOnly      generate only near the player (grass, flowers)
   *   maxRing       not drawn beyond this ring count
   *   lodRing       switch to low-poly beyond this ring count
   *   castShadow / shadowRing  whether to cast shadows, and within how many rings
   *   material      custom material, any three.js material (optional, default is the style pack's 'vegetation' role); wind, cloud
   *                 shadows and season tint are added to it (and its shadow sways) unless effects: false
   */
  add(name, o) {
    checkOptions(`vegetation.add('${name}')`, o, ADD_KEYS);
    checkOptions(`vegetation.add('${name}').rule`, o.rule, RULE_KEYS);
    const fx = m => o.effects === false ? m : applyEffects(m, { wind: o.wind, season: 'foliage' });
    const mdl = o.model && fromModel(o.model, `vegetation.add('${name}')`);
    let lod = o.lodGeometry?.isObject3D ? fromModel(o.lodGeometry, `vegetation.add('${name}').lodGeometry`).geometry : o.lodGeometry || null;
    if (mdl && lod && !lod.groups.length) { lod = lod.clone(); lod.addGroup(0, Infinity, 0); }   // a material array draws nothing without groups
    const sp = {
      name, geometry: mdl ? mdl.geometry : o.geometry, lodGeometry: lod,
      rule: { salt: hashName(name), ...(o.rule || {}) },   // random seed from the name: placement is unaffected by registration order
      nearOnly: !!o.nearOnly, maxRing: o.maxRing ?? (o.nearOnly ? 1 : 99), lodRing: o.lodRing ?? 1,
      castShadow: o.castShadow ?? !o.nearOnly, shadowRing: o.shadowRing ?? 1, receiveShadow: o.receiveShadow ?? true,
      material: mdl ? mdl.materials.map(fx)
        : fx(o.material ?? makeMaterial('vegetation', { vertexColors: true, side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide }, this.engine)),
    };
    this.species.set(name, sp);
    this.host.registerSpecies(name, sp.rule);
    return sp;
  }
  /**
   * Place every chunk again: after changing the ground behind the same provider (a ground function reading game state). A new setGround or level is followed
   * automatically
   */
  rebuild() { this.host.rebuild(); }
  get(name) { return this.species.get(name); }
  list() { return [...this.species.values()]; }
  /** @internal Set from which chunk ring a vegetation kind stops casting shadows (smaller is cheaper); takes effect immediately */
  setShadowRing(name, ring) {
    const sp = this.species.get(name);
    if (!sp) { warnMissing('vegetation', name, [...this.species.keys()]); return; }
    sp.shadowRing = ring;
    this.host.refreshLevels();
  }
  /** @internal terrain plumbing */
  baseNames() { return this.list().filter(s => !s.nearOnly).map(s => s.name); }
  /** @internal terrain plumbing */
  nearNames() { return this.list().filter(s => s.nearOnly).map(s => s.name); }

  // ---------- single-instance remove / restore ----------
  /** @internal save-key format */
  key(species, cx, cz, id) { return `veg:${species}:${cx},${cz}:${id}`; }
  isRemoved(species, cx, cz, id) { return !!this._removed.get(`${species}:${cx},${cz}`)?.has(id); }
  /** Remove one instance (regrowSeconds: game seconds until it grows back, 0/omitted = permanent). The record is saved with the save */
  removeInstance(species, cx, cz, id, { regrowSeconds = 0 } = {}) {
    const ck = `${species}:${cx},${cz}`;
    if (!this._removed.has(ck)) this._removed.set(ck, new Map());
    this._removed.get(ck).set(id, regrowSeconds > 0 ? this.engine.clock.now + regrowSeconds : null);
    this._refresh(species, cx, cz, id);
    this.engine.events.emit('vegetation:remove', { species, cx, cz, id });
    return this.key(species, cx, cz, id);
  }
  restoreInstance(species, cx, cz, id) {
    const ck = `${species}:${cx},${cz}`, m = this._removed.get(ck);
    if (m) { m.delete(id); if (!m.size) this._removed.delete(ck); }
    this._refresh(species, cx, cz, id);
    this.engine.events.emit('vegetation:restore', { species, cx, cz, id });
  }
  /** @internal module hook: check once per second, those due grow back */
  tick(dt) {
    this._acc += dt;
    if (this._acc < 1) return;
    this._acc = 0;
    const now = this.engine.clock.now, due = [];
    for (const [ck, m] of this._removed) {
      const a = ck.lastIndexOf(':');
      for (const [id, until] of m) if (until != null && until <= now) due.push([ck.slice(0, a), ...ck.slice(a + 1).split(',').map(Number), id]);
    }
    for (const d of due) this.restoreInstance(...d);
  }

  /**
   * Nearest instance within radius meters (default 2) of position (loaded chunks only; species restricts to one kind): { species, cx, cz, id, position } or
   * null
   */
  instanceAt(position, opts = {}) {
    checkOptionsArg('vegetation.instanceAt()', opts, ['radius', 'species']);
    const [x, z] = xzOf(position), { radius = 2, species = null } = typeof opts === 'object' && opts ? opts : {};
    const T = this.host, CH = T.CHUNK;
    let best = null, bestD = radius * radius;
    for (let cz = Math.floor((z - radius) / CH); cz <= Math.floor((z + radius) / CH); cz++)
      for (let cx = Math.floor((x - radius) / CH); cx <= Math.floor((x + radius) / CH); cx++) {
        const c = T.chunks.get(cx + ',' + cz);
        if (!c || c.state !== 'ready') continue;
        for (const name in c.veg) {
          if (species && name !== species) continue;
          const im = c.veg[name], a = im.instanceMatrix.array, hid = im.userData.hidden, ox = cx * CH, oz = cz * CH;
          for (let i = 0; i < im.count; i++) {
            if (hid?.has(i)) continue;
            const dx = ox + a[i * 16 + 12] - x, dz = oz + a[i * 16 + 14] - z, d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = { species: name, cx, cz, id: im.userData.ids ? im.userData.ids[i] : i, position: new this.engine.THREE.Vector3(ox + a[i * 16 + 12], a[i * 16 + 13], oz + a[i * 16 + 14]) }; }
          }
        }
      }
    return best;
  }

  /** @internal chunk plumbing (terrain chunks and ground chunks): upload one species' placement result r into chunk c as an InstancedMesh */
  mount(c, name, r) {
    if (r.k && r.k.length) c.colliders[name] = r.k; else delete c.colliders[name];
    (c.collidersAll ||= {})[name] = c.colliders[name];   // original collision circles (before felled trees are filtered), for single-tree removal
    if (r.n === 0) return;
    const sp = this.species.get(name);
    const im = new THREE.InstancedMesh(sp.geometry, sp.material, r.n);
    im.instanceMatrix.array.set(r.m); im.instanceMatrix.needsUpdate = true;
    im.instanceColor = new THREE.InstancedBufferAttribute(r.c, 3);
    im.frustumCulled = false; im.matrixAutoUpdate = false;
    im.receiveShadow = sp.receiveShadow;
    im.userData.ids = r.ids;   // stable id per instance (used by felled-tree records)
    im.userData.budgetTag = 'vegetation';
    c.group.add(im); im.updateMatrixWorld(true);
    if (c.veg[name]) { c.group.remove(c.veg[name]); c.veg[name].dispose(); }
    c.veg[name] = im;
    this.applyEdits(c, name);   // felled trees stay gone after reload
  }
  /** @internal chunk plumbing: drop a near-only species from a chunk that moved out of its ring */
  unmount(c, name) {
    const im = c.veg[name]; if (!im) return;
    c.group.remove(im); im.dispose(); delete c.veg[name]; delete c.colliders[name]; if (c.collidersAll) delete c.collidersAll[name];
  }
  /** @internal chunk plumbing: draw distance, low-poly swap and shadows of one species' instances at a ring */
  levelOf(im, sp, ring) {
    im.visible = ring <= sp.maxRing;
    im.geometry = sp.lodGeometry && ring > sp.lodRing ? sp.lodGeometry : sp.geometry;
    im.castShadow = this.engine.shadows && sp.castShadow && ring <= sp.shadowRing;
  }

  /** @internal Called by the terrain module when a chunk's vegetation was just uploaded: reapply the edit records */
  applyEdits(c, name) {
    const im = c.veg[name];
    if (!im) return;
    const want = this._removed.get(`${name}:${c.cx},${c.cz}`)?.keys() ?? [];
    const hid = im.userData.hidden;
    const wantSlots = new Set(); for (const id of want) { const s = slotOf(im, id); if (s !== undefined) wantSlots.add(s); }
    if (hid) for (const i of [...hid.keys()]) if (!wantSlots.has(i)) this._show(im, i, true);
    for (const i of wantSlots) this._show(im, i, false);
    this._filterColliders(c, name);
  }

  _refresh(species, cx, cz, id) {
    const c = this.host.chunks.get(cx + ',' + cz), im = c?.veg[species];
    if (!im) return;   // chunk not loaded: applyEdits handles it when loaded
    const slot = slotOf(im, id); if (slot === undefined) return;
    this._show(im, slot, !this.isRemoved(species, cx, cz, id));
    this._filterColliders(c, species);
  }

  // show/hide an instance: when hiding, save the original matrix and write an all-zero matrix
  _show(im, i, visible) {
    if (i >= im.count) return;
    const a = im.instanceMatrix.array, hid = (im.userData.hidden ||= new Map());
    if (visible) { const m = hid.get(i); if (!m) return; a.set(m, i * 16); hid.delete(i); }
    else { if (hid.has(i)) return; hid.set(i, a.slice(i * 16, i * 16 + 16)); a.set(ZERO16, i * 16); }
    im.instanceMatrix.needsUpdate = true;
  }

  // collision circles map one-to-one to instances (instance i = group i of [x, z, r]); drop the hidden ones
  _filterColliders(c, name) {
    const all = c.collidersAll?.[name], hid = c.veg[name]?.userData.hidden;
    if (!all) return;
    const before = c.colliders[name];
    if (!hid || !hid.size) c.colliders[name] = all;
    else {
      const out = [];
      for (let i = 0; i < all.length / 3; i++) if (!hid.has(i)) out.push(all[i * 3], all[i * 3 + 1], all[i * 3 + 2]);
      c.colliders[name] = new Float32Array(out);
    }
    if (before !== c.colliders[name]) c.colToken = {};   // tell the physics module to rebuild this chunk's collision
  }
}

const OPTS = ['chunkSize', 'viewChunks', 'density', 'area', 'seed'];
/**
 * Vegetation module. Provides engine.vegetation.add(name, {...}) once installed.
 * With terrain() installed first it grows on the terrain chunks and takes no options (density and view distance are terrain options).
 * Without terrain it grows on its own chunks over whatever provides the ground: a level model (engine.level), a code-built ground
 * (engine.setGround), or the flat default. Rules read engine.surface / slope / groundType, so a level's named surfaces are picked with
 * rule.biomes (a level's ground type is the mesh's groundType property or its material name).
 * @param {{ chunkSize?: number, viewChunks?: number, density?: number, area?: { min: number[], max: number[] }, seed?: number }} [opts]
 *   only without terrain: chunkSize meters (default 32), viewChunks rings drawn around each stream source (default 3), density multiplier (default 1),
 * area { min: [x, z], max: [x, z] } where it may grow (default: a level's walkable bounds when a level provides the ground, else anywhere), seed placement seed
 * (default 1)
 * @example
 * engine.use(level({ url: '/levels/town.glb' }), vegetation({ area: { min: [-80, -80], max: [80, 80] } }));
 * engine.vegetation.add('grass', { geometry, nearOnly: true, rule: { perChunk: 400, biomes: { lawn: 1 } } });   // only on 'lawn' surfaces
 */
export function vegetation(opts = {}) {
  checkOptions('vegetation()', opts, OPTS);
  let v = null, own = null, cols = null, ready = null;
  return { name: 'vegetation', label: 'Vegetation', stage: 'world', after: ['terrain', 'level'], optional: ['terrain', 'level'],
    install(e) {
      v = new Vegetation(e, opts);
      if (v.host !== e.terrain) {
        own = v.host;
        cols = e.addGroundColliders((x, z, range, fn) => own.forEachCollider(x, z, range, fn));   // collision and path planning see the trees
        ready = e.stream.readyCheck('vegetation', s => own.isReadyAround(s));
      }
      return v;
    },
    // terrain installed after vegetation would leave two chunk tables: say where to put it
    init(e) { if (own && e.terrain) throw new Error('vegetation() was installed before terrain(): put terrain() first, vegetation then grows on its chunks'); },
    frame(dt, e) { own?.update(e.stream.sources(), e.camera); },
    fixed(dt) { v.tick(dt); }, skip(dt, e, done) { if (done) v.tick(1); },
    describe(e, ctx) { if (own) ctx.out.perf.vegetation = { loaded: own.stats.loaded, visible: own.stats.visible, queued: own.stats.queued }; },
    dispose() { own?.dispose(); cols?.remove(); ready?.remove(); } };
}
