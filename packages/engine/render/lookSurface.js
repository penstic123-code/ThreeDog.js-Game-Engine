// look.materials and look.surface (render/materials.js reads them when it makes a material).
// Why a file of its own: materials.js is near the size cap, and the two parts share one rule: a verb changes what makeMaterial does NEXT time
// (a Material already handed out is not touched, catalog / describe say appliesTo; rebuilding made materials from the spec costs a recompile each, so it is not done).
// Exception: plain numeric / color properties (LIVE_KEYS below) are written to the already-made materials of that role at once; they need no recompile.
//   look.materials  set({ wool: { roughness: 0.4 } })       merge into the role's spec (style.materials[role] stays below as the style layer)
//                   patch(name, shaderPatch, { roles })      add a named ShaderPatch (render/patches.js) to materials made for those roles
//                   replace(role, Material | fn)             a role is this Material (cloned) / this (params, purpose, engine) => Material
//   look.surface    set({ lighting: { wrap, shadowTint, rim }, detail: {...}, ramp: [...], soften })   defaults for every spec-made material
//                   patch('lighting' | 'detail', glsl)       the shared threedogLighting / threedogDetailSample function
import { defineLookPart } from '../core/look/part.js';
import * as THREE from 'three';
import { codedError } from '../core/errorHints.js';
import { isPlainObject as isPlain } from '../core/util.js';
import { rampTexture } from './lighting.js';

const asGlsl = v => (typeof v === 'string' ? { glsl: v } : v);   // a hook value is a GLSL string or { glsl, uniforms }

/** A material spec key makeMaterial understands: its own keys (materials.js SPEC_KEYS + type) or a property of one of the three.js types it makes */
const probes = [];   // one probe Material per three.js type, made on first use; page-wide on purpose (they are never rendered)
function knownSpecKey(k) {
  if (['type', 'steps', 'ramp', 'soften', 'repeat', 'wrap', 'detail', 'lighting'].includes(k)) return true;
  if (!probes.length) probes.push(...[THREE.MeshPhysicalMaterial, THREE.MeshLambertMaterial, THREE.MeshPhongMaterial, THREE.MeshToonMaterial, THREE.MeshBasicMaterial].map(C => new C()));
  return probes.some(m => k in m);
}
/** Plain material properties that change at once on materials already made for the role (no shader change, so no recompile); every other key is for new materials only */
export const LIVE_KEYS = ['color', 'emissive', 'emissiveIntensity', 'roughness', 'metalness', 'opacity', 'envMapIntensity', 'shininess', 'specular'];
const COLOR_KEYS = new Set(['color', 'emissive', 'specular']);
/** Every Material made per role, per engine, as weak refs (a disposed material that nobody holds drops out) */
const LIVE = new WeakMap();
const liveOf = e => LIVE.get(e) ?? LIVE.set(e, new Map()).get(e);
/** The last Material made per role, per engine (look.materials.object(role)); kept here so materials.js never touches the part's fields */
const MADE = new WeakMap();
const madeOf = e => MADE.get(e) ?? MADE.set(e, new Map()).get(e);

