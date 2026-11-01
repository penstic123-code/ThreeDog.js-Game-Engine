// Built-in shader effects (used by render/materials.js): the engine uniforms they read, the GLSL chunks (also registered as
// THREE.ShaderChunk.threedog_*), the named patches world / clouds / wind / season, and placeholder textures.
import * as THREE from 'three';
import { engineUniform } from './engineUniforms.js';

// ---------- engine uniforms ----------
// Each engine has its own uniforms (engine.uniforms) and style pack. Built-in effects name engine uniforms, which patches.js swaps
// for the compiling renderer's engine (bindUniforms), so two engines on one page never share time, wind or cloud cover.
const UNIFORM_DEFAULTS = {
  uTime: 0,                                  // fixed seconds (engine.elapsed), written by the engine every fixed step
  uWind: 1,                                  // wind multiplier (driven by weather)
  uCloud: 0.25,                              // cloud cover 0-1 (driven by weather)
  uCloudShadow: 0,                           // darkest cloud shadow (style.clouds.shadow; 0 = no cloud shadows)
  uCloudScale: 0.006,                        // cloud size (smaller = bigger clouds)
  uCloudSpeed: () => new THREE.Vector2(0.012, 0.006),   // cloud drift direction and speed
  uWindFreq: 1,                              // sway frequency multiplier
  uFoliageTint: () => new THREE.Color(1, 1, 1),         // season: foliage tint (driven by the sky module's calendar)
  uGroundTint: () => new THREE.Color(1, 1, 1),          // season: ground tint
  uFoliageMix: 0, uGroundMix: 0,             // season mode 'mix': how far the surface moves to the tint (0 = multiply, the default)
};
/**
 * A fresh set of engine uniforms with the style pack's cloud and wind values (each engine owns one: engine.uniforms)
 * @internal
 * @param {any} [style]
 * @returns {import('../types/core').EngineUniforms}
 */
export function createUniforms(style = {}) {
  const u = /** @type {any} */ ({});
  for (const [k, v] of Object.entries(UNIFORM_DEFAULTS)) u[k] = engineUniform(k, typeof v === 'function' ? v() : v);
  const c = style.clouds || {}, w = style.wind || {};
  if (c.shadow != null) u.uCloudShadow.value = c.shadow;
  if (c.scale != null) u.uCloudScale.value = c.scale;
  if (c.speed) u.uCloudSpeed.value.set(c.speed[0], c.speed[1]);
  if (w.frequency != null) u.uWindFreq.value = w.frequency;
  return u;
}
const TEMPLATE = createUniforms();   // what built-in patches name; resolved to the compiling engine's uniforms

// ---------- GLSL ----------
/**
 * Shared GLSL value noise: threedogHash(vec2), threedogNoise(vec2) (used by sky clouds and cloud shadows)
 * @internal
 */
export const NOISE_GLSL = `float threedogHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float threedogNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(threedogHash(i), threedogHash(i+vec2(1,0)), f.x), mix(threedogHash(i+vec2(0,1)), threedogHash(i+vec2(1,1)), f.x), f.y); }`;

