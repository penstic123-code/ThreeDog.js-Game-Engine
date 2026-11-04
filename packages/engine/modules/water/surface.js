// The water's shader code (recipes/44): the wave function, depth color, crest foam and a replaceable surface function, all set through
// engine.water.shader({ wave, surface, depthColor, foam, uniforms }). With no depthColor / foam / surface function the surface patch is not
// added at all, so plain water pays nothing.
//
// wave      float threedogWaterWave(vec3 p, float t)   p = world position * uWaveScale, t = time * uWaveSpeed; returns the height before uWave
//                                                      (default peaks near +-0.29 = waveMax)
// surface   vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time)
//           base = material color and opacity; wave = threedogWaterWave at this point; facing = 1 looking straight down, 0 at grazing angles;
//           returns the color and opacity lighting starts from
import * as THREE from 'three';
import { closest } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { declareUniforms } from '../../render/uniformDecl.js';
import { hashText } from '../../render/effects.js';
import { codedError } from '../../core/errorHints.js';
import { glslFloat as gf, WAVE as W, WAVE_MAX, DEPTH, FOAM } from '../../render/fxNumbers.js';

const DEPTH_KEYS = ['shallow', 'deep', 'by', 'curve'];
const FOAM_KEYS = ['color', 'start', 'end', 'opacity'];
const BY = ['view', 'wave'];

// The built-in wave sum as a function, so a game can replace the motion alone and keep the rest of the water
const WAVE = `float threedogWaterWave(vec3 p, float t) {
  return sin(p.x * ${gf(W.x[0])} + t * ${gf(W.x[1])}) * ${gf(W.x[2])} + cos(p.z * ${gf(W.z[0])} + t * ${gf(W.z[1])}) * ${gf(W.z[2])}
    + sin((p.x + p.z) * ${gf(W.xz[0])} + t * ${gf(W.xz[1])}) * ${gf(W.xz[2])}; }`;

/**
 * Check and normalize what engine.water.shader takes (throws on wrong values with the fix)
 * @internal
 */
