// look.ground: how the terrain looks (colors, variation, shading, detail layer, material). Registered by the terrain module.
//   set({ colors, biomeColors, steep, variation, shading, detail })
//        colors / biomeColors / steep / variation / shading are baked into the chunks by the workers: a change rebuilds every chunk (cost 'rebuild';
//        edits stay). colors / biomeColors / steep are given whole (they replace the style's table), variation / detail are objects (style.terrain.*).
//   patch('detail', glsl)   the detail layer's `vec4 threedogDetailSample(vec2 p)` (render/detail.js); a detail object must be set too
//   replace(Material | (engine) => Material)   the ground material (terrain({ material }) / style.terrain.material is the first one); null gives it back
// Why not in ChunkManager.js: that file is at its size cap, and every ground option below already reached it as config before; this only
// writes the same config again when a verb changes it.
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { terrainMaterial } from '../../render/materials.js';

const GEN = ['colors', 'biomeColors', 'steep', 'variation', 'shading'];
const isObj = v => (v && typeof v === 'object' ? null : 'must be an object');

/**
 * @param {any} e @param {any} w the ChunkManager
 * @param {{ cfg: () => any, setCfg: (c: any) => void, game: Record<string, any> }} h the module's current terrain config, and what terrain({...}) itself passed (written as owner 'terrain()')
 */
export function defineGroundLook(e, w, h) {
  const st = e.style.terrain ?? {}, cfg0 = h.cfg();
  const rebuild = 'rebuild';
  const part = defineLookPart(e, {
    id: 'ground', group: 'surface', module: 'terrain', object: () => w.terrainMat, applyAtStart: false, docs: ['recipes/52-look.md'],
    params: {
      colors: { type: 'any', default: {}, neutral: true, cost: rebuild, check: isObj, desc: 'palette name -> color; the whole table (a ground type without a color is neutral gray)' },
      biomeColors: { type: 'any', default: {}, neutral: true, cost: rebuild, check: isObj, desc: 'ground type -> palette name(s); the whole table' },
      steep: { type: 'array', default: [], neutral: true, cost: rebuild, desc: 'slope colors [{ maxNormalY, colors }]' },
      variation: { type: 'any', default: null, neutral: true, cost: rebuild, check: isObj, desc: '{ blend, jitter, patches } color variation (style.terrain.variation); null = none' },
      shading: { type: 'string', values: ['smooth', 'flat', 'texture'], default: 'smooth', cost: rebuild,
        why: 'terrain colors are blended per grid point (smooth) so the ground has no visible facets', off: "look.ground.set({ shading: 'flat' }) for one color per triangle, or 'texture' for a per-chunk color map" },
      detail: { type: 'any', default: null, neutral: true, cost: 'recompile', check: isObj, desc: '{ texture | noise | glsl, scale, strength ... } detail layer over the ground (style.terrain.detail); null = none' },
    },
    style: () => ({ colors: st.colors, biomeColors: st.biomeColors, steep: st.steep, variation: st.variation, shading: st.config?.shading, detail: st.detail, [REPLACE]: st.material }),
    read: () => ({}),
    hooks: { detail: { signature: 'vec4 threedogDetailSample(vec2 p)  // rgb + height 0-1', scope: ['fragment'], example: "engine.look.ground.patch('detail', glsl)" } },
    replace: { accepts: 'a Material, or (engine) => Material; null gives the style\'s back', loses: ['the style\'s terrain material (cloud shadows and season tint are added to the new one)'] },
    applyReplace: () => material(), applyHook: () => material(),
    apply(v, changed) {
      if (changed.has('detail')) material();
      if (!GEN.some(k => changed.has(k))) return;
      const next = { ...h.cfg() };
      for (const k of GEN) if (changed.has(k)) { if (v[k] == null) delete next[k]; else next[k] = v[k]; }
      if (!next.shading) next.shading = cfg0.shading;
      h.setCfg(next);
      const species = {}; for (const sp of e.vegetation?.list() || []) species[sp.name] = sp.rule;
      w.reinit(next, species);
    },
  });
  // what terrain({ colors, shading, material ... }) itself was given sits on the game layer under the owner 'terrain()', so describe shows it
  const given = {};
  for (const k of GEN) if (h.game[k] !== undefined) given[k] = h.game[k];
  if (h.game.material !== undefined) given[REPLACE] = h.game.material;
  if (Object.keys(given).length) part.write('terrain()', given);
  /** Rebuild the ground material from the resolved replace / detail, then every chunk picks it up */
  function material() {
    const impl = part.value(REPLACE) ?? null;
    w.terrainMat = terrainMaterial(typeof impl === 'function' ? impl(e) : impl, e);
    w.rebuild();
  }
  return part;
}
