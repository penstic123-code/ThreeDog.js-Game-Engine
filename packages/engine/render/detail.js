// The `detail` surface patch: grain, paper, brush strokes or a texture laid over any lit material in world space (no UVs needed).
// Everything that differs between materials is a uniform (scale, strength, direction, stretch, octaves, mode, tint), so N materials with
// different values share ONE shader program; only the structure is in the cacheKey: source kind, projection, which channels it touches.
import * as THREE from 'three';
import { checkOptions, warnOnce } from '../core/validate.js';
import { placeholderTexture, hashText } from './effects.js';
import { declareUniforms } from './uniformDecl.js';

/**
 * @typedef {{ texture?: string | import('three').Texture, noise?: 'grain' | 'paper' | 'stroke', glsl?: string, uniforms?: Record<string, any>,
 *   projection?: 'world' | 'triplanar', scale?: number, strength?: number, mode?: 'multiply' | 'add' | 'mix', tint?: import('../types/common').ColorLike,
 *   direction?: number, stretch?: number, octaves?: number, normal?: number, roughness?: number }} DetailOptions
 */
const KEYS = ['texture', 'noise', 'glsl', 'uniforms', 'projection', 'scale', 'strength', 'mode', 'tint', 'direction', 'stretch', 'octaves', 'normal', 'roughness'];
const NOISES = ['grain', 'paper', 'stroke'];
const MODES = ['multiply', 'add', 'mix'];

const NOISE = `float threedogDHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float threedogDNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(threedogDHash(i), threedogDHash(i+vec2(1,0)), f.x), mix(threedogDHash(i+vec2(0,1)), threedogDHash(i+vec2(1,1)), f.x), f.y); }
float threedogDFbm(vec2 p){ float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 4; i++) { if (float(i) >= uDetailOctaves) break; s += a * threedogDNoise(p); n += a; p = p * 2.03 + 17.0; a *= 0.5; }
  return s / n; }`;

// Built-in sources: p is already scaled, turned by direction and stretched along it; returns (color, height)
const SOURCES = {
  tex: 'vec4 threedogDetailSample(vec2 p){ vec3 c = texture2D(uDetail, p).rgb; return vec4(c, dot(c, vec3(0.299, 0.587, 0.114))); }',
  grain: 'vec4 threedogDetailSample(vec2 p){ float s = threedogDFbm(p); return vec4(vec3(s), s); }',
  paper: 'vec4 threedogDetailSample(vec2 p){ float s = 0.65 * threedogDFbm(p) + 0.35 * threedogDNoise(vec2(p.x * 7.0, p.y * 0.9)); return vec4(vec3(s), s); }',
  stroke: 'vec4 threedogDetailSample(vec2 p){ float s = smoothstep(0.15, 0.85, threedogDFbm(vec2(p.x, p.y * 1.7))); return vec4(vec3(s), s); }',
};

// p (world position) -> sample; 'world' looks straight down (xz), 'triplanar' blends the three axis planes by the surface normal
const PROJECT = {
  world: 'vec4 threedogDetail(vec3 w){ return threedogDetailSample(threedogDetailUV(w.xz)); }',
  triplanar: `vec4 threedogDetail(vec3 w){
  vec3 n = abs(normalize(cross(dFdx(w), dFdy(w)))); n /= n.x + n.y + n.z;
  return threedogDetailSample(threedogDetailUV(w.zy)) * n.x + threedogDetailSample(threedogDetailUV(w.xz)) * n.y + threedogDetailSample(threedogDetailUV(w.xy)) * n.z; }`,
};

const COLOR = `{ vec3 tdc = threedogDS.rgb * uDetailTint;
  if (uDetailMode < 0.5) diffuseColor.rgb *= mix(vec3(1.0), tdc * 2.0, uDetailStrength);
  else if (uDetailMode < 1.5) diffuseColor.rgb += (tdc - 0.5) * uDetailStrength;
  else diffuseColor.rgb = mix(diffuseColor.rgb, tdc, uDetailStrength); }`;
// Screen-space bump (the same maths as three's bump map): uDetailBump is the relief height in meters per unit of height
const BUMP = `vec3 threedogDetailBump(vec3 surfPos, vec3 surfNorm, float h, float k, float faceDir){
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos), r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  return normalize(abs(det) * surfNorm - k * sign(det) * (dFdx(h) * r1 + dFdy(h) * r2)); }`;

