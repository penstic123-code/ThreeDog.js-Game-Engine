// Sky fog (helper of Sky.js): style.sky.fog / sky({ fog }) picks the fog model and color; the sky drives it every frame.
//   kind 'linear' (default, three.js Fog: near = 0.3 x far) | 'exp' | 'exp2' (three.js FogExp2) | 'height' (thick low, thin high)
//   color 'horizon' (default: the dome's horizon color, so distant ground melts into the sky) | a color | (sky) => color
//   density  per meter for exp / exp2 / height (default: derived from engine.fogFar, so the fog reaches the same distance as linear)
//   height / falloff  'height' only: the fog's floor (world y) and how fast it thins above it (per meter)
//   glsl     replace the fog math in every material: `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returns
//            (fog rgb, amount 0..1). In scope: fogColor, cameraPosition, fogNear / fogFar (linear) or fogDensity (the other kinds),
//            THREEDOG_FOG_HEIGHT / THREEDOG_FOG_FALLOFF. No custom uniforms: three copies fog uniforms into each material when it
//            compiles, so a live value would need every material patched; write constants in the GLSL instead.
// How: 'linear' / 'exp2' without glsl are three's own fog, untouched (the default draws exactly what it always drew). 'exp', 'height'
// and glsl replace three's fog_* shader chunks (ShaderChunk is shared by every material, including other packages' and the game's own),
// once at install: three caches programs by material settings, not by source, so the chunks cannot change mid-play; density and color
// stay live. The replacement keeps three's code for materials that compile under the other fog object. The chunks are shared by the
// page, so two engines may use the same custom setting (reference counted) but a different one throws; the originals return when the
// last engine using them is disposed.
// sky({ fog: true | 'manual' | false }) (look.js) says who owns scene.fog: the sky (default), the game (the sky never writes it), or nobody (null).
import * as THREE from 'three';
import { checkOptions, closest } from '../../core/validate.js';

const KINDS = ['linear', 'exp', 'exp2', 'height'];
const KEYS = ['kind', 'color', 'density', 'height', 'falloff', 'glsl'];
const NAMES = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'];
const ORIGINAL = Object.fromEntries(NAMES.map(n => [n, THREE.ShaderChunk[n]]));
// fog amount reached at the far distance with the derived density: exp(-3.9) = 2% (exp, height), exp(-1.98^2) = 2% (exp2)
const REACH = { exp: 3.9, exp2: 1.98, height: 3.9 };
const flt = v => Number.isInteger(v) ? v.toFixed(1) : String(v);

const FN = {
  exp: 'vec4 threedogFog(vec3 color, float depth, vec3 worldPos){ return vec4(color, 1.0 - exp(-fogDensity * depth)); }',
  // density decays as exp(-falloff * (y - floor)); this is its integral along the view ray. Heights are clamped at the floor (full
  // density below it), which also keeps the exponentials finite for any camera height
  height: `vec4 threedogFog(vec3 color, float depth, vec3 worldPos){
  float b = THREEDOG_FOG_FALLOFF, hc = max(cameraPosition.y - THREEDOG_FOG_HEIGHT, 0.0), hp = max(worldPos.y - THREEDOG_FOG_HEIGHT, 0.0);
  float dist = length(worldPos - cameraPosition), dh = hp - hc;
  float k = abs(dh * b) < 1e-4 ? exp(-b * hc) : (exp(-b * hc) - exp(-b * hp)) / (b * dh);
  return vec4(color, 1.0 - exp(-fogDensity * dist * k));
}`,
};

