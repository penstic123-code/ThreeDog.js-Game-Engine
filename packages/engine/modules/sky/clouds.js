// Sky cloud layer for the dome shader: built-in kinds ('plane' default, 'cumulus') or your own GLSL function (engine.sky.clouds(spec)),
// plus the uniforms they read. Split out of shader.js so a picture can be replaced without touching the dome.
//
// Every kind implements the same function, which is the contract for engine.sky.clouds(glsl | { glsl, tsl, uniforms }) too:
//   vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)
//   dir      unit view direction, dir.y > 0 (only the upper hemisphere calls it; cover > 0.01)
//   time     seconds (engine.uniforms.uTime); sunDir unit vector towards the sun (moon is opposite); night 0 day .. 1 night
//   lit / shade cloud colors (clouds.color / clouds.shade); cover = weather cloud amount * clouds.coverage, 0..1+
//   returns  rgb = final cloud color, a = opacity 0..1 (the dome does mix(sky, rgb, a)); apply your own horizon fade
// In scope for your code: threedogHash(vec2), threedogNoise(vec2), the built-in cloud uniforms (uSkyCloudScale, uSkyCloudSpeed,
// uCloudHorizon, uCloudFade, uCloudSoft, uCloudOpacity, uCloudMul, uCloudWeights, uCloudRelief) and the patch's own uniforms.
// WebGPURenderer draws the hook's tsl form instead ({ glsl, tsl, uniforms }; render/fx/sky.tsl.js): tsl: (ctx) => vec4 node, ctx = { dir, time,
// sunDir, night, lit, shade, cover (the same arguments as nodes), clouds (the built-in kind's vec4, the value so far), uniforms (the dome's
// uniforms as nodes, the patch's own included), fx: { noise, hash }, tsl (three/tsl) }. Each renderer needs its own form; a missing one throws by name.
import * as THREE from 'three';
import { closest } from '../../core/validate.js';
import { declareUniforms } from '../../render/uniformDecl.js';
import { codedError } from '../../core/errorHints.js';
import { scanRenamed, RENAMED_DOME_UNIFORMS } from '../../render/uniformRenames.js';
import { SKY as K, glslFloat as f } from '../../render/fxNumbers.js';

const KINDS = ['plane', 'cumulus'];

// Defaults per kind. 'plane' values are the original picture: nothing changes unless sky({ clouds }) sets them.
const DEFAULTS = {
  plane: { horizon: 0.08, fade: [0, 0.18], opacity: 0.9, soft: 0.3, scales: [2.7, 6.1], weights: [0.6, 0.3, 0.1], relief: 5 },
  cumulus: { horizon: 0.5, fade: [0, 0.12], opacity: 0.95, soft: 0.35, scales: [2.7, 6.1], weights: [0.6, 0.3, 0.1], relief: 5 },
};

// Original picture: one plane projected onto the sky (cells shrink towards the horizon), 3 fixed noise layers.
const PLANE = `vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cov){
  vec2 cp = d.xz / (d.y + uCloudHorizon) * uSkyCloudScale + uSkyCloudSpeed * time;
  float cn = threedogNoise(cp) * uCloudWeights.x + threedogNoise(cp * uCloudMul.x + 7.0) * uCloudWeights.y + threedogNoise(cp * uCloudMul.y) * uCloudWeights.z;
  float cloud = smoothstep(1.0 - cov, 1.0 - cov + uCloudSoft, cn) * smoothstep(uCloudFade.x, uCloudFade.y, d.y);
  vec3 cc = mix(shade, lit, smoothstep(${f(K.planeTone[0])}, ${f(K.planeTone[1])}, cn)) * (${f(K.nightDim)} + ${f(1 - K.nightDim)} * (1.0 - night));
  return vec4(cc, cloud * uCloudOpacity);
}`;

