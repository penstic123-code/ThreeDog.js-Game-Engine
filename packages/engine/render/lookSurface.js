// look.materials and look.surface.
// render/materials.js reads them when it makes a material.
// Why a file of its own: materials.js is near the size cap, and the two parts share one rule: a verb changes what makeMaterial does NEXT time
// (a Material already handed out is not touched, catalog / describe say appliesTo; rebuilding made materials from the spec costs a recompile each, so it is
// not done on every change). Exception: plain numeric / color properties (LIVE_KEYS below) are written to the already-made materials of that role at once.
// The one explicit way to bring the made ones in line: look.materials.rebuild() (engine.plugins off / on of a material or patch plugin calls it).
//   look.materials  the ONE entry for "what material a purpose gets": the style's materials table is its style layer (specs as <role>.<key>,
//                   Material / function entries as replace:<role>), and makeMaterial reads only this part (no second read of engine.style)
//                   set({ wool: { roughness: 0.4 } })       merge into the role's spec
//                   add(name, shaderPatch, { roles })        add a named ShaderPatch (render/patches.js) to materials made for those roles
//                   replace(role, Material | fn)             a role is this Material (cloned) / this (params, purpose, engine) => Material
//   look.surface    set({ lighting: { wrap, shadowTint, rim }, detail: {...}, ramp: [...], soften })   defaults for every spec-made material
//                   patch('lighting' | 'detail', glsl)       the shared threedogLighting / threedogDetailSample function
import { defineLookPart, hookSpec } from '../core/look/part.js';
import * as THREE from 'three';
import { codedError } from '../core/errorHints.js';
import { isPlainObject as isPlain } from '../core/util.js';
import { rampTexture } from './lighting.js';
import { warnOnce } from '../core/validate.js';
import { addGlowVerb } from './lookGlow.js';
import { carryPatches } from './patches.js';


/** A material spec key makeMaterial understands: its own keys (materials.js SPEC_KEYS + type) or a property of one of the three.js types it makes */
const probes = [];   // one probe Material per three.js type, made on first use; page-wide on purpose (they are never rendered)
function knownSpecKey(k) {
  if (['type', 'steps', 'ramp', 'soften', 'repeat', 'wrap', 'detail', 'lighting'].includes(k)) return true;
  if (!probes.length) probes.push(...[THREE.MeshPhysicalMaterial, THREE.MeshLambertMaterial, THREE.MeshPhongMaterial, THREE.MeshToonMaterial, THREE.MeshBasicMaterial].map(C => new C()));
  return probes.some(m => k in m);
}
/** Plain material properties that change at once on materials already made for the role (no shader change, so no recompile); every other key is for new materials only */
const LIVE_KEYS = ['color', 'emissive', 'emissiveIntensity', 'roughness', 'metalness', 'opacity', 'envMapIntensity', 'shininess', 'specular'];
const COLOR_KEYS = new Set(['color', 'emissive', 'specular']);
/** Every Material made per role, per engine, as weak refs (a disposed material that nobody holds drops out) */
const LIVE = new WeakMap();
const liveOf = e => LIVE.get(e) ?? LIVE.set(e, new Map()).get(e);
/** The last Material made per role, per engine (look.materials.object(role)); kept here so materials.js never touches the part's fields */
const MADE = new WeakMap();
const madeOf = e => MADE.get(e) ?? MADE.set(e, new Map()).get(e);
// Live-key priority (§5.1): hand-set > passed in this makeMaterial call > look.materials.set > style.
// Why record on each material: before, live keys were written to ALL materials of the role, so a color passed by makeMaterial('wood', { color }) or later set by the game with m.color.set(),
// got overwritten on a style change or look.materials.set, and the game could not tell "why did my change not stick". Now: keys passed by the call itself are always skipped; the value the engine last wrote is remembered,
// and if it differs before the next write = the game hand-set it, so skip it and warn once (this material belongs to the game, P1 "step aside", per material rather than per role).
// rebuild() also reads: params (the call's own params, made again with them) and look (names of the look.materials patches it got, made fresh)
const REC = new WeakMap();   // material -> { call: Set(keys this makeMaterial call passed), params, look: Set(patch names), seen: Map(prop -> value the engine last left there) }
const snap = v => (v?.isColor ? v.getHex() : v);

