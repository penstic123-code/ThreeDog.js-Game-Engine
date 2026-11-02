// Sky fog (helper of Sky.js): style.sky.fog / sky({ fog }) picks the fog model and color; the sky drives it every frame.
//   kind 'linear' (default, three.js Fog: near = 0.3 x far) | 'exp' | 'exp2' (three.js FogExp2) | 'height' (thick low, thin high)
//   color 'horizon' (default: the dome's horizon color, so distant ground melts into the sky) | a color | ({ time, weather, season, state, sky }) => color
//   color / near / far / density each also take such a function, evaluated every frame (core/look/state.js)
//   density  per meter for exp / exp2 / height (default: derived from engine.fogFar, so the fog reaches the same distance as linear)
//   height / falloff  'height' only: the fog's floor (world y) and how fast it thins above it (per meter)
// Your own fog math is the look hook, never a style key: engine.look.fog.patch('fog', glsl) with
//   `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returning (fog rgb, amount 0..1). In scope: fogColor, cameraPosition, fogNear / fogFar
//   (linear) or fogDensity (the other kinds), THREEDOG_FOG_HEIGHT / THREEDOG_FOG_FALLOFF. No custom uniforms: write constants in the GLSL.
// How: 'linear' / 'exp2' without a hook are three's own fog, untouched (the default draws exactly what it always drew). 'exp', 'height' and the
// hook are one named shader patch, 'fog', on the semantic slots fogPars / fog (render/slots.js), put on each material in this engine's scene
// (fogMaterials below). Why per material and not THREE.ShaderChunk.fog_*: the chunks are one object per page, so a rewrite reached every
// engine and every package, and two engines with different fog could not share a page (it used to throw). A patch lives on the material, its
// cacheKey follows the code, so two engines with different fog both draw right; changing the fog later recompiles the patched materials.
// Like the cascades' csm patch (cascades.js), this reaches the game's own built-in materials too: three's fog under a FogExp2 object would draw
// exp2 instead of the asked kind, a wrong picture, not a neutral one. describe().owned row 'fog.patch' lists the game materials it went on.
// A ShaderMaterial (fog: true) is the game's own code and keeps three's fog; so do Sprite materials (no world position varying there).
// Who writes scene.fog: sky({ fog: true | false }) (look.js) and look.fog.manual() / replace() (lookFog.js), one owned record (frame.js).
import * as THREE from 'three';
import { closest } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { live } from '../../core/look/state.js';
import { patchMaterial, unpatchMaterial, isEngineMade } from '../../render/patches.js';
import { hashText } from '../../render/effects.js';
import { sceneVisitor } from '../../core/sceneDelta.js';
import { codedError } from '../../core/errorHints.js';

/** A start distance for the fog object: a function far is evaluated per frame (updateFog), so the object starts at engine.fogFar */
export const startFar = (f, fogFar) => (typeof f.far === 'number' ? f.far : fogFar);