// Billowy cumulus: 4-octave fbm over a gently flattened projection (overhead cells are only ~2x larger than near the horizon, so
// the whole sky fills with clouds), lit by sampling the density again one step towards the sun: where density falls off towards
// the sun the cloud faces it (bright), the far side stays in shade; thin rims glow, thick cores sit darker.
// Cost: 8 value-noise samples per cloudy sky pixel (plane: 3). Still one 2D pass, no ray marching.
const CUMULUS = `float threedogCumulusDensity(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += threedogNoise(p) * a; p = p * ${f(K.lacunarity)} + ${f(K.offset)}; a *= 0.5; }
  return s / ${f(K.norm)};
}
vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cov){
  vec2 cp = d.xz / (d.y + uCloudHorizon) * uSkyCloudScale + uSkyCloudSpeed * time;
  vec2 toSun = normalize(sunDir.xz + vec2(0.0001, 0.0)) * ${f(K.toSun)};
  float n0 = threedogCumulusDensity(cp), n1 = threedogCumulusDensity(cp + toSun);
  float t = 1.0 - cov * ${f(K.cover)};
  float body = smoothstep(t, t + uCloudSoft, n0);
  float core = smoothstep(t, t + ${f(K.core)}, n0);
  float sunSide = clamp(0.5 + (n0 - n1) * uCloudRelief, 0.0, 1.0);
  float light = mix(sunSide, 1.0, (1.0 - core) * ${f(K.rim)}) * (${f(1 - K.coreDark)} + ${f(K.coreDark)} * (1.0 - core * 0.5));
  vec3 cc = mix(shade, lit, light) * (${f(K.nightDim)} + ${f(1 - K.nightDim)} * (1.0 - night));
  return vec4(cc, body * smoothstep(uCloudFade.x, uCloudFade.y, d.y) * uCloudOpacity);
}`;

/**
 * Checks sky({ clouds }) and returns { kind, glsl, uniforms: {name: {value}}, decl: GLSL declarations of the custom uniforms }.
 * Your own cloud function is engine.sky.clouds(spec) only, never an option: one shader injection entry per picture value, so sky({ clouds: { glsl } }) throws and names it.
 * @param {any} c the clouds start values @param {string | { glsl?: string, uniforms?: object } | null} [hook] engine.sky.clouds(spec)
 */
export function resolveClouds(c, hook, gpu = false) {
  const kind = c?.kind ?? 'plane';
  if (!KINDS.includes(kind)) throw codedError('sky-option', `sky clouds.kind '${kind}' is not a cloud kind; use ${KINDS.map(k => `'${k}'`).join(' | ')}` + (closest(kind, KINDS) ? ` (did you mean '${closest(kind, KINDS)}'?)` : ''));
  for (const k of ['glsl', 'uniforms']) if (c?.[k] != null) throw codedError('sky-option', `sky clouds.${k} is not an option; your own cloud function goes through engine.sky.clouds({ glsl, tsl, uniforms }) (signature in modules/sky/clouds.js)`);
  const h = typeof hook === 'string' ? { glsl: hook } : hook;
  let glsl = kind === 'cumulus' ? CUMULUS : PLANE;
  if (h?.tsl != null && typeof h.tsl !== 'function') throw codedError('sky-option', "engine.sky.clouds(): tsl must be (ctx) => vec4 node (WebGPURenderer); see modules/sky/clouds.js");
  // gpu: the node dome draws h.tsl (render/fx/sky.tsl.js checks it); the GLSL, when given too, is still checked here
  if (h && h.glsl == null && !gpu) throw codedError('sky-option', "engine.sky.clouds() has only a tsl form, which WebGLRenderer cannot draw: give glsl too ({ glsl, tsl, uniforms })");
  if (h?.glsl != null) {
    if (typeof h.glsl !== 'string' || !/vec4\s+threedogClouds\s*\(/.test(h.glsl)) throw codedError('sky-option', "engine.sky.clouds(): glsl must define `vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)` returning (rgb color, alpha); see modules/sky/clouds.js");
    glsl = h.glsl;
    scanRenamed([h.glsl], 'engine.sky.clouds()', h.uniforms, RENAMED_DOME_UNIFORMS);
  }
  const { uniforms, decl } = declareUniforms('engine.sky.clouds().uniforms', h?.uniforms);
  return { kind, glsl, uniforms, decl };
}

/** The built-in cloud uniforms (defaults of the chosen kind; sky({ clouds }) values override) */
export function cloudUniforms(c, kind) {
  const d = DEFAULTS[kind], n = c?.noise || {};
  return {
    uCloudHorizon: { value: c?.horizon ?? d.horizon }, uCloudFade: { value: new THREE.Vector2(...(c?.fade ?? d.fade)) },
    uCloudOpacity: { value: c?.opacity ?? d.opacity }, uCloudSoft: { value: c?.softness ?? d.soft },
    uCloudMul: { value: new THREE.Vector2(...(n.scales ?? d.scales)) }, uCloudWeights: { value: new THREE.Vector3(...(n.weights ?? d.weights)) },
    uCloudRelief: { value: c?.relief ?? d.relief },
  };
}

export const CLOUD_UNIFORM_DECL = `uniform float uCloudHorizon; uniform vec2 uCloudFade; uniform float uCloudOpacity; uniform float uCloudSoft; uniform vec2 uCloudMul; uniform vec3 uCloudWeights; uniform float uCloudRelief;`;
