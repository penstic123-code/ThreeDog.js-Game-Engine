// Vegetation look: draws what the vegetation data part placed. One InstancedMesh per species per chunk from the chunk's placement records
// (c.plants[name]: m matrices, c colors, ids, n), the species' geometry / low-poly geometry / material (wind sway, season tint, near fade
// patched in), ring LOD (draw distance, low-poly swap, shadow distance) and frustum visibility. Installed by vegetation() as its own module
// 'vegetationLook' holding the slot 'vegetation-look'; it also registers look.wind.
//
// Why a separate module: collision, paths, felling and instanceAt read only the data part, so a game can swap the whole plant look
// (engine.use(myPlants, { replaces: 'vegetation-look' })) and keep everything that plays. A replacement look does what this file does:
//   install(e, ctx) { ctx.track(e.vegetation.view({ species(sp) {...}, change(c, name) {...c.plants[name]...}, ring(c, ring) {...}, show(c, v) {...}, drop(c) {...} })); }
// This file never changes placement data; it only reads it.
import { engineOwned } from '../../core/things.js';
import * as THREE from 'three';
import { fromModel } from './modelGeometry.js';
import { makeMaterial, applyEffects } from '../../render/materials.js';
import { asGiven } from '../../render/terms.js';
import { swayOf, defineWindLook, defineVegetationLook, colorPatchOf } from './lookWind.js';
import { nearFadePatch } from './nearFade.js';
import { shadowsOn } from '../../core/look/shadowPart.js';

export class VegetationLook {
  /** @param {any} e @param {any} v the vegetation data part (engine.vegetation) */
  constructor(e, v) {
    this.engine = e; this.v = v;
    defineWindLook(e);   // look.wind: before the first species() so its sway hook is read
    defineVegetationLook(e, this);   // look.vegetation: the color hook, live on every species' material
    /** @internal species name -> { geometry, lodGeometry, material, fadeUniforms } */ this.kinds = new Map();
    /** @internal chunk record -> { group, ims: { name: InstancedMesh } } */ this.meshes = new Map();
    this._view = v.view(this);
  }

  /** The InstancedMesh drawing one species in one chunk (null when none is drawn there) @param {any} c chunk record @param {string} name */
  mesh(c, name) { return this.meshes.get(c)?.ims[name] ?? null; }
  /** How one species is drawn: { geometry, lodGeometry, material, fadeUniforms } (null for an unknown name) @param {string} name */
  kind(name) { return this.kinds.get(name) ?? null; }

  /** @internal view hook: a species was defined (or defined again): build its geometry and patched materials. A bad option throws into define() */
  species(sp) {
    const o = sp.source, e = this.engine, label = `vegetation.define('${sp.name}')`;
    // look.wind 'sway' (a game's engine.look.wind.patch('sway', ...)) replaces the sway shape
    const sw = swayOf(e), wind = o.wind && sw ? { amplitude: o.wind, glsl: sw.glsl, tsl: sw.tsl, uniforms: sw.uniforms } : o.wind;
    // distance fade of near-only species (nearFade.js): the band was worked out (and checked) by define(), null = hard ring edge
    const band = sp.fade, nf = band && nearFadePatch(band), col = colorPatchOf(e);
    const own = [nf?.patch, col].filter(Boolean);
    const fx = m => o.effects === false ? asGiven(m) : applyEffects(m, { wind, season: 'foliage', engine: e, patches: own.length ? own : undefined });
    const mdl = o.model && fromModel(o.model, label);
    let lod = o.lodGeometry?.isObject3D ? fromModel(o.lodGeometry, label + '.lodGeometry').geometry : o.lodGeometry || null;
    if (mdl && lod && !lod.groups.length) { lod = lod.clone(); lod.addGroup(0, Infinity, 0); }   // a material array draws nothing without groups
    this.kinds.set(sp.name, {
      geometry: mdl ? mdl.geometry : o.geometry, lodGeometry: lod, fadeUniforms: nf?.uniforms ?? null,
      material: mdl ? mdl.materials.map(fx) : fx(o.material ?? makeMaterial('vegetation', { vertexColors: true, side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide }, e)),
    });
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
    if (c.ring != null) this._level(im, sp, k, c.ring);
  }

  /** @internal view hook: the chunk's ring changed (or shadows were switched): draw distance, low-poly swap and shadows of every species there */
  ring(c, ring) {
    const rec = this.meshes.get(c); if (!rec) return;
    for (const n in rec.ims) { const sp = this.v.get(n), k = this.kinds.get(n); if (sp && k && !sp.nearOnly) this._level(rec.ims[n], sp, k, ring); }
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
    im.castShadow = shadowsOn(this.engine) && sp.castShadow && ring <= sp.shadowRing;
  }
  _chunk(c) {
    const CH = this.v.host.CHUNK, g = new THREE.Group();
    g.userData.budgetTag = 'vegetation';
    g.position.set(c.cx * CH, 0, c.cz * CH); g.matrixAutoUpdate = false; g.updateMatrix();
    g.visible = c.inView !== false;
    this.engine.scene.add(engineOwned('vegetation', g)); g.updateMatrixWorld(true);
    const rec = { group: g, ims: {} };
    this.meshes.set(c, rec);
    return rec;
  }

  dispose() { this._view.remove(); this.kinds.clear(); }
}