/** Materials: role names are open, so the part grows `<role>.<specKey>` params as the style or a game mentions them */
export function defineMaterialsLook(e, purposes) {
  const M = e.style.materials ?? {};
  const params = {}, style = {};
  const grow = (into, key) => { into[key] = { type: 'any', default: null, neutral: true, desc: 'a spec key of this role (type, color, roughness, steps, ramp, detail, lighting ...); null = not overridden' }; };
  for (const [role, spec] of Object.entries(M)) {
    if (isPlain(spec)) for (const [k, v] of Object.entries(spec)) { grow(params, `${role}.${k}`); style[`${role}.${k}`] = v; }
    else if (spec?.isMaterial || typeof spec === 'function') style[`replace:${role}`] = spec;   // the same slot replace(role, ...) fills, one layer down
    else if (spec != null) throw codedError('material-option', `style.materials.${role} is a spec { type, color, ... }, a three.js Material or a function (params, purpose, engine) => Material; got ${typeof spec}`);
  }
  const made = madeOf(e);
  let glow = null;
  const part = defineLookPart(e, {
    id: 'materials', group: 'surface', module: 'core', docs: ['recipes/52-look.md'], params, style: () => style, appliesTo: `materials made after the change, except the live keys (${LIVE_KEYS.join(', ')}), which also change the materials already made for that role; type, steps, ramp, soften, repeat, wrap, detail, lighting, patch and replace are for new materials only`,
    applyAtStart: false, extraSignatures: { glow: 'glow(match, { night, day = 0, owner })', rebuild: 'rebuild() -> { rebuilt, kept, ms }' }, info: () => glow?.info() ?? {},
    apply(v, changed) {   // live keys: write them to the already-made materials of the role (a cleared key goes back to the style value, or stays when the style gave none)
      for (const k of changed) {
        const i = k.indexOf('.'), role = k.slice(0, i), prop = k.slice(i + 1);
        if (i < 0 || !LIVE_KEYS.includes(prop)) continue;
        const val = v[k] ?? style[k];
        if (val == null) continue;
        let hand = 0;
        for (const ref of liveOf(e).get(role) ?? []) {
          const m = ref.deref();
          if (!m) { liveOf(e).get(role).delete(ref); continue; }
          if (!(prop in m)) continue;
          const r = REC.get(m);
          if (r?.call.has(prop)) continue;   // this makeMaterial call gave it: the call wins over look.materials (§5.1)
          if (r && r.seen.has(prop) && r.seen.get(prop) !== snap(m[prop])) { hand++; continue; }   // set by hand since: the game's
          if (COLOR_KEYS.has(prop)) m[prop].set(val); else m[prop] = val;
          r?.seen.set(prop, snap(m[prop]));
        }
        if (hand) warnOnce(`look.materials.set({ ${role}: { ${prop} } }) skipped ${hand} '${role}' material(s) whose ${prop} you set directly (yours wins). ` +
          `To change them too, set it on them: material.${prop}${COLOR_KEYS.has(prop) ? '.set(value)' : ' = value'}`);
      }
    },
    // a function, not a map: look.materials.object('wool') is the last Material made for that role, object() all of them
    object: () => role => (role === undefined ? Object.fromEntries(made) : made.get(role)),
    // a role key must be one makeMaterial reads, so set({ wool: { roughnes: 1 } }) fails instead of adding the typo as a new key
    // normalize runs for set() and engine.debug.override alike, before the values are checked
    normalize(p) {
      const grown = {};
      for (const [role, spec] of Object.entries(p)) if (isPlain(spec)) for (const k of Object.keys(spec)) if (!part.author.has(`${role}.${k}`)) {
        if (!knownSpecKey(k)) throw codedError('look-param', `look.materials.set(): ${role}.${k} is not a material spec key (type, color, roughness, steps, ramp, detail, lighting or a three.js material property)`);
        grow(grown, `${role}.${k}`);
      }
      if (Object.keys(grown).length) part.author.extend(grown);
      return p;
    },
    // no named hook to swap: a shader patch here is one more thing next to the others, so it is add(), not patch() (docs/plans/2026-11-03-look-api.md)
    noPatch: "a material patch is added, not swapped: look.materials.add('tint', { slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }, { roles: ['wool'] }); the handle's remove() takes it out",
    replace: { accepts: "replace('wool', Material | (params, purpose, engine) => Material); replace('wool', null) gives the role back to the style (a style's own Material entry sits one layer down, in the same slot)", loses: ['the role spec: type, steps, ramp, detail, lighting ... and look.materials.set keys for that role'] },
    verbs: {
      add: { signature: 'add(name, shaderPatch, { roles, owner, layer })',
        take(bad, name, spec, { roles, owner, layer } = {}) {
          if (typeof name !== 'string' || !name) bad("name is the patch's name, e.g. add('tint', { slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }, { roles: ['wool'] })");
          if (spec == null) bad("take an added patch out with the handle add() returned: h.remove()");
          if (!isPlain(spec)) bad(`the patch is a ShaderPatch object { slot: 'color', glsl: '...', pars, uniforms, needs } (slots: render/slots.js); got ${typeof spec}`);
          return [{ [`hook:${name}`]: { patch: { name, ...spec }, roles: roles ?? null } }, owner, layer];
        } },
      replace: { signature: 'replace(role, Material | (params, purpose, engine) => Material | null, { owner, layer })',
        take(bad, role, impl, { owner, layer } = {}) {
          if (typeof role !== 'string') bad("the first argument is the role name, e.g. replace('wool', new THREE.MeshMatcapMaterial(...))");
          if (impl != null && !impl.isMaterial && typeof impl !== 'function') bad(`give a three.js Material or a function (params, purpose, engine) => Material; got ${typeof impl}`);
          return [{ [`replace:${role}`]: impl ?? null }, owner, layer];
        } },
    },
  });
  glow = addGlowVerb(e, part);   // look.materials.glow: emissive that follows daylight (render/lookGlow.js)
  /**
   * Make every material makeMaterial made that is on a mesh in the scene again from the current layers (type, replace, patches, spec) and put the
   * new one where the old one was. Why one explicit call: a patch / replace / type change reaches only materials made later, so turning a patch
   * plugin off left the made ones patched and a streamed world mixed old and new looks (review 2026-11-03). Kept: the makeMaterial call's own
   * params, live keys the game set by hand, and patches a module added after makeMaterial (wind, cloud shadow). The old material is disposed after the next frame;
   * one the scene does not hold (a pool, a game field) is left as it is and counted in kept. Cost: one scene walk plus a compile per new program.
   */
  /** @type {any} */ (part).rebuild = () => {   // a verb of this part only (typed on MaterialsLook), like glow
    const t0 = performance.now(), uses = new Map();
    e.scene.traverse(o => { if (o.material) [].concat(o.material).forEach((m, i) => (uses.get(m) ?? uses.set(m, []).get(m)).push([o, Array.isArray(o.material) ? i : -1])); });
    const todo = [...liveOf(e)].flatMap(([role, refs]) => [...refs].map(ref => [role, refs, ref]));   // a snapshot: makeMaterial below adds refs
    let rebuilt = 0, kept = 0; const old = [];
    for (const [role, refs, ref] of todo) {
      const m = ref.deref();
      if (!m) { refs.delete(ref); continue; }
      const on = uses.get(m), r = REC.get(m);
      if (!on || !r) { kept++; continue; }
      const n = e.makeMaterial(role, r.params);
      carryPatches(m, n, r.look);
      for (const [k, v] of r.seen) if (snap(m[k]) !== v && k in n) { if (COLOR_KEYS.has(k)) n[k].copy(m[k]); else n[k] = m[k]; REC.get(n)?.seen.set(k, snap(n[k])); }   // set by hand: the game's
      for (const [o, i] of on) { if (i < 0) o.material = n; else o.material[i] = n; }
      refs.delete(ref); old.push(m); rebuilt++;
    }
    // disposed after the next frame is drawn, not now: three.js frees a program when its last material goes, so disposing first made every
    // unchanged material compile its program again (open world: next frame 13 -> 99 ms); after the frame the new ones already hold it
    if (old.length) { const h = e.onRender(() => { h.remove(); for (const m of old) m.dispose(); }, { when: 'after' }); }
    return { rebuilt, kept, ms: +(performance.now() - t0).toFixed(2) };
  };
  return part;
}

