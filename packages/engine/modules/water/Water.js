// Water module: draws the global water plane (sea, big lakes; snaps to a grid following the focus so it doesn't "swim") and independent water bodies (mountain lakes, ponds, each with its own level).
// Look comes from the style pack's style.water: color, opacity, waves, surface quality (material factory 'water'), normal map, grazing-angle reflection.
//
// engine.use(water());                                      // global water only (level taken from the terrain water level)
// engine.use(water({ sea: false }));                         // no global water
// engine.use(water({ level: 4, size: 1200 }));              // level and size are world state: here, never in the style
// const lake = engine.addWaterBody({ position: [120, 0, -40], radius: 25, level: 18 });   // add a mountain lake (can be added any time); lake.remove()
//
// three.js objects: engine.water.sea (global water Mesh, may be null), material (shared by all water), bodies (Map: water body → its Mesh)
// Style pack: water = { color, opacity, flat, waveHeight, waveScale, waveSpeed, normalMap: '/textures/water-n.jpg', normalScale, normalRepeat,
//                   normalSpeed: [x, z], fresnel: 0.6, segments, depthColor, foam, glsl: { wave, surface }, uniforms,
//                   material?: (engine, { uniforms, waves, surface, normalMap }) => Material }   (look hooks: recipes/44-water-weather-look-hooks.md)
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { placeholderTexture } from '../../render/effects.js';
import { patchMaterial } from '../../render/patches.js';
import { checkOptions, warnOnce } from '../../core/validate.js';
import { waterLook, wavesPatch, surfacePatch } from './surface.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Object3D, Material, Vector3 } from '../../types/common' */
/** @import { WaterBody, WaterOptions } from '../../types/world' */
// Options accepted by water(): sea / level + any appearance item that overrides the style pack's style.water
const WATER_OPTIONS = ['sea', 'level', 'color', 'opacity', 'flat', 'waveHeight', 'waveScale', 'waveSpeed', 'fresnel', 'size', 'segments', 'normalMap',
  'normalScale', 'normalRepeat', 'normalSpeed', 'shininess', 'specular', 'material', 'depthColor', 'foam', 'glsl', 'uniforms'];

/** engine.water */
export class Water {
  /** @internal */
  constructor(engine, opts = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.st = { color: 0x888888, opacity: 0.85, flat: true, waveHeight: 1, waveScale: 1, waveSpeed: 1, fresnel: 0.5,
      size: 900, segments: 150, normalScale: 0.4, normalRepeat: 0.05, normalSpeed: [0.01, 0.006], ...(engine.style.water || {}), ...opts };
    const st = this.st;
    /** @internal */ this.cell = st.size / st.segments;
    /** @internal */ this.normalMap = null;
    if (st.normalMap) {
      // normal map: a flat-normal placeholder until the asset loads, then it takes the asset's image source (shared, not copied;
      // goes through asset management, so it can be preloaded and released)
      const n = this.normalMap = placeholderTexture('normal'); n.wrapS = n.wrapT = THREE.RepeatWrapping;
      engine.assets.texture(st.normalMap, { color: false }).then(t => { n.source = t.source; n.needsUpdate = true; }).catch(err => warnOnce(err.message));
    }
    /**
     * Water material (shared by all water)
     * @type {Material}
     */
    this.material = this._material();
    /**
     * Water body → mesh
     * @type {Map<WaterBody, THREE.Mesh>}
     */
    this.bodies = new Map();

    /**
     * Global water mesh (null when absent)
     * @type {THREE.Mesh | null}
     */
    this.sea = null;
    /** @internal */ this._seaChecked = st.sea === false;   // global water is built on the first frame: terrain (water level) is installed by then, so no dependence on install order
    for (const b of engine.waterBodies) this._addBody(b);
    engine.events.on('water:add', b => this._addBody(b));
    // material is shared by all bodies, so not engine.remove (which would dispose it); its ray registration goes too
    engine.events.on('water:remove', b => { const m = this.bodies.get(b); if (m) { engine.detach(m); engine.rays.forget(m); m.geometry.dispose(); this.bodies.delete(b); } });
  }