/** Check style.sky.fog (+ sky({ fog }) on top) and return the resolved settings; throws with the fix on a bad kind or glsl */
export function resolveFog(spec) {
  const s = spec || {};
  checkOptions('style.sky.fog', s, KEYS);
  const kind = s.kind ?? 'linear';
  if (!KINDS.includes(kind)) throw new Error(`style.sky.fog.kind '${kind}' is not a fog kind; use ${KINDS.map(k => `'${k}'`).join(' | ')}` + (closest(kind, KINDS) ? ` (did you mean '${closest(kind, KINDS)}'?)` : ''));
  if (s.glsl != null && (typeof s.glsl !== 'string' || !/vec4\s+threedogFog\s*\(/.test(s.glsl)))
    throw new Error('style.sky.fog.glsl must be GLSL that defines `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returning (fog rgb, amount 0..1); see modules/sky/fog.js');
  const color = s.color ?? 'horizon';
  return { kind, color: color === 'horizon' || typeof color === 'function' ? color : new THREE.Color(color), density: s.density ?? null,
    height: s.height ?? 0, falloff: s.falloff ?? 0.05, glsl: s.glsl ?? FN[kind] ?? null };
}

/** The fog object for the kind: density-based kinds use FogExp2 (its fogDensity uniform is live), linear uses Fog */
export function makeFog(f, far) {
  return f.kind === 'linear' ? new THREE.Fog(0xcccccc, far * 0.3, far) : new THREE.FogExp2(0xcccccc, REACH[f.kind] / far);
}

// The chunks are one global per page, so only one custom fog setting can own them at a time. Engines with the same setting share
// them (count); a different setting throws; the originals come back when the last owner is disposed. Plain linear / exp2 never claim.
let held = null;   // { key, count }

/** Install the fog chunks for f (a plain linear / exp2 touches nothing); returns the function that releases them (restores at the last owner) */
export function applyFogChunks(f) {
  const C = THREE.ShaderChunk;
  if (!f?.glsl) return () => {};
  // everything the chunks bake in: kind picks the branch, height / falloff are constants, glsl is the math
  const key = JSON.stringify([f.kind, f.height, f.falloff, f.glsl]);
  if (held && held.key !== key)
    throw new Error(`sky fog: another engine on this page already installed a different custom fog (kind '${held.kind}'); three.js shares the fog shader chunks across the page, so only one custom fog setting can exist at a time. `
      + `Use the same style.sky.fog (kind, height, falloff, glsl) in both engines, give only one engine a custom fog (the other keeps 'linear' / 'exp2'), or dispose the first engine before creating this one.`);
  if (held) { held.count++; return release(held); }
  held = { key, kind: f.kind, count: 1 };
  // the material compiles under FOG_EXP2 when the fog object is FogExp2, so that branch holds the replacement for density kinds;
  // a custom glsl for 'linear' takes the other branch
  const dense = f.kind !== 'linear', own = `vec4 threedogFogOut = threedogFog(fogColor, vFogDepth, vFogWorld);
	gl_FragColor.rgb = mix(gl_FragColor.rgb, threedogFogOut.rgb, clamp(threedogFogOut.a, 0.0, 1.0));`;
  const orig = ORIGINAL.fog_fragment.replace('#ifdef USE_FOG', '').replace(/#endif\s*$/, '');
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorld;\n#endif\n';
  // world position from the view-space one: the view matrix is a pure rotation + translation, so its transpose undoes the rotation
  // (cheaper than another matrix and right for instanced and skinned meshes too, which mvPosition already includes)
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorld = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz + cameraPosition;\n#endif\n';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	const float THREEDOG_FOG_HEIGHT = ${flt(f.height)};
	const float THREEDOG_FOG_FALLOFF = ${flt(f.falloff)};
	#ifdef FOG_EXP2
		uniform float fogDensity;
		${dense ? f.glsl : ''}
	#else
		uniform float fogNear;
		uniform float fogFar;
		${dense ? '' : f.glsl}
	#endif
#endif
`;
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		${dense ? own : orig}
	#else
		${dense ? orig : own}
	#endif
#endif
`;
  return release(held);
}

// One release per owner; the originals return only when the count reaches 0
function release(h) {
  let done = false;
  return () => {
    if (done) return; done = true;
    if (--h.count > 0) return;
    for (const n of NAMES) THREE.ShaderChunk[n] = ORIGINAL[n];
    if (held === h) held = null;
  };
}
/** Per frame: fog color and distance / density from the sky's horizon and the modifier layers (fog multiplies the distance) */
export function updateFog(sky, horizon, M) {
  // only when the sky drives fog (sky({ fog: true })) and scene.fog is still a fog object: the game may have nulled or replaced it
  const fog = sky.engine.scene.fog, f = sky._fog, far = sky.engine.fogFar * M.fog;
  if (sky._drive.fog !== true || !fog?.color) return;
  if (f.color === 'horizon') fog.color.copy(horizon);
  else if (typeof f.color === 'function') fog.color.set(f.color(sky));
  else fog.color.copy(f.color);
  // near / far are written for every kind: engine.setFogFar and the dev guard read them
  fog.far = far; fog.near = far * 0.3;
  if (f.kind !== 'linear') fog.density = f.density != null ? f.density / M.fog : REACH[f.kind] / far;
}

/** Dome addition when the fog color is not the horizon: the dome's lower band fades to the fog color so the horizon line does not show */
export function domeFog(f) {
  if (f.color === 'horizon') return { decl: '', body: '' };
  return { decl: 'uniform vec3 uFogColor;', body: '\n  col = mix(col, uFogColor, 1.0 - smoothstep(-0.02, 0.15, d.y));' };
}