/** The Material / function the role is replaced with on the top layer that says one (style table entry, plugin file, game replace), else undefined */
export const materialImpl = (eng, role) => eng?.look?.materials?.value(`replace:${role}`) ?? undefined;
/** The role's spec after all layers (style table < game set < debug): { key: value } */
export function materialSpec(eng, role) {
  const p = eng?.look?.materials, out = {};
  if (p) for (const [k, v] of p.author.resolved(role + '.')) if (v != null) out[k.slice(role.length + 1)] = v;
  return out;
}
/** Every role look.materials says something about (a spec key or a replace), for the typo check */
export function materialRoles(eng) {
  const out = new Set();
  for (const [k, v] of eng?.look?.materials?.author.resolved() ?? []) if (v != null && !k.startsWith('hook:')) out.add(k.startsWith('replace:') ? k.slice(8) : k.slice(0, k.indexOf('.')));
  return out;
}
/** Patches added with look.materials.add for this role (stored as 'hook:<name>' keys, so layers and owners work as for every key) */
export function materialPatches(eng, role) {
  const p = eng?.look?.materials, out = [];
  if (p) for (const [, v] of p.author.resolved('hook:')) if (v && (!v.roles || v.roles.includes(role))) out.push(v.patch);
  return out;
}
/** Remember the last Material made for a role (look.materials.object(role)); params: this makeMaterial call's (live keys skip them, rebuild reuses
 *  them); look: the names of the look.materials patches it got */
export function materialMade(eng, role, m, params = {}, look = []) {
  if (!eng) return;
  REC.set(m, { call: new Set(Object.keys(params)), params, look: new Set(look), seen: new Map(LIVE_KEYS.filter(k => k in m).map(k => [k, snap(m[k])])) });
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
  const o = keep3({ wrap: p.value('lighting.wrap'), shadowTint: p.value('lighting.shadowTint'), rim: p.value('lighting.rim'), ...hookSpec(p.value('hook:lighting')) });
  return Object.keys(o).length ? o : undefined;
}
/** The pack-wide detail options (with the detail hook's glsl), or undefined */
export function surfaceDetail(eng) {
  const p = eng?.look?.surface, d = p?.value('detail');
  return d ? { ...hookSpec(p.value('hook:detail')), ...d } : undefined;
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
  return d ? { ...hookSpec(p?.value('hook:detail')), ...d } : undefined;
}
