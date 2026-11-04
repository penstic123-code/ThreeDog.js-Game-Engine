// TSL waterWave() / waterSurface() / waterFresnel(): the water patches of modules/water (waves, waterSurface, fresnel) as TSL.
// - waterWave(p, t): line for line the built-in GLSL threedogWaterWave (surface.js WAVE). Like the GLSL `waves` patch, feed it the world position
//   of the undisplaced vertex times waveScale and time times waveSpeed, and add wave * waveHeight to the vertex y (a positionNode: positionLocal + vec3(0, h, 0)).
// - waterSurface(spec): the GLSL surface function is generated per water shader (builtSurface: depthColor / foam decide which lines exist), so the TSL side
//   is a builder too: it returns an Fn with the exact GLSL signature threedogWaterSurface(base, wave, facing, worldPos, time) -> vec4 (rgb, opacity).
// - waterFresnel(color, normal, viewDir, strength, towards): the expression of the `fresnel` patch (Water.js, output slot), grazing angles toward
//   `towards` (the engine passes the fog color). GLSL has it inline, not as a function; the inputs are the ones that expression reads.
// Why this split: waves needs nothing from waterSurface, waterSurface needs the wave height and world position waves hands over (GLSL varyings
// vThreedogWave / vThreedogWaterPos, `needs: waves`); in TSL a value used in the fragment is carried over by three, so the caller just reuses the node.
import { Fn, vec4, float, color, sin, cos, mix, pow, clamp, smoothstep, abs, dot } from 'three/tsl';
import { WAVE as W, WAVE_MAX, DEPTH, FOAM, FRESNEL_POWER } from '../fxNumbers.js';

/** @template {string} T @typedef {import('three/webgpu').Node<T>} N */

/** GLSL float threedogWaterWave(vec3 p, float t): the built-in wave sum, height in metres before waveHeight (p = world position * waveScale, t = time * waveSpeed) */
export const waterWave = Fn(/** @param {[N<'vec3'>, N<'float'>]} a */ ([p, t]) =>
  sin(p.x.mul(W.x[0]).add(t.mul(W.x[1]))).mul(W.x[2]).add(cos(p.z.mul(W.z[0]).add(t.mul(W.z[1]))).mul(W.z[2]))
    .add(sin(p.x.add(p.z).mul(W.xz[0]).add(t.mul(W.xz[1]))).mul(W.xz[2])));

/** @param {any} v @returns {N<'float'>} */
const f1 = v => (v?.isNode ? v : float(v));
/** @param {any} v @returns {N<'vec3'> | N<'color'>} */
const c3 = v => (v?.isNode ? v : color(v));

/**
 * The built-in surface function as TSL (GLSL builtSurface in modules/water/surface.js): the parts given exist, the rest is left out.
 * Values may be numbers / colors (constants) or nodes (uniforms you change live); missing ones take the GLSL patch's fallbacks.
 * @param {{ depth?: { shallow?: any, deep?: any, curve?: any, by?: 'view' | 'wave' }, foam?: { color?: any, start?: any, end?: any, opacity?: any }, waveMax?: number }} [spec]
 * @returns {(base: any, wave: any, facing: any, worldPos: any, time: any) => any} vec4 (rgb, opacity)
 */
export function waterSurface({ depth, foam, waveMax = WAVE_MAX } = {}) {
  // base: the color so far, vec3 or vec4 (vec4() takes either)
  return Fn(/** @param {[any, N<'float'>, N<'float'>, ...any[]]} a */ ([base, wave, facing]) => {
    const b = vec4(base);
    /** @type {N<'vec3'> | N<'color'>} */ let c = b.rgb;
    /** @type {N<'float'>} */ let a = b.a;
    if (depth) {
      const sh = c3(depth.shallow ?? DEPTH.shallow), dp = c3(depth.deep ?? DEPTH.deep), cu = f1(depth.curve ?? DEPTH.curve);
      c = (depth.by ?? 'view') === 'view'
        ? mix(sh, dp, pow(float(1).sub(facing), cu))
        : mix(dp, sh, pow(clamp(float(wave).div(waveMax).mul(0.5).add(0.5), 0, 1), cu));
    }
    if (foam) {
      const fo = smoothstep(f1(foam.start ?? FOAM.start), f1(foam.end ?? FOAM.end), float(wave).div(waveMax)).mul(f1(foam.opacity ?? FOAM.opacity));
      c = mix(c, c3(foam.color ?? FOAM.color), fo); a = mix(a, 1, fo);
    }
    return vec4(c, a);
  });
}

/** The `fresnel` patch's blend: color mixed toward `towards` by pow(1 - |viewDir . normal|, 3) * strength (view space; viewDir's sign does not matter) */
export const waterFresnel = Fn(/** @param {[N<'vec3'>, N<'vec3'>, N<'vec3'>, N<'float'>, N<'vec3'>]} a */ ([col, normal, viewDir, strength, towards]) =>
  mix(col, towards, clamp(pow(float(1).sub(abs(dot(viewDir, normal))), FRESNEL_POWER).mul(strength), 0, 1)));
