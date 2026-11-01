// look.shadow: the sun's shadow as a look part (set only: the csm patch is internal, and a game that wants its own shadows lights with its own lights).
// Why a part: the type / cascades / bias a game set were invisible to describe(); now every key says who set it.
// the work itself is Sky._applyShadow (shadow.js).
import { defineLookPart } from '../../core/look/part.js';
import { SHADOW_TYPES } from '../../core/shadowTypes.js';

const SPLITS = ['practical', 'uniform', 'logarithmic'];
const KEYS = ['bias', 'normalBias', 'updateEvery', 'snap', 'ahead', 'type', 'radius', 'blurSamples', 'cascades', 'maxFar', 'fade', 'lightMargin', 'split'];

/**
 * @param {any} sky @param {object} sh shadowFor(...) at start: becomes the style layer (style.sky.shadow, tier-adjusted, merged with sky({ shadow }))
 */
export function defineShadowLook(sky, sh) {
  const e = sky.engine, sun = sky.sun;
  const cost = 'shadow pass';
  defineLookPart(e, {
    id: 'shadow', group: 'atmosphere', module: 'sky', object: () => sun.shadow, docs: ['recipes/52-look.md', 'recipes/45-cascaded-shadows.md'],
    params: {
      enabled: { type: 'bool', default: e.shadows, cost, desc: 'master shadow switch (engine.setShadows)',
        why: 'the sun casts shadows (createEngine({ shadows }) is the start value)', off: 'look.shadow.set({ enabled: false }), or createEngine({ shadows: false })' },
      type: { type: 'string', default: e.shadowType, values: Object.keys(SHADOW_TYPES), neutral: true, cost, desc: "'basic' hard edge | 'pcf' | 'vsm' softest; switching recompiles materials, do it rarely" },
      radius: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'edge softness (pcf, vsm)' },
      blurSamples: { type: 'int', default: 8, min: 1, neutral: true, cost, desc: 'blur quality (vsm only)' },
      bias: { type: 'number', default: -0.0006, neutral: true, cost: 'uniform', desc: 'depth bias against acne' },
      normalBias: { type: 'number', default: 0.04, neutral: true, cost: 'uniform', desc: 'normal offset against acne (meters)' },
      mapSize: { type: 'int', default: 2048, min: 64, neutral: true, cost: 'gpu', desc: 'shadow map pixels (the nearest cascade with cascades)' },
      updateEvery: { type: 'int', default: 1, min: 1, neutral: true, cost, desc: 'update the shadow map every N frames' },
      snap: { type: 'any', default: 0.5, neutral: true, cost: 'uniform', desc: "shadow center snap grid in meters, or 'texel'" },
      ahead: { type: 'number', default: 0, neutral: true, cost: 'uniform', desc: 'meters the shadow center is shifted in front of the view' },
      cascades: { type: 'int', default: 1, neutral: true, cost, desc: '1 = one shadow map; 2-4 = cascaded shadows (recipes/45)',
        check: v => (v < 1 || v > 4 ? `must be a whole number 1 (one shadow map, the default) to 4; got ${v}` : v > 1 && sky._drive.sun === false ? "cannot be above 1: cascades split the engine sun's shadow, and sky({ sun: false }) has no engine sun" : null) },
      maxFar: { type: 'number', default: 120, min: 0.001, neutral: true, cost: 'uniform', desc: 'meters from the camera that cascades cover' },
      fade: { type: 'bool', default: true, neutral: true, cost: 'uniform', desc: 'cascades blend into each other' },
      lightMargin: { type: 'number', default: 100, neutral: true, cost: 'uniform', desc: 'meters the cascade lights sit behind their frustum' },
      split: { type: 'any', default: 'practical', neutral: true, cost: 'uniform', desc: "'practical' | 'uniform' | 'logarithmic' | (count, near, far, out) => void",
        check: v => (typeof v === 'function' || SPLITS.includes(v) ? null : `must be ${SPLITS.map(s => `'${s}'`).join(' | ')} or a function (count, near, far, out) => void; got ${JSON.stringify(v)}`) },
    },
    style: () => ({ ...Object.fromEntries(KEYS.filter(k => sh[k] !== undefined).map(k => [k, sh[k]])), ...(sh.mapSize !== undefined ? { mapSize: sh.mapSize } : {}) }),
    read: () => ({ enabled: e.shadows, type: e.shadowType, radius: sun.shadow.radius, mapSize: sun.shadow.mapSize.x, bias: sun.shadow.bias, normalBias: sun.shadow.normalBias }),
    apply(v, changed) {
      const o = {};
      for (const k of changed) if (KEYS.includes(k)) o[k] = v[k];
      if (changed.has('enabled') && v.enabled !== e.shadows) e.setShadows(v.enabled);
      if (changed.has('mapSize')) sky.setShadowMapSize(v.mapSize);
      if (Object.keys(o).length) sky._applyShadow(o);
    },
    noPatch: "the cascade patch ('csm') is internal; change the shadows with look.shadow.set({ type, radius, cascades, ... })",
    noReplace: 'to own the shadows, light the world with your own three.js lights: sky({ sun: false }) or createEngine({ lights: false })',
  });
}
