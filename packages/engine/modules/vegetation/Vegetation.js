// Vegetation module: defines what to plant, where, how far before switching to low-poly, and how far before not drawing. Models (the look) come from the game
// or style.
import * as THREE from 'three';
import { fromModel } from './modelGeometry.js';
import { isModelName, vegetationModel } from '../../core/namedModel.js';
import { makeMaterial, applyEffects } from '../../render/materials.js';
import { warnMissing } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { reportError } from '../../core/errors.js';
import { xzOf } from '../../core/math.js';
import { GroundChunks } from './groundChunks.js';
import { swayOf } from './lookWind.js';
import { fadeBand, nearFadePatch } from './nearFade.js';
import { makeDensity, thin } from './densityMap.js';
import { codedError } from '../../core/errorHints.js';
// parameters read by vegetation.define(); keys inside rule (sent to the worker thread)
const ADD_KEYS = ['geometry', 'model', 'lodGeometry', 'rule', 'positions', 'densityMap', 'wind', 'nearOnly', 'maxRing', 'lodRing', 'castShadow', 'shadowRing', 'receiveShadow', 'material', 'effects', 'doubleSided', 'fade'];
const RULE_KEYS = ['perChunk', 'chance', 'minHeight', 'maxHeight', 'maxSlope', 'cluster', 'scale', 'stretch', 'sink', 'tintJitter', 'tints', 'biomes', 'collider', 'avoidFlat', 'salt'];
// rule keys that only filter random attempts: with positions the game already chose every spot, so naming one is a mistake, not a no-op
const SCATTER_ONLY = ['perChunk', 'chance', 'minHeight', 'maxHeight', 'maxSlope', 'cluster', 'biomes', 'avoidFlat'];