/** Materials: role names are open, so the part grows `<role>.<specKey>` params as the style or a game mentions them */
export function defineMaterialsLook(e, purposes) {
  const M = e.style.materials ?? {};
  const params = {}, style = {};
  const grow = (into, key) => { into[key] = { type: 'any', default: null, neutral: true, desc: 'a spec key of this role (type, color, roughness, steps, ramp, detail, lighting ...); null = not overridden' }; };
  for (const [role, spec] of Object.entries(M)) if (isPlain(spec)) for (const [k, v] of Object.entries(spec)) { grow(params, `${role}.${k}`); style[`${role}.${k}`] = v; }
  const made = madeOf(e);
  const part = defineLookPart(e, {
    id: 'materials', group: 'surface', module: 'core', docs: ['recipes/52-look.md'], params, style: () => style, appliesTo: `materials made after the change, except the live keys (${LIVE_KEYS.join(', ')}), which also change the materials already made for that role; type, steps, ramp, soften, repeat, wrap, detail, lighting, patch and replace are for new materials only`,
    applyAtStart: false,
    apply(v, changed) {   // live keys: write them to the already-made materials of the role (a cleared key goes back to the style value, or stays when the style gave none)
      for (const k of changed) {
        const i = k.indexOf('.'), role = k.slice(0, i), prop = k.slice(i + 1);
        if (i < 0 || !LIVE_KEYS.includes(prop)) continue;
        const val = v[k] ?? style[k];
        if (val == null) continue;
        for (const ref of liveOf(e).get(role) ?? []) {
          const m = ref.deref();
          if (!m) { liveOf(e).get(role).delete(ref); continue; }
          if (!(prop in m)) continue;
          if (COLOR_KEYS.has(prop)) m[prop].set(val); else m[prop] = val;
        }
      }
    },
    // a function, not a map: look.materials.object('wool') is the last Material made for that role, object() all of them
    object: () => role => (role === undefined ? Object.fromEntries(made) : made.get(role)),
    // set({ wool: { roughnes: 1 } }) used to add the typo as a new key; now a role key must be one makeMaterial reads (review M7).
    // normalize runs for set() and engine.debug.override alike, before the values are checked
    normalize(p) {
      const grown = {};
      for (const [role, spec] of Object.entries(p)) if (isPlain(spec)) for (const k of Object.keys(spec)) if (!part.has(`${role}.${k}`)) {
        if (!knownSpecKey(k)) throw codedError('look-param', `look.materials.set(): ${role}.${k} is not a material spec key (type, color, roughness, steps, ramp, detail, lighting or a three.js material property)`);
        grow(grown, `${role}.${k}`);
      }
      if (Object.keys(grown).length) part.extend(grown);
      return p;
    },
    hooks: { '<name>': { signature: 'a ShaderPatch { name, glsl, uniforms, needs } (render/patches.js); patch(name, spec, { roles: ["wool"] }) adds it to materials made for those roles (none = all)', scope: ['fragment', 'vertex'] } },
    replace: { accepts: "replace('wool', Material | (params, purpose, engine) => Material); replace('wool', null) gives the role back to the style", loses: ['the role spec: type, steps, ramp, detail, lighting ... and look.materials.set keys for that role'] },
    verbs: {
      patch: { signature: 'patch(name, shaderPatch | null, { roles, owner })',
        take(bad, name, spec, { roles, owner } = {}) {
          if (typeof name !== 'string' || !name) bad("name is the patch's name, e.g. patch('snap', { glsl: {...} }, { roles: ['wool'] })");
          if (spec != null && !isPlain(spec)) bad(`the patch is a ShaderPatch object { glsl: { vertex|fragment: {...} }, uniforms, needs } (render/patches.js); got ${typeof spec}`);
          return [{ [`hook:${name}`]: spec == null ? null : { patch: { name, ...spec }, roles: roles ?? null } }, owner];
        } },
      replace: { signature: 'replace(role, Material | (params, purpose, engine) => Material | null, { owner })',
        take(bad, role, impl, { owner } = {}) {
          if (typeof role !== 'string') bad("the first argument is the role name, e.g. replace('wool', new THREE.MeshMatcapMaterial(...))");
          if (impl != null && !impl.isMaterial && typeof impl !== 'function') bad(`give a three.js Material or a function (params, purpose, engine) => Material; got ${typeof impl}`);
          return [{ [`replace:${role}`]: impl ?? null }, owner];
        } },
    },
  });
  return part;
}

/** What the games and debug layers changed for a role: { key: value } to lay over the role's spec (makeMaterial) */
export function materialOverrides(eng, role) {
  const p = eng?.look?.materials, out = {};
  if (!p) return out;
  for (const [k] of p.resolved(role + '.')) { const v = p.top(k); if (v != null) out[k.slice(role.length + 1)] = v; }
  return out;
}
/** replace(role, ...) from a game / debug layer, else undefined */
export const materialReplace = (eng, role) => eng?.look?.materials?.top(`replace:${role}`) ?? undefined;
/** Patches added with look.materials.patch for this role */
export function materialPatches(eng, role) {
  const p = eng?.look?.materials, out = [];
  if (p) for (const [, v] of p.resolved('hook:')) if (v && (!v.roles || v.roles.includes(role))) out.push(v.patch);
  return out;
}
/** Remember the last Material made for a role (look.materials.object(role)) */
export function materialMade(eng, role, m) {
  if (!eng) return;
  madeOf(eng).set(role, m);
  (liveOf(eng).get(role) ?? liveOf(eng).set(role, new Set()).get(role)).add(new WeakRef(m));
}

