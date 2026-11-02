// look.water: the water's look as a look part (recipes/52-look.md).
//   set({ color, opacity, waveHeight, waveScale, waveSpeed, fresnel })  live: uniforms and material fields, no recompile
//   set({ depthColor, foam })                                           structural: the shared material is rebuilt once (one recompile)
//   patch('wave' | 'surface', glsl)                                     the GLSL hooks (recipes/44), the only way GLSL reaches the water
//   replace((engine, { uniforms, waves, surface, normalMap }) => Material)   the whole surface (style.water.material)
// The style layer is style.water; the options of water({...}) are the game's own layer ('game'). Why a rebuild and not a patch of the old
// material: depthColor / foam / hooks decide which GLSL exists, and the shader is part of the material program.
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { waterLook } from './surface.js';

const WHY = 'the water module draws a plain gray, mostly opaque sea when the style gives none';
const OFF = "engine.use(water({ sea: false })) for no global water, or look.water.set({ opacity: 0 }) to hide the surface";
const KEYS = ['color', 'opacity', 'waveHeight', 'waveScale', 'waveSpeed', 'fresnel', 'depthColor', 'foam'];
const UN = { waveHeight: 'uWave', waveScale: 'uWaveScale', waveSpeed: 'uWaveSpeed', fresnel: 'uFresnel' };   // the uniforms behind the live keys
const STRUCT = ['depthColor', 'foam'];
const validate = (w, k) => v => { try { waterLook({ ...w.st, [k]: v }); return null; } catch (err) { return err.message; } };

/** @param {any} w the Water module */
export function defineWaterLook(w) {
  const e = w.engine, st = w.st;
  const pick = o => Object.fromEntries(KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const built = { sig: '', material: undefined };
  const sig = () => JSON.stringify([st.depthColor ?? null, st.foam ?? null, st._hooks ?? null]);
  built.sig = sig(); built.material = st.material;
  const live = (k, v) => {
    const m = w.material, u = w._u;
    if (k === 'color' && !st.material && m.color) m.color.set(v);
    else if (k === 'opacity' && !st.material) { const t = v < 1; m.opacity = v; if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; } }
    else if (u?.[UN[k]]) u[UN[k]].value = v;
  };
  const rebuild = () => {
    const now = sig();
    if (now === built.sig && st.material === built.material) return;   // the same structure again (e.g. the game layer repeating the style): nothing to do
    built.sig = now; built.material = st.material;
    w._rebuild();
  };
  const p = defineLookPart(e, {
    id: 'water', group: 'surface', module: 'water', object: () => ({ material: w.material, sea: w.sea }), docs: ['recipes/52-look.md'], applyAtStart: false,
    params: {
      color: { type: 'any', default: 0x888888, cost: 'uniform', why: WHY, off: OFF, desc: 'base color (any THREE.Color input)' },
      opacity: { type: 'number', default: 0.85, min: 0, max: 1, cost: 'uniform', why: WHY, off: OFF },
      waveHeight: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'multiplies the wave function (0 = flat)' },
      waveScale: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'world position scale fed to the wave function' },
      waveSpeed: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'time scale fed to the wave function' },
      fresnel: { type: 'number', default: 0.5, min: 0, max: 1, cost: 'uniform', why: 'grazing angles blend toward the fog (horizon) color', off: 'look.water.set({ fresnel: 0 })' },
      depthColor: { type: 'any', default: null, neutral: true, cost: 'recompile', desc: '{ shallow, deep, by: "view" | "wave", curve } or null; rebuilds the water material once', check: validate(w, 'depthColor') },
      foam: { type: 'any', default: null, neutral: true, cost: 'recompile', desc: 'true | { color, start, end, opacity } or null; rebuilds the water material once', check: validate(w, 'foam') },
    },
    style: () => ({ ...pick(e.style.water ?? {}),
      ...(e.style.water?.material ? { [REPLACE]: e.style.water.material } : {}) }),
    read: () => ({ opacity: !st.material && w.material.opacity !== undefined ? w.material.opacity : undefined }),
    apply(v, changed) {
      for (const k of changed) { st[k] = v[k]; live(k, v[k]); }
      if (STRUCT.some(k => changed.has(k))) rebuild();
    },
    hooks: {
      wave: { signature: 'float threedogWaterWave(vec3 p, float t)', scope: ['uTime'], example: 'float threedogWaterWave(vec3 p, float t) { return sin(p.x + t) * 0.2; }' },
      surface: { signature: 'vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time)', scope: ['uTime'],
        example: 'vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time) { return vec4(base.rgb * (0.8 + wave), base.a); }' },
    },
    applyHook(name, glsl) {
      const was = st._hooks;   // internal hook state (surface.js waterLook reads it), never a style / option key
      st._hooks = { ...was, [name]: glsl ?? undefined };
      try { waterLook(st); rebuild(); } catch (err) { st._hooks = was; throw err; }
    },
    replace: { accepts: '(engine, { uniforms, waves, surface, normalMap }) => THREE.Material', loses: ['built-in role "water" material, fresnel, color and opacity (your material owns them)', 'depthColor / foam unless your material uses surface'] },
    // checked before any layer is written: the replace slot is a function, a GLSL hook builds (waterLook compiles it on a copy of the state)
    validate: (k, v) => k === REPLACE ? (typeof v === 'function' ? null : 'is (engine, { uniforms, waves, surface, normalMap }) => THREE.Material')
      : k.startsWith('hook:') ? validate(w, '_hooks')({ ...w.st._hooks, [k.slice(5)]: v }) : null,
    applyReplace(impl) {
      st.material = impl ?? undefined; rebuild();
    },
  });
  // water({...}) options are the game's layer
  const o = w.opts ?? {}, mine = pick(o);
  if (Object.keys(mine).length) p.set(mine);
  if (o.material) p.replace(o.material);
  return p;
}
