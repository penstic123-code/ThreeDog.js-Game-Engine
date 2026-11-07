// Vegetation drawing: draws what the vegetation data part placed. One InstancedMesh per species per chunk from the chunk's placement records
// (c.plants[name]: m matrices, c colors, ids, n), the species' geometry / low-poly geometry / material (wind sway, season tint, near fade
// patched in), ring LOD (draw distance, low-poly swap, shadow distance) and frustum visibility. Installed by vegetation() as its own module
// 'vegetationDraw' holding the slot 'vegetation-draw'. Its picture entries are reached through engine.vegetation: material, patches, sway(), color().
//
// Why a separate module: collision, paths, felling and instanceAt read only the data part, so a game can swap the whole plant picture
// (engine.use(myPlants, { replaces: 'vegetation-draw' })) and keep everything that plays. A replacement draw part does what this file does:
//   install(e, ctx) { ctx.track(e.vegetation.view({ species(sp) {...}, change(c, name) {...c.plants[name]...}, ring(c, ring) {...}, show(c, v) {...}, drop(c) {...} })); }
// This file never changes placement data; it only reads it.
import { engineOwned } from '../../core/scene/things.js';
import { needMaterial, oneForm } from '../../core/base/validate.js';
import * as THREE from 'three';
import { fromModel } from './modelGeometry.js';
import { applyEffects, windCustom } from '../../render/materials.js';
import { neutralMaterial } from '../../render/neutral.js';
import { patchMaterial, unpatchMaterial } from '../../render/patches.js';
import { EFFECTS, hashText } from '../../render/effects.js';
import { codedError } from '../../core/base/errorHints.js';
import { isWebGPU } from '../../render/backend.js';
import { nearFadePatch } from './nearFade.js';
import { scatterAttempts } from '../../core/stream/scatter.js';

const COLOR = 'vegetationColor';   // the patch name of vegetation.color() on every species' material
// The wind patch in engine.vegetation.patches has one amplitude: a shared material cannot carry each species' own (those are define()'s wind option)
const SHARED_SWAY = 0.05;
const code = v => (typeof v === 'string' ? { glsl: v } : v);

/**
 * How many instances of a placement to draw at a density. A plant with a collider is placed in full at every quality, so collision and felled ids stay the same world, and low
 * quality thins only its drawing. Why a count and not a filter: ids rise in placement order, so the plants a density keeps are the front of the list, the same ones it kept when
 * it thinned placement, and the instances behind just are not drawn. A blocker that is not drawn still blocks. rule.positions are the game's own and never thin.
 * @internal
 */
export function drawnPlants(rule, r, density) {
  if (!rule?.collider || rule.positions) return r.n;
  const keep = scatterAttempts(rule, density);
  let n = r.n;
  while (n > 0 && r.ids[n - 1] >= keep) n--;
  return n;
}

export class VegetationDraw {
  /** @param {any} e @param {any} v the vegetation data part (engine.vegetation) */
  constructor(e, v) {
    this.engine = e; this.v = v;
    // what engine.vegetation.material reads until the game sets one. Each species draws its own copy (wind amplitude and fade band are per species);
    // the copies share this Color, so a write to material.color reaches them
    /** @internal */ this._base = neutralMaterial('vegetation', { vertexColors: true });
    /** @internal the game's shared material, drawn as given */ this._game = null;
    /** @internal vegetation.sway()'s { glsl, tsl, uniforms } */ this._sway = null;
    /** @internal vegetation.color()'s patch */ this._color = null;
    /** @internal species name -> { geometry, lodGeometry, material, fadeUniforms, shared } */ this.kinds = new Map();
    /** @internal chunk record -> { group, ims: { name: InstancedMesh } } */ this.meshes = new Map();
    this._refreshPatches();
    this._view = v.view(this);
  }

  /** @internal engine.vegetation.material: every species with no material or model of its own draws it, as given; null gives the neutral default back */
  get material() { return this._game ?? this._base; }
  set material(m) {
    if (m != null) needMaterial('vegetation-option', 'vegetation.material', m, ' (null gives the neutral default back)');
    this._game = m || null;
    for (const sp of this.v.list()) {
      const old = this.kinds.get(sp.name);
      if (old?.shared) this.species(sp);
    }
    for (const rec of this.meshes.values()) for (const n in rec.ims) { const k = this.kinds.get(n); if (k) rec.ims[n].material = k.material; }
  }