const KINDS = ['linear', 'exp', 'exp2', 'height'];
export const FOG_KINDS = KINDS;
// Linear fog starts at this fraction of far when look.fog near is not set. One constant, shown in look.fog's catalog (lookFog.js why / off),
// so the start distance is a visible engine choice instead of a number buried in two places (review 2026-11-03)
export const FOG_NEAR = 0.3;
// no 'glsl': custom fog math is look.fog.patch('fog', glsl) only (one injection entry), so style.sky.fog.glsl throws as an unknown key
const KEYS = ['kind', 'color', 'density', 'height', 'falloff', 'near', 'far', 'enabled'];   // near / far / enabled: look.fog (lookFog.js)
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
export const FOG_SIGNATURE = /vec4\s+threedogFog\s*\(/;

/**
 * Check style.sky.fog (+ sky({ fog }) on top) and return the resolved settings; throws with the fix on a bad kind.
 * @param {object} spec the settings @param {string} [hook] look.fog's 'hook:fog' GLSL (lookFog.js validated it)
 */
export function resolveFog(spec, hook) {
  const s = spec || {};
  if (s.glsl != null) throw codedError('sky-option', "style.sky.fog.glsl is not an option; your own fog math goes through the look hook: engine.look.fog.patch('fog', glsl) with `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)`");
  readParams('style.sky.fog', keysSchema(KEYS), s);
  const kind = s.kind ?? 'linear';
  if (!KINDS.includes(kind)) throw codedError('sky-option', `style.sky.fog.kind '${kind}' is not a fog kind; use ${KINDS.map(k => `'${k}'`).join(' | ')}` + (closest(kind, KINDS) ? ` (did you mean '${closest(kind, KINDS)}'?)` : ''));
  const color = s.color ?? 'horizon';
  return { kind, color: color === 'horizon' || typeof color === 'function' ? color : new THREE.Color(color), density: s.density ?? null,
    height: s.height ?? 0, falloff: s.falloff ?? 0.05, glsl: hook ?? FN[kind] ?? null, near: s.near ?? null, far: s.far ?? null, enabled: s.enabled !== false };
}

/** The fog object for the kind: density-based kinds use FogExp2 (its fogDensity uniform is live), linear uses Fog */
export function makeFog(f, far) {
  return f.kind === 'linear' ? new THREE.Fog(0xcccccc, far * FOG_NEAR, far) : new THREE.FogExp2(0xcccccc, REACH[f.kind] / far);
}

/**
 * The 'fog' patch for resolved settings, or null when three's own fog draws it (plain linear / exp2).
 * The material compiles under FOG_EXP2 when the fog object is FogExp2, so that branch holds the replacement for the density kinds; a hook on
 * 'linear' takes the other branch. The other branch keeps three's own code, so a game that swaps in the other fog object still gets fog.
 */
export function fogPatch(f) {
  if (!f?.glsl) return null;
  const dense = f.kind !== 'linear', mine = dense ? '#ifdef FOG_EXP2' : '#ifndef FOG_EXP2';
  // three's fog_fragment body without its #ifdef USE_FOG wrapper (read now: nothing in the engine rewrites the chunk any more)
  const orig = THREE.ShaderChunk.fog_fragment.replace('#ifdef USE_FOG', '').replace(/#endif\s*$/, '');
  const pars = `#ifdef USE_FOG
const float THREEDOG_FOG_HEIGHT = ${flt(f.height)};
const float THREEDOG_FOG_FALLOFF = ${flt(f.falloff)};
${mine}
${f.glsl}
#endif
#endif`;
  // vFogDepth is three's own varying (fog_vertex); the world position comes from the engine's 'world' patch (vThreedogWorld)
  const body = `#ifdef USE_FOG
${mine}
  vec4 threedogFogOut = threedogFog(fogColor, vFogDepth, vThreedogWorld);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, threedogFogOut.rgb, clamp(threedogFogOut.a, 0.0, 1.0));
#else
${orig}
#endif
#endif`;
  return { name: 'fog', cacheKey: hashText(pars + body), needs: { patches: ['world'] }, glsl: { fogPars: pars, fog: body } };
}

// Built-in material types whose shaders have the world varying's anchor and three's fog chunks (Sprite does not: it builds mvPosition by hand)
const FOGGED = new Set(['MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial',
  'MeshToonMaterial', 'MeshMatcapMaterial', 'LineBasicMaterial', 'LineDashedMaterial', 'PointsMaterial']);

/**
 * Point the fog patch at new settings: unchanged code does nothing, new code re-patches every material it went on (they recompile once),
 * null takes it off them. The next fogMaterials walk reaches materials it has not seen.
 * @param {any} sky @param {any} f resolved settings, or null (no fog: sky({ fog: false }), module disposed)
 */
export function setFogPatch(sky, f) {
  const w = sky._fogWalk ??= { patch: null, mats: new Map(), view: null };
  const p = f ? fogPatch(f) : null;
  if ((p?.cacheKey ?? null) === (w.patch?.cacheKey ?? null)) return;
  w.patch = p;
  for (const m of w.mats.keys()) unpatchMaterial(m, 'fog');
  w.mats.clear();
  // new code: every material in the scene again (rescan); no patch: stop watching the scene
  if (!p) { w.view?.remove(); w.view = null; return; }
  const fit = m => {
    if (!m || w.mats.get(m) === w.patch || !FOGGED.has(m.type) || m.fog === false) return;
    patchMaterial(m, [w.patch], { strict: false }); w.mats.set(m, w.patch);
  };
  if (w.view) w.view.rescan();
  else w.view = sceneVisitor(sky.engine.scene, { enter(o) { const ms = o.material; if (Array.isArray(ms)) for (const m of ms) fit(m); else fit(ms); } });
}

/** Per frame (updateSky): put the fog patch on fogged materials of objects that entered the scene since the last frame (core/sceneDelta.js) */
export function fogMaterials(sky) {
  sky._fogWalk?.view?.sync();
}

/** describe().owned row 'fog.patch': the game's own materials the fog patch went on (undefined while none) */
export function fogGameMaterials(sky) {
  const g = [...(sky._fogWalk?.mats.keys() ?? [])].filter(m => !isEngineMade(m)).map(m => m.name || m.type);
  return g.length ? { part: 'fog', key: 'patch', writer: 'engine', materials: g, why: "kind 'exp' / 'height' / look.fog hook: three's fog would draw another curve" } : undefined;
}

/** The far distance a disabled fog is pushed to (out of reach, no recompile); fogBand reads it back to know the fog is off */
const FOG_OFF_FAR = 1e9;

/** Per frame: fog color and distance / density from the sky's horizon and the modifier layers (fog multiplies the distance) */
export function updateFog(sky, horizon, M, ctx) {
  // only when the sky drives fog (sky({ fog: true })) and scene.fog is still a fog object: the game may have nulled or replaced it
  const fog = sky.engine.scene.fog, f = sky._fog;
  if (!sky._oFog?.on || !fog?.color) return;   // off also after look.fog.replace(fog): replace puts the owned entry in manual mode (lookFog.js)
  // look.fog: far / near set explicitly are the base distance (weather still scales it); enabled false pushes the fog out of reach without a recompile
  const far = f.enabled ? (live(f.far, ctx) ?? sky.engine.fogFar) * M.fog : FOG_OFF_FAR, near = live(f.near, ctx), density = live(f.density, ctx);
  // a function color may answer 'horizon' too (({ state }) => state.boss ? '#400' : 'horizon'), so the default stays one word away
  const color = live(f.color, ctx);
  if (color === 'horizon') fog.color.copy(horizon);
  else fog.color.set(color);
  // near / far are written for every kind: engine.setFogFar and the dev guard read them
  fog.far = far; fog.near = f.enabled && near != null ? near * M.fog : far * FOG_NEAR;
  if (f.kind !== 'linear') fog.density = !f.enabled ? 0 : density != null ? density / M.fog : REACH[f.kind] / far;
}

// The dome's fog band: its lower band fades to the fog color so the line where fogged ground meets the sky does not show.
// Always compiled in and switched by the uFogBand uniform (0 = off, mix(col, x, 0.0) is col exactly), so any fog color change at
// runtime -- 'horizon' <-> a fixed color <-> a function, look.fog.set, a game writing scene.fog.color under manual() -- needs no recompile.
export const DOME_FOG = { decl: 'uniform vec3 uFogColor; uniform float uFogBand;', body: '\n  col = mix(col, uFogColor, uFogBand * (1.0 - smoothstep(-0.02, 0.15, d.y)));' };
/** Per frame, after updateFog: the band is on exactly when the fog's color is not the horizon the dome draws. One rule for every mode
 * (sky-driven, manual, replaced fog), because it reads the fog object itself rather than the sky's settings; 'horizon' copies the color
 * exactly, so the default stays bit-for-bit the plain dome. No fog object (fog: false) = nothing to hide = off; a fog that is there but draws
 * nothing (look.fog enabled: false pushes far out of reach, or an exp2 density of 0) = also off, or the dome would show a band no ground has. */
// !(far >= off): a game's own FogExp2 has no far at all and still shows
const fogShows = fog => !(fog.far >= FOG_OFF_FAR) && !(fog.isFogExp2 && fog.density <= 0);
export const fogBand = (fog, horizon) => (fog?.color && fogShows(fog) && !fog.color.equals(horizon) ? 1 : 0);