const needColor = name => v => (isPlain(v) && v.color !== undefined ? null : `needs a color, e.g. { color: '#334', strength: 0.5 } (${name})`);
/** Surface: the pack-wide lighting / detail / toon ramp every spec-made material starts from */
export function defineSurfaceLook(e) {
  const L = e.style.lighting ?? {};
  const keep = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
  const num = v => (typeof v === 'number' ? null : 'must be a number');
  defineLookPart(e, {
    id: 'surface', appliesTo: 'materials made after the change', group: 'surface', module: 'core', docs: ['recipes/52-look.md'],
    params: {
      'lighting.wrap': { type: 'any', default: null, neutral: true, check: num, desc: 'half-lambert wrap 0-1: how far light bends past the terminator (softer shade edge); null = off' },
      'lighting.shadowTint': { type: 'any', default: null, neutral: true, check: needColor('shadowTint'), desc: '{ color, strength?, soft? } hue of the shaded side; null = off' },
      'lighting.rim': { type: 'any', default: null, neutral: true, check: needColor('rim'), desc: '{ color, strength?, power?, shadowSide? } edge light; null = off' },
      detail: { type: 'any', default: null, neutral: true, check: v => (isPlain(v) ? null : 'must be a detail object, e.g. { noise: "grain", strength: 0.2 } (render/detail.js)'), desc: 'detail layer added to every spec-made material (a spec\'s own detail wins; detail: false in a spec opts out); null = none' },
      ramp: { type: 'any', default: null, neutral: true, check: v => { try { rampTexture(v); return null; } catch (err) { return err.message; } }, desc: 'toon ramp for every toon material, grays or colors dark to light; null = each spec\'s own steps / ramp' },
      soften: { type: 'any', default: null, neutral: true, check: num, desc: 'how much the toon bands melt into each other 0-1; used with ramp' },
    },
    style: () => keep({ 'lighting.wrap': L.wrap, 'lighting.shadowTint': L.shadowTint, 'lighting.rim': L.rim, 'hook:lighting': L.glsl ? { glsl: L.glsl, uniforms: L.uniforms } : null }),
    hooks: {
      lighting: { signature: 'void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo)', scope: ['fragment'], example: 'engine.look.surface.patch("lighting", glslString)' },
      detail: { signature: 'vec4 threedogDetailSample(vec2 p)  // rgb + height 0-1', scope: ['fragment'], example: 'engine.look.surface.patch("detail", glslString)' },
    },
    noReplace: 'to swap a whole material, use engine.look.materials.replace(role, ...)',
  });
}

/** The pack-wide lighting options for makeMaterial: style.lighting under any look.surface change (undefined without the part) */
export function surfaceLighting(eng) {
  const p = eng?.look?.surface;
  if (!p) return eng?.style?.lighting;
  const o = keep3({ wrap: p.value('lighting.wrap'), shadowTint: p.value('lighting.shadowTint'), rim: p.value('lighting.rim'), ...asGlsl(p.value('hook:lighting')) });
  return Object.keys(o).length ? o : undefined;
}
/** The pack-wide detail options (with the detail hook's glsl), or undefined */
export function surfaceDetail(eng) {
  const p = eng?.look?.surface, d = p?.value('detail');
  return d ? { ...asGlsl(p.value('hook:detail')), ...d } : undefined;
}
/** The pack-wide toon ramp { ramp, soften }, or undefined */
export function surfaceRamp(eng) {
  const p = eng?.look?.surface, r = p?.value('ramp');
  return r ? { ramp: r, soften: p.value('soften') ?? 0 } : undefined;
}
function keep3(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)); }
/** The ground's detail options: look.ground (style.terrain.detail under any change, plus its detail glsl hook), or style.terrain.detail without the part */
export function groundDetail(eng) {
  const p = eng?.look?.ground, d = p ? p.value('detail') : eng?.style?.terrain?.detail;
  return d ? { ...asGlsl(p?.value('hook:detail')), ...d } : undefined;
}
