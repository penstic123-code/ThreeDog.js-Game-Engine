// @threedog/post-effects: optional post effects. The engine ships none (it owns no look); a style or a game adds the ones it wants, the one
// way every post effect gets in (engine.look.post.add). Each effect gives create (WebGL) and node (WebGPU), so one value runs on both:
//   import { vignette, grain } from '@threedog/post-effects';
//   engine.look.post.add(vignette());                       // game code
//   plugins/20-grain.js: export default grain();            // the game's plugins folder, or a style's style/plugins/ folder
// Styles bring bloom / ao / outline as their own plugin files; they all import from here, never from each other.
// hdr slot (linear, before tone mapping): bloom, ao, outline, dof. ldr slot (sRGB, after it): lut, grain, vignette, chromatic.
// lut / grain / vignette / chromatic carry a `fuse` GLSL snippet, so when several are on they run as one fullscreen pass.
// Added = on: an effect given to look.post.add (or exported by a plugin file) is on unless it says enabled: false (list it off for the game to switch on later with
// look.post.set({ '<name>.enabled': true })); the engine's rule for every effect, so listing one never silently does nothing. The costly ones
// (bloom, ao, dof, outline mode normal/both) start off on low-tier devices when a style's plugins bring them; engine.look.post.set({ name: true }) turns them on.
import * as THREE from 'three';
export { dof } from './dof.js';
export { bloom, ao } from './hdr.js';
export { outline, OUTLINE_OFF_LAYER } from './outline.js';
/** @import { PostEffect } from 'threedog' */

// A 2x2x2 identity LUT stands in until the game gives a real one (a sampler uniform must always hold a texture)
const identity = new THREE.Data3DTexture(new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 0, 255,
  0, 0, 255, 255, 255, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255]), 2, 2, 2);
identity.format = THREE.RGBAFormat; identity.minFilter = identity.magFilter = THREE.LinearFilter; identity.unpackAlignment = 1; identity.needsUpdate = true;

/**
 * Color grading in sRGB space (ldr slot): contrast, saturation, warm/cool shift and an optional 3D LUT, in one fused snippet.
 * @example
 * import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
 * const { texture3D } = await new LUTCubeLoader().loadAsync('/luts/warm.cube');
 * engine.look.post.add(lut({ enabled: true, lut: texture3D, amount: 0.8, saturation: 1.1, temperature: 0.2 }))
 * @param {{ lut?: import('three').Data3DTexture | null, amount?: number, contrast?: number, saturation?: number, temperature?: number, enabled?: boolean, order?: number }} [o]
 *   lut: a 3D LUT texture (null = only the numbers below); amount: how much of the LUT result to use (0..1); contrast, saturation: 1 = unchanged;
 *   temperature: -1 cool .. 1 warm
 * @returns {PostEffect}
 */
export function lut({ lut = null, amount = 1, contrast = 1, saturation = 1, temperature = 0, enabled, order = 10 } = {}) {
  return { name: 'lut', slot: 'ldr', order, enabled, params: { lut, amount, contrast, saturation, temperature },
    fuse: {
      uniforms: { uLutTex: 'sampler3D', uLutSize: 'float', uLutAmount: 'float', uLutContrast: 'float', uLutSaturation: 'float', uLutTemp: 'float' },
      values: p => ({ uLutTex: p.lut ?? identity, uLutSize: (p.lut ?? identity).image.width, uLutAmount: p.lut ? p.amount : 0,
        uLutContrast: p.contrast, uLutSaturation: p.saturation, uLutTemp: p.temperature }),
      glsl: `color.rgb += vec3(uLutTemp * 0.06, 0.0, -uLutTemp * 0.06);
    color.rgb = clamp((color.rgb - 0.5) * uLutContrast + 0.5, 0.0, 1.0);
    color.rgb = mix(vec3(dot(color.rgb, vec3(0.2126, 0.7152, 0.0722))), color.rgb, uLutSaturation);
    if (uLutAmount > 0.0) color.rgb = mix(color.rgb, texture(uLutTex, clamp(color.rgb, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize).rgb, uLutAmount);`,
      // the same steps as the GLSL above; the LUT texture is not a live param (changing it rebuilds the chain), so its branch is chosen here
      tsl: (color, uv, { tsl: T, p, params }) => {
        let c = color.rgb.add(T.vec3(p.temperature.mul(0.06), 0, p.temperature.mul(-0.06)));
        c = T.clamp(c.sub(0.5).mul(p.contrast).add(0.5), 0, 1);
        c = T.mix(T.vec3(T.dot(c, T.vec3(0.2126, 0.7152, 0.0722))), c, p.saturation);
        if (params.lut) { const n = params.lut.image.width; c = T.mix(c, T.texture3D(params.lut, T.clamp(c, 0, 1).mul((n - 1) / n).add(0.5 / n)).rgb, p.amount); }
        return T.vec4(c, color.a);
      } } };
}

