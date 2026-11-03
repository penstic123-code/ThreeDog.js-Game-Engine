// Water look hooks (recipes/44): the wave function, depth color, crest foam and a replaceable surface function.
// The defaults draw exactly the old water (tests/specs/appearance-water.mjs): with no depthColor / foam / surface hook the surface patch
// is not added at all, so a plain style pays nothing.
//
// patch('wave', glsl)       float threedogWaterWave(vec3 p, float t)   p = world position * waveScale, t = time * waveSpeed; returns the
//                                                                      height before waveHeight (default peaks near ±0.29 = waveMax)
// patch('surface', glsl)   vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time)
//                          base = material color and opacity; wave = threedogWaterWave at this point; facing = 1 looking straight down,
//                          0 at grazing angles; returns the color and opacity lighting starts from
import * as THREE from 'three';
import { closest } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { declareUniforms } from '../../render/uniformDecl.js';
import { hashText } from '../../render/effects.js';
import { codedError } from '../../core/errorHints.js';
import { WAVE as W, WAVE_MAX, DEPTH, FOAM } from './surfaceDefaults.js';
import { glslFloat as gf } from '../../render/fxNumbers.js';

const DEPTH_KEYS = ['shallow', 'deep', 'by', 'curve'];
const FOAM_KEYS = ['color', 'start', 'end', 'opacity'];
const BY = ['view', 'wave'];

// The built-in wave sum as a function, so a style can replace the motion alone and keep the rest of the water
const WAVE = `float threedogWaterWave(vec3 p, float t) {
  return sin(p.x * ${gf(W.x[0])} + t * ${gf(W.x[1])}) * ${gf(W.x[2])} + cos(p.z * ${gf(W.z[0])} + t * ${gf(W.z[1])}) * ${gf(W.z[2])}
    + sin((p.x + p.z) * ${gf(W.xz[0])} + t * ${gf(W.xz[1])}) * ${gf(W.xz[2])}; }`;

/**
 * Check and normalize the look keys of style.water (throws on wrong values with the fix; unknown keys warn with the near name)
 * @internal
 */
