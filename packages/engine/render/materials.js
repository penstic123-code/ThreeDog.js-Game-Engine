// Materials and shaders:
//   1. Material factory makeMaterial(role, params): modules ask the style pack for a material; the pack decides the look (matte, glossy, realistic, toon)
//   2. Effects injected into stock three.js materials (shadows, fog and tone mapping kept): wind sway, cloud shadows, season tint, ground detail texture
//
// Style pack usage (an entry may also be a Material instance or a function returning any Material, see makeMaterial):
//   materials: {
//     default:    { type: 'lambert' },                       // 'lambert' matte | 'phong' glossy | 'standard' realistic PBR | 'toon' cartoon bands
//     terrain:    { type: 'standard', roughness: 0.95 },
//     vegetation: { type: 'toon', steps: 3 },
//     character:  { type: 'toon', steps: 3 },
//     building:   { type: 'standard', roughness: 0.8, metalness: 0 },
//     water:      { type: 'phong', shininess: 90 },
//   }
//   Role names are open: a game can add its own and fetch it with makeMaterial('furniture', { color: 0x8a5a36 }).
import * as THREE from 'three';
import { closest, warnMissing, warnOnce, checkOptions } from '../core/validate.js';
import { patchMaterial, copyPatches } from './patches.js';
import { declareUniforms } from './uniformDecl.js';
import { EFFECTS } from './effects.js';
import { detailPatch } from './detail.js';
import { applySurface } from './surface.js';
import { lightingPatch, rampTexture } from './lighting.js';
/** @import { ColorLike, Material, BufferGeometry } from '../types/common' */

// ---------- style pack per engine ----------
// Live engines in creation order: only makeMaterial called without an engine (a game's module-level code) uses the first one's style pack
const ENGINES = [];
/**
 * Register an engine's style pack and assets for makeMaterial; returns a handle whose remove() unregisters it (engine.dispose)
 * @internal
 * @param {{ style: any, assets: any }} engine
 * @returns {{ remove(): void }}
 */
export function registerEngine(engine) {
  ENGINES.push(engine);
  return { remove: () => { const i = ENGINES.indexOf(engine); if (i >= 0) ENGINES.splice(i, 1); } };
}
function owner(engine) {
  if (engine) return engine;
  if (ENGINES.length > 1 && ENGINES.some(e => e.style !== ENGINES[0].style))
    warnOnce(`makeMaterial: ${ENGINES.length} engines with different style packs are running; using the first one's. Pass the engine as the third argument: makeMaterial(role, params, engine)`);
  return ENGINES[0] ?? null;
}

