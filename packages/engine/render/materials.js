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
import { closest, warnMissing, warnOnce } from '../core/validate.js';
import { patchMaterial, copyPatches } from './patches.js';
import { EFFECTS, placeholderTexture } from './effects.js';
/** @import { ColorLike, Material, BufferGeometry } from '../types/common' */

// ---------- style pack per engine ----------
// Live engines in creation order: makeMaterial without an engine argument uses the first one's style pack
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
 *   prop:    (params, purpose) => new THREE.ShaderMaterial({ ... }),  // function: returns any three.js Material
 * }
 * A pack Material instance is cloned with its shader patches (applyEffects) kept.
 * With more than one engine on the page, pass the engine whose style pack should decide (default: the first engine created).
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
  const entry = M[purpose] ?? M.default, key = purpose in M ? purpose : 'default';
  let m, props = params;
  if (entry?.isMaterial) m = copyPatches(entry, entry.clone());
  else if (typeof entry === 'function') {
    m = entry(params, purpose);
    if (!m?.isMaterial) throw new Error(`style.materials.${key} returned ${m}; the function must return a three.js Material`);
  } else {
    // A spec layers on top of materials.default when that is a spec too
    const { type = 'lambert', steps = 3, ...rest } = { ...(isSpec(M.default) ? M.default : {}), ...entry, ...params };
    const Ctor = TYPES[type];
    if (!Ctor) throw new Error(`style.materials.${key}: unknown type '${type}'; use ${Object.keys(TYPES).join(' | ')}, or give a Material instance or a function (params, purpose) => Material`);
    m = new Ctor();
    if (type === 'toon') m.gradientMap = toonRamp(steps);
    props = rest;
  }
  for (const k in props) {
    if (k === 'type' || !(k in m)) continue;
    const v = props[k];
    if (m[k]?.isColor) m[k].set(v); else m[k] = v;
  }
  m.userData.purpose = purpose;
  m.needsUpdate = true;
  return m;
}

// ---------- shader effects (named patches, see patches.js; the built-in ones are in effects.js) ----------
/**
 * Add effects to any material (built-in, from a style pack, or third-party); returns the same material. The one entry for shader effects:
 * wind (sway amplitude; the shadow sways too, nothing else to set up), clouds (drifting cloud shadows, default on; how dark is
 * style.clouds.shadow), season ('foliage' | 'ground' seasonal tint), and patches: your own named patches (see ShaderPatch in
 * render/patches.js). The 'world' patch (varying vThreedogWorld, world position) comes with clouds, and is added for any of your
 * patches that lists it in needs.patches.
 * Built-in effects the material cannot take (MeshBasicMaterial has no lighting chunk for clouds) are skipped with a one-time warning;
 * your own patches throw when their anchor is missing. Calling again with the same effect replaces it.
 * @example
 * applyEffects(new THREE.MeshToonMaterial({ color: 0x5a8a3a }), { wind: 0.03, season: 'foliage' });
 * applyEffects(mat, { clouds: false, patches: [{ name: 'snap', cacheKey: 64, uniforms: { uGrid: { value: 64 } },
 *   glsl: { vertex: { pars: 'uniform float uGrid;', project_vertex: 'gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uGrid) / uGrid * gl_Position.w;' } } }] });
 * @param {Material} material
 * @param {{ wind?: number, clouds?: boolean, season?: 'foliage' | 'ground', patches?: import('./patches.js').ShaderPatch[] }} [opts]
 * @returns {Material}
 */
export function applyEffects(material, { wind, clouds = true, season, patches } = {}) {
  const list = [];
  if (clouds || patches?.some(p => p.needs?.patches?.includes('world'))) list.push(EFFECTS.world());
  if (clouds) list.push(EFFECTS.clouds());
  if (season) list.push(EFFECTS.season(season));
  if (wind) list.push(EFFECTS.wind(wind));
  patchMaterial(material, list, { strict: false });
  if (patches) patchMaterial(material, patches);
  return material;
}

// Optional detail texture (a neutral placeholder until the image loads): style pack terrain.detail = { texture: '/textures/grain.png', scale: 0.25, strength: 0.35 }.
// Projected top-down in world space, so no UVs needed; adds grain or grass texture to flat color areas.
/**
 * Terrain material: base (default the style's 'terrain' role with vertex colors) + cloud shadows + season tint + optional detail texture
 * (style.terrain.detail). Pass the engine so its style pack and assets are used.
 * @param {Material | null} [base]
 * @param {{ style: any, assets: any }} [engine]
 * @returns {Material}
 */
export function terrainMaterial(base = null, engine = undefined) {
  const e = owner(engine);
  const m = applyEffects(base || makeMaterial('terrain', { vertexColors: true }, e ?? undefined), { season: 'ground' });
  const det = e?.style?.terrain?.detail;
  if (det?.texture && e?.assets) {
    const u = { uDetail: { value: placeholderTexture('detail') }, uDetailScale: { value: det.scale ?? 0.25 }, uDetailStrength: { value: det.strength ?? 0.35 } };
    e.assets.texture(det.texture).then(t => {
      const tex = t.clone();   // shares the image (no second upload); own wrapping
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
      u.uDetail.value.dispose(); u.uDetail.value = tex;
    }).catch(err => console.warn(err.message));
    patchMaterial(m, [EFFECTS.world(), { name: 'detail', needs: { patches: ['world'] }, uniforms: u,
      glsl: { fragment: { pars: 'uniform sampler2D uDetail; uniform float uDetailScale; uniform float uDetailStrength;',
        color_fragment: 'diffuseColor.rgb *= mix(vec3(1.0), texture2D(uDetail, vThreedogWorld.xz * uDetailScale).rgb * 2.0, uDetailStrength);' } } }], { strict: false });
  }
  return m;
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