export function waterLook(st) {
  // GLSL comes only from look.water.patch('wave' | 'surface', ...) (look.js keeps it in st._hooks): one shader injection entry per look value,
  // so the old style.water.glsl / water({ glsl }) key throws and names the hook
  if (st.glsl !== undefined) throw codedError('water-option', "style.water.glsl / water({ glsl }) is not an option; your own GLSL goes through the look hooks: engine.look.water.patch('wave', glsl | { glsl, waveMax }) and engine.look.water.patch('surface', glsl) (recipes/44-water-weather-look-hooks.md)");
  const h = st._hooks || {}, code = v => (typeof v === 'string' ? v : v?.glsl);
  if (h.wave != null && typeof h.wave === 'object') readParams("look.water.patch('wave')", keysSchema(['glsl', 'waveMax']), h.wave);
  const g = { wave: code(h.wave), surface: code(h.surface), waveMax: typeof h.wave === 'object' ? h.wave?.waveMax : undefined };
  if (g.wave != null && !/\bfloat\s+threedogWaterWave\s*\(/.test(g.wave)) throw codedError('water-option', "look.water.patch('wave'): the GLSL must define `float threedogWaterWave(vec3 p, float t)` returning the wave height (p = world position * waveScale, t = time * waveSpeed)");
  if (g.surface != null && !/\bvec4\s+threedogWaterSurface\s*\(/.test(g.surface)) throw codedError('water-option', "look.water.patch('surface'): the GLSL must define `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time)` returning (rgb, opacity)");
  const d = st.depthColor, f = st.foam === true ? {} : st.foam;
  if (d) {
    readParams('style.water.depthColor', keysSchema(DEPTH_KEYS), d);
    const by = d.by ?? 'view';
    if (!BY.includes(by)) throw codedError('water-option', `style.water.depthColor.by '${by}' must be 'view' (fresnel: shallow looking down, deep at grazing angles) or 'wave' (shallow on crests)` + (closest(by, BY) ? ` (did you mean '${closest(by, BY)}'?)` : ''));
  }
  if (f) readParams('style.water.foam', keysSchema(FOAM_KEYS), f);
  return { wave: g.wave ?? WAVE, surface: g.surface, waveMax: g.waveMax ?? WAVE_MAX, depth: d || null, foam: f || null, custom: declareUniforms('style.water.uniforms', st.uniforms) };
}

/** The 'waves' patch: moves the vertices by threedogWaterWave; with a surface it also hands the height and world position to the fragment @internal */
export function wavesPatch(e, st, look, surface) {
  const vary = surface ? 'varying float vThreedogWave; varying vec3 vThreedogWaterPos;' : '';
  return wavesTsl({ name: 'waves', cacheKey: hashText(look.wave + look.custom.decl + vary),
    uniforms: { uTime: e.uniforms.uTime, uWave: { value: st.waveHeight }, uWaveScale: { value: st.waveScale }, uWaveSpeed: { value: st.waveSpeed }, ...look.custom.uniforms },
    slot: 'position', pars: `uniform float uTime; uniform float uWave; uniform float uWaveScale; uniform float uWaveSpeed;\n${look.custom.decl}\n${vary}\n${look.wave}`, glsl: `
      vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz * uWaveScale; float tw = uTime * uWaveSpeed;
      float threedogWave = threedogWaterWave(wp, tw);
      transformed.y += threedogWave * uWave;` + (surface ? `
      vThreedogWave = threedogWave; vThreedogWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;` : '') }, look, surface);
}

// NodeMaterial side of the two patches. material -> { wave, pos }: the TSL twins of the varyings vThreedogWave / vThreedogWaterPos, which the
// waves code makes and the waterSurface code reads (that is why waterSurface needs waves, on both sides). Kept per material because each
// NodeMaterial builds its own nodes; WeakMap so a dropped material takes its entry with it.
const WAVE_NODES = new WeakMap();
/** Add the tsl field to the waves patch: the built-in wave only (a look.water.patch('wave') GLSL has no TSL twin: no tsl, so a NodeMaterial names the patch) */
function wavesTsl(p, look, surface) {
  if (look.wave !== WAVE) return p;
  p.tsl = c => {
    const T = c.tsl, U = k => c.fx.patchUniform(p.uniforms[k]);
    // same inputs as the GLSL: world position of the undisplaced vertex * waveScale, time * waveSpeed
    const h = c.fx.waterWave(T.modelWorldMatrix.mul(T.vec4(T.positionGeometry, 1)).xyz.mul(U('uWaveScale')), U('uTime').mul(U('uWaveSpeed')));
    const out = c.position.add(T.vec3(0, h.mul(U('uWave')), 0));
    // varying(): computed per vertex and interpolated, as the GLSL varyings are (not recomputed per pixel)
    if (surface) WAVE_NODES.set(c.material, { wave: T.varying(h), pos: T.varying(T.modelWorldMatrix.mul(T.vec4(out, 1)).xyz) });
    return out;
  };
  return p;
}
/** Add the tsl field to the waterSurface patch: the built-in surface (depthColor / foam) only; a look.water.patch('surface') GLSL has no TSL twin */
function surfaceTsl(p, look) {
  if (look.surface) return p;
  p.tsl = c => {
    const n = WAVE_NODES.get(c.material);
    if (!n) throw codedError('shader-patch', "waterSurface reads the wave height the 'waves' patch hands over; add waves before it (needs: waves)");
    const T = c.tsl, U = k => c.fx.patchUniform(p.uniforms[k]), d = look.depth;
    const fn = c.fx.waterSurface({ waveMax: look.waveMax,
      depth: d && { shallow: U('uWaterShallow'), deep: U('uWaterDeep'), curve: U('uWaterCurve'), by: d.by },
      foam: look.foam && { color: U('uFoamColor'), start: U('uFoamStart'), end: U('uFoamEnd'), opacity: U('uFoamOpacity') } });
    return fn(c.color, n.wave, T.abs(T.normalize(T.cameraPosition.sub(n.pos)).y), n.pos, U('uTime'));
  };
  return p;
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
    // fallbacks are a light / dark neutral gray pair: the blend still shows, but the engine picks no water color (the style sets shallow / deep)
    uWaterShallow: { value: new THREE.Color(d.shallow ?? DEPTH.shallow) }, uWaterDeep: { value: new THREE.Color(d.deep ?? DEPTH.deep) }, uWaterCurve: { value: d.curve ?? DEPTH.curve },
    uFoamColor: { value: new THREE.Color(f.color ?? FOAM.color) }, uFoamStart: { value: f.start ?? FOAM.start }, uFoamEnd: { value: f.end ?? FOAM.end }, uFoamOpacity: { value: f.opacity ?? FOAM.opacity } };
  const pars = `#define THREEDOG_WAVE_MAX ${(+look.waveMax).toFixed(4)}
uniform float uTime; uniform vec3 uWaterShallow; uniform vec3 uWaterDeep; uniform float uWaterCurve;
uniform vec3 uFoamColor; uniform float uFoamStart; uniform float uFoamEnd; uniform float uFoamOpacity;
${look.custom.decl}
varying float vThreedogWave; varying vec3 vThreedogWaterPos;
${fn}`;
  // slot 'color': lighting has not started, so lit materials shade the new color (and Basic, which has no normal, works too)
  return surfaceTsl({ name: 'waterSurface', cacheKey: hashText(pars), needs: { patches: ['waves'] }, uniforms, pars, slot: 'color', glsl: `
    diffuseColor = threedogWaterSurface(diffuseColor, vThreedogWave, abs(normalize(cameraPosition - vThreedogWaterPos).y), vThreedogWaterPos, uTime);` }, look);
}