// ---------- material factory ----------
const toonRamps = new Map();
function toonRamp(steps) {
  if (!toonRamps.has(steps)) {
    const data = new Uint8Array(steps * 4);
    for (let i = 0; i < steps; i++) { const v = Math.round(((i + 1) / steps) * 255); data.set([v, v, v, 255], i * 4); }
    const t = new THREE.DataTexture(data, steps, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
    toonRamps.set(steps, t);
  }
  return toonRamps.get(steps);
}
const TYPES = { lambert: THREE.MeshLambertMaterial, phong: THREE.MeshPhongMaterial, standard: THREE.MeshStandardMaterial, physical: THREE.MeshPhysicalMaterial, toon: THREE.MeshToonMaterial, basic: THREE.MeshBasicMaterial };

// A style pack's materials can give them a look, or add new names.
/**
 * Material roles the engine itself uses
 * @type {string[]}
 */
export const MATERIAL_PURPOSES = ['default', 'terrain', 'vegetation', 'character', 'water', 'pickup', 'prop'];

// The style pack's materials[role] (or materials.default) decides the material; params are this call's specifics (color, vertex colors, double-sided...).
// Only properties the material has are set, so one params object works for any material, built-in or custom.
// Spec keys handled by makeMaterial / applySurface rather than copied onto the material
const SPEC_KEYS = ['steps', 'ramp', 'soften', 'repeat', 'wrap', 'detail', 'lighting'];
const isSpec = e => e && !e.isMaterial && typeof e !== 'function';
/**
 * Create a material by role: makeMaterial('furniture', { color: 0x8a5a36 }); the look comes from the style pack's materials[role] (unlisted roles use materials.default).
 * Roles the engine uses: default terrain vegetation character water pickup prop (MATERIAL_PURPOSES); a game may pick new names (e.g. 'building'),
 * and a name close to an existing role ('props', 'charcter') warns in dev.
 * A style pack entry has one of three forms; params are then applied to the result (keys the material lacks are skipped):
 * @example
 * materials: {
 *   default: { type: 'toon', steps: 3 },                                // spec: type lambert | phong | standard | physical | toon | basic, plus properties
 *   water:   new THREE.MeshMatcapMaterial({ matcap: tex }),           // instance: cloned on every call
 *   prop:    (params, purpose, engine) => new THREE.ShaderMaterial({ ... }),  // function: returns any three.js Material
 * }
 * A pack Material instance is cloned with its shader patches (applyEffects) kept.
 * Whose style pack decides: engine.makeMaterial(purpose, params) (this engine's) or the third argument; without either the first live engine's
 * (fine for a one-engine game; engine code and style packs always pass the engine, and two engines on the page warn in dev).
 * @param {string} [purpose]
 * @param {{ color?: ColorLike, [prop: string]: any }} [params]
 * @param {{ style: any }} [engine]
 * @returns {Material}
 */
export function makeMaterial(purpose = 'default', params = {}, engine = undefined) {
  const M = owner(engine)?.style?.materials || {};
  // New role names are allowed; warn only when a name is close to an existing one (probably a typo)
  if (!(purpose in M) && !MATERIAL_PURPOSES.includes(purpose)) {
    const known = [...new Set([...MATERIAL_PURPOSES, ...Object.keys(M)])];
    if (closest(purpose, known)) warnMissing('material', purpose, known);
  }
  const entry = M[purpose] ?? M.default, key = purpose in M ? purpose : 'default', eng = owner(engine);
  let m, props = params;
  if (entry?.isMaterial) m = copyPatches(entry, entry.clone());
  else if (typeof entry === 'function') {
    m = entry(params, purpose, eng);
    if (!m?.isMaterial) throw new Error(`style.materials.${key} returned ${m}; the function must return a three.js Material`);
  } else {
    // A spec layers on top of materials.default when that is a spec too
    const { type = 'lambert', steps = 3, ramp, soften, ...rest } = { ...(isSpec(M.default) ? M.default : {}), ...entry, ...params };
    const Ctor = TYPES[type];
    if (!Ctor) throw new Error(`style.materials.${key}: unknown type '${type}'; use ${Object.keys(TYPES).join(' | ')}, or give a Material instance or a function (params, purpose) => Material`);
    m = new Ctor();
    if (type === 'toon') m.gradientMap = ramp ? rampTexture(ramp, soften) : toonRamp(steps);
    else if (ramp || soften !== undefined) throw new Error(`style.materials.${key}: ramp / soften belong to type 'toon' (this is '${type}')`);
    props = applySurface(m, rest, `style.materials.${key}`, eng, eng?.style?.lighting);
  }
  // the pack's style.lighting also shapes pack Materials and function results that are plain three.js lit materials (specs got it above)
  if (props === params && eng?.style?.lighting && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial))
    patchMaterial(m, [lightingPatch(eng.style.lighting, 'style.lighting')]);
  for (const k in props) {
    if (k === 'type' || !(k in m)) continue;
    const v = props[k];
    if (m[k]?.isColor) m[k].set(v); else if (m[k]?.isVector2 && Array.isArray(v)) m[k].set(...v); else m[k] = v;
  }
  // A key this material lacks is skipped on purpose (one params object works for any material type), but a key that looks like a typo of a real
  // property ('roughnes') warns once with the suggestion. loose: keys with no close match (a spec shared across types) stay silent.
  checkOptions(`makeMaterial('${purpose}')`, params, [...Object.keys(m), ...SPEC_KEYS, 'type'], { loose: true });
  m.userData.purpose = purpose;
  m.needsUpdate = true;
  return m;
}

