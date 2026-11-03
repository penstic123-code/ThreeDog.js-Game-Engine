// Sky cascaded shadows (helper of shadow.js), off by default (shadow.cascades 1 = one shadow map, exactly the single-map path).
// shadow.cascades 2-4 splits the sun's shadow along the view into that many maps (three's CSM addon): sharp near the camera, wide far away.
// Design choices, each one because the addon used as-is would break something:
// - engine.lights.sun stays in charge and is the nearest cascade, so the sky keeps driving its color / intensity / direction, the dev
//   guards keep watching it. The other cascades are extra
//   DirectionalLights that copy the sun's color and intensity every frame.
// - Materials get the cascade lighting through one named patch, 'csm' (render/patches.js), never CSM.setupMaterial: that assigns
//   material.onBeforeCompile and would drop every other patch (wind, clouds, season, detail, lighting), and CSM.dispose deletes it.
// - The chunk swap is per material (the patch replaces <lights_fragment_begin>): CSM's constructor overwrites ShaderChunk globally and
//   never restores it, which would reach every material and every engine on the page; here _injectInclude does nothing.
// - Every lit material in the scene must carry the patch: without it the cascade lights would add up (N times the sunlight). So while
//   cascades are on, each frame visits only what entered the scene since the last one (core/sceneDelta.js: an add at any depth, or
//   mesh.material = x) and patches lit materials it has not seen (one Map lookup per mesh); the whole scene is walked once, when they turn on.
// - Which materials (user decision 4, option A, 2026-11-02): every BUILT-IN lit type, the game's own `new` materials too. This is the one named
//   exception to "the engine does not change what it did not create": unpatched, a lit material is lit by every cascade light (N times as
//   bright, doubled shadows), so leaving it alone is not neutral, it is a wrong picture. describe().owned lists the game materials it patched.
//   A ShaderMaterial with lights: true is the game's own shader code, so it is never patched silently: one warning names
//   engine.look.shadow.include(mat), which opts it in.
// - csm.update() runs only on frames whose shadow maps re-render (shadow.updateEvery), else lights move while the maps stay old.
// On WebGPURenderer all of the above is replaced by three's CSMShadowNode on the sun (cascades.tsl.js, registered by threedog/tsl): one light,
// so no patch, no scene walk, and look.shadow.include() does nothing. This file only hands over to it, so WebGL bundles never load three/webgpu.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { CSMShader } from 'three/addons/csm/CSMShader.js';
import { patchMaterial, unpatchMaterial, isEngineMade } from '../../render/patches.js';

import { warnOnce } from '../../core/validate.js';
import { sceneVisitor } from '../../core/sceneDelta.js';
import { codedError } from '../../core/errorHints.js';
import { setShadowUpdate, shadowUpdatePending, isWebGPU, webgpuPart } from '../../render/backend.js';
import { shadowsOn } from '../../core/look/shadowPart.js';

const LIT = new Set(['MeshLambertMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshToonMaterial']);
const litShader = m => m.isShaderMaterial && m.lights && m.fragmentShader.includes('#include <lights_fragment_begin>');
/** ShaderMaterials the game opted in with engine.look.shadow.include(mat) (per engine: the sky owns it) */
const optedIn = sky => sky._csmInclude ??= new WeakSet();
/**
 * engine.look.shadow.include(material): let the cascades patch a ShaderMaterial (lights: true) of yours. Built-in lit materials need nothing.
 * @example engine.look.shadow.include(myLitShaderMaterial);
 */
export function includeInCascades(sky, m) {
  if (!m?.isMaterial) throw codedError('sky-option', `engine.look.shadow.include(material): needs a three.js Material; got ${m}. Example: engine.look.shadow.include(myShaderMaterial)`);
  if (m.isShaderMaterial && !litShader(m)) throw codedError('sky-option', "engine.look.shadow.include(material): this ShaderMaterial has no lights: true + '#include <lights_fragment_begin>', so the cascades cannot reach it; build it on THREE.ShaderLib's lit shaders, or leave it out");
  if (isWebGPU(sky.engine.renderer)) {   // the cascades are the sun's shadow node there: every material is lit once without opting in
    warnOnce('engine.look.shadow.include(mat) does nothing on WebGPURenderer: cascaded shadows there are one light (three CSMShadowNode) and patch no material');
    return m;
  }
  optedIn(sky).add(m);
  if (sky.csm?.mats.has(m)) sky.csm.fit(m);   // already looked at and left alone: patch it now (fit is per material, so no scene walk)
  return m;
}
const lit = (sky, m) => {
  if (LIT.has(m.type)) return true;
  if (!litShader(m)) return false;
  if (optedIn(sky).has(m)) return true;
  warnOnce(`cascaded shadows: engine.look.shadow.include(mat) opts ShaderMaterial '${m.name || m.uuid.slice(0, 8)}' in. Until then it has lights: true and is lit by all ` +
    `${sky.csm?.lights.length ?? 'the'} cascade lights (too bright, doubled shadows): the engine does not patch your own shader code unasked`);
  return false;
};
const SPLITS = ['practical', 'uniform', 'logarithmic'];
const STRINGS = {
  count: 'look.shadow.set({ cascades }): a whole number 1 (one shadow map, the default) to 4; got {got}',
  split: "look.shadow.set({ split }): 'practical' (default) | 'uniform' | 'logarithmic' | (count, near, far, out) => void; got {got}",
  maxFar: 'look.shadow.set({ maxFar }): meters from the camera that cascades cover, a number > 0; got {got}',
  noSun: "look.shadow.set({ cascades }): cascaded shadows split the engine sun's shadow, and sky({ sun: false }) has no engine sun. " +
    "With your own lights use three's CSM addon on them, or keep sun: true / 'manual'",
};
const bad = (k, v) => { throw codedError('sky-option', STRINGS[k].replace('{got}', JSON.stringify(v) ?? String(v))); };