// positions: [[x, z], [x, z, scale], [x, z, scale, yaw], ...] in world metres / size multiplier / radians. Checked here on the main thread
// because the list travels to the terrain worker as plain data, where a bad entry would only show up as a missing plant
function checkPositions(label, list, rule) {
  if (!Array.isArray(list)) throw codedError('vegetation-option', `${label}: positions is an array of [x, z] or [x, z, scale, yaw] entries`);
  list.forEach((p, i) => {
    if (!Array.isArray(p) || p.length < 2 || p.length > 4 || !p.every(Number.isFinite)) throw codedError('vegetation-option', `${label}: positions[${i}] = ${JSON.stringify(p)}; each entry is [x, z], [x, z, scale] or [x, z, scale, yaw] (finite numbers)`);
  });
  const clash = SCATTER_ONLY.filter(k => rule && k in rule);
  if (clash.length) throw codedError('vegetation-option', `${label}: rule.${clash.join(' / rule.')} only filters random placement and does not apply to positions (every listed spot is planted). Drop it, or add a second species for the scattered ones`);
}

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
    if (engine.terrain && Object.keys(opts).length) throw codedError('vegetation-option', `vegetation({ ${Object.keys(opts).join(', ')} }): with terrain() installed vegetation grows on the terrain chunks, and density / view distance are terrain options (terrain({ density, viewChunks })). The vegetation() options are for ground without terrain (a level, a code-built ground)`);
    /** @internal the chunk table vegetation lives in: engine.terrain, or its own GroundChunks */
    this.host = engine.terrain ?? new GroundChunks(engine, this, opts);
    this._removed = new Map();   // 'name:cx,cz' -> Map(id -> regrow time (clock game seconds), null = permanent)
    this._acc = 0;
    this._pending = [];   // density images still loading (densityMap.url); the module's init waits for them
    this._initDone = false;   // set when init took _pending: an image of a species added later is not awaited, so its error is caught where it is added
    // dev asset hot swap (core/assetHot.js): a species made from a swapped model is added again with the new geometry / materials. Why here and
    // not in the generic scene walk: a species' materials are patched copies (wind, season) and its geometry may be merged from a model
    engine.assets.onSwap?.(s => this._swapped(s));
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
   *   model         a model name from an asset pack ('pine' or ['flower', color], as in content: then add returns a Promise of the species), or an
   *                 Object3D with one material per mesh (e.g. assets.model('oak')): trunk and leaves keep their own materials, still one draw per part
   * lodGeometry low-detail model (optional), used beyond the lodRing ring; with model it is a geometry (drawn with the first material) or an Object3D with the
   * same mesh order
   *   rule          placement rule: perChunk attempts per chunk, minHeight/maxHeight, maxSlope, cluster('forest'|'meadow'|'none'),
   *                 scale[min,max], stretch[min,max], sink, tintJitter, tints[{color:[r,g,b],chance}]
   *   positions     the game's own spots instead of random attempts: [[x, z], [x, z, scale, yaw], ...] world metres; each is planted at the ground
   *                 height (rule's scale / stretch / sink / tints / collider still apply; the scatter filters are refused). Stable id = list index
   *   densityMap    how much survives per spot, 0..1: (x, z) => 0..1, or a gray image { url | data + width + height, size: [w, l], center?, outside? }
   *                 (the keys of terrain({ heightmap })). Thins the rule's or the positions' placement; call rebuild() after a function's inputs change
   *   wind          wind sway amplitude (0 disables)
   *   nearOnly      generate only near the player (grass, flowers)
   *   maxRing       not drawn beyond this ring count
   *   fade          near-only species shrink out over a band [start, end] metres from the player instead of popping at the ring edge (default on for
   *                 nearOnly, end = maxRing x chunk size; false = hard edge; { start, end } sets the band)
   *   lodRing       switch to low-poly beyond this ring count
   *   castShadow / shadowRing  whether to cast shadows, and within how many rings
   *   material      custom material, any three.js material (optional, default is the style's 'vegetation' role); wind, cloud
   *                 shadows and season tint are added to it (and its shadow sways) unless effects: false
   */
  define(name, o) {
    readParams(`vegetation.define('${name}')`, keysSchema(ADD_KEYS), o);
    // a model name ('pine' / ['flower', color]) means what it means in content: resolved through the same vegetationModel (cache, bake, file or
    // generator), then added as if the geometry / Object3D had been passed. Returns a Promise of the species then; start waits for it like a density image
    if (isModelName(o.model) || isModelName(o.lodGeometry)) {
      const p = Promise.all([isModelName(o.model) ? vegetationModel(this.engine, o.model) : { model: o.model }, isModelName(o.lodGeometry) ? vegetationModel(this.engine, o.lodGeometry) : null])
        .then(([main, low]) => {
          if (this.engine.disposed) return null;
          const { model: _m, ...rest } = o;
          return this.define(name, { ...rest, ...(main.model ? { model: main.model } : { geometry: main.geometry ?? o.geometry }), ...(low && { lodGeometry: low.model ?? low.geometry }) });
        });
      if (!this._initDone) this._pending.push(p);
      else p.catch(err => reportError(this.engine, err, `vegetation.define('${name}') model`, { soft: true }));
      return p;
    }
    readParams(`vegetation.define('${name}').rule`, keysSchema(RULE_KEYS), o.rule);
    if (o.positions != null) checkPositions(`vegetation.define('${name}')`, o.positions, o.rule);
    const density = o.densityMap != null ? makeDensity(o.densityMap, `vegetation.define('${name}')`) : null;
    const sw = swayOf(this.engine), wind = o.wind && sw ? { amplitude: o.wind, glsl: sw.glsl, uniforms: sw.uniforms } : o.wind;   // look.wind 'sway' (a game's engine.look.wind.patch('sway', ...)) replaces the sway shape
    // distance fade of near-only species (nearFade.js): on by default for them, fade: false keeps the hard ring edge, { start, end } sets the band in metres
    if (o.fade && typeof o.fade === 'object') readParams(`vegetation.define('${name}').fade`, keysSchema(['start', 'end']), o.fade);
    const maxRing = o.maxRing ?? (o.nearOnly ? 1 : 99);
    const band = o.effects === false ? null : fadeBand(o.fade, !!o.nearOnly, maxRing, this.host.CHUNK), nf = band && nearFadePatch(band);
    const fx = m => o.effects === false ? m : applyEffects(m, { wind, season: 'foliage', patches: nf ? [nf.patch] : undefined });
    const mdl = o.model && fromModel(o.model, `vegetation.define('${name}')`);
    let lod = o.lodGeometry?.isObject3D ? fromModel(o.lodGeometry, `vegetation.define('${name}').lodGeometry`).geometry : o.lodGeometry || null;
    if (mdl && lod && !lod.groups.length) { lod = lod.clone(); lod.addGroup(0, Infinity, 0); }   // a material array draws nothing without groups
    const sp = {
      name, geometry: mdl ? mdl.geometry : o.geometry, lodGeometry: lod,
      // random seed from the name: placement is unaffected by registration order. positions rides inside the rule because the rule is what
      // reaches the placer (terrain worker or ground chunks), and a list of numbers travels as plain data
      rule: { salt: hashName(name), ...(o.rule || {}), ...(o.positions != null ? { positions: o.positions } : {}) },
      density,   // densityMap sampler (main thread only: a function may read game state), applied in mount()
      nearOnly: !!o.nearOnly, maxRing, fade: band, fadeUniforms: nf?.uniforms ?? null, lodRing: o.lodRing ?? 1,
      castShadow: o.castShadow ?? !o.nearOnly, shadowRing: o.shadowRing ?? 1, receiveShadow: o.receiveShadow ?? true,
      material: mdl ? mdl.materials.map(fx)
        : fx(o.material ?? makeMaterial('vegetation', { vertexColors: true, side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide }, this.engine)),
    };
    sp.source = o;   // what it was made from: a hot swap adds it again with the new model (_swapped)
    this.species.set(name, sp);
    this.host.registerSpecies(name, sp.rule);
    // a density image still loading: this species places nothing until it is in, then every chunk is placed again. The module's init waits
    // for those added before start, so a game never opens on a bare map; one added later fills in when its image arrives
    if (density?.pending) {
      // the image may arrive after engine.dispose(): then chunks and meshes are gone, so no rebuild
      const p = density.pending.then(() => { if (!this.engine.disposed && this.species.get(name) === sp) this.host.rebuild(); });
      // only species added before init took _pending are awaited by init (a failure fails start); later ones nobody awaits, so report once
      // (soft: the species just stays empty, gameplay is not frozen for a missing image)
      if (!this._initDone) this._pending.push(p);
      else p.catch(err => reportError(this.engine, err, `vegetation.define('${name}') densityMap`, { soft: true }));
    }
    return sp;
  }
  /** @internal hot swap: species whose geometry or model meshes were swapped are added again (the chunks rebuild); returns { name: 1 } */
  _swapped({ geometry, material }) {
    const out = {};
    const remap = v => {
      if (v?.isBufferGeometry) return geometry.get(v)?.to ?? v;
      if (!v?.isObject3D) return v;
      const c = v.clone();
      c.traverse(m => {
        if (!m.isMesh) return;
        m.geometry = geometry.get(m.geometry)?.to ?? m.geometry;
        m.material = Array.isArray(m.material) ? m.material.map(x => material.get(x)?.to ?? x) : material.get(m.material)?.to ?? m.material;
      });
      return c;
    };
    const hit = v => {
      if (v?.isBufferGeometry) return geometry.has(v);
      let h = false; v?.traverse?.(m => { if (m.isMesh && (geometry.has(m.geometry) || [].concat(m.material).some(x => material.has(x)))) h = true; });
      return h;
    };
    for (const sp of [...this.species.values()]) {
      const o = sp.source;
      if (!o || !(hit(o.geometry) || hit(o.model) || hit(o.lodGeometry))) continue;
      this.define(sp.name, { ...o, ...(o.geometry && { geometry: remap(o.geometry) }), ...(o.model && { model: remap(o.model) }), ...(o.lodGeometry && { lodGeometry: remap(o.lodGeometry) }) });
      out[sp.name] = 1;
    }
    return out;
  }
  /** @internal module init: density images of species added before start */
  async whenLoaded() { const p = this._pending; this._pending = []; this._initDone = true; await Promise.all(p); }
  /**
   * Place every chunk again: after changing the ground behind the same provider (a ground function reading game state), or what a densityMap
   * function reads. A new setGround or level is followed automatically
   */
  rebuild() { this.host.rebuild(); }
  get(name) { return this.species.get(name); }
  list() { return [...this.species.values()]; }
  /**
   * Change at runtime how far a vegetation kind casts shadows: within `ring` chunk rings of the player (0 = only the chunk you stand in, 1 = the default,
   * larger = further and dearer). Takes effect at once; the add() option shadowRing is only the starting value. An unknown name warns with the known ones
   * @example engine.vegetation.setShadowRing('tree', 0);   // graphics setting "shadows: low": trees shadow only the nearest chunk
   * @param {string} name species name given to vegetation.define
   * @param {number} ring chunk rings, 0 or more
   * @returns {void}
   */
  setShadowRing(name, ring) {
    const sp = this.species.get(name);
    if (!sp) { warnMissing('vegetation', name, [...this.species.keys()]); return; }
    sp.shadowRing = ring;
    this.host.refreshLevels();
  }
  /** @internal module frame hook: the fade band is centred on the view focus (the player in a follow camera) */
  updateFade() {
    const f = this.engine.focus;
    for (const sp of this.species.values()) sp.fadeUniforms?.uNearFadeCenter.value.copy(f);
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
    readParams('vegetation.instanceAt()', keysSchema(['radius', 'species']), opts);
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
    const sp = this.species.get(name);
    // densityMap thins here, before the colliders are taken, so a dropped plant blocks nothing; survivors keep their stable ids
    if (sp?.density) r = thin(r, c.cx * this.host.CHUNK, c.cz * this.host.CHUNK, sp.density.at, sp.rule.salt);
    if (r.k && r.k.length) c.colliders[name] = r.k; else delete c.colliders[name];
    (c.collidersAll ||= {})[name] = c.colliders[name];   // original collision circles (before felled trees are filtered), for single-tree removal
    // 一株不剩（地形挖过、densityMap 疏掉全部）：旧网格也要拆掉，否则碰撞已删、植物却悬在原处。在 mount 里处理，调用方（地形编辑、换地面）不用各自记得
    if (r.n === 0) { if (c.veg[name]) { c.group.remove(c.veg[name]); c.veg[name].dispose(); delete c.veg[name]; } return; }
    const t0 = performance.now();   // measure: the 'build' stage of engine.budget.cost
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
    this.engine.budget.cost.end('build', t0);
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