// GLSL pieces, also registered as THREE.ShaderChunk.threedog_* so a hand-written ShaderMaterial can #include them
// (put the matching engine.uniforms on it; threedog_wind_vertex needs `transformed`, `position` and #define THREEDOG_WIND_AMP;
// threedog_clouds_pars_fragment reads vThreedogWorld, declared by threedog_world_pars_fragment)
const CHUNKS = {
  threedog_world_pars_vertex: 'varying vec3 vThreedogWorld;',
  threedog_world_pars_fragment: 'varying vec3 vThreedogWorld;',
  // same order as three's project_vertex: batching, then instancing, then the model matrix (InstancedMesh and BatchedMesh both work)
  threedog_world_vertex: `
  {
    vec4 threedogP = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      threedogP = batchingMatrix * threedogP;
    #endif
    #ifdef USE_INSTANCING
      threedogP = instanceMatrix * threedogP;
    #endif
    vThreedogWorld = (modelMatrix * threedogP).xyz;
  }`,
  threedog_clouds_pars_fragment: `
  uniform float uTime; uniform float uCloud; uniform float uCloudShadow; uniform float uCloudScale; uniform vec2 uCloudSpeed;
  ${NOISE_GLSL}
  float threedogCloudLight(vec2 xz){
    vec2 p = xz * uCloudScale + uCloudSpeed * uTime;
    float n = threedogNoise(p) * 0.65 + threedogNoise(p * 2.3) * 0.35;
    float c = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.25, n);
    return 1.0 - c * uCloudShadow;
  }`,
  threedog_wind_pars_vertex: 'uniform float uTime; uniform float uWind; uniform float uWindFreq;',
  // Higher vertices sway more; each tree / grass clump / batched object has its own phase from its own origin
  threedog_wind_vertex: `
  {
    vec4 ipo = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_BATCHING
      ipo = batchingMatrix * ipo;
    #endif
    #ifdef USE_INSTANCING
      ipo = instanceMatrix * ipo;
    #endif
    vec3 ip = (modelMatrix * ipo).xyz;
    #ifdef THREEDOG_WIND_CUSTOM
      threedogWind(transformed, ip, position);
    #else
    float wt = uTime * uWindFreq;
    float sw = sin(wt * (1.2 + 0.6 * uWind) + ip.x * 0.31 + ip.z * 0.23) * 0.6 + sin(wt * 2.9 + ip.x * 0.77 - ip.z * 0.4) * 0.4;
    float k = max(position.y, 0.0) * THREEDOG_WIND_AMP * uWind;
    transformed.x += sw * k + k * 0.4 * (uWind - 1.0); transformed.z += sw * k * 0.6;
    #endif
  }`,
};
Object.assign(THREE.ShaderChunk, CHUNKS);
/** Short text hash for cacheKeys @internal */
export const hashText = t => { let h = 7; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const pick = (...keys) => Object.fromEntries(keys.map(k => [k, TEMPLATE[k]]));

// The engine's built-in effects as named patches (also readable as GLSL examples for your own patches)
/** @internal */
export const EFFECTS = {
  // world-space position varying vThreedogWorld; clouds, the terrain detail texture and your own patches build on it (needs: ['world'])
  world: () => ({ name: 'world', glsl: {
    vertex: { pars: '#include <threedog_world_pars_vertex>', project_vertex: '#include <threedog_world_vertex>' },
    fragment: { pars: '#include <threedog_world_pars_fragment>' } } }),
  clouds: () => ({ name: 'clouds', needs: { patches: ['world'] }, uniforms: pick('uTime', 'uCloud', 'uCloudShadow', 'uCloudScale', 'uCloudSpeed'), glsl: {
    fragment: { pars: '#include <threedog_clouds_pars_fragment>', lights_fragment_end:
      'reflectedLight.directDiffuse *= threedogCloudLight(vThreedogWorld.xz);\n  reflectedLight.directSpecular *= threedogCloudLight(vThreedogWorld.xz);' } } }),
  // wind(amplitude) or wind(amplitude, { glsl, uniforms, decl }): a style's own sway function replaces the default one (see StyleWind in types/style.d.ts)
  wind: (amplitude, custom) => ({ name: 'wind', cacheKey: custom ? `${amplitude}|${hashText(custom.glsl)}` : amplitude, shadow: true,
    uniforms: { ...pick('uTime', 'uWind', 'uWindFreq'), ...custom?.uniforms }, glsl: {
    vertex: { pars: `#define THREEDOG_WIND_AMP ${(+amplitude).toFixed(4)}
#include <threedog_wind_pars_vertex>` + (custom
      ? `
#define THREEDOG_WIND_CUSTOM
${custom.decl}
${custom.glsl}` : ''), begin_vertex: '#include <threedog_wind_vertex>' } } }),
  season: kind => {
    const u = kind === 'ground' ? 'uGroundTint' : 'uFoliageTint', k = kind === 'ground' ? 'uGroundMix' : 'uFoliageMix';
    // mix is 0 in the default 'multiply' mode (exactly the old `*=`); style.seasons.mode 'mix' sets it so the tint is blended in instead
    return { name: 'season', cacheKey: kind, uniforms: pick(u, k), glsl: { fragment: { pars: `uniform vec3 ${u}; uniform float ${k};`,
      color_fragment: `diffuseColor.rgb = ${k} > 0.0 ? mix(diffuseColor.rgb, ${u}, ${k}) : diffuseColor.rgb * ${u};` } } };
  },
};

// Until the image loads, a 1x1 linear mid-gray placeholder (x2 in the shader = 1) leaves the ground unchanged instead of darkening it.
/**
 * Neutral 1x1 linear stand-in for a texture that is still loading: 'detail' (0.5 gray, which the detail shader doubles to 1) or
 * 'normal' (a flat normal). A plain Texture (not DataTexture), so the loaded image's source can replace it in place.
 * @internal
 * @param {'detail' | 'normal'} kind
 * @returns {any}
 */
export function placeholderTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.fillStyle = kind === 'normal' ? 'rgb(128,128,255)' : 'rgb(128,128,128)'; g.fillRect(0, 0, 1, 1);
  const t = new THREE.Texture(c); t.needsUpdate = true;
  return t;
}
