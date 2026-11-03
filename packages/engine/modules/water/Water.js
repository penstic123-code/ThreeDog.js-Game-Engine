// Water module: draws the global water plane (sea, big lakes; snaps to a grid following the focus so it doesn't "swim") and independent water bodies (mountain lakes, ponds, each with its own level).
// Look comes from look.water (its style layer is style.water): color, opacity, waves, normal map, shininess, grazing-angle reflection; water({...})
// takes only the structural choices (sea, level, flat, size, segments, uniforms for the look hooks). An own water material is
// look.water.replace(fn) (style layer: style.water.material).
//
// engine.use(water());                                      // global water only (level taken from the terrain water level)
// engine.use(water({ sea: false }));                         // no global water
// engine.use(water({ level: 4, size: 1200 }));              // level and size are world state: here, never in the style
// engine.look.water.set({ color: 0x3070a0, normalMap: 'water-n' });   // look values: look.water (style layer style.water), never water({...})
// const lake = engine.addWaterBody({ position: [120, 0, -40], radius: 25, level: 18 });   // add a mountain lake (can be added any time); lake.remove()
//
// three.js objects: engine.water.sea (global water Mesh, may be null), material (shared by all water), bodies (Map: water body → its Mesh)
// Style: water = { color, opacity, flat, waveHeight, waveScale, waveSpeed, normalMap: '/textures/water-n.jpg', normalScale, normalRepeat,
//                   normalSpeed: [x, z], fresnel: 0.6, segments, depthColor, foam, uniforms (for the look.water.patch hooks),
//                   material?: (engine, { uniforms, waves, surface, normalMap }) => Material }   (look hooks: recipes/44-water-weather-look-hooks.md)
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { placeholderTexture } from '../../render/effects.js';
import { patchMaterial } from '../../render/patches.js';
import { readParams, keysSchema } from '../../core/params.js';
import { waterLook, wavesPatch, surfacePatch } from './surface.js';
import { defineWaterLook, LOOK_KEYS } from './look.js';
import { codedError } from '../../core/errorHints.js';
import { glslFloat } from '../../render/fxNumbers.js';
import { FRESNEL_POWER } from './surfaceDefaults.js';
import { DEV } from '../../core/validate.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Object3D, Material, Vector3 } from '../../types/common' */
/** @import { WaterBody, WaterOptions } from '../../types/world' */
// Options accepted by water(): the structural choices only. Look values are look.water params (one entry per value), so the old look
// options throw in dev naming the look.water.set call; no glsl: look.water.patch('wave' | 'surface') is the one GLSL entry
const WATER_OPTIONS = ['sea', 'level', 'flat', 'size', 'segments', 'uniforms'];
const WATER_PARAMS = keysSchema(WATER_OPTIONS);

