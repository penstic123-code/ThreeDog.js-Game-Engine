// Terrain look: draws the chunks the terrain data part (ChunkManager) generated. One mesh per chunk from the chunk's arrays (c.data: pos, nor,
// col, uv, tex), the ground material (style / terrain({ material }) / look.ground.replace), the per-chunk color map of shading 'texture',
// island side material, and frustum visibility. Installed by terrain() as its own module 'terrainLook' holding the slot 'terrain-look'.
//
// Why a separate module: collision, paths, engine.surface and vegetation read only the data part, so a game can swap the whole look
// (engine.use(myGround, { replaces: 'terrain-look' })) and keep everything that plays. A replacement look does what this file does:
//   install(e, ctx) { ctx.track(e.terrain.view({ add(c) {...c.data.pos...}, change(c) {...}, remove(c) {...}, show(c, visible) {...} })); }
// This file never changes chunk data; it only reads it.
import { engineOwned } from '../../core/things.js';
import * as THREE from 'three';
import { terrainMaterial } from '../../render/materials.js';
import { mountColorMap, updateColorMap, disposeColorMap } from './terrainTexture.js';

export class TerrainLook {
  /** @param {any} e @param {any} w the terrain data part (engine.terrain) @param {{ material?: any, effects?: boolean, sideMat?: any }} o */
  constructor(e, w, { material = null, effects = true, sideMat = null } = {}) {
    this.engine = e; this.w = w;
    /** The ground material every chunk draws with (a texture-shaded chunk draws a clone carrying its color map) */
    this.material = terrainMaterial(typeof material === 'function' ? material(e) : material, e, { effects });
    /** shape.side.material: island sides and bottoms (null: the ground material) */
    this.sideMat = typeof sideMat === 'function' ? sideMat(e) : sideMat;
    this.meshes = new Map();   // chunk record -> { group, mesh, colorTex, colorMat }
    this._view = w.view(this);
  }

  /** @internal view hook: a chunk was generated (or regenerated after a full rebuild) */
  add(c) {
    const t0 = performance.now();   // measure: the 'build' stage of engine.budget.cost
    const t = c.data, CH = this.w.CHUNK, g = new THREE.BufferGeometry();
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
  /** @internal view hook: an edit rebuilt the chunk's arrays (same vertex count) */
  change(c) {
    const rec = this.meshes.get(c); if (!rec) return;
    const g = rec.mesh.geometry, t = c.data;
    for (const [n, a] of [['position', t.pos], ['normal', t.nor], ['color', t.col], ['uv', t.uv]]) { g.attributes[n].array.set(a); g.attributes[n].needsUpdate = true; }
    if (t.tex && rec.colorTex) updateColorMap(rec, t.tex);
    g.computeBoundingSphere(); g.boundingBox = null;
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

  /** Swap the ground material on every loaded chunk at once (look.ground.replace / detail): no chunk is regenerated, collision is untouched */
  setMaterial(m) {
    this.material = m;
    for (const [c, rec] of this.meshes) { disposeColorMap(rec); rec.colorTex = rec.colorMat = null; rec.mesh.material = this._materialFor(rec, c); }
  }

  // texture shading: a material with this chunk's color map. Island sides keep vertex colors (the map is sampled by world xz and would smear down them)
  _materialFor(rec, c) {
    const t = c.data, CH = this.w.CHUNK;
    const mat = t.tex ? mountColorMap(this.engine, this.material, rec, t.tex, c.cx * CH, c.cz * CH, CH) : this.material;
    const rest = t.top != null ? t.pos.length / 3 - t.top : 0;
    return rest && (t.tex || this.sideMat) ? [mat, this.sideMat ?? this.material] : mat;
  }

  dispose() { this._view.remove(); }
}
