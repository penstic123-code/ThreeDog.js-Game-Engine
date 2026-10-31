// Named shader patches: one way to add shader code to any three.js material (WebGLRenderer only).
// A patch says where its code goes (after or before a `#include <chunk>` anchor), which uniforms it needs and what makes its
// program unique (cacheKey). Patches stack: the material's own onBeforeCompile runs first, then every patch in the order added,
// and the program cache key joins all of them, so two patches never overwrite each other and differently-parameterised
// materials never share a program. A missing anchor is reported when the patch is added, not discovered as a silent no-op.
// GLSL lives under `glsl`; a WebGPU node version would be a separate field once a WebGPU path exists (WebGPURenderer does not
// run onBeforeCompile). Engine uniforms (engine.uniforms: uTime, uWind, uCloud...) are resolved per renderer when the program
// compiles, so one material works under any engine and two engines on a page each drive their own time and weather.
// A patch that moves vertices (shadow: true) owns its shadow: meshes using the material get matching depth and distance
// materials automatically (see the customDepthMaterial / customDistanceMaterial defaults below), callers never set them.
// material.clone() does not carry patches (three's Material.copy skips onBeforeCompile): copy them with copyPatches(from, to).
//
// Composition contract (each part is checked, so a bad combination fails loudly in development instead of rendering wrong):
//   needs.data     program inputs the code reads, named like three's program parameters ('instancing', 'instancingColor',
//                  'vertexColors', 'skinning', 'batching'); checked when the program compiles, one console.error per material.
//   needs.patches  patches that must already be on the material (their varyings / functions are used); checked when added.
//   conflicts      patch names this one cannot share a material with (both write the same output); checked when added, both ways.
//   uniforms       a name belongs to one patch: two patches bringing different objects under one uniform name is a conflict
//                  (the same engine uniform, e.g. engine.uniforms.uTime, counts as one object).
//   shadow         render steps: without it the patch runs only in the color pass; with it its vertex code also runs in the
//                  depth pass (directional / spot shadows) and the distance pass (point-light shadows).
//   cacheKey       must change whenever the GLSL text changes (defines, branches), never for uniform values. The program key is
//                  the material's own key + '|threedog:' + name=cacheKey of every patch in order; one name + cacheKey producing
//                  two different GLSL texts throws, since those materials would silently share one program.
import * as THREE from 'three';
import { closest } from '../core/validate.js';
/** @import { Material } from '../types/common' */

/**
 * @typedef {{ before?: string, after?: string } | string} PatchCode  code for one anchor (a plain string goes after the include)
 * @typedef {{ name: string, cacheKey?: string | number, uniforms?: Record<string, { value: any }>, shadow?: boolean,
 *   needs?: { data?: string[], patches?: string[] }, conflicts?: string[],
 *   glsl?: { vertex?: Record<string, PatchCode>, fragment?: Record<string, PatchCode> } }} ShaderPatch
 *   glsl.vertex / glsl.fragment: anchor chunk name -> code; the key `pars` is declarations placed at the top of the shader.
 *   shadow: the patch moves vertices, so the depth and point-light distance passes run its vertex code too.
 *   needs.data: program inputs read, e.g. ['instancing']; needs.patches: patches it builds on, e.g. ['world'] (the vThreedogWorld varying).
 *   conflicts: patch names it cannot be combined with. cacheKey: changes whenever the GLSL text changes (see the header).
 */

// Shader source of built-in materials, to check anchors before the first compile
const LIB = { MeshBasicMaterial: 'basic', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong', MeshStandardMaterial: 'standard',
  MeshPhysicalMaterial: 'physical', MeshToonMaterial: 'toon', MeshMatcapMaterial: 'matcap', MeshDepthMaterial: 'depth',
  MeshDistanceMaterial: 'distance', MeshNormalMaterial: 'normal', PointsMaterial: 'points', SpriteMaterial: 'sprite' };
