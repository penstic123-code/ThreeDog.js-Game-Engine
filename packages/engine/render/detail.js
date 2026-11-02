// The `detail` surface patch: grain, paper, brush strokes or a texture laid over any lit material in world space (no UVs needed).
// Everything that differs between materials is a uniform (scale, strength, direction, stretch, octaves, mode, tint), so N materials with
// different values share ONE shader program; only the structure is in the cacheKey: source kind, projection, which channels it touches.
import * as THREE from 'three';
import { warnOnce } from '../core/validate.js';
import { readParams, keysSchema, isOptions } from '../core/params.js';
import { placeholderTexture, hashText } from './effects.js';
import { declareUniforms } from './uniformDecl.js';
import { codedError } from '../core/errorHints.js';

/**
 * @typedef {{ texture?: string | import('three').Texture, noise?: 'grain' | 'paper' | 'stroke' | 'dabs', glsl?: string, uniforms?: Record<string, any>,
 *   projection?: 'world' | 'triplanar' | 'screen', scale?: number, strength?: number, mode?: 'multiply' | 'add' | 'mix', tint?: import('../types/common').ColorLike,
 *   direction?: number, stretch?: number, octaves?: number, normal?: number, roughness?: number, fade?: boolean }} DetailOptions
 */
const KEYS = ['texture', 'noise', 'glsl', 'uniforms', 'projection', 'scale', 'strength', 'mode', 'tint', 'direction', 'stretch', 'octaves', 'normal', 'roughness', 'fade'];
const NOISES = ['grain', 'paper', 'stroke', 'dabs'];
const MODES = ['multiply', 'add', 'mix'];

// Callable (#include <threedog_detail> in your own ShaderMaterial; the patch's built-in noises call the same functions). No uniforms:
//   vec4 threedogDetailNoise(vec2 p, int kind, float octaves)   kind 0 grain, 1 paper, 2 stroke, 3 dabs; returns (gray rgb, height 0-1)
//   vec3 threedogDetailBump(vec3 surfPos, vec3 surfNorm, float h, float k, float faceDir)   screen-space bump (three's bump-map math)
// Why: a game's own shader gets the style's grain / paper / brush texture by calling it instead of the engine patching its material.
const CALLABLE = `#ifndef THREEDOG_DETAIL
#define THREEDOG_DETAIL
float threedogDHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float threedogDNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(threedogDHash(i), threedogDHash(i+vec2(1,0)), f.x), mix(threedogDHash(i+vec2(0,1)), threedogDHash(i+vec2(1,1)), f.x), f.y); }
float threedogDFbm(vec2 p, float octaves){ float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 4; i++) { if (float(i) >= octaves) break; s += a * threedogDNoise(p); n += a; p = p * 2.03 + 17.0; a *= 0.5; }
  return s / n; }
// Soft oval brush dabs: one random dab per cell (random size, rotation, tone), no preferred direction. 3x3 cells cover a dab that reaches into a neighbor.
float threedogDDabs(vec2 p, float octaves){ float s = 0.5, w = 0.85;
  for (int o = 0; o < 3; o++) { if (float(o) >= octaves) break;
    vec2 ip = floor(p); float fo = float(o);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = ip + vec2(float(i), float(j));
      vec2 h = vec2(threedogDHash(c + fo * 13.1), threedogDHash(c.yx + 7.7 + fo * 5.3));
      float ang = 6.2832 * threedogDHash(c * 1.7 + 3.1 + fo), r = 0.35 + 0.3 * threedogDHash(c * 2.3 + 11.9 + fo), tone = threedogDHash(c + vec2(5.5, 1.3) + fo);
      vec2 d = p - (c + 0.15 + 0.7 * h); float ca = cos(ang), sa = sin(ang);
      d = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / vec2(r * 1.3, r * 0.75);
      s = mix(s, tone, (1.0 - smoothstep(0.3, 1.0, length(d))) * w); }
    p = p * 2.03 + 17.0; w *= 0.6; }
  return s; }
vec4 threedogDetailNoise(vec2 p, int kind, float octaves){
  float s = kind == 1 ? 0.65 * threedogDFbm(p, octaves) + 0.35 * threedogDNoise(vec2(p.x * 7.0, p.y * 0.9))
    : kind == 2 ? smoothstep(0.15, 0.85, threedogDFbm(vec2(p.x, p.y * 1.7), octaves))
    : kind == 3 ? threedogDDabs(p, octaves) : threedogDFbm(p, octaves);
  return vec4(vec3(s), s); }
vec3 threedogDetailBump(vec3 surfPos, vec3 surfNorm, float h, float k, float faceDir){
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos), r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  return normalize(abs(det) * surfNorm - k * sign(det) * (dFdx(h) * r1 + dFdy(h) * r2)); }
#endif`;
Object.assign(THREE.ShaderChunk, { threedog_detail: CALLABLE });   // the same registry effects.js fills
// The patch's own part: the footprint / fade globals the projection writes and a game's glsl sample may read
const NOISE = `#include <threedog_detail>
// Size of one pixel in pattern units (1 = one pattern cell): the fade-out and \`glsl\` samples read it
float threedogDetailFootprint = 0.0;
float threedogDFp(vec2 p){ return max(length(dFdx(p)), length(dFdy(p))); }
float threedogDFade = 1.0;
float threedogDFadeOf(float fp){ return mix(1.0, 1.0 - smoothstep(0.5, 1.0, fp), uDetailFade); }`;

