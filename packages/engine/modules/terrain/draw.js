// Terrain drawing: draws the chunks the terrain data part (ChunkManager) generated. One mesh per chunk from the chunk's arrays (c.data: pos, nor,
// col, uv, tex), the ground material (terrain({ material }) / engine.terrain.material), the per-chunk color map of shading 'texture',
// island side material, and frustum visibility. Installed by terrain() as its own module 'terrainDraw' holding the slot 'terrain-draw'.
// engine.terrain.material / .patches / .uniforms / .recolor() end up here (ChunkManager hands them on, it is data only).
//
// Why a separate module: collision, paths, engine.surface and vegetation read only the data part, so a game can swap the whole picture
// (engine.use(myGround, { replaces: 'terrain-draw' })) and keep everything that plays. A replacement draw part does what this file does:
//   install(e, ctx) { ctx.track(e.terrain.view({ add(c) {...c.data.pos...}, change(c) {...}, remove(c) {...}, show(c, visible) {...} })); }
// This file never changes chunk data; it only reads it.
import { engineOwned } from '../../core/scene/things.js';
import { needMaterial } from '../../core/base/validate.js';
import * as THREE from 'three';
import { terrainMaterial } from '../../render/materials.js';
import { patchesOf, unpatchMaterial } from '../../render/patches.js';
import { readParams, keysSchema } from '../../core/base/params.js';
import { codedError } from '../../core/base/errorHints.js';
import { mountColorMap, updateColorMap, disposeColorMap } from './terrainTexture.js';
import { SHADINGS, NORMALS } from './terrainDefaults.js';

// what the workers bake into each chunk: a change rebuilds every chunk
const BAKED = ['colors', 'biomeColors', 'steep', 'variation', 'shading', 'normals'];
const RECOLOR_KEYS = [...BAKED, 'detail'];

/** Check the picture values terrain({...}) and engine.terrain.recolor take; null is "none" for each @param {string} where @param {any} o */
export function checkGround(where, o) {
  const bad = (k, want) => codedError('terrain-option', `${where}: ${k} ${want}; got ${JSON.stringify(o[k])}`);
  for (const k of ['colors', 'biomeColors', 'variation', 'detail']) if (o[k] != null && typeof o[k] !== 'object') throw bad(k, 'must be an object');
  if (o.steep != null && !Array.isArray(o.steep)) throw bad('steep', 'must be an array [{ maxNormalY, colors }]');
  if (o.shading != null && !SHADINGS.includes(o.shading)) throw bad('shading', `must be ${SHADINGS.join(' | ')}`);
  if (o.normals != null && !NORMALS.includes(o.normals)) throw bad('normals', `must be ${NORMALS.join(' | ')} or null`);
  const v = o.variation;
  if (v) {
    readParams(`${where} variation`, keysSchema(['blend', 'jitter', 'patches']), v);
    readParams(`${where} variation.blend`, keysSchema(['size', 'strength']), v.blend || {});
    readParams(`${where} variation.jitter`, keysSchema(['size', 'min', 'range']), v.jitter || {});
    readParams(`${where} variation.patches`, keysSchema(['size', 'strength', 'levels', 'tint']), v.patches || {});
  }
}

export class TerrainDraw {
  /**
   * @param {any} e @param {any} w the terrain data part (engine.terrain)
   * @param {{ material?: any, effects?: boolean, detail?: any, sideMat?: any, config: { get(): any, set(c: any): void, species(): any } }} o config: the current worker config, shared with the data half
   */
  constructor(e, w, { material = null, effects = true, detail = null, sideMat = null, config }) {
    this.engine = e; this.w = w;
    /** @internal */ this._config = config;
    /** @internal shading null in recolor goes back to this */ this._shading = config.get().shading;
    /** @internal effects: false means the material given at the start stays as given, so detail never reaches it */ this._effects = effects;
    /** @internal the material the engine dressed: the neutral one, or terrain({ material }) */
    this._own = terrainMaterial(typeof material === 'function' ? material(e) : material, e, { effects, detail });
    /** @internal the material the chunks draw with */ this._material = this._own;
    /** shape.side.material: island sides and bottoms (null: the ground material) */
    this.sideMat = typeof sideMat === 'function' ? sideMat(e) : sideMat;
    this.meshes = new Map();   // chunk record -> { group, mesh, colorTex, colorMat }
    this._view = w.view(this);
  }