function sourceOf(m, stage) {
  if (m.isShaderMaterial) return m[stage + 'Shader'];
  const id = LIB[m.type];
  return id ? THREE.ShaderLib[id][stage + 'Shader'] : null;
}
/** Anchors the patch needs that the material's shader lacks ([] = fits; null = unknown material, checked at compile time) */
function missing(m, p) {
  const out = [];
  for (const stage of ['vertex', 'fragment']) {
    const src = sourceOf(m, stage);
    if (src == null) return null;
    for (const k in p.glsl?.[stage] || {}) if (k !== 'pars' && !src.includes(`#include <${k}>`)) out.push(`${stage} <${k}>`);
  }
  return out;
}

// ---------- engine uniforms ----------
// An engine uniform carries its name under this key; at compile time it is swapped for the same-named uniform of the engine
// that owns the renderer (bindUniforms), and a renderer without an engine keeps the object it was given.
const ENGINE_UNIFORM = Symbol.for('threedog.engineUniform');
const BOUND = new WeakMap();   // renderer -> its engine's uniforms
/**
 * A uniform object { value } tagged as the engine uniform `name` (resolved per renderer at compile time)
 * @internal
 * @param {string} name
 * @param {any} value
 * @returns {{ value: any }}
 */
export function engineUniform(name, value) { return { value, [ENGINE_UNIFORM]: name }; }
/**
 * Programs this renderer compiles from now on read these engine uniforms (called once per engine)
 * @internal
 * @param {any} renderer
 * @param {Record<string, { value: any }>} uniforms
 * @returns {void}
 */
export function bindUniforms(renderer, uniforms) { BOUND.set(renderer, uniforms); }
const sameUniform = (a, b) => a === b || (!!a[ENGINE_UNIFORM] && a[ENGINE_UNIFORM] === b[ENGINE_UNIFORM]);
const resolveUniform = (u, renderer) => (u?.[ENGINE_UNIFORM] && renderer && BOUND.get(renderer)?.[u[ENGINE_UNIFORM]]) || u;

// Why a patch cannot join the material's list, or '' (composition rules from the header)
let deriving = false;   // re-entrancy flag, set and cleared inside one synchronous call (never across a frame)
const CODE = new Map();   // name=cacheKey -> GLSL text, to catch a cacheKey that does not follow the code
const DATA = ['instancing', 'instancingColor', 'vertexColors', 'skinning', 'batching'];
function clash(list, p) {
  for (const d of p.needs?.data || []) if (!DATA.includes(d)) {
    const near = closest(d, DATA);
    return `patch '${p.name}' needs.data names '${d}', which is not a program input; use ${DATA.join(' | ')}` + (near ? ` (did you mean '${near}'?)` : '');
  }
  const others = list.filter(q => q.name !== p.name);
  for (const q of others) if (p.conflicts?.includes(q.name) || q.conflicts?.includes(p.name))
    return `patches '${q.name}' and '${p.name}' cannot be combined on one material; keep one of them, or use two materials`;
  for (const n of p.needs?.patches || []) if (!others.some(q => q.name === n))
    return `patch '${p.name}' needs patch '${n}' on the material first; put '${n}' before it in the patches list (applyEffects adds the built-in 'world' itself when a patch needs it), or fix why '${n}' was skipped`;
  for (const q of others) for (const u in p.uniforms || {}) if (q.uniforms?.[u] && !sameUniform(q.uniforms[u], p.uniforms[u]))
    return `patches '${q.name}' and '${p.name}' both bring a uniform named '${u}'; rename one (prefix it with the patch name), or share engine.uniforms.${u}`;
  const key = p.name + '=' + (p.cacheKey ?? ''), code = JSON.stringify(p.glsl ?? {});
  if (CODE.has(key) && CODE.get(key) !== code)
    return `patch '${p.name}' produced different GLSL under the same cacheKey '${p.cacheKey ?? ''}'; put every value that changes the code into cacheKey`;
  CODE.set(key, code);
  return '';
}

const LISTS = new WeakMap();   // material -> its patches (not userData: that gets JSON-cloned and exported to glTF)
const PROTO_COMPILE = THREE.Material.prototype.onBeforeCompile;
const warned = new Set();

