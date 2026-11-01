// The `lighting` surface patch and the toon ramp: extra, optional light shaping on three's lit materials (lambert, phong, standard, toon).
// three has no "shadow color": a shadow just removes the sun's light. The patch therefore works after the lights are summed (lights_fragment_end):
// it re-reads the first directional light (three sorts shadow-casting lights first, so that is the sun) and its shadow-map value for this
// pixel, and shapes the result from them. Limits: one directional light is considered (point / spot lights are untouched); wrap does not
// follow a toon ramp (a toon ramp is the better tool there); cloud shadows are not "shadow" for shadowTint.
// All values are uniforms: materials differing only in numbers or colors share one program (the cacheKey holds which features are on).
import * as THREE from 'three';
import { checkOptions } from '../core/validate.js';
import { hashText } from './effects.js';
import { declareUniforms } from './uniformDecl.js';

const KEYS = ['wrap', 'shadowTint', 'rim', 'glsl', 'uniforms'];
const lum = 'vec3(0.2126, 0.7152, 0.0722)';

// Functions need getShadow and the light uniforms, which exist only after these includes: they go after shadowmap_pars_fragment
const SUN = `float threedogSunShadow(){
  #if NUM_DIR_LIGHTS > 0 && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    return receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity,
      directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
  #else
    return 1.0;
  #endif
}`;

/**
 * @typedef {{ wrap?: number, shadowTint?: { color: import('../types/common').ColorLike, strength?: number, soft?: number },
 *   rim?: { color: import('../types/common').ColorLike, strength?: number, power?: number, shadowSide?: number }, glsl?: string, uniforms?: Record<string, any> }} LightingOptions
 */

/**
 * The `lighting` patch (see MaterialLighting in types/style.d.ts). With `glsl` your function replaces the built-in shaping.
 * @internal use materialSpec.lighting, style.lighting or applyEffects(mat, { patches: [lightingPatch(opts)] })
 * @param {LightingOptions} o
 * @param {string} [label]
 * @returns {import('./patches.js').ShaderPatch}
 */
