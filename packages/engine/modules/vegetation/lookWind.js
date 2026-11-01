// look.wind: how plants sway. Registered by the vegetation module (it is the one that adds wind patches to its species' materials).
//   set({ frequency, amplitude })   uniforms: live on every wind patch (trees already planted too)
//   patch('sway', glsl)             a threedogWind function (style.wind.glsl is the style layer); read when a species is ADDED, so patch before vegetation.add
// No replace: the sway patch already is the whole motion; weather's gusts (uWind) still scale it.
import { defineLookPart } from '../../core/look/part.js';
import { codedError } from '../../core/errorHints.js';
import { windCustom } from '../../render/materials.js';

const asObj = v => (typeof v === 'string' ? { glsl: v } : v);
/** The custom sway { glsl, uniforms } to give a new wind patch, or null for the built-in sway */
export function swayOf(e) { const v = e.look?.wind?.value('hook:sway'); return v ? asObj(v) : null; }

/** @param {any} e */
export function defineWindLook(e) {
  if (e.look?.wind) return;
  const u = e.uniforms, w = e.style.wind ?? {};
  const part = defineLookPart(e, {
    id: 'wind', group: 'motion', module: 'vegetation', object: () => u, docs: ['recipes/52-look.md'],
    params: {
      frequency: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'sway speed multiplier (style.wind.frequency)' },
      amplitude: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: "multiplies every species' wind amplitude; 0 = plants stand still" },
    },
    style: () => ({ frequency: w.frequency, ...(w.glsl ? { 'hook:sway': { glsl: w.glsl, uniforms: w.uniforms } } : {}) }),
    read: () => ({ frequency: u.uWindFreq.value, amplitude: u.uWindAmp.value }),
    apply(v, changed) {
      if (changed.has('frequency')) u.uWindFreq.value = v.frequency;
      if (changed.has('amplitude')) u.uWindAmp.value = v.amplitude;
    },
    hooks: { sway: { signature: 'void threedogWind(inout vec3 transformed, vec3 ip, vec3 position)', scope: ['vertex'], example: 'engine.look.wind.patch("sway", glsl)  // or { glsl, uniforms }' } },
    noReplace: 'the sway patch already is the whole motion; patch("sway", glsl) rewrites it, set({ amplitude: 0 }) stops it',
  });
  const patch = part.patch.bind(part);
  part.patch = (name, glsl, o) => {   // a wrong sway function throws here, not later inside vegetation.add
    if (glsl != null) { try { windCustom(asObj(glsl)); } catch (err) { throw codedError('look-param', `look.wind.patch('${name}'): ${err.message}`); } }
    return patch(name, glsl, o);
  };
}