// Built-in sources: p is already scaled, turned by direction and stretched along it; returns (color, height)
const SOURCES = {
  tex: 'vec4 threedogDetailSample(vec2 p){ vec3 c = texture2D(uDetail, p).rgb; return vec4(c, dot(c, vec3(0.299, 0.587, 0.114))); }',
  grain: 'vec4 threedogDetailSample(vec2 p){ return threedogDetailNoise(p, 0, uDetailOctaves); }',
  paper: 'vec4 threedogDetailSample(vec2 p){ return threedogDetailNoise(p, 1, uDetailOctaves); }',
  stroke: 'vec4 threedogDetailSample(vec2 p){ return threedogDetailNoise(p, 2, uDetailOctaves); }',
  dabs: 'vec4 threedogDetailSample(vec2 p){ return threedogDetailNoise(p, 3, uDetailOctaves); }',
};

// p (world position) -> sample; 'world' looks straight down (xz), 'triplanar' blends the three axis planes by the surface normal,
// 'screen' ignores w and lays the pattern on the screen pixels (gl_FragCoord), scale = pixels per pattern cell.
// Why screen exists: world / triplanar grain shrinks with distance and the fade then takes it out (it must, or it shimmers), but an
// illustration, print or painted look wants the same grain size over the whole picture, near and far. Its footprint is constant
// (1 / scale), so fade only matters when the cell is under ~2 px.
const PROJECT = {
  world: `vec4 threedogDetail(vec3 w){ vec2 p = threedogDetailUV(w.xz); threedogDetailFootprint = threedogDFp(p); threedogDFade = threedogDFadeOf(threedogDetailFootprint);
  return threedogDetailSample(p); }`,
  triplanar: `vec4 threedogDetail(vec3 w){
  vec3 n = abs(normalize(cross(dFdx(w), dFdy(w)))); n /= n.x + n.y + n.z;
  vec2 a = threedogDetailUV(w.zy), b = threedogDetailUV(w.xz), c = threedogDetailUV(w.xy);
  float fa = threedogDFp(a), fb = threedogDFp(b), fc = threedogDFp(c);
  threedogDFade = threedogDFadeOf(fa) * n.x + threedogDFadeOf(fb) * n.y + threedogDFadeOf(fc) * n.z;
  threedogDetailFootprint = fa; vec4 sa = threedogDetailSample(a); threedogDetailFootprint = fb; vec4 sb = threedogDetailSample(b); threedogDetailFootprint = fc; vec4 sc = threedogDetailSample(c);
  return sa * n.x + sb * n.y + sc * n.z; }`,
  screen: `vec4 threedogDetail(vec3 w){ vec2 p = threedogDTurn(gl_FragCoord.xy / max(uDetailScale, 1e-3));
  threedogDetailFootprint = 1.0 / max(uDetailScale, 1e-3); threedogDFade = threedogDFadeOf(threedogDetailFootprint);
  return threedogDetailSample(p); }`,
};
// default scale per projection: 4 repeats per metre on the ground (world / triplanar), a 2-pixel cell on screen
const SCALE = { world: 0.25, triplanar: 0.25, screen: 2 };

const COLOR = `{ vec3 tdc = threedogDS.rgb * uDetailTint;
  if (uDetailMode < 0.5) diffuseColor.rgb *= mix(vec3(1.0), tdc * 2.0, uDetailStrength * threedogDFade);
  else if (uDetailMode < 1.5) diffuseColor.rgb += (tdc - 0.5) * uDetailStrength * threedogDFade;
  else diffuseColor.rgb = mix(diffuseColor.rgb, tdc, uDetailStrength * threedogDFade); }`;

/**
 * The `detail` patch from a detail option object (see MaterialDetail in types/style.d.ts). `engine` loads a texture given by asset name.
 * @internal use materialSpec.detail, style.terrain.detail or applyEffects(mat, { detail })
 * @param {any} o
 * @param {{ assets?: any } | null} engine
 * @param {string} [label] where the options came from, for errors
 * @returns {import('./patches.js').ShaderPatch}
 */
