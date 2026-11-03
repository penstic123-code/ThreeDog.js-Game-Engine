// TSL wrapDiffuse() / shadowTint() / rim() (GLSL threedogWrapDiffuse / threedogShadowTint / threedogRim).
// Line for line the callable chunk of render/lighting.js (#include <threedog_lighting>): plain inputs, no uniforms, no three internals.
// Where the inputs come from in TSL: wrap the material's setupLightingModel; in the LightingModel's direct() hook the sun is the first
// directional lightNode, nl = dot(normalView, lightDirection), its shadow alone is lightNode.shadowNode (null without shadows), and the
// end of start() is the point GLSL calls lights_fragment_end (reflectedLight still writable). The GLSL threedogSunShadow() helper is not needed there.
// Why not import lighting.js: it registers a ShaderChunk and the WebGL patch, which threedog/tsl must not pull in.
import { Fn, vec3, float, max, mix, smoothstep, clamp, pow, dot } from 'three/tsl';

/** @template {string} T @typedef {import('three/webgpu').Node<T>} N */

const LUM = vec3(0.2126, 0.7152, 0.0722);   // the same Rec. 709 weights as lighting.js `lum`

/**
 * GLSL vec3 threedogWrapDiffuse(float nl, float wrap, vec3 lightColor, float shadow, vec3 albedo): the half-lambert light beyond plain Lambert,
 * to add to directDiffuse. In direct() lightColor already carries the shadow, so pass shadow = 1 with it (or the unshadowed color and the shadow).
 */
export const wrapDiffuse = Fn(/** @param {[N<'float'>, N<'float'>, N<'vec3'>, N<'float'>, N<'vec3'>]} a */ ([nl, wrap, lightColor, shadow, albedo]) =>
  max(nl.add(wrap).div(float(wrap).add(1)), 0).sub(max(nl, 0)).mul(lightColor).mul(shadow).mul(0.3183098861837907).mul(albedo));

/** GLSL vec3 threedogShadowTint(vec3 ambient, vec3 tint, float strength, float soft, float nl, float shadow): ambient with the shaded side's hue moved */
export const shadowTint = Fn(/** @param {[N<'vec3'>, N<'vec3'>, N<'float'>, N<'float'>, N<'float'>, N<'float'>]} a */ ([ambient, tint, strength, soft, nl, shadow]) => {
  const k = float(1).sub(float(shadow).mul(smoothstep(0, soft, nl))).mul(strength);
  return mix(ambient, ambient.mul(tint.div(max(dot(tint, LUM), 0.001))), k);
});

/** GLSL vec3 threedogRim(vec3 normal, vec3 viewDir, vec3 color, float strength, float power, float shadowSide, float nl): edge light to add (viewDir: surface to eye) */
export const rim = Fn(/** @param {[N<'vec3'>, N<'vec3'>, N<'vec3'>, N<'float'>, N<'float'>, N<'float'>, N<'float'>]} a */ ([normal, viewDir, color, strength, power, shadowSide, nl]) =>
  color.mul(pow(float(1).sub(clamp(dot(normal, viewDir), 0, 1)), power).mul(mix(1, float(1).sub(clamp(nl, 0, 1)), shadowSide)).mul(strength)));
