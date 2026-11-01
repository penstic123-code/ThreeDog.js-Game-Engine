// @threedog/post-effects: optional post effects for engine.post. The engine ships none (it owns no look); a game adds the ones it wants:
//   import { vignette, grain, lut } from '@threedog/post-effects';
//   createEngine({ canvas, style: [lowpoly, postAdd(vignette({ enabled: true }), grain({ enabled: true }))] });
// lut / grain / vignette / chromatic carry a `fuse` GLSL snippet, so when several are on they run as one fullscreen pass.
// All are off unless you pass enabled: true.
import * as THREE from 'three';
export { dof } from './dof.js';
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
 * post: [lut({ enabled: true, lut: texture3D, amount: 0.8, saturation: 1.1, temperature: 0.2 })]
 * @param {{ lut?: import('three').Data3DTexture | null, amount?: number, contrast?: number, saturation?: number, temperature?: number, enabled?: boolean, order?: number }} [o]
 *   lut: a 3D LUT texture (null = only the numbers below); amount: how much of the LUT result to use (0..1); contrast, saturation: 1 = unchanged;
 *   temperature: -1 cool .. 1 warm
 * @returns {PostEffect}
 */
export function lut({ lut = null, amount = 1, contrast = 1, saturation = 1, temperature = 0, enabled = false, order = 10 } = {}) {
  return { name: 'lut', slot: 'ldr', order, enabled, params: { lut, amount, contrast, saturation, temperature },
    fuse: {
      uniforms: { uLutTex: 'sampler3D', uLutSize: 'float', uLutAmount: 'float', uLutContrast: 'float', uLutSaturation: 'float', uLutTemp: 'float' },
      values: p => ({ uLutTex: p.lut ?? identity, uLutSize: (p.lut ?? identity).image.width, uLutAmount: p.lut ? p.amount : 0,
        uLutContrast: p.contrast, uLutSaturation: p.saturation, uLutTemp: p.temperature }),
      glsl: `color.rgb += vec3(uLutTemp * 0.06, 0.0, -uLutTemp * 0.06);
    color.rgb = clamp((color.rgb - 0.5) * uLutContrast + 0.5, 0.0, 1.0);
    color.rgb = mix(vec3(dot(color.rgb, vec3(0.2126, 0.7152, 0.0722))), color.rgb, uLutSaturation);
    if (uLutAmount > 0.0) color.rgb = mix(color.rgb, texture(uLutTex, clamp(color.rgb, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize).rgb, uLutAmount);` } };
}

/**
 * Film grain (ldr slot): per-pixel noise, a little weaker in highlights.
 * @example post: [grain({ enabled: true, amount: 0.06 })]
 * @param {{ amount?: number, size?: number, animated?: boolean, enabled?: boolean, order?: number }} [o]
 *   amount: noise strength; size: grain size in device pixels; animated: new noise every frame (24 per second)
 * @returns {PostEffect}
 */
export function grain({ amount = 0.06, size = 1, animated = true, enabled = false, order = 30 } = {}) {
  return { name: 'grain', slot: 'ldr', order, enabled, params: { amount, size, animated },
    fuse: {
      uniforms: { uGrainAmount: 'float', uGrainSize: 'float', uGrainAnimated: 'float' },
      values: p => ({ uGrainAmount: p.amount, uGrainSize: Math.max(1, p.size), uGrainAnimated: p.animated ? 1 : 0 }),
      glsl: `float n = fxHash(floor(vUv * uResolution / uGrainSize) + (uGrainAnimated > 0.5 ? floor(uTime * 24.0) * 17.0 : 0.0)) - 0.5;
    color.rgb += n * uGrainAmount * (1.0 - 0.5 * dot(color.rgb, vec3(0.299, 0.587, 0.114)));` } };
}

/**
 * Vignette (ldr slot): darker screen corners.
 * @example post: [vignette({ enabled: true, strength: 0.4 })]
 * @param {{ strength?: number, start?: number, enabled?: boolean, order?: number }} [o]
 *   strength: darkness at the corners (0..1); start: distance from the center where darkening begins (0 center .. 1 corner)
 * @returns {PostEffect}
 */
export function vignette({ strength = 0.35, start = 0.45, enabled = false, order = 20 } = {}) {
  return { name: 'vignette', slot: 'ldr', order, enabled, params: { strength, start },
    fuse: {
      uniforms: { uVigStrength: 'float', uVigStart: 'float' },
      values: p => ({ uVigStrength: p.strength, uVigStart: p.start }),
      glsl: 'color.rgb *= 1.0 - uVigStrength * smoothstep(uVigStart, 1.0, length(vUv - 0.5) * 1.4142);' } };
}

/**
 * Chromatic aberration (ldr slot): red and blue shift apart toward the screen edge. Samples the pass input, so it starts a fused group
 * (default order puts it first, so it still joins the others).
 * @example post: [chromatic({ enabled: true, amount: 0.004 })]
 * @param {{ amount?: number, enabled?: boolean, order?: number }} [o]  amount: edge shift in screen fractions
 * @returns {PostEffect}
 */
export function chromatic({ amount = 0.004, enabled = false, order = 5 } = {}) {
  return { name: 'chromatic', slot: 'ldr', order, enabled, params: { amount },
    fuse: {
      reads: true,
      uniforms: { uChromaAmount: 'float' },
      values: p => ({ uChromaAmount: p.amount }),
      glsl: `vec2 off = (vUv - 0.5) * uChromaAmount;
    color.r = texture2D(tDiffuse, vUv + off).r; color.b = texture2D(tDiffuse, vUv - off).b;` } };
}