/**
 * Film grain (ldr slot): per-pixel noise, a little weaker in highlights.
 * @example engine.look.post.add(grain({ enabled: true, amount: 0.06 }))
 * @param {{ amount?: number, size?: number, animated?: boolean, enabled?: boolean, order?: number }} [o]
 *   amount: noise strength; size: grain size in device pixels; animated: new noise every frame (24 per second)
 * @returns {PostEffect}
 */
export function grain({ amount = 0.06, size = 1, animated = true, enabled, order = 30 } = {}) {
  return { name: 'grain', slot: 'ldr', order, enabled, params: { amount, size, animated },
    fuse: {
      uniforms: { uGrainAmount: 'float', uGrainSize: 'float', uGrainAnimated: 'float' },
      values: p => ({ uGrainAmount: p.amount, uGrainSize: Math.max(1, p.size), uGrainAnimated: p.animated ? 1 : 0 }),
      glsl: `float n = fxHash(floor(vUv * uResolution / uGrainSize) + (uGrainAnimated > 0.5 ? floor(uTime * 24.0) * 17.0 : 0.0)) - 0.5;
    color.rgb += n * uGrainAmount * (1.0 - 0.5 * dot(color.rgb, vec3(0.299, 0.587, 0.114)));`,
      // same shape; three's hash() stands in for fxHash, so the noise pattern differs from WebGL's (its strength does not)
      tsl: (color, uv, { tsl: T, p, time, resolution }) => {
        const q = T.floor(uv.mul(resolution).div(T.max(p.size, 1))), frame = T.floor(time.mul(24)).mul(17).mul(p.animated);
        const n = T.hash(q.x.add(q.y.mul(1103)).add(frame)).sub(0.5);
        return T.vec4(color.rgb.add(n.mul(p.amount).mul(T.float(1).sub(T.dot(color.rgb, T.vec3(0.299, 0.587, 0.114)).mul(0.5)))), color.a);
      } } };
}

/**
 * Vignette (ldr slot): darker screen corners.
 * @example engine.look.post.add(vignette({ enabled: true, strength: 0.4 }))
 * @param {{ strength?: number, start?: number, enabled?: boolean, order?: number }} [o]
 *   strength: darkness at the corners (0..1); start: distance from the center where darkening begins (0 center .. 1 corner)
 * @returns {PostEffect}
 */
export function vignette({ strength = 0.35, start = 0.45, enabled, order = 20 } = {}) {
  return { name: 'vignette', slot: 'ldr', order, enabled, params: { strength, start },
    fuse: {
      uniforms: { uVigStrength: 'float', uVigStart: 'float' },
      values: p => ({ uVigStrength: p.strength, uVigStart: p.start }),
      glsl: 'color.rgb *= 1.0 - uVigStrength * smoothstep(uVigStart, 1.0, length(vUv - 0.5) * 1.4142);',
      tsl: (color, uv, { tsl: T, p }) => T.vec4(color.rgb.mul(T.float(1).sub(p.strength.mul(T.smoothstep(p.start, 1, uv.sub(0.5).length().mul(1.4142))))), color.a) } };
}

/**
 * Chromatic aberration (ldr slot): red and blue shift apart toward the screen edge. Samples the pass input, so it starts a fused group
 * (default order puts it first, so it still joins the others).
 * @example engine.look.post.add(chromatic({ enabled: true, amount: 0.004 }))
 * @param {{ amount?: number, enabled?: boolean, order?: number }} [o]  amount: edge shift in screen fractions
 * @returns {PostEffect}
 */
export function chromatic({ amount = 0.004, enabled, order = 5 } = {}) {
  return { name: 'chromatic', slot: 'ldr', order, enabled, params: { amount },
    fuse: {
      reads: true,
      uniforms: { uChromaAmount: 'float' },
      values: p => ({ uChromaAmount: p.amount }),
      glsl: `vec2 off = (vUv - 0.5) * uChromaAmount;
    color.r = texture2D(tDiffuse, vUv + off).r; color.b = texture2D(tDiffuse, vUv - off).b;`,
      // input: the image before this effect as a texture (reads: true), sampled at the shifted uvs
      tsl: (color, uv, { tsl: T, p, input }) => {
        const off = uv.sub(0.5).mul(p.amount);
        return T.vec4(input.sample(uv.add(off)).r, color.g, input.sample(uv.sub(off)).b, color.a);
      } } };
}