  /** @internal */
  _material() {
    const st = this.st, e = this.engine;
    const look = waterLook(st), surface = surfacePatch(e, look), waves = wavesPatch(e, st, look, !!surface);
    // A whole custom surface (toon foam bands, pixel ripples): the engine still builds the meshes and keeps the shared uniforms and the
    // normal-map scroll running; the built-in look (role 'water', waves, fresnel) is skipped. waves (and surface, when depthColor / foam /
    // glsl.surface ask for one; it needs waves before it) are offered for applyEffects({ patches })
    if (st.material) {
      const own = st.material(e, { uniforms: waves.uniforms, waves, surface, normalMap: this.normalMap });
      if (!own?.isMaterial) throw new Error('style.water.material must return a three.js Material, e.g. material: (engine, { uniforms }) => new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })');
      return own;
    }
    const m = makeMaterial('water', { color: st.color, transparent: st.opacity < 1, opacity: st.opacity, flatShading: st.flat, shininess: st.shininess ?? 90, specular: st.specular ?? 0xaaaaaa, roughness: 0.15, metalness: 0 }, e);
    if (this.normalMap && 'normalMap' in m) {
      const lit = /** @type {THREE.MeshPhongMaterial | THREE.MeshStandardMaterial} */ (m);   // only lit materials have normalMap; the `in` test guarantees it
      lit.normalMap = this.normalMap; lit.normalScale = new THREE.Vector2(st.normalScale, st.normalScale);
    }
    const grey = new THREE.Color(0xcccccc);
    const patches = surface ? [waves, surface] : [waves];
    // grazing-angle reflection: the flatter the view, the closer to the fog (horizon) color; the getter follows whatever fog exists at draw time.
    // Basic material has no normal/view variables, so it gets no reflection
    if (!('isMeshBasicMaterial' in m)) patches.push({ name: 'fresnel',
      uniforms: { uFresnel: { value: st.fresnel }, uFresnelColor: { get value() { return e.scene.fog?.color ?? grey; } } },
      glsl: { fragment: { pars: 'uniform float uFresnel; uniform vec3 uFresnelColor;', opaque_fragment: { before: `
        float threedogFres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0) * uFresnel;
        outgoingLight = mix(outgoingLight, uFresnelColor, clamp(threedogFres, 0.0, 1.0));` } } } });
    return patchMaterial(m, patches, { strict: false });
  }
  /** @internal */
  _prep(mesh, size) {
    mesh.receiveShadow = true; mesh.renderOrder = 1;
    if (this.normalMap) { const uv = mesh.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size * this.st.normalRepeat, uv.getY(i) * size * this.st.normalRepeat); }
  }
  /** @internal */
  _addBody(b) {
    const seg = Math.max(4, Math.round((b.radius ? b.radius * 2 : Math.max(b.hw, b.hd) * 2) / this.cell));
    const geo = b.radius ? new THREE.CircleGeometry(b.radius, Math.max(16, seg * 2)).rotateX(-Math.PI / 2) : new THREE.PlaneGeometry(b.hw * 2, b.hd * 2, seg, seg).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, this.material);
    m.position.set(b.x, b.level - 0.1, b.z);
    this._prep(m, b.radius ? b.radius * 2 : Math.max(b.hw, b.hd) * 2);
    this.engine.add(m, { owner: 'engine:water' });
    this.bodies.set(b, m);
  }
  /** @internal */
  _makeSea() {
    this._seaChecked = true;
    const st = this.st, level = st.level ?? (Number.isFinite(this.engine.waterLevel) ? this.engine.waterLevel : null);
    if (level == null) return;
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(st.size, st.size, st.segments, st.segments).rotateX(-Math.PI / 2), this.material);
    this.sea.position.y = level - 0.2;
    this._prep(this.sea, st.size);
    this.engine.add(this.sea, { owner: 'engine:water' });
  }
  /**
   * Per-frame update: global water snaps to the focus grid, normal map scrolls (called by the module itself each frame)
   * @param {Vector3} focus
   * @param {number} dt
   * @returns {void}
   * @internal
   */
  update(focus, dt) {
    if (!this._seaChecked) this._makeSea();
    if (this.sea) {
      const c = this.cell * 4;
      this.sea.position.x = Math.round(focus.x / c) * c;
      this.sea.position.z = Math.round(focus.z / c) * c;
    }
    if (this.normalMap) { this.normalMap.offset.x += this.st.normalSpeed[0] * dt; this.normalMap.offset.y += this.st.normalSpeed[1] * dt; }
  }
}

/**
 * Water → engine.water. Global level defaults to the terrain water level; independent bodies use engine.addWaterBody()
 * @param {WaterOptions} [opts]
 * @returns {ModuleDef<Water>}
 */
export function water(opts = {}) {
  let w = null;
  return { name: 'water', label: 'Water', stage: 'environment', after: ['sky'], install(e) { checkOptions('water()', opts, WATER_OPTIONS); w = new Water(e, opts); return w; }, frame(dt, e) { w.update(e.focus, dt); } };
}