/** Throw on cascade fields a look.shadow.set call gets wrong, before anything is applied */
export function checkCascades(sky, o) {
  if (o.cascades !== undefined && !(Number.isInteger(o.cascades) && o.cascades >= 1 && o.cascades <= 4)) bad('count', o.cascades);
  if (o.split !== undefined && typeof o.split !== 'function' && !SPLITS.includes(o.split)) bad('split', o.split);
  if (o.maxFar !== undefined && !(o.maxFar > 0)) bad('maxFar', o.maxFar);
  if (o.cascades > 1 && sky._drive.sun === false) bad('noSun');
}

// The addon's split / frustum / texel-snapped placement, with the sun as cascade 0 and the chunk swap left to the 'csm' patch
class SkyCSM extends CSM {
  constructor(sky, S) {
    const e = sky.engine, custom = typeof S.split === 'function';
    super({ camera: e.camera, parent: e.scene, cascades: S.cascades, maxFar: S.maxFar, mode: custom ? 'custom' : S.split, customSplitsCallback: custom ? S.split : undefined,
      shadowMapSize: sky._sun.shadow.mapSize.x, shadowBias: S.bias, lightMargin: S.lightMargin, lightNear: 1, lightFar: S.lightMargin + 2 * S.maxFar });
    const first = this.lights[0];
    this.parent.remove(first, first.target); first.dispose();
    this.lights[0] = sky._sun;
    // uniforms shared by every patched material: one write here reaches all of them
    this.uniforms = { CSM_cascades: { value: [] }, cameraNear: { value: 0 }, shadowFar: { value: 0 } };
    this.fade = S.fade;
    this.updateFrustums();
    // cacheKey is new for every build: three keeps a material's old programs and, when a key comes back (cascades off, then on again),
    // reuses that program with the uniforms map of the material's latest compile, which lacks these uniforms, so the GPU would keep the
    // old build's split and far values (shadows vanish where the old cascade 0 ended). One recompile per switch, which the light count
    // change costs anyway; each material keeps one program per switch until it is disposed, so switch on a settings screen, not per frame
    sky._csmBuild = (sky._csmBuild ?? 0) + 1;
    this.patch = { name: 'csm', cacheKey: `${S.cascades}${S.fade ? 'f' : ''}.${sky._csmBuild}`, uniforms: this.uniforms, slot: 'lightingModel',
      pars: `#define USE_CSM 1\n#define CSM_CASCADES ${S.cascades}\n${S.fade ? '#define CSM_FADE\n' : ''}` +
        'uniform vec2 CSM_cascades[CSM_CASCADES];\nuniform float cameraNear;\nuniform float shadowFar;',
      glsl: CSMShader.lights_fragment_begin };
    /** material -> the patch object it carries, so a rebuilt CSM re-patches and switching off finds every material */
    this.mats = new Map();
    this.sky = sky;
    this.at = new THREE.Vector3(Infinity, 0, 0);   // camera position at the last placement
    this.proj = '';
    /** what entered the scene since the last frame (view.walks: how many full walks ran; tests read it) */
    this.view = sceneVisitor(sky.engine.scene, { enter: o => { if (!o.isMesh) return; const ms = o.material; if (Array.isArray(ms)) for (const m of ms) this.fit(m); else if (ms) this.fit(ms); } });
  }
  fit(m) {
    const was = this.mats.get(m);
    if (was === this.patch || (was === null && !optedIn(this.sky).has(m))) return;
    if (!lit(this.sky, m)) { this.mats.set(m, null); return; }   // null: looked at, left alone (no per-frame recheck / rewarn)
    patchMaterial(m, [this.patch], { strict: false }); this.mats.set(m, this.patch);
  }
  /** describe().owned row: the game's own materials the csm patch went on (the named exception, see the header) */
  gameMaterials() { return [...this.mats].filter(([m, p]) => p && !isEngineMade(m)).map(([m]) => m.name || m.type); }
  _injectInclude() {}
  _updateUniforms() {
    const U = this.uniforms;
    if (!U) return;   // the base constructor calls this before the uniforms exist
    this._getExtendedBreaks(U.CSM_cascades.value);
    U.cameraNear.value = this.camera.near; U.shadowFar.value = Math.min(this.camera.far, this.maxFar);
  }
}