  /** @internal engine.vegetation.sway(): the new shape reaches the engine's own species materials; a shared material of the game is the game's to re-patch */
  sway(spec) {
    const s = spec == null ? null : code(spec);
    if (s) { windCustom(s); this._needForm('sway', s); }   // a wrong sway function throws here, not later inside vegetation.define
    this._sway = s;
    this._refreshPatches();
    // a number is an amplitude for this shape; a species' own wind object is its own sway and stays (see species())
    this._eachOwn((m, sp) => { if (typeof sp.source.wind === 'number' && sp.source.wind) patchMaterial(m, [this._windPatch(sp.source.wind)], { strict: false }); });
  }

  /** @internal engine.vegetation.color(): live on the engine's own species materials, one patch object so they keep sharing a program */
  color(spec) {
    const s = spec == null ? null : code(spec);
    if (s) {
      if (typeof s !== 'object' || (s.glsl != null && typeof s.glsl !== 'string') || (s.tsl != null && typeof s.tsl !== 'function')) throw codedError('vegetation-option', 'vegetation.color() takes GLSL code, or { glsl, tsl: (ctx) => vec4, uniforms, pars }');
      this._needForm('color', s);
    }
    this._color = s && { name: COLOR, slot: 'color', cacheKey: hashText(JSON.stringify([s.glsl ?? '', s.pars ?? ''])),
      ...(s.uniforms && { uniforms: s.uniforms }), ...(s.glsl != null && { glsl: s.glsl, ...(s.pars && { pars: s.pars }) }), ...(s.tsl && { tsl: s.tsl }) };
    this._refreshPatches();
    this._eachOwn(m => { if (this._color) patchMaterial(m, [this._color]); else unpatchMaterial(m, COLOR); });
  }

  /** Each renderer draws its own form; the one this engine's renderer needs, when missing, is named (else the code would do nothing silently) */
  _needForm(entry, s) {
    const gpu = isWebGPU(this.engine.renderer);
    if (gpu ? s.tsl == null : s.glsl == null) throw oneForm('vegetation-option', `vegetation.${entry}()`, !!gpu);
  }
  _windPatch(amplitude) { return EFFECTS.wind(amplitude, this._sway ? windCustom(this._sway) : undefined); }
  /** engine.vegetation.patches: what a game's shared material needs to behave like the engine's (the near fade is per species: define({ material }) gets it) */
  _refreshPatches() { /** @internal */ this.patches = [EFFECTS.season('foliage'), this._windPatch(SHARED_SWAY), ...(this._color ? [this._color] : [])]; }
  /** Materials the engine patches: not effects: false species, not the game's shared material */
  _eachOwn(fn) {
    for (const sp of this.v.list()) {
      const k = this.kinds.get(sp.name);
      if (!k || sp.source.effects === false || k.material === this._game) continue;
      for (const m of [k.material].flat()) fn(m, sp);
    }
  }

  /** The InstancedMesh drawing one species in one chunk (null when none is drawn there) @param {any} c chunk record @param {string} name */
  mesh(c, name) { return this.meshes.get(c)?.ims[name] ?? null; }
  /** How one species is drawn: { geometry, lodGeometry, material, fadeUniforms } (null for an unknown name) @param {string} name */
  kind(name) { return this.kinds.get(name) ?? null; }

