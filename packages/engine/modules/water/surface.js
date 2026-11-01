// Water look hooks (recipes/44): the wave function, depth color, crest foam and a replaceable surface function.
// The defaults draw exactly the old water (tests/specs/appearance-water.mjs): with no depthColor / foam / glsl.surface the surface patch
// is not added at all, so a plain style pays nothing.
//
// style.water.glsl.wave    float threedogWaterWave(vec3 p, float t)   p = world position * waveScale, t = time * waveSpeed; returns the
//                                                                      height before waveHeight (default peaks near ±0.29 = waveMax)
// style.water.glsl.surface vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time)
//                          base = material color and opacity; wave = threedogWaterWave at this point; facing = 1 looking straight down,
//                          0 at grazing angles; returns the color and opacity lighting starts from
import * as THREE from 'three';
import { checkOptions, closest } from '../../core/validate.js';
import { declareUniforms } from '../../render/uniformDecl.js';
import { hashText } from '../../render/effects.js';

const GLSL_KEYS = ['wave', 'surface', 'waveMax'];
const DEPTH_KEYS = ['shallow', 'deep', 'by', 'curve'];
const FOAM_KEYS = ['color', 'start', 'end', 'opacity'];
const BY = ['view', 'wave'];

// The built-in wave sum as a function, so a style can replace the motion alone and keep the rest of the water
const WAVE = `float threedogWaterWave(vec3 p, float t) {
  return sin(p.x * 0.21 + t * 1.1) * 0.12 + cos(p.z * 0.17 + t * 0.9) * 0.12 + sin((p.x + p.z) * 0.37 + t * 1.7) * 0.05; }`;

/**
 * Check and normalize the look keys of style.water (throws on wrong values with the fix; unknown keys warn with the near name)
 * @internal
 */
export function waterLook(st) {
  const g = st.glsl || {};
  if (st.glsl !== undefined) {
    if (typeof st.glsl !== 'object') throw new Error('style.water.glsl must be { wave?, surface?, waveMax? } (GLSL strings); see recipes/44-water-weather-look-hooks.md');
    checkOptions('style.water.glsl', g, GLSL_KEYS);
    if (g.wave != null && !/\bfloat\s+threedogWaterWave\s*\(/.test(g.wave)) throw new Error('style.water.glsl.wave must define `float threedogWaterWave(vec3 p, float t)` returning the wave height (p = world position * waveScale, t = time * waveSpeed)');
    if (g.surface != null && !/\bvec4\s+threedogWaterSurface\s*\(/.test(g.surface)) throw new Error('style.water.glsl.surface must define `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time)` returning (rgb, opacity)');
  }
  const d = st.depthColor, f = st.foam === true ? {} : st.foam;
  if (d) {
    checkOptions('style.water.depthColor', d, DEPTH_KEYS);
    const by = d.by ?? 'view';
    if (!BY.includes(by)) throw new Error(`style.water.depthColor.by '${by}' must be 'view' (fresnel: shallow looking down, deep at grazing angles) or 'wave' (shallow on crests)` + (closest(by, BY) ? ` (did you mean '${closest(by, BY)}'?)` : ''));
  }
  if (f) checkOptions('style.water.foam', f, FOAM_KEYS);
  return { wave: g.wave ?? WAVE, surface: g.surface, waveMax: g.waveMax ?? 0.29, depth: d || null, foam: f || null, custom: declareUniforms('style.water.uniforms', st.uniforms) };
}

/** The 'waves' patch: moves the vertices by threedogWaterWave; with a surface it also hands the height and world position to the fragment @internal */
export function wavesPatch(e, st, look, surface) {
  const vary = surface ? 'varying float vThreedogWave; varying vec3 vThreedogWaterPos;' : '';
  return { name: 'waves', cacheKey: hashText(look.wave + look.custom.decl + vary),
    uniforms: { uTime: e.uniforms.uTime, uWave: { value: st.waveHeight }, uWaveScale: { value: st.waveScale }, uWaveSpeed: { value: st.waveSpeed }, ...look.custom.uniforms },
    glsl: { vertex: { pars: `uniform float uTime; uniform float uWave; uniform float uWaveScale; uniform float uWaveSpeed;\n${look.custom.decl}\n${vary}\n${look.wave}`, begin_vertex: `
      vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz * uWaveScale; float tw = uTime * uWaveSpeed;
      float threedogWave = threedogWaterWave(wp, tw);
      transformed.y += threedogWave * uWave;` + (surface ? `
      vThreedogWave = threedogWave; vThreedogWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;` : '') } } };
}

/** The built-in surface function from depthColor / foam (numbers are uniforms; only which parts exist is in the code) */
function builtSurface(look) {
  const { depth, foam } = look, body = [];
  if (depth) body.push((depth.by ?? 'view') === 'view'
    ? 'c = mix(uWaterShallow, uWaterDeep, pow(1.0 - facing, uWaterCurve));'
    : 'c = mix(uWaterDeep, uWaterShallow, pow(clamp(0.5 + 0.5 * wave / THREEDOG_WAVE_MAX, 0.0, 1.0), uWaterCurve));');
  if (foam) body.push('float fo = smoothstep(uFoamStart, uFoamEnd, wave / THREEDOG_WAVE_MAX) * uFoamOpacity;\n  c = mix(c, uFoamColor, fo); a = mix(a, 1.0, fo);');
  return `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time) {
  vec3 c = base.rgb; float a = base.a;
  ${body.join('\n  ')}
  return vec4(c, a); }`;
}

/** The 'waterSurface' patch, or null when the style asks for none (then the old shader is untouched) @internal */
export function surfacePatch(e, look) {
  if (!look.depth && !look.foam && !look.surface) return null;
  const d = look.depth || {}, f = look.foam || {};
  const fn = look.surface ?? builtSurface(look);
  const uniforms = { uTime: e.uniforms.uTime, ...look.custom.uniforms,
    uWaterShallow: { value: new THREE.Color(d.shallow ?? 0x4fb8c8) }, uWaterDeep: { value: new THREE.Color(d.deep ?? 0x0e3a5c) }, uWaterCurve: { value: d.curve ?? 1 },
    uFoamColor: { value: new THREE.Color(f.color ?? 0xffffff) }, uFoamStart: { value: f.start ?? 0.55 }, uFoamEnd: { value: f.end ?? 0.85 }, uFoamOpacity: { value: f.opacity ?? 1 } };
  const pars = `#define THREEDOG_WAVE_MAX ${(+look.waveMax).toFixed(4)}
uniform float uTime; uniform vec3 uWaterShallow; uniform vec3 uWaterDeep; uniform float uWaterCurve;
uniform vec3 uFoamColor; uniform float uFoamStart; uniform float uFoamEnd; uniform float uFoamOpacity;
${look.custom.decl}
varying float vThreedogWave; varying vec3 vThreedogWaterPos;
${fn}`;
  // after color_fragment: lighting has not started, so lit materials shade the new color (and Basic, which has no normal, works too)
  return { name: 'waterSurface', cacheKey: hashText(pars), needs: { patches: ['waves'] }, uniforms, glsl: { fragment: { pars, color_fragment: `
    diffuseColor = threedogWaterSurface(diffuseColor, vThreedogWave, abs(normalize(cameraPosition - vThreedogWaterPos).y), vThreedogWaterPos, uTime);` } } };
}