function apply(shader, list, m, renderer) {
  for (const p of list) for (const d of p.needs?.data || []) if (!shader[d]) {
    const tag = `${m.uuid}:${p.name}:${d}`;
    if (!warned.has(tag)) { warned.add(tag); console.error(`[threedog] patch '${p.name}' needs '${d}', which this mesh does not provide (e.g. 'instancing' needs an InstancedMesh, 'vertexColors' needs material.vertexColors and a color attribute)`); }
  }
  for (const stage of ['vertex', 'fragment']) {
    const key = stage + 'Shader', pars = [], at = new Map();
    for (const p of list) {
      for (const u in p.uniforms) shader.uniforms[u] = resolveUniform(p.uniforms[u], renderer);
      for (const [k, code] of Object.entries(p.glsl?.[stage] || {})) {
        if (k === 'pars') { pars.push(code); continue; }
        const slot = at.get(k) || at.set(k, { before: [], after: [] }).get(k);
        if (typeof code === 'string') slot.after.push(code); else { if (code.before) slot.before.push(code.before); if (code.after) slot.after.push(code.after); }
      }
    }
    let src = shader[key];
    for (const [k, { before, after }] of at) {
      const inc = `#include <${k}>`;
      if (!src.includes(inc)) {
        const tag = `${m.type}:${k}`;
        if (!warned.has(tag)) { warned.add(tag); console.error(`[threedog] shader patch anchor ${inc} not found in ${m.type}; add it to your shader or #include the threedog_* chunks by hand (see render/patches.js)`); }
        continue;
      }
      src = src.replace(inc, [...before, inc, ...after].join('\n'));
    }
    shader[key] = pars.join('\n') + '\n' + src;
  }
}

/**
 * Add named shader patches to any material; returns the same material. Stacks with the material's own onBeforeCompile
 * and with earlier patches; a patch with the same name replaces the earlier one. A missing anchor throws (strict) or
 * skips that patch with a one-time warning (strict: false, used for the engine's automatic effects). Composition errors
 * (conflicts, a needed patch missing, a uniform name taken, cacheKey not following the code) throw the same way.
 * @example
 * // reads the world position varying of 'clouds', and must not share a material with the engine's 'wind'
 * patchMaterial(mat, [{ name: 'ripple', needs: { patches: ['clouds'] }, conflicts: ['wind'], shadow: true, ... }]);
 * patchMaterial(mat, [{ name: 'snap', cacheKey: 64, uniforms: { uGrid: { value: 64 } }, glsl: {
 *   vertex: { pars: 'uniform float uGrid;', project_vertex: 'gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uGrid) / uGrid * gl_Position.w;' } } }]);
 * @internal games and style packs go through applyEffects(material, { patches })
 * @param {Material} material
 * @param {ShaderPatch[]} patches
 * @param {{ strict?: boolean }} [opts]
 * @returns {Material}
 */
export function patchMaterial(material, patches, { strict = true } = {}) {
  const m = /** @type {any} */ (material);
  let list = LISTS.get(m);
  if (!list) {
    LISTS.set(m, list = []);
    const prev = m.onBeforeCompile;
    const prevKey = Object.hasOwn(m, 'customProgramCacheKey') ? m.customProgramCacheKey.bind(m) : prev !== PROTO_COMPILE ? () => prev.toString() : () => '';
    m.onBeforeCompile = function (shader, renderer) { if (prev !== PROTO_COMPILE) prev.call(this, shader, renderer); apply(shader, list, m, renderer); };
    m.addEventListener('dispose', () => dropShadow(m));
    m.customProgramCacheKey = () => prevKey() + '|threedog:' + list.map(p => p.name + '=' + (p.cacheKey ?? '')).join(',');
  }
  for (const p of patches) {
    const bad = deriving ? '' : clash(list, p);
    if (bad) {
      if (strict) throw new Error(`[threedog] ${bad}`);
      console.error(`[threedog] ${bad}; patch '${p.name}' skipped`);
      continue;
    }
    const gaps = missing(m, p);
    if (gaps?.length) {
      const msg = `patch '${p.name}' needs ${gaps.join(', ')}, which ${m.type} does not have`;
      if (strict) throw new Error(msg + '; use a material that has these chunks, or #include the threedog_* chunks in your own shader');
      if (!warned.has(msg)) { warned.add(msg); console.warn('[threedog] ' + msg + '; skipped'); }
      continue;
    }
    const i = list.findIndex(q => q.name === p.name);
    if (i >= 0) list[i] = p; else list.push(p);
  }
  dropShadow(m);
  m.needsUpdate = true;
  return m;
}

