// Sky cloud layer for the dome shader: built-in kinds ('plane' default, 'cumulus') or a style-pack GLSL function, plus the
// uniforms they read. Split out of shader.js so a look can be replaced without touching the dome.
//
// Every kind implements the same function, which is the contract for style.sky.clouds.glsl too:
//   vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)
//   dir      unit view direction, dir.y > 0 (only the upper hemisphere calls it; cover > 0.01)
//   time     seconds (engine.uniforms.uTime); sunDir unit vector towards the sun (moon is opposite); night 0 day .. 1 night
//   lit/shade style cloud colors (clouds.color / clouds.shade); cover = weather cloud amount * clouds.coverage, 0..1+
//   returns  rgb = final cloud color, a = opacity 0..1 (the dome does mix(sky, rgb, a)); apply your own horizon fade
// In scope for your code: threedogHash(vec2), threedogNoise(vec2), the built-in cloud uniforms (uCloudScale, uCloudSpeed,
// uCloudHorizon, uCloudFade, uCloudSoft, uCloudOpacity, uCloudMul, uCloudWeights, uCloudRelief) and your clouds.uniforms.
import * as THREE from 'three';
import { closest } from '../../core/validate.js';
import { declareUniforms } from '../../render/uniformDecl.js';

const KINDS = ['plane', 'cumulus'];

// Defaults per kind. 'plane' values are the original look: nothing changes unless a style sets them.
const DEFAULTS = {
  plane: { horizon: 0.08, fade: [0, 0.18], opacity: 0.9, soft: 0.3, scales: [2.7, 6.1], weights: [0.6, 0.3, 0.1], relief: 5 },
  cumulus: { horizon: 0.5, fade: [0, 0.12], opacity: 0.95, soft: 0.35, scales: [2.7, 6.1], weights: [0.6, 0.3, 0.1], relief: 5 },
};

// Original look: one plane projected onto the sky (cells shrink towards the horizon), 3 fixed noise layers.
const PLANE = `vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cov){
  vec2 cp = d.xz / (d.y + uCloudHorizon) * uCloudScale + uCloudSpeed * time;
  float cn = threedogNoise(cp) * uCloudWeights.x + threedogNoise(cp * uCloudMul.x + 7.0) * uCloudWeights.y + threedogNoise(cp * uCloudMul.y) * uCloudWeights.z;
  float cloud = smoothstep(1.0 - cov, 1.0 - cov + uCloudSoft, cn) * smoothstep(uCloudFade.x, uCloudFade.y, d.y);
  vec3 cc = mix(shade, lit, smoothstep(0.3, 0.8, cn)) * (0.35 + 0.65 * (1.0 - night));
  return vec4(cc, cloud * uCloudOpacity);
}`;

// Billowy cumulus: 4-octave fbm over a gently flattened projection (overhead cells are only ~2x larger than near the horizon, so
// the whole sky fills with clouds), lit by sampling the density again one step towards the sun: where density falls off towards
// the sun the cloud faces it (bright), the far side stays in shade; thin rims glow, thick cores sit darker.
// Cost: 8 value-noise samples per cloudy sky pixel (plane: 3). Still one 2D pass, no ray marching.
const CUMULUS = `float threedogCumulusDensity(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += threedogNoise(p) * a; p = p * 2.03 + 3.7; a *= 0.5; }
  return s / 0.9375;
}
vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cov){
  vec2 cp = d.xz / (d.y + uCloudHorizon) * uCloudScale + uCloudSpeed * time;
  vec2 toSun = normalize(sunDir.xz + vec2(0.0001, 0.0)) * 0.12;
  float n0 = threedogCumulusDensity(cp), n1 = threedogCumulusDensity(cp + toSun);
  float t = 1.0 - cov * 0.9;
  float body = smoothstep(t, t + uCloudSoft, n0);
  float core = smoothstep(t, t + 0.35, n0);
  float sunSide = clamp(0.5 + (n0 - n1) * uCloudRelief, 0.0, 1.0);
  float light = mix(sunSide, 1.0, (1.0 - core) * 0.5) * (0.55 + 0.45 * (1.0 - core * 0.5));
  vec3 cc = mix(shade, lit, light) * (0.35 + 0.65 * (1.0 - night));
  return vec4(cc, body * smoothstep(uCloudFade.x, uCloudFade.y, d.y) * uCloudOpacity);
}`;

/** Checks style.sky.clouds and returns { kind, glsl, uniforms: {name: {value}}, decl: GLSL declarations of the custom uniforms } */
export function resolveClouds(c) {
  const kind = c?.kind ?? 'plane';
  if (!KINDS.includes(kind)) throw new Error(`style.sky.clouds.kind '${kind}' is not a cloud kind; use ${KINDS.map(k => `'${k}'`).join(' | ')}` + (closest(kind, KINDS) ? ` (did you mean '${closest(kind, KINDS)}'?)` : ''));
  let glsl = kind === 'cumulus' ? CUMULUS : PLANE;
  if (c?.glsl != null) {
    if (typeof c.glsl !== 'string' || !/vec4\s+threedogClouds\s*\(/.test(c.glsl)) throw new Error('style.sky.clouds.glsl must be GLSL that defines `vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)` returning (rgb color, alpha); see modules/sky/clouds.js');
    glsl = c.glsl;
  }
  const { uniforms, decl } = declareUniforms('style.sky.clouds.uniforms', c?.uniforms);
  return { kind, glsl, uniforms, decl };
}

/** The built-in cloud uniforms (defaults of the chosen kind; style values override) */
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
