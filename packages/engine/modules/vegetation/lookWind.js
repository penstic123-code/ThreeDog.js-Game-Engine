// look.wind: how plants sway. Registered by the vegetation look module (it is the one that adds wind patches to its species' materials).
//   set({ frequency, amplitude })   uniforms: live on every wind patch (trees already planted too)
//   patch('sway', glsl | { glsl, tsl, uniforms })   a threedogWind function (tsl: the WebGPURenderer form, (ctx) => moved position);
//                                              read when a species is ADDED, so patch before vegetation.define.
//                                              The only way in: style.wind.glsl / .uniforms throw (one shader injection entry per look value)
// No replace: the sway patch already is the whole motion; weather's gusts (uWind) still scale it.
// Also look.vegetation (defineVegetationLook below): the color hook on every species' material.
import { defineLookPart, hookSpec } from '../../core/look/part.js';
import { codedError } from '../../core/errorHints.js';
import { windCustom } from '../../render/materials.js';
import { patchMaterial, unpatchMaterial } from '../../render/patches.js';
import { hashText } from '../../render/effects.js';

/** The custom sway { glsl, uniforms } to give a new wind patch, or null for the built-in sway */
export function swayOf(e) { const v = e.look?.wind?.value('hook:sway'); return v ? hookSpec(v) : null; }

/** @param {any} e */
export function defineWindLook(e) {
  if (e.look?.wind) return;
  const u = e.uniforms, w = e.style.wind ?? {};
  for (const k of ['glsl', 'uniforms']) if (w[k] != null) throw codedError('look-param', `style.wind.${k} is not an option; your own sway goes through the look hook: engine.look.wind.patch('sway', { glsl, uniforms }) before vegetation.define`);
  const part = defineLookPart(e, {
    id: 'wind', group: 'motion', module: 'vegetationLook', object: () => u, docs: ['recipes/52-look.md'],
    params: {
      frequency: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'sway speed multiplier (style.wind.frequency)' },
      amplitude: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: "multiplies every species' wind amplitude; 0 = plants stand still" },
    },
    style: () => ({ frequency: w.frequency }),
    read: () => ({ frequency: u.uWindFreq.value, amplitude: u.uWindAmp.value }),
    apply(v, changed) {
      if (changed.has('frequency')) u.uWindFreq.value = v.frequency;
      if (changed.has('amplitude')) u.uWindAmp.value = v.amplitude;
    },
    hooks: { sway: { signature: 'void threedogWind(inout vec3 transformed, vec3 ip, vec3 position); tsl: (ctx) => vec3 moved object-space position', scope: ['vertex'], example: 'engine.look.wind.patch("sway", glsl)  // or { glsl, tsl, uniforms }' } },
    noReplace: 'the sway patch already is the whole motion; patch("sway", glsl) rewrites it, set({ amplitude: 0 }) stops it',
  });
  const patch = part.patch.bind(part);
  part.patch = (name, glsl, o) => {   // a wrong sway function throws here, not later inside vegetation.define
    if (glsl != null) {
      try { windCustom(hookSpec(glsl)); } catch (err) { throw codedError('look-param', `look.wind.patch('${name}'): ${err.message}`); }
      const miss = missingForm(e, hookSpec(glsl));
      if (miss) throw codedError('look-param', `look.wind.patch('${name}'): ${miss}`);
    }
    return patch(name, glsl, o);
  };
}

/** Each renderer draws its own form; the one this engine's renderer needs, when missing, is named (else the hook would do nothing silently) */
function missingForm(e, s) {
  const gpu = !!e.renderer?.isWebGPURenderer;
  if (!gpu && s.glsl == null) return 'has only a tsl form, which WebGLRenderer cannot draw: give glsl too ({ glsl, tsl })';
  if (gpu && s.tsl == null) return 'has only a glsl form, which WebGPURenderer cannot draw: give tsl too ({ glsl, tsl })';
  return null;
}

const COLOR = 'vegetationColor';   // the patch name of look.vegetation's color hook on every species' material
/** The game's look.vegetation color patch, or null @param {any} e */
export function colorPatchOf(e) {
  const v = e.look?.vegetation?.value('hook:color');
  if (!v) return null;
  const s = hookSpec(v);
  let p = PATCHES.get(s);   // one patch object per hook value: every species' material shares its program
  if (!p) PATCHES.set(s, p = { name: COLOR, slot: 'color', cacheKey: hashText(JSON.stringify([s.glsl ?? '', s.pars ?? ''])),
    ...(s.uniforms && { uniforms: s.uniforms }), ...(s.glsl != null && { glsl: s.glsl, ...(s.pars && { pars: s.pars }) }), ...(s.tsl && { tsl: s.tsl }) });
  return p;
}
const PATCHES = new WeakMap();

/**
 * look.vegetation: change part of how plants are drawn without replacing the vegetation look (that is engine.use(myPlants, { replaces: 'vegetation-look' })).
 *   patch('color', glsl | { glsl, tsl, uniforms, pars })   code in the 'color' slot of every species' material (render/slots.js): diffuseColor
 *                                                         (vertex / instance colors and the season tint applied) is yours to change; tsl:
 *                                                         (ctx) => vec4 from ctx.color. Live: species already planted change at once.
 * The sway shape is look.wind.patch('sway', { glsl, tsl }): one hook per thing, not two names for it.
 * @param {any} e @param {any} look the VegetationLook (its species materials)
 */
export function defineVegetationLook(e, look) {
  if (e.look?.vegetation) return;
  defineLookPart(e, {
    id: 'vegetation', group: 'surface', module: 'vegetationLook', object: () => look.kinds, docs: ['recipes/52-look.md'], params: {},
    hooks: { color: { signature: "'color' slot code on diffuseColor (vec4); tsl: (ctx) => vec4 from ctx.color", scope: ['diffuseColor', 'vThreedogWorld (needs world)', 'engine uniforms you list'],
      example: "engine.look.vegetation.patch('color', { glsl: 'diffuseColor.rgb *= vec3(1.1, 0.9, 0.7);', tsl: c => c.color.mul(c.tsl.vec4(1.1, 0.9, 0.7, 1)) })" } },
    validate: (k, v) => {
      if (k !== 'hook:color' || v == null) return null;
      const s = hookSpec(v);
      if (typeof s !== 'object' || (s.glsl != null && typeof s.glsl !== 'string') || (s.tsl != null && typeof s.tsl !== 'function')) return 'is GLSL code, or { glsl, tsl: (ctx) => vec4, uniforms }';
      return missingForm(e, s);
    },
    applyHook() {   // every species' material gets the new code (or loses it): the shared patch keeps one program for all of them
      const p = colorPatchOf(e);
      for (const k of look.kinds.values()) for (const m of [k.material].flat()) {
        if (!m) continue;
        if (p) patchMaterial(m, [p]); else unpatchMaterial(m, COLOR);
      }
    },
    noReplace: "the whole plant look is a module: engine.use(myPlants, { replaces: 'vegetation-look' }) keeps collision, felling and saves",
  });
}