// ---------- shader effects (named patches, see patches.js; the built-in ones are in effects.js) ----------
// A style's own sway function (style.wind.glsl): must define threedogWind(); its uniforms are declared for it
function windCustom({ glsl, uniforms }) {
  if (!/void\s+threedogWind\s*\(/.test(glsl || '')) throw new Error('style.wind.glsl must define `void threedogWind(inout vec3 transformed, vec3 ip, vec3 position)`: move the vertex (object space) by the sway; ip = world position of this instance, uTime / uWind / uWindFreq / THREEDOG_WIND_AMP are in scope');
  return { glsl, ...declareUniforms('style.wind.uniforms', uniforms) };
}
/**
 * Add effects to any material (built-in, from a style pack, or third-party); returns the same material. The one entry for shader effects:
 * wind (sway amplitude; the shadow sways too, nothing else to set up), clouds (drifting cloud shadows, default on; how dark is
 * style.clouds.shadow), season ('foliage' | 'ground' seasonal tint), and patches: your own named patches (see ShaderPatch in
 * render/patches.js), detail (grain / paper / strokes / a texture over the surface, see MaterialDetail in types/style.d.ts; a texture given by
 * asset name loads from `engine`, default the first live engine). The 'world' patch (varying vThreedogWorld, world position) comes with clouds, and is added for any of your
 * patches that lists it in needs.patches.
 * Built-in effects the material cannot take (MeshBasicMaterial has no lighting chunk for clouds) are skipped with a one-time warning;
 * your own patches throw when their anchor is missing. Calling again with the same effect replaces it.
 * @example
 * applyEffects(new THREE.MeshToonMaterial({ color: 0x5a8a3a }), { wind: 0.03, season: 'foliage' });
 * applyEffects(mat, { clouds: false, patches: [{ name: 'snap', cacheKey: 64, uniforms: { uGrid: { value: 64 } },
 *   glsl: { vertex: { pars: 'uniform float uGrid;', project_vertex: 'gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uGrid) / uGrid * gl_Position.w;' } } }] });
 * @param {Material} material
 * @param {{ wind?: number | { amplitude: number, glsl: string, uniforms?: Record<string, any> }, clouds?: boolean, season?: 'foliage' | 'ground', detail?: import('./detail.js').DetailOptions, engine?: { assets: any }, patches?: import('./patches.js').ShaderPatch[] }} [opts]
 * @returns {Material}
 */
export function applyEffects(material, { wind, clouds = true, season, detail, engine, patches } = {}) {
  const list = [];
  if (clouds || patches?.some(p => p.needs?.patches?.includes('world'))) list.push(EFFECTS.world());
  if (clouds) list.push(EFFECTS.clouds());
  if (season) list.push(EFFECTS.season(season));
  if (wind) list.push(typeof wind === 'number' ? EFFECTS.wind(wind) : EFFECTS.wind(wind.amplitude, windCustom(wind)));
  if (detail) list.push(EFFECTS.world(), detailPatch(detail, owner(engine), 'detail'));
  patchMaterial(material, list, { strict: false });
  if (patches) patchMaterial(material, patches);
  return material;
}

/**
 * Terrain material: base (default the style's 'terrain' role with vertex colors) + cloud shadows + season tint + optional detail texture
 * (style.terrain.detail). Pass the engine so its style pack and assets are used.
 * @param {Material | null} [base]
 * @param {{ style: any, assets: any }} [engine]
 * @returns {Material}
 */
export function terrainMaterial(base = null, engine = undefined) {
  const e = owner(engine);
  // style.terrain.detail is the `detail` patch with its texture-only options (top-down world projection, multiply)
  const det = e?.style?.terrain?.detail, tex = det?.texture && e?.assets;
  return applyEffects(base || makeMaterial('terrain', { vertexColors: true }, e ?? undefined),
    { season: 'ground', engine: e ?? undefined, ...(tex && { detail: { texture: det.texture, scale: det.scale ?? 0.25, strength: det.strength ?? 0.35 } }) });
}

/**
 * Merge several geometries into one vertex-colored geometry (a tree = trunk + canopy in one draw call): [[geometry, color], ...].
 * flat (default true): one normal per triangle, the faceted low-poly look; false keeps each part's own (smooth) normals.
 * UVs are kept when every part has them, so the merged model can still take a texture.
 * @example
 * const trunk = new THREE.CylinderGeometry(0.2, 0.3, 2).translate(0, 1, 0), crown = new THREE.SphereGeometry(1.2).translate(0, 2.6, 0);
 * const tree = mergeColored([[trunk, 0x7a5536], [crown, 0x4c8a3b]], { flat: false });   // smooth crown
 * @param {[BufferGeometry, ColorLike][]} parts
 * @param {{ flat?: boolean }} [opts]
 * @returns {BufferGeometry}
 */
export function mergeColored(parts, { flat = true } = {}) {
  const pos = [], nor = [], col = [], uv = [];
  const keepUV = parts.every(([g]) => g.attributes.uv);
  for (const [g0, hex] of parts) {
    if (!flat && !g0.attributes.normal) g0.computeVertexNormals();
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (flat) g.computeVertexNormals();
    const c = new THREE.Color(hex), p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) col.push(c.r, c.g, c.b);
    if (keepUV) for (const v of g.attributes.uv.array) uv.push(v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (keepUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
