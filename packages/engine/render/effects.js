// Built-in shader effects. Used by render/materials.js: the engine uniforms they read, the GLSL chunks (also registered as
// THREE.ShaderChunk.threedog_*), the named patches world / clouds / wind / season, and placeholder textures.
import * as THREE from 'three';
import { engineUniform } from './engineUniforms.js';
import { notePatch } from '../core/threePatches.js';
import { WIND, HASH, CLOUD, glslFloat as f } from './fxNumbers.js';

// ---------- engine uniforms ----------
// Each engine has its own uniforms (engine.uniforms) and style. Built-in effects name engine uniforms, which patches.js swaps
// for the compiling renderer's engine (bindUniforms), so two engines on one page never share time, wind or cloud cover.
const UNIFORM_DEFAULTS = {
  uTime: 0,                                  // ambient seconds (engine.time.now('ambient')), written only by core/time.js
  uWind: 1,                                  // wind multiplier (driven by weather)
  uCloud: 0.25,                              // cloud cover 0-1 (driven by weather)
  uCloudShadow: 0,                           // darkest cloud shadow (style.clouds.shadow; 0 = no cloud shadows)
  uCloudScale: 0.006,                        // cloud size (smaller = bigger clouds)
  uCloudSpeed: () => new THREE.Vector2(0.012, 0.006),   // cloud drift direction and speed
  uWindFreq: 1,                              // sway frequency multiplier
  uWindAmp: 1,                               // sway amplitude multiplier (look.wind.amplitude); every wind patch's amplitude is scaled by it
  uFoliageTint: () => new THREE.Color(1, 1, 1),         // season: foliage tint (driven by the sky module's calendar)
  uGroundTint: () => new THREE.Color(1, 1, 1),          // season: ground tint
  uFoliageMix: 0, uGroundMix: 0,             // season mode 'mix': how far the surface moves to the tint (0 = multiply, the default)
  // snow / ash cover amount alone (x foliage, y ground, 0-1; modules/sky/tint.js): the tints above already hold it blended in, but a game's
  // own tint (look.season.replace) needs the amount by itself to draw its own snow
  uCover: () => new THREE.Vector2(0, 0),
  // the sky contract's shared outputs (modules/sky/frame.js writes them every frame): a game's own sky dome, water or shader reads these, so a
  // replaced sky still follows the time of day. Share the object itself: mySky.material.uniforms.sunPosition = engine.uniforms.uSunDir
  uSunDir: () => new THREE.Vector3(0, 1, 0),   // unit vector toward the sun
  uDaylight: 1,                              // 0 at night .. 1 at noon (sky.daylight)
  uTimeOfDay: 0.5,                           // 0-1 time of day (0 midnight, 0.5 noon)
  // the sky colors as drawn this frame (keyframes, look.sky top / horizon, weather tint, lightning; a backdrop's color for the horizon): the one
  // read for a game shader that should meet the sky (sea, distant cards). Fog in its default 'horizon' color is this same color (fog.js)
  uSkyTop: () => new THREE.Color(0, 0, 0),
  uSkyHorizon: () => new THREE.Color(0.8, 0.8, 0.8),
};
/**
 * A fresh set of engine uniforms with the style's cloud and wind values (each engine owns one: engine.uniforms)
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
export const NOISE_GLSL = `float threedogHash(vec2 p){ return fract(sin(dot(p, vec2(${f(HASH.dir[0])}, ${f(HASH.dir[1])}))) * ${f(HASH.scale)}); }
  float threedogNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(threedogHash(i), threedogHash(i+vec2(1,0)), f.x), mix(threedogHash(i+vec2(0,1)), threedogHash(i+vec2(1,1)), f.x), f.y); }`;

// GLSL pieces, also registered as THREE.ShaderChunk.threedog_* so a hand-written ShaderMaterial can #include them.
// The callable ones (fixed signatures, for your own ShaderMaterial; the automatic patches call the same functions, so the math lives once):
//   #include <threedog_uniforms>      every engine uniform declared (uTime, uWind, uWindFreq, uWindAmp, uCloud*, uFoliage*/uGround*)
//   #include <threedog_wind>          vec3 threedogWind(vec3 position, vec3 origin, float amplitude)   object-space offset; origin = world origin of the object
//   #include <threedog_cloudShadow>   float threedogCloudShadow(vec3 worldPos)                         light factor 0-1 under drifting clouds
//   #include <threedog_season>        vec3 threedogSeason(vec3 color, int kind)                        kind 0 foliage, 1 ground
//   #include <threedog_detail>  threedogDetailNoise / threedogDetailBump (render/detail.js);  #include <threedog_lighting>  threedogWrapDiffuse / ShadowTint / Rim (render/lighting.js)
//   new THREE.ShaderMaterial({ uniforms: { ...engine.uniforms, uMine: { value: 1 } }, vertexShader, fragmentShader })
// Why functions and not only patches: a game's own shader should get the engine's wind or cloud shadows by calling them, without the engine
// patching the game's material (plan §4b). The older pars / vertex chunks below stay for the patches (they declare only what each patch needs).
const CALLABLE = {
  threedog_uniforms: `uniform float uTime; uniform float uWind; uniform float uWindFreq; uniform float uWindAmp;
  uniform float uCloud; uniform float uCloudShadow; uniform float uCloudScale; uniform vec2 uCloudSpeed;
  uniform vec3 uFoliageTint; uniform vec3 uGroundTint; uniform float uFoliageMix; uniform float uGroundMix; uniform vec2 uCover;
  uniform vec3 uSunDir; uniform float uDaylight; uniform float uTimeOfDay; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;`,
  // Higher vertices sway more; each tree / grass clump / batched object has its own phase from its own origin
  threedog_wind: `
  vec3 threedogWind(vec3 position, vec3 origin, float amplitude){
    float wt = uTime * uWindFreq;
    float sw = sin(wt * (${f(WIND.speed)} + ${f(WIND.gust)} * uWind) + origin.x * ${f(WIND.phase[0])} + origin.z * ${f(WIND.phase[1])}) * ${f(WIND.weight)}
      + sin(wt * ${f(WIND.speed2)} + origin.x * ${f(WIND.phase2[0])} + origin.z * ${f(WIND.phase2[1])}) * ${f(WIND.weight2)};
    float k = max(position.y, 0.0) * amplitude * uWind;
    return vec3(sw * k + k * ${f(WIND.lean)} * (uWind - 1.0), 0.0, sw * k * ${f(WIND.side)});
  }`,
  threedog_noise: `#ifndef THREEDOG_NOISE
  #define THREEDOG_NOISE
  ${NOISE_GLSL}
  #endif`,
  threedog_cloudShadow: `
  #include <threedog_noise>
  float threedogCloudShadow(vec3 worldPos){
    vec2 p = worldPos.xz * uCloudScale + uCloudSpeed * uTime;
    float n = threedogNoise(p) * ${f(CLOUD.weight)} + threedogNoise(p * ${f(CLOUD.octave)}) * ${f(CLOUD.weight2)};
    float c = smoothstep(1.0 - uCloud, 1.0 - uCloud + ${f(CLOUD.edge)}, n);
    return 1.0 - c * uCloudShadow;
  }`,
  threedog_season: `
  vec3 threedogSeason(vec3 color, int kind){
    vec3 t = kind == 1 ? uGroundTint : uFoliageTint; float m = kind == 1 ? uGroundMix : uFoliageMix;
    return m > 0.0 ? mix(color, t, m) : color * t;
  }`,
};
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
  #include <threedog_cloudShadow>
  float threedogCloudLight(vec2 xz){ return threedogCloudShadow(vec3(xz.x, 0.0, xz.y)); }`,
  // The built-in cloud shadow, in the lightsPars slot: three's own directional (and SunLight) light info is wrapped, so clouds dim only the
  // sun / moon light (every cascade of a cascaded sun too), never a street lamp or a torch (point, spot, rect-area) or the ambient light.
  // Why a branch on uCloudShadow and not a recompile: the default is 0, and a branch on a uniform takes the same path for the whole frame
  // (no noise is computed), while every plain material of one type keeps one program whether the shadow is on or off. The factor is
  // computed once per pixel (threedogCloudK caches it: a cascaded sun calls the light info once per cascade).
  threedog_clouds_light: `
  float threedogCloudK = -1.0;
  float threedogSunCloud(){
    if (threedogCloudK < 0.0) { threedogCloudK = 1.0; if (uCloudShadow > 0.0) threedogCloudK = threedogCloudLight(vThreedogWorld.xz); }
    return threedogCloudK;
  }
  #if NUM_DIR_LIGHTS > 0
  void threedogDirectionalLightInfo(const in DirectionalLight l, out IncidentLight light){ getDirectionalLightInfo(l, light); light.color *= threedogSunCloud(); }
  #define getDirectionalLightInfo threedogDirectionalLightInfo
  #endif
  #if NUM_SUN_LIGHTS > 0
  void threedogSunLightInfo(const in SunLight l, out IncidentLight light){ getSunLightInfo(l, light); light.color *= threedogSunCloud(); }
  #define getSunLightInfo threedogSunLightInfo
  #endif`,
  threedog_wind_pars_vertex: `uniform float uTime; uniform float uWind; uniform float uWindFreq;
#include <threedog_wind>`,
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
      transformed += threedogWind(position, ip, THREEDOG_WIND_AMP);
    #endif
  }`,
};
Object.assign(THREE.ShaderChunk, CALLABLE, CHUNKS);
notePatch('shader-chunks', 'THREE.ShaderChunk.threedog_* (new names only, none of three\'s replaced): the engine\'s GLSL pieces, #include-able in a ShaderMaterial',
  null, { lost: "the engine's own material patches #include them; nothing changes for code that does not include a threedog_ chunk" });
/** Short text hash for cacheKeys @internal */
export const hashText = t => { let h = 7; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const pick = (...keys) => Object.fromEntries(keys.map(k => [k, TEMPLATE[k]]));

/**
 * Varyings an engine patch declares, by the patch that provides them: a game patch whose GLSL reads one gets that patch added before it
 * (patchMaterial in patches.js), so forgetting needs: { patches: ['world'] } is a one-time dev note, not a shader compile error
 * @internal
 */
export const PROVIDED_BY = { vThreedogWorld: 'world' };
// The engine's built-in effects as named patches (also readable as GLSL examples for your own patches)
/** @internal @type {Record<string, (...args: any[]) => import('./patches.js').ShaderPatch>} */
export const EFFECTS = {
  // world-space position varying vThreedogWorld; clouds, the terrain detail texture and your own patches build on it (needs: ['world'])
  // (slot names: render/slots.js)
  world: () => ({ name: 'world', slot: 'clipPosition', glsl: '#include <threedog_world_vertex>',
    pars: { vertex: '#include <threedog_world_pars_vertex>', fragment: '#include <threedog_world_pars_fragment>' },
    // TSL needs no varying for this (positionWorld is a built-in node), so the NodeMaterial side has nothing to do
    tsl: {} }),
  // tsl = the same one-line call as the GLSL, through the threedog/tsl function (ctx.fx); effects.js stays free of three/tsl imports
  clouds: () => ({ name: 'clouds', needs: { patches: ['world'] }, uniforms: pick('uTime', 'uCloud', 'uCloudShadow', 'uCloudScale', 'uCloudSpeed'),
    // sun light only, skipped while uCloudShadow is 0 (threedog_clouds_light above); WebGPU: the lighting slot's light() hook changes the
    // sun's color before three lights the surface with it, behind the same uniform branch
    pars: '#include <threedog_clouds_pars_fragment>', glsl: { lightsPars: '#include <threedog_clouds_light>' },
    tsl: { lighting: { light: (L, c) => {
      if (!L.light?.isDirectionalLight && !L.light?.isSunLight) return undefined;
      const T = c.tsl;
      if (!c.state.cloud) {
        const k = c.state.cloud = T.float(1).toVar('tdCloud');
        T.If(c.fx.uniform('uCloudShadow').greaterThan(0), () => { k.assign(c.fx.cloudShadow(T.positionWorld)); });
      }
      return L.color.mul(c.state.cloud);
    } } } }),
  // wind(amplitude) or wind(amplitude, { glsl, uniforms, decl }): a style's own sway function replaces the default one (see StyleWind in types/style.d.ts)
  wind: (amplitude, custom) => ({ name: 'wind', cacheKey: custom ? `${amplitude}|${hashText(custom.glsl ?? '')}` : amplitude, shadow: true,
    uniforms: { ...pick('uTime', 'uWind', 'uWindFreq', 'uWindAmp'), ...custom?.uniforms }, slot: 'position', glsl: '#include <threedog_wind_vertex>',
    pars: `uniform float uWindAmp;