  /** @internal view hook: a species was defined (or defined again): build its geometry and patched materials. A bad option throws into define() */
  species(sp) {
    const o = sp.source, e = this.engine, label = `vegetation.define('${sp.name}')`;
    const wind = typeof o.wind === 'number' && o.wind && this._sway ? { amplitude: o.wind, ...this._sway } : o.wind;   // vegetation.sway() is the default shape, a species' own wind object wins
    // distance fade of near-only species (nearFade.js): the band was worked out (and checked) by define(), null = hard ring edge
    const band = sp.fade, nf = band && nearFadePatch(band);
    const own = [nf?.patch, this._color].filter(Boolean);
    const fx = m => o.effects === false ? m : applyEffects(m, { wind, season: 'foliage', engine: e, patches: own.length ? own : undefined });
    const mdl = o.model && fromModel(o.model, label);
    const lodMdl = o.lodGeometry?.isObject3D ? fromModel(o.lodGeometry, label + '.lodGeometry') : null;
    let lod = lodMdl ? lodMdl.geometry : o.lodGeometry || null;
    if (mdl && lod && !lod.groups.length) { lod = lod.clone(); lod.addGroup(0, Infinity, 0); }   // a material array draws nothing without groups
    const shared = !mdl && !o.material, game = shared ? this._game : null;
    const material = game ?? (mdl ? mdl.materials.map(fx) : fx(o.material ?? this._neutral(o)));
    // what was built here and is ours to free (the game's geometry and materials stay the game's); a mesh still drawing the old ones uploads them again
    const made = [...(lodMdl?.materials ?? []), ...(lod && lod !== o.lodGeometry ? [lod] : []), ...(mdl ? [mdl.geometry, ...material] : shared && !game ? [material] : [])];
    const old = this.kinds.get(sp.name);
    this.kinds.set(sp.name, { geometry: mdl ? mdl.geometry : o.geometry, lodGeometry: lod, fadeUniforms: game ? null : nf?.uniforms ?? null, shared, material, made });
    for (const d of old?.made ?? []) d.dispose();
  }
  _neutral(o) {
    const m = neutralMaterial('vegetation', { vertexColors: true, side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    m.color = this._base.color;
    return m;
  }

  /** @internal view hook: c.plants[name] was placed, replaced, thinned or dropped, or which of its instances are felled changed */
  change(c, name) {
    const r = c.plants?.[name], rec = this.meshes.get(c), old = rec?.ims[name];
    if (!r) { if (old) { rec.group.remove(old); old.dispose(); delete rec.ims[name]; } return; }
    const k = this.kinds.get(name), sp = this.v.get(name);
    if (!k || !sp) return;
    let im = old;
    if (!old || old.userData.plants !== r || old.material !== k.material) {   // new placement (or species defined again): a new mesh
      const t0 = performance.now();   // measure: the 'build' stage of engine.budget.cost
      im = new THREE.InstancedMesh(k.geometry, k.material, r.n);
      im.instanceColor = new THREE.InstancedBufferAttribute(r.c, 3);
      im.frustumCulled = false; im.matrixAutoUpdate = false;
      im.receiveShadow = sp.receiveShadow;
      im.userData.plants = r; im.userData.budgetTag = 'vegetation';
      const R = rec ?? this._chunk(c);
      if (old) { R.group.remove(old); old.dispose(); }
      R.group.add(im); im.updateMatrixWorld(true);
      R.ims[name] = im;
      this.engine.budget.cost.end('build', t0);
    }
    // felled instances draw as a zero matrix (count unchanged, so the other instances keep their slots)
    const a = im.instanceMatrix.array, hid = c.hidden?.[name];
    a.set(r.m);
    if (hid) for (const i of hid) if (i < r.n) a.fill(0, i * 16, i * 16 + 16);
    im.instanceMatrix.needsUpdate = true;
    im.count = drawnPlants(sp.rule, r, this.v.host.density);
    if (c.ring != null) this._level(im, sp, k, c.ring);
  }

  /** @internal view hook: the chunk's ring changed (or shadows were switched): draw distance, low-poly swap and shadows of every species there */
  ring(c, ring) {
    const rec = this.meshes.get(c); if (!rec) return;
    for (const n in rec.ims) { const sp = this.v.get(n), k = this.kinds.get(n); if (sp && k) this._level(rec.ims[n], sp, k, ring); }
  }
  /** @internal view hook: in view or not (ring 1 is always in view, farther chunks by the camera frustum) */
  show(c, visible) { const rec = this.meshes.get(c); if (rec) rec.group.visible = visible; }
  /** @internal view hook: the chunk was released */
  drop(c) {
    const rec = this.meshes.get(c); if (!rec) return;
    this.meshes.delete(c);
    for (const n in rec.ims) rec.ims[n].dispose();
    this.engine.scene.remove(rec.group);
  }

  /** @internal module frame hook: the fade band is centred on the view focus (the player in a follow camera) */
  updateFade() {
    const f = this.engine.focus;
    for (const k of this.kinds.values()) k.fadeUniforms?.uNearFadeCenter.value.copy(f);
  }

  _level(im, sp, k, ring) {
    im.visible = ring <= sp.maxRing;
    im.geometry = k.lodGeometry && ring > sp.lodRing ? k.lodGeometry : k.geometry;
    im.castShadow = !!this.engine.renderer?.shadowMap?.enabled && sp.castShadow && ring <= sp.shadowRing;
  }
  _chunk(c) {
    const CH = this.v.host.chunkSize, g = new THREE.Group();
    g.userData.budgetTag = 'vegetation';
    g.position.set(c.cx * CH, 0, c.cz * CH); g.matrixAutoUpdate = false; g.updateMatrix();
    g.visible = c.inView !== false;
    this.engine.scene.add(engineOwned('vegetation', g)); g.updateMatrixWorld(true);
    const rec = { group: g, ims: {} };
    this.meshes.set(c, rec);
    return rec;
  }

  dispose() {
    this._view.remove();
    for (const k of this.kinds.values()) for (const d of k.made) d.dispose();
    this.kinds.clear(); this._base.dispose();
  }
}