/** Create, rebuild or remove the cascades after look.shadow.set changed shadow fields; copy bias / softness to the extra lights */
export function syncCascades(sky) {
  const S = sky.shadow, e = sky.engine, want = S.cascades > 1;
  const key = want ? [S.cascades, S.maxFar, S.fade, S.lightMargin, S.split].join('|') : '';
  if (key !== sky._csmKey) {
    dropCascades(sky);
    sky._csmKey = key;
    if (want) {
      const sc = sky._sun.shadow.camera;
      sky._csmSaved = { left: sc.left, right: sc.right, top: sc.top, bottom: sc.bottom, near: sc.near, far: sc.far };
      if (isWebGPU(e.renderer)) {   // three's CSMShadowNode on the sun (cascades.tsl.js): no extra lights in the scene, no patches
        let node;
        try { node = webgpuPart('cascades', '[sky] cascaded shadows (style.sky.cascades)'); } catch (err) { sky._csmKey = ''; throw err; }
        sky.csm = node.create(sky, S);
        sky.csm.shadowParams(S);
        return;
      }
      sky.csm = new SkyCSM(sky, S);
      Object.assign(sc, { near: 1, far: sky.csm.lightFar });
      // these lights are new to the scene: honor look.shadow enabled false the way it treats existing lights
      for (const l of sky.csm.lights) if (l !== sky._sun) l.castShadow = shadowsOn(e);
    }
  }
  if (sky.csm?.isSkyCascadeNode) sky.csm.shadowParams(S);
  else if (sky.csm) for (const l of sky.csm.lights) Object.assign(l.shadow, { bias: S.bias, normalBias: S.normalBias, radius: S.radius, blurSamples: S.blurSamples });
}

/** Remove the cascades: extra lights out, the 'csm' patch off every material it went on, the sun's shadow box restored */
export function dropCascades(sky) {
  const c = sky.csm;
  if (!c) return;
  if (c.isSkyCascadeNode) c.drop();
  else {
    for (const l of c.lights) if (l !== sky._sun) { c.parent.remove(l, l.target); l.dispose(); }
    c.view.remove();
    for (const [m, p] of c.mats) if (p) unpatchMaterial(m, 'csm');
  }
  const sc = sky._sun.shadow.camera;
  Object.assign(sc, sky._csmSaved); sc.updateProjectionMatrix();
  sky.csm = null; sky._csmKey = ''; sky._snapKey = '';
  setShadowUpdate(sky.engine.renderer, sky.engine.scene, { now: true });
}

/** Per frame while cascades are on (instead of _placeShadow): patch materials that entered the scene, follow the camera and the light, place on shadow frames */
export function cascadeFrame(sky, lightDir) {
  const c = sky.csm, e = sky.engine, cam = e.camera, sun = sky._sun, S = sky.shadow;
  if (c.isSkyCascadeNode) { c.frame(lightDir); return; }
  c.view.sync();
  const proj = cam.isPerspectiveCamera ? `${cam.fov},${cam.aspect},${cam.near},${cam.far},${cam.zoom}` : `${cam.left},${cam.right},${cam.near},${cam.far},${cam.zoom}`;
  let force = false;
  if (c.camera !== cam || proj !== c.proj) { c.camera = cam; c.proj = proj; c.updateFrustums(); force = true; }
  c.lightDirection.copy(lightDir).negate();   // CSM points from the light into the scene
  const show = sun.visible && shadowsOn(e);      // with shadows off the extra lights would only add light: hide them
  for (const l of c.lights) if (l !== sun) { l.color.copy(sun.color); l.intensity = sun.intensity; l.visible = show; }
  cam.updateMatrixWorld();
  // not updating every frame: also place early when the camera left a quarter of the nearest cascade (teleport, fast travel)
  const near = c.breaks[0] * Math.min(cam.far, c.maxFar);
  if (S.updateEvery <= 1 || shadowUpdatePending(e.renderer, e.scene) || force || c.at.distanceToSquared(cam.position) > (near / 4) ** 2) {
    c.update(); c.at.copy(cam.position);
    if (S.updateEvery > 1) setShadowUpdate(e.renderer, e.scene, { now: true });
  }
}