export function lightingPatch(o, label = 'lighting') {
  checkOptions(label, o, KEYS);
  const { wrap, shadowTint: st, rim } = o;
  if (o.glsl && !/void\s+threedogLighting\s*\(/.test(o.glsl)) throw new Error(`${label}.glsl must define \`void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo)\`: normal and viewDir are in view space, sunDir points to the sun, sunShadow is 1 lit / 0 in shadow (1 without shadows); change light.directDiffuse / indirectDiffuse (the lights are already summed)`);
  if (st && st.color === undefined) throw new Error(`${label}.shadowTint needs a color: { color: shadowColor, strength: 0.6 }`);
  if (rim && rim.color === undefined) throw new Error(`${label}.rim needs a color: { color: rimColor, strength: 0.4, power: 3 }`);
  const own = declareUniforms(label + '.uniforms', o.uniforms);
  const u = { ...own.uniforms };
  let pars = `uniform float uLitWrap; uniform vec3 uLitShadowColor; uniform vec2 uLitShadow; uniform vec3 uLitRimColor; uniform vec3 uLitRim;\n${own.decl}`;
  let code = '#if NUM_DIR_LIGHTS > 0\n  float tdSun = threedogSunShadow(); vec3 tdL = directionalLights[ 0 ].direction; float tdNL = dot( normal, tdL );\n';
  if (o.glsl) code += '  threedogLighting( reflectedLight, normal, normalize( vViewPosition ), tdL, tdSun, diffuseColor.rgb );\n';
  else {
    if (wrap !== undefined) {
      // half-lambert: the diffuse term (n.l + w) / (1 + w); only the part beyond plain Lambert is added, with the sun's color and shadow
      code += '  reflectedLight.directDiffuse += ( max( ( tdNL + uLitWrap ) / ( 1.0 + uLitWrap ), 0.0 ) - max( tdNL, 0.0 ) ) * directionalLights[ 0 ].color * tdSun * RECIPROCAL_PI * diffuseColor.rgb;\n';
      u.uLitWrap = { value: wrap };
    }
    if (st) {
      // 1 - lit: in the shadow map, or turned away from the sun (soft = how wide the terminator is, in n.l). The hue moves, the brightness stays.
      const c = new THREE.Color(st.color);
      code += `  { float tdK = ( 1.0 - tdSun * smoothstep( 0.0, uLitShadow.y, tdNL ) ) * uLitShadow.x;
    vec3 tdHue = uLitShadowColor / max( dot( uLitShadowColor, ${lum} ), 0.001 );
    reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, reflectedLight.indirectDiffuse * tdHue, tdK ); }\n`;
      u.uLitShadowColor = { value: c }; u.uLitShadow = { value: new THREE.Vector2(st.strength ?? 0.5, Math.max(st.soft ?? 0.3, 0.001)) };
    }
    if (rim) {
      // fresnel-like edge light, added to the ambient part; shadowSide 1 = only on the side facing away from the sun
      code += '  reflectedLight.indirectDiffuse += uLitRimColor * ( pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), uLitRim.y ) * mix( 1.0, 1.0 - clamp( tdNL, 0.0, 1.0 ), uLitRim.z ) * uLitRim.x );\n';
      u.uLitRimColor = { value: new THREE.Color(rim.color) }; u.uLitRim = { value: new THREE.Vector3(rim.strength ?? 0.4, rim.power ?? 3, rim.shadowSide ?? 0) };
    }
  }
  code += '#endif';
  for (const n of ['uLitWrap', 'uLitShadowColor', 'uLitShadow', 'uLitRimColor', 'uLitRim']) u[n] ??= { value: n === 'uLitWrap' ? 0 : n === 'uLitShadow' ? new THREE.Vector2() : n === 'uLitRim' ? new THREE.Vector3() : new THREE.Color() };
  const key = o.glsl ? 'g' + hashText(o.glsl) : `${wrap !== undefined ? 'w' : ''}${st ? 's' : ''}${rim ? 'r' : ''}`;
  return { name: 'lighting', cacheKey: key, uniforms: u, glsl: { fragment: { pars, shadowmap_pars_fragment: (o.glsl ? o.glsl + '\n' : '') + SUN, lights_fragment_end: code } } };
}

// ---------- toon ramp ----------
const rampCache = new Map();
/**
 * The gradientMap of a toon material from `ramp` (grays or colors, dark to light) and `soften` (0 = hard bands, 1 = bands melt into each other).
 * Color entries tint the light of that band (a cool band in the shade); a gray number n is the light's strength there.
 * @internal
 * @param {(number | import('../types/common').ColorLike)[]} ramp
 * @param {number} [soften]
 * @returns {THREE.DataTexture}
 */
export function rampTexture(ramp, soften = 0) {
  if (!Array.isArray(ramp) || ramp.length < 2) throw new Error('toon ramp must be an array of at least 2 grays or colors, dark to light, e.g. ramp: [0.35, 0.7, 1] or three colors');
  const key = JSON.stringify([ramp, soften]);
  if (rampCache.has(key)) return rampCache.get(key);
  const cols = ramp.map(v => typeof v === 'number' && v <= 1 ? new THREE.Color(v, v, v) : new THREE.Color(v));
  const soft = Math.max(0, Math.min(1, soften)), W = soft > 0 ? 128 : cols.length, N = cols.length, data = new Uint16Array(W * 4), c = new THREE.Color();
  for (let i = 0; i < W; i++) {
    const x = (i + 0.5) / W * N, b = Math.round(x), d = x - b;   // b = nearest band border
    if (soft > 0 && b > 0 && b < N && Math.abs(d) < soft / 2) c.copy(cols[b - 1]).lerp(cols[b], THREE.MathUtils.smoothstep(d, -soft / 2, soft / 2));
    else c.copy(cols[Math.min(N - 1, Math.floor(x))]);
    data.set([THREE.DataUtils.toHalfFloat(c.r), THREE.DataUtils.toHalfFloat(c.g), THREE.DataUtils.toHalfFloat(c.b), THREE.DataUtils.toHalfFloat(1)], i * 4);
  }
  const t = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = soft > 0 ? THREE.LinearFilter : THREE.NearestFilter; t.needsUpdate = true;
  rampCache.set(key, t);
  return t;
}