#define THREEDOG_WIND_AMP (${(+amplitude).toFixed(4)} * uWindAmp)
#include <threedog_wind_pars_vertex>` + (custom?.glsl != null
      ? `
#define THREEDOG_WIND_CUSTOM
${custom.decl}
${custom.glsl}` : ''),
    // a game's own sway brings its own tsl (look.wind.patch('sway', { glsl, tsl })); one with GLSL only has no tsl (a NodeMaterial names it).
    // ctx.position is object space before instancing on both renderers (render/slots.js), so this is the GLSL line as it is
    ...(custom?.tsl && { tsl: custom.tsl }),
    ...(!custom && { tsl: c => c.position.add(c.fx.wind(c.tsl.positionGeometry, c.fx.objectOrigin(),
      c.tsl.float(+(+amplitude).toFixed(4)).mul(c.fx.uniform('uWindAmp')))) }) }),
  season: kind => {
    // the shared threedogSeason / TSL season() on both sides (mix is 0 in the default 'multiply' mode; style.seasons.mode 'mix' sets it)
    const id = kind === 'ground' ? 1 : 0;
    return { name: 'season', cacheKey: kind, uniforms: pick('uFoliageTint', 'uGroundTint', 'uFoliageMix', 'uGroundMix'), slot: 'color',
      pars: 'uniform vec3 uFoliageTint; uniform vec3 uGroundTint; uniform float uFoliageMix; uniform float uGroundMix;\n#include <threedog_season>',
      glsl: `diffuseColor.rgb = threedogSeason(diffuseColor.rgb, ${id});`,
      tsl: c => c.tsl.vec4(c.fx.season(c.color.rgb, id), c.color.a) };
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