/**
 * The `detail` patch from a detail option object (see MaterialDetail in types/style.d.ts). `engine` loads a texture given by asset name.
 * @internal use materialSpec.detail, style.terrain.detail or applyEffects(mat, { detail })
 * @param {any} o
 * @param {{ assets?: any } | null} engine
 * @param {string} [label] where the options came from, for errors
 * @returns {import('./patches.js').ShaderPatch}
 */
export function detailPatch(o, engine, label = 'detail') {
  checkOptions(label, o, KEYS);
  if (o.mode !== undefined && !MODES.includes(o.mode)) throw new Error(`${label}.mode '${o.mode}' is not a blend mode; use ${MODES.join(' | ')}`);
  if (o.noise !== undefined && !NOISES.includes(o.noise)) throw new Error(`${label}.noise '${o.noise}' is not a built-in noise; use ${NOISES.join(' | ')}, or write your own with glsl: 'vec4 threedogDetailSample(vec2 p){ ... }'`);
  const proj = o.projection ?? 'world';
  if (!PROJECT[proj]) throw new Error(`${label}.projection '${proj}' must be 'world' (top-down) or 'triplanar'`);
  if (o.glsl && !/vec4\s+threedogDetailSample\s*\(\s*vec2/.test(o.glsl)) throw new Error(`${label}.glsl must define \`vec4 threedogDetailSample(vec2 p)\`: p is the scaled, turned, stretched position; return vec4(color rgb, height 0-1). uDetailOctaves and the uniforms you list are in scope`);
  const src = o.glsl ? 'glsl:' + hashText(o.glsl) : o.texture ? 'tex' : o.noise ?? 'grain';
  const isStroke = o.noise === 'stroke', ang = (o.direction ?? 0) * Math.PI / 180;
  const colorOn = o.strength !== 0 && (o.strength !== undefined || !(o.normal || o.roughness)), bump = !!o.normal, rough = !!o.roughness;
  const u = /** @type {Record<string, { value: any }>} */ ({
    uDetailScale: { value: o.scale ?? 0.25 }, uDetailStrength: { value: o.strength ?? 0.35 }, uDetailMode: { value: Math.max(0, MODES.indexOf(o.mode ?? 'multiply')) },
    uDetailTint: { value: new THREE.Color(o.tint ?? 0xffffff) }, uDetailDir: { value: new THREE.Vector2(Math.cos(ang), Math.sin(ang)) },
    uDetailStretch: { value: o.stretch ?? (isStroke ? 6 : 1) }, uDetailOctaves: { value: o.octaves ?? 2 },
    uDetailBump: { value: o.normal ?? 0 }, uDetailRough: { value: o.roughness ?? 0 },
  });
  let decl = '';
  if (o.texture || o.glsl) {
    let tex;
    if (o.texture?.isTexture) tex = o.texture;
    else {
      tex = placeholderTexture('detail');
      if (typeof o.texture === 'string') {
        if (!engine?.assets) throw new Error(`${label}.texture '${o.texture}' is an asset name but no engine is known; pass the engine (makeMaterial(role, params, engine), applyEffects(mat, { detail, engine })) or give a THREE.Texture`);
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
  const pars = `uniform float uDetailScale, uDetailStrength, uDetailMode, uDetailStretch, uDetailOctaves, uDetailBump, uDetailRough;
uniform vec3 uDetailTint; uniform vec2 uDetailDir; ${decl}
${NOISE}
vec2 threedogDetailUV(vec2 w){ vec2 p = w * uDetailScale; p = vec2(uDetailDir.x * p.x + uDetailDir.y * p.y, -uDetailDir.y * p.x + uDetailDir.x * p.y); p.x /= uDetailStretch; return p; }
${o.glsl ?? SOURCES[o.texture ? 'tex' : o.noise ?? 'grain']}
${PROJECT[proj]}
${BUMP}`;
  const fragment = /** @type {Record<string, string>} */ ({ pars, color_fragment: `vec4 threedogDS = threedogDetail(vThreedogWorld);\n${colorOn ? COLOR : ''}` });
  if (bump) fragment.normal_fragment_maps = 'normal = threedogDetailBump(-vViewPosition, normal, threedogDS.a, uDetailBump, faceDirection);';
  if (rough) fragment.roughnessmap_fragment = 'roughnessFactor = clamp(roughnessFactor + (threedogDS.a - 0.5) * uDetailRough, 0.04, 1.0);';
  return { name: 'detail', cacheKey: `${src}|${proj}|${colorOn ? 'c' : ''}${bump ? 'n' : ''}${rough ? 'r' : ''}`, needs: { patches: ['world'] }, uniforms: u, glsl: { fragment } };
}