  /** @internal view hook: a chunk was generated (or regenerated after a full rebuild) */
  add(c) {
    const t0 = performance.now();   // measure: the 'build' stage of engine.budget.cost
    const t = c.data, CH = this.w.chunkSize, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(t.uv, 2));
    const rec = { group: new THREE.Group(), mesh: null, colorTex: null, colorMat: null };
    const mesh = rec.mesh = new THREE.Mesh(g, this._materialFor(rec, c));
    if (t.top != null) {   // island chunk (terrain({ shape })): vertices are top, side, bottom
      const rest = t.pos.length / 3 - t.top;
      if (rest) { g.addGroup(0, t.top, 0); g.addGroup(t.top, rest, 1); }
    }
    mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    rec.group.userData.budgetTag = 'terrain';
    rec.group.position.set(c.cx * CH, 0, c.cz * CH);
    rec.group.add(mesh); rec.group.updateMatrixWorld(true);
    rec.group.visible = c.inView !== false;
    this.meshes.set(c, rec);
    this.engine.scene.add(engineOwned('terrain', rec.group));
    this.engine.budget.cost.end('build', t0);
  }
  /** @internal view hook: an edit rebuilt the chunk's arrays */
  change(c) {
    const rec = this.meshes.get(c); if (!rec) return;
    const g = rec.mesh.geometry, t = c.data;
    // the rim of a shape with diagonal 'adaptive': the diagonal follows the heights and cuts a boundary cell into a different number of triangles
    if (g.attributes.position.array.length !== t.pos.length || (g.groups.length && g.groups[0].count !== t.top)) { this.remove(c); this.add(c); return; }
    for (const [n, a] of [['position', t.pos], ['normal', t.nor], ['color', t.col], ['uv', t.uv]]) { g.attributes[n].array.set(a); g.attributes[n].needsUpdate = true; }
    if (t.tex && rec.colorTex) updateColorMap(rec, t.tex);
    g.boundingSphere = g.boundingBox = null;   // only rays read them (chunks are not frustum culled): worked out again when asked
  }
  /** @internal view hook: the chunk was released */
  remove(c) {
    const rec = this.meshes.get(c); if (!rec) return;
    this.meshes.delete(c);
    this.engine.scene.remove(rec.group);
    rec.mesh.geometry.dispose();
    disposeColorMap(rec);
  }
  /** @internal view hook: in view or not (ring 1 is always in view, farther chunks by the camera frustum) */
  show(c, visible) { const rec = this.meshes.get(c); if (rec) rec.group.visible = visible; }

  /**
   * The ground material every chunk draws with (a texture-shaded chunk draws a clone carrying its color map). Setting swaps it on every loaded chunk at once, draws it as
   * given (no engine patch) and regenerates nothing
   * @type {any}
   */
  get material() { return this._material; }
  set material(m) {
    needMaterial('terrain-option', 'engine.terrain.material', m, '; e.g. engine.terrain.material = applyEffects(new THREE.MeshStandardMaterial({ vertexColors: true }), { patches: engine.terrain.patches })');
    const was = this._material;
    if (m === was) return;
    this._material = m;
    this._remount();
    if (was === this._own) was.dispose();   // only its GPU program: setting it back compiles it again
  }
  /** The patches on the engine's material (world, clouds, season, detail), so a game material keeps them through applyEffects(m, { patches }) */
  get patches() { return patchesOf(this._own); }
  /** The detail layer's uniforms ({} without one), written directly and live: uDetailStrength, uDetailScale, uDetailTint... */
  get uniforms() { return this.patches.find(p => p.name === 'detail')?.uniforms ?? {}; }

  /**
   * What terrain({...}) baked in, changed at run time. colors / biomeColors / steep / variation / shading / normals: every chunk is rebuilt (edits stay); each is given
   * whole, null takes it out. detail: the detail layer on the engine's material, no chunk rebuilt; a game's material is the game's to patch
   * @param {any} o
   */
  recolor(o = {}) {
    readParams('engine.terrain.recolor', keysSchema(RECOLOR_KEYS), o);
    checkGround('engine.terrain.recolor', o);
    if ('detail' in o && this._effects) {
      terrainMaterial(unpatchMaterial(this._own, 'detail'), this.engine, { detail: o.detail });
      if (this._material === this._own) this._remount();
    }
    const baked = BAKED.filter(k => k in o);
    if (!baked.length) return;
    const next = { ...this._config.get() };
    for (const k of baked) if (o[k] == null) delete next[k]; else next[k] = o[k];
    if (next.shading == null && this._shading != null) next.shading = this._shading;   // a key holding undefined would hide createTerrain's default
    this._config.set(next);
    this.w.reinit(next, this._config.species());
  }

  /** Every loaded chunk draws the current material: no chunk is regenerated, collision is untouched @internal */
  _remount() {
    for (const [c, rec] of this.meshes) { disposeColorMap(rec); rec.colorTex = rec.colorMat = null; rec.mesh.material = this._materialFor(rec, c); }
  }

  // texture shading: a material with this chunk's color map. Island sides keep vertex colors (the map is sampled by world xz and would smear down them)
  _materialFor(rec, c) {
    const t = c.data, CH = this.w.chunkSize;
    const mat = t.tex ? mountColorMap(this.engine, this.material, rec, t.tex, c.cx * CH, c.cz * CH, CH) : this.material;
    const rest = t.top != null ? t.pos.length / 3 - t.top : 0;
    return rest && (t.tex || this.sideMat) ? [mat, this.sideMat ?? this.material] : mat;
  }

  dispose() { this._view.remove(); this._own.dispose(); }
}