export function detailPatch(o, engine, label = 'detail') {
  if (isOptions(o)) readParams(label, keysSchema(KEYS), o);
  if (o.mode !== undefined && !MODES.includes(o.mode)) throw codedError('material-option', `${label}.mode '${o.mode}' is not a blend mode; use ${MODES.join(' | ')}`);
  if (o.noise !== undefined && !NOISES.includes(o.noise)) throw codedError('material-option', `${label}.noise '${o.noise}' is not a built-in noise; use ${NOISES.join(' | ')}, or write your own with glsl: 'vec4 threedogDetailSample(vec2 p){ ... }'`);
  const proj = o.projection ?? 'world';
  if (!PROJECT[proj]) throw codedError('material-option', `${label}.projection '${proj}' must be 'world' (top-down), 'triplanar' (walls, rocks) or 'screen' (screen pixels, same grain size near and far; scale = pixels per cell)`);
  if (o.glsl && !/vec4\s+threedogDetailSample\s*\(\s*vec2/.test(o.glsl)) throw codedError('material-option', `${label}.glsl must define \`vec4 threedogDetailSample(vec2 p)\`: p is the scaled, turned, stretched position; return vec4(color rgb, height 0-1). uDetailOctaves, threedogDetailFootprint (one pixel in pattern units; fade yourself or leave it to detail.fade) and the uniforms you list are in scope`);
  const src = o.glsl ? 'glsl:' + hashText(o.glsl) : o.texture ? 'tex' : o.noise ?? 'grain';
  const isStroke = o.noise === 'stroke', ang = (o.direction ?? 0) * Math.PI / 180;
  const colorOn = o.strength !== 0 && (o.strength !== undefined || !(o.normal || o.roughness)), bump = !!o.normal, rough = !!o.roughness;
  const u = /** @type {Record<string, { value: any }>} */ ({
    uDetailScale: { value: o.scale ?? SCALE[proj] }, uDetailStrength: { value: o.strength ?? 0.35 }, uDetailMode: { value: Math.max(0, MODES.indexOf(o.mode ?? 'multiply')) },
    uDetailTint: { value: new THREE.Color(o.tint ?? 0xffffff) }, uDetailDir: { value: new THREE.Vector2(Math.cos(ang), Math.sin(ang)) },
    uDetailStretch: { value: o.stretch ?? (isStroke ? 6 : 1) }, uDetailOctaves: { value: o.octaves ?? 2 },
    uDetailBump: { value: o.normal ?? 0 }, uDetailRough: { value: o.roughness ?? 0 }, uDetailFade: { value: o.fade === false ? 0 : 1 },
  });
  let decl = '';
  if (o.texture || o.glsl) {
    let tex;
    if (o.texture?.isTexture) tex = o.texture;
    else {
      tex = placeholderTexture('detail');
      if (typeof o.texture === 'string') {
        if (!engine?.assets) throw codedError('material-option', `${label}.texture '${o.texture}' is an asset name but no engine is known; pass the engine (makeMaterial(role, params, engine), applyEffects(mat, { detail, engine })) or give a THREE.Texture`);
        engine.assets.texture(o.texture).then(t => {
          const own = t.clone();   // shares the image (no second upload); own wrapping
          own.wrapS = own.wrapT = THREE.RepeatWrapping; own.colorSpace = THREE.SRGBColorSpace; own.needsUpdate = true;
          tex.dispose(); u.uDetail.value = own;
        }).catch(err => warnOnce(err.message));
      }
    }
    if (o.texture) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; u.uDetail = { value: tex }; decl = 'uniform sampler2D uDetail;'; }
  }
  const own = declareUniforms(label + '.uniforms', o.uniforms);
  Object.assign(u, own.uniforms); decl += '\n' + own.decl;
  const pars = `uniform float uDetailScale, uDetailStrength, uDetailMode, uDetailStretch, uDetailOctaves, uDetailBump, uDetailRough, uDetailFade;
uniform vec3 uDetailTint; uniform vec2 uDetailDir; ${decl}
${NOISE}
vec2 threedogDTurn(vec2 p){ p = vec2(uDetailDir.x * p.x + uDetailDir.y * p.y, -uDetailDir.y * p.x + uDetailDir.x * p.y); p.x /= uDetailStretch; return p; }
vec2 threedogDetailUV(vec2 w){ return threedogDTurn(w * uDetailScale); }
${o.glsl ?? SOURCES[o.texture ? 'tex' : o.noise ?? 'grain']}
${PROJECT[proj]}`;
  const glsl = /** @type {Record<string, string>} */ ({ color: `vec4 threedogDS = threedogDetail(vThreedogWorld);\n${colorOn ? COLOR : ''}` });
  if (bump) glsl.normal = 'normal = threedogDetailBump(-vViewPosition, normal, threedogDS.a, uDetailBump * threedogDFade, faceDirection);';
  if (rough) glsl.roughness = 'roughnessFactor = clamp(roughnessFactor + (threedogDS.a - 0.5) * uDetailRough * threedogDFade, 0.04, 1.0);';
  return { name: 'detail', cacheKey: `${src}|${proj}|${colorOn ? 'c' : ''}${bump ? 'n' : ''}${rough ? 'r' : ''}`, needs: { patches: ['world'] }, uniforms: u, pars, glsl };
}