/**
 * Names of the patches on a material (in order), e.g. ['clouds', 'tint', 'wind']
 * @param {Material} material
 * @returns {string[]}
 */
export function materialPatches(material) { return (LISTS.get(material) || []).map(p => p.name); }

/**
 * Give `to` the patches of `from`, e.g. after `from.clone()` (three's Material.copy does not carry onBeforeCompile, so a clone
 * starts without patches). Returns `to`.
 * @internal engine code that clones materials (makeMaterial, vegetation fromModel) calls it
 * @param {Material} from
 * @param {Material} to
 * @returns {Material}
 */
export function copyPatches(from, to) {
  const list = LISTS.get(from);
  if (!list?.length || from === to) return to;
  deriving = true;   // already checked on `from`
  try { return patchMaterial(to, list, { strict: false }); } finally { deriving = false; }
}

// ---------- shadows follow vertex-moving patches ----------
// Depth / distance materials carrying the material's vertex-moving patches; undefined when nothing moves. Cached per material
// and kind; patchMaterial and material.dispose() drop (and dispose) the cached ones, so patches added later are picked up.
const shadowMats = new WeakMap();
function dropShadow(material) {
  const byKind = shadowMats.get(material);
  if (byKind) for (const k in byKind) byKind[k]?.dispose();
  shadowMats.delete(material);
}
const moves = m => !!LISTS.get(m)?.some(p => p.shadow);
/**
 * Whether the material carries a vertex-moving patch (shadow: true, e.g. wind). Such code reads object space (position.y, the model
 * origin), so baking these meshes into world space (merging, HLOD proxies) would change how they move.
 * @internal
 * @param {Material | Material[]} material
 * @returns {boolean}
 */
export function movesVertices(material) { return [].concat(material).some(moves); }
function shadowMaterial(material, kind) {
  let byKind = shadowMats.get(material);
  if (!byKind) shadowMats.set(material, byKind = {});
  if (kind in byKind) return byKind[kind];
  const moving = LISTS.get(material).filter(p => p.shadow).map(p => ({ ...p, needs: { data: p.needs?.data }, conflicts: undefined, glsl: { vertex: p.glsl?.vertex } }));
  // three copies side, alphaTest, map and clipping from the drawn material onto the depth material on every draw
  const base = kind === 'depth' ? new THREE.MeshDepthMaterial() : new THREE.MeshDistanceMaterial();
  deriving = true;   // vertex-only copies of patches already checked on the source material
  try { return byKind[kind] = patchMaterial(base, moving, { strict: false }); } finally { deriving = false; }
}
// The shadow passes read object.customDepthMaterial (sun / spot) and customDistanceMaterial (point lights); three has no other hook.
// Their default (nothing assigned) becomes "my material's moving patches in that pass", so a wind material casts a swaying shadow
// however the mesh was built (game code, level load, instancing, a swapped material); an explicit assignment still wins. It must be
// on Mesh.prototype before any mesh exists (Object3D's constructor assigns both, which would otherwise make own properties).
// Explicit values live under a global symbol, so a second copy of this file (hot reload) redefining the accessor loses none.
for (const [prop, kind] of [['customDepthMaterial', 'depth'], ['customDistanceMaterial', 'distance']]) {
  const own = Symbol.for('threedog.' + prop);
  Object.defineProperty(THREE.Mesh.prototype, prop, {
    configurable: true,
    get() {
      if (Object.hasOwn(this, own)) return this[own];
      // multi-material mesh (trunk + leaves): one shadow material serves every group, so take the first one that moves
      const m = Array.isArray(this.material) ? this.material.find(moves) : this.material;
      return moves(m) ? shadowMaterial(m, kind) : undefined;
    },
    set(v) { if (v === undefined) delete this[own]; else this[own] = v; },   // Object3D's constructor assigns undefined
  });
}