export function waterShader(o) {
  const code = v => (typeof v === 'string' ? v : v?.glsl);
  if (o.wave != null && typeof o.wave === 'object') readParams('engine.water.shader wave', keysSchema(['glsl', 'waveMax']), o.wave);
  const wave = code(o.wave), surface = code(o.surface), waveMax = typeof o.wave === 'object' ? o.wave?.waveMax : undefined;
  if (wave != null && !/\bfloat\s+threedogWaterWave\s*\(/.test(wave)) throw codedError('water-option', 'engine.water.shader({ wave }): the GLSL must define `float threedogWaterWave(vec3 p, float t)` returning the wave height (p = world position * uWaveScale, t = time * uWaveSpeed)');
  if (surface != null && !/\bvec4\s+threedogWaterSurface\s*\(/.test(surface)) throw codedError('water-option', 'engine.water.shader({ surface }): the GLSL must define `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time)` returning (rgb, opacity)');
  const d = o.depthColor, f = o.foam === true ? {} : o.foam;
  if (d) {
    readParams('engine.water.shader depthColor', keysSchema(DEPTH_KEYS), d);
    const by = d.by ?? 'view';
    if (!BY.includes(by)) throw codedError('water-option', `engine.water.shader depthColor.by '${by}' must be 'view' (fresnel: shallow looking down, deep at grazing angles) or 'wave' (shallow on crests)` + (closest(by, BY) ? ` (did you mean '${closest(by, BY)}'?)` : ''));
  }
  if (f) readParams('engine.water.shader foam', keysSchema(FOAM_KEYS), f);
  return { wave: wave ?? WAVE, surface, waveMax: waveMax ?? WAVE_MAX, depth: d || null, foam: f || null, custom: declareUniforms('engine.water.shader uniforms', o.uniforms) };
}

/**
 * The 'waves' patch: moves the vertices by threedogWaterWave; with a surface it also hands the height and world position to the fragment.
 * tune: the { uWave, uWaveScale, uWaveSpeed } objects, the same ones across shader() rebuilds so a game's handle to them stays live
 * @internal
 */
export function wavesPatch(e, tune, shader, surface) {
  const vary = surface ? 'varying float vThreedogWave; varying vec3 vThreedogWaterPos;' : '';
  return wavesTsl({ name: 'waves', cacheKey: hashText(shader.wave + shader.custom.decl + vary),
    uniforms: { uTime: e.uniforms.uTime, uWave: tune.uWave, uWaveScale: tune.uWaveScale, uWaveSpeed: tune.uWaveSpeed, ...shader.custom.uniforms },
    slot: 'position', pars: `uniform float uTime; uniform float uWave; uniform float uWaveScale; uniform float uWaveSpeed;\n${shader.custom.decl}\n${vary}\n${shader.wave}`, glsl: `
      vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz * uWaveScale; float tw = uTime * uWaveSpeed;
      float threedogWave = threedogWaterWave(wp, tw);
      transformed.y += threedogWave * uWave;` + (surface ? `
      vThreedogWave = threedogWave; vThreedogWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;` : '') }, shader, surface);
}

// NodeMaterial side of the two patches. material -> { wave, pos }: the TSL twins of the varyings vThreedogWave / vThreedogWaterPos, which the
// waves code makes and the waterSurface code reads (that is why waterSurface needs waves, on both sides). Kept per material because each
// NodeMaterial builds its own nodes; WeakMap so a dropped material takes its entry with it.
const WAVE_NODES = new WeakMap();
/** Add the tsl field to the waves patch: the built-in wave only (your own wave GLSL has no TSL twin: no tsl, so a NodeMaterial names the patch) */
function wavesTsl(p, shader, surface) {
  if (shader.wave !== WAVE) return p;
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
/** Add the tsl field to the waterSurface patch: the built-in surface (depthColor / foam) only; your own surface GLSL has no TSL twin */
function surfaceTsl(p, shader) {
  if (shader.surface) return p;
  p.tsl = c => {
    const n = WAVE_NODES.get(c.material);
    if (!n) throw codedError('shader-patch', "waterSurface reads the wave height the 'waves' patch hands over; add waves before it (needs: waves)");
    const T = c.tsl, U = k => c.fx.patchUniform(p.uniforms[k]), d = shader.depth;
    const fn = c.fx.waterSurface({ waveMax: shader.waveMax,
      depth: d && { shallow: U('uWaterShallow'), deep: U('uWaterDeep'), curve: U('uWaterCurve'), by: d.by },
      foam: shader.foam && { color: U('uFoamColor'), start: U('uFoamStart'), end: U('uFoamEnd'), opacity: U('uFoamOpacity') } });
    return fn(c.color, n.wave, T.abs(T.normalize(T.cameraPosition.sub(n.pos)).y), n.pos, U('uTime'));
  };
  return p;
}

/** The built-in surface function from depthColor / foam (numbers are uniforms; only which parts exist is in the code) */
function builtSurface(shader) {
  const { depth, foam } = shader, body = [];
  if (depth) body.push((depth.by ?? 'view') === 'view'
    ? 'c = mix(uWaterShallow, uWaterDeep, pow(1.0 - facing, uWaterCurve));'
    : 'c = mix(uWaterDeep, uWaterShallow, pow(clamp(0.5 + 0.5 * wave / THREEDOG_WAVE_MAX, 0.0, 1.0), uWaterCurve));');
  if (foam) body.push('float fo = smoothstep(uFoamStart, uFoamEnd, wave / THREEDOG_WAVE_MAX) * uFoamOpacity;\n  c = mix(c, uFoamColor, fo); a = mix(a, 1.0, fo);');
  return `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time) {
  vec3 c = base.rgb; float a = base.a;
  ${body.join('\n  ')}
  return vec4(c, a); }`;
}

/** The 'waterSurface' patch, or null when none is asked for (then the plain shader is untouched) @internal */
export function surfacePatch(e, shader) {
  if (!shader.depth && !shader.foam && !shader.surface) return null;
  const d = shader.depth || {}, f = shader.foam || {};
  const fn = shader.surface ?? builtSurface(shader);
  const uniforms = { uTime: e.uniforms.uTime, ...shader.custom.uniforms,
    // fallbacks are a light / dark neutral gray pair: the blend still shows, but the engine picks no water color (the game sets shallow / deep)
    uWaterShallow: { value: new THREE.Color(d.shallow ?? DEPTH.shallow) }, uWaterDeep: { value: new THREE.Color(d.deep ?? DEPTH.deep) }, uWaterCurve: { value: d.curve ?? DEPTH.curve },
    uFoamColor: { value: new THREE.Color(f.color ?? FOAM.color) }, uFoamStart: { value: f.start ?? FOAM.start }, uFoamEnd: { value: f.end ?? FOAM.end }, uFoamOpacity: { value: f.opacity ?? FOAM.opacity } };
  const pars = `#define THREEDOG_WAVE_MAX ${(+shader.waveMax).toFixed(4)}
uniform float uTime; uniform vec3 uWaterShallow; uniform vec3 uWaterDeep; uniform float uWaterCurve;
uniform vec3 uFoamColor; uniform float uFoamStart; uniform float uFoamEnd; uniform float uFoamOpacity;
${shader.custom.decl}
varying float vThreedogWave; varying vec3 vThreedogWaterPos;
${fn}`;
  // slot 'color': lighting has not started, so lit materials shade the new color (and Basic, which has no normal, works too)
  return surfaceTsl({ name: 'waterSurface', cacheKey: hashText(pars), needs: { patches: ['waves'] }, uniforms, pars, slot: 'color', glsl: `
    diffuseColor = threedogWaterSurface(diffuseColor, vThreedogWave, abs(normalize(cameraPosition - vThreedogWaterPos).y), vThreedogWaterPos, uTime);` }, shader);
}