/** engine.water */
export class Water {
  /** @internal */
  constructor(engine, opts = {}, track) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.opts = opts;
    /** @internal */ this.st = { color: 0x888888, opacity: 0.85, flat: true, waveHeight: 1, waveScale: 1, waveSpeed: 1, fresnel: 0.5,
      size: 900, segments: 150, normalScale: 0.4, normalRepeat: 0.05, normalSpeed: [0.01, 0.006], shininess: 90, specular: 0xaaaaaa,
      ...(engine.style.water || {}), ...opts };
    const st = this.st;
    /** @internal */ this.cell = st.size / st.segments;
    /** @internal */ this.normalMap = null;
    /** @internal UV factor applied to the water meshes (1 = as built; size * normalRepeat once a normal map tiles them) and each mesh's size */
    this._uv = new Map();
    this._setNormalMap(st.normalMap);
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
    defineWaterLook(this);   // look.water: the style's values are its style layer, water({...}) options its 'game' layer
    track(engine.events.on('water:add', b => this._addBody(b)));
    // material is shared by all bodies, so not engine.remove (which would dispose it); its ray registration goes too
    track(engine.events.on('water:remove', b => { const m = this.bodies.get(b); if (m) { engine.detach(m); engine.rays.forget(m); this._uv.delete(m); m.geometry.dispose(); this.bodies.delete(b); } }));
  }

  /**
   * Normal map by asset name (null = none): a flat-normal placeholder until the asset loads, then it takes the asset's image source (shared,
   * not copied; goes through asset management, so it can be preloaded and released). look.water.set({ normalMap }) rebuilds the material after this
   * @internal
   */
  _setNormalMap(name) {
    if (!name) { this.normalMap = null; return; }
    const n = this.normalMap = placeholderTexture('normal'); n.wrapS = n.wrapT = THREE.RepeatWrapping;
    this.engine.assets.useTexture(name, t => { if (this.normalMap === n) { n.source = t.source; n.needsUpdate = true; } }, { where: 'water normalMap', instead: 'the generated ripples stay', opts: { color: false } });
    for (const mesh of this._uv.keys()) this._tile(mesh);
  }
  /** Scale a mesh's UVs to size * normalRepeat (the normal map tiles in meters); a no-op without a normal map or when already at that factor @internal */
  _tile(mesh) {
    const u = this._uv.get(mesh); if (!this.normalMap || !u) return;
    const f = u.size * this.st.normalRepeat, k = f / u.f; if (k === 1) return;
    const uv = mesh.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
    uv.needsUpdate = true; u.f = f;
  }
  /** @internal */
  _material() {
    const st = this.st, e = this.engine;
    const look = waterLook(st), surface = surfacePatch(e, look), waves = wavesPatch(e, st, look, !!surface);
    // A whole custom surface (toon foam bands, pixel ripples): the engine still builds the meshes and keeps the shared uniforms and the
    // normal-map scroll running; the built-in look (role 'water', waves, fresnel) is skipped. waves (and surface, when depthColor / foam /
    // the surface hook ask for one; it needs waves before it) are offered for applyEffects({ patches })
    if (st.material) {
      this._u = waves.uniforms;
      const own = st.material(e, { uniforms: waves.uniforms, waves, surface, normalMap: this.normalMap });
      if (!own?.isMaterial) throw codedError('water-option', 'look.water.replace / style.water.material must return a three.js Material, e.g. material: (engine, { uniforms }) => new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })');
      return own;
    }
    const m = makeMaterial('water', { color: st.color, transparent: st.opacity < 1, opacity: st.opacity, flatShading: st.flat, shininess: st.shininess, specular: st.specular, roughness: 0.15, metalness: 0 }, e);
    if (this.normalMap && 'normalMap' in m) {
      const lit = /** @type {THREE.MeshPhongMaterial | THREE.MeshStandardMaterial} */ (m);   // only lit materials have normalMap; the `in` test guarantees it
      lit.normalMap = this.normalMap; lit.normalScale = new THREE.Vector2(st.normalScale, st.normalScale);
    }
    const grey = new THREE.Color(0xcccccc);
    const patches = surface ? [waves, surface] : [waves];
    const uFresnel = { value: st.fresnel };
    this._u = { ...waves.uniforms, uFresnel };   // the live uniforms look.water.set writes
    // grazing-angle reflection: the flatter the view, the closer to the fog (horizon) color; the getter follows whatever fog exists at draw time.
    // Basic material has no normal/view variables, so it gets no reflection
    const uFresnelColor = { get value() { return e.scene.fog?.color ?? grey; } };
    if (!('isMeshBasicMaterial' in m)) patches.push({ name: 'fresnel',
      uniforms: { uFresnel, uFresnelColor },
      pars: 'uniform float uFresnel; uniform vec3 uFresnelColor;', slot: 'output', glsl: `
        float threedogFres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), ${glslFloat(FRESNEL_POWER)}) * uFresnel;
        outgoingLight = mix(outgoingLight, uFresnelColor, clamp(threedogFres, 0.0, 1.0));`,
      // NodeMaterial: the same blend (threedog/tsl waterFresnel) on the color before fog; the uniform nodes read these objects every render
      tsl: c => c.tsl.vec4(c.fx.waterFresnel(c.output.rgb, c.tsl.normalView, c.tsl.positionViewDirection,
        c.fx.patchUniform(uFresnel), c.fx.patchUniform(uFresnelColor)), c.output.a) });
    return patchMaterial(m, patches, { strict: false });
  }
  /** Build the shared material again (look.water changed something structural) and hand it to every water mesh @internal */
  _rebuild() {
    const old = this.material;
    this.material = this._material();
    for (const m of [this.sea, ...this.bodies.values()]) if (m) m.material = this.material;
    old.dispose();
  }
  /** Tile every water mesh again (look.water.set({ normalRepeat })) @internal */
  _retile() { for (const mesh of this._uv.keys()) this._tile(mesh);
  }
  /** @internal */
  _prep(mesh, size) {
    mesh.receiveShadow = true; mesh.renderOrder = 1;
    this._uv.set(mesh, { size, f: 1 }); this._tile(mesh);
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
  if (DEV) for (const k of LOOK_KEYS) if (k in opts) throw codedError('water-option', `water({ ${k} }) moved: engine.look.water.set({ ${k} }) after engine.use(water()), or style.water.${k} in the style (one entry per look value)`);
  // one entry per job: the whole surface is the look.water replace slot (the replaced material gets the uniforms in its ctx)
  if (DEV && 'material' in opts) throw codedError('water-option', 'water({ material }) moved: engine.look.water.replace((engine, { uniforms, waves, surface, normalMap }) => material) after engine.use(water()), or style.water.material in the style (one entry per look value)');
  readParams('water', WATER_PARAMS, opts);
  let w = null;
  return { name: 'water', type: 'look', label: 'Water', params: WATER_PARAMS, options: opts, stage: 'environment', after: ['sky'], install(e, ctx) { e.i18n.add({ 'zh-CN': { 'module.water': '水面' }, en: { 'module.water': 'water' } }); w = new Water(e, opts, ctx.track); return w; }, frame(dt, e) { w.update(e.focus, dt); },
    // "is there water where I think": the global sea (its level and plane size; null = none, e.g. no water level) and each separate body
    describe() {
      const r = v => Math.round(v * 10) / 10, s = w.sea;
      const bodies = [...w.bodies.keys()].map(b => ({ x: r(b.x), z: r(b.z), level: r(b.level), ...(b.radius ? { radius: r(b.radius) } : { size: [r(b.hw * 2), r(b.hd * 2)] }) }));
      return { sea: s ? { level: r(s.position.y + 0.2), size: w.st.size } : null, bodies };
    } };
}
