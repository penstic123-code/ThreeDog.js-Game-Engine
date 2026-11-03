// look.shadow, sky half: the sun's shadow box (bias, cascades, extent, update rate ...) added to the core part (core/look/shadowPart.js has the
// master switch and the filter type). Why one part: a game reads and sets every shadow value on engine.look.shadow, with or without a sky, and
// describe().look.shadow says who set each. The work itself is Sky._applyShadow (shadow.js); dispose takes these keys back out.
import { includeInCascades } from './cascades.js';
import { SKY_BIAS } from './shadow.js';
import { ownedRow } from '../../core/owned.js';

const SPLITS = ['practical', 'uniform', 'logarithmic'];
const KEYS = ['bias', 'normalBias', 'updateEvery', 'snap', 'ahead', 'type', 'radius', 'blurSamples', 'cascades', 'maxFar', 'fade', 'lightMargin', 'split', 'follow', 'extent'];

/**
 * @param {any} sky @param {object} sh shadowFor(...) at start: becomes the style layer (style.sky.shadow, tier-adjusted, merged with sky({ shadow }))
 */
export function extendShadowLook(sky, sh) {
  const e = sky.engine, part = e.look.shadow;
  const cost = 'shadow pass';
  const PARAMS = {
    radius: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'edge softness (pcf, vsm)' },
    blurSamples: { type: 'int', default: 8, min: 1, neutral: true, cost, desc: 'blur quality (vsm only)' },
    bias: { type: 'number', default: SKY_BIAS, neutral: true, cost: 'uniform', desc: 'depth bias against acne, in shadow-camera depth (0-1 over near-far: -0.00005 x 419 m = 2 cm); normalBias does most of the work' },
    normalBias: { type: 'number', default: 0.04, neutral: true, cost: 'uniform', desc: 'normal offset against acne (meters)' },
    mapSize: { type: 'int', default: 2048, min: 64, neutral: true, cost: 'gpu', desc: 'shadow map pixels (each cascade with cascades)' },
    updateEvery: { type: 'int', default: 1, min: 1, neutral: true, cost, desc: 'update the shadow map every N frames' },
    snap: { type: 'any', default: 0.5, neutral: true, cost: 'uniform', desc: "shadow center snap grid in meters, or 'texel'" },
    ahead: { type: 'number', default: 0, neutral: true, cost: 'uniform', desc: 'meters the shadow center is shifted in front of the view' },
    cascades: { type: 'int', default: 1, neutral: true, cost, desc: '1 = one shadow map; 2-4 = cascaded shadows (recipes/45)',
      check: v => (v < 1 || v > 4 ? `must be a whole number 1 (one shadow map, the default) to 4; got ${v}` : v > 1 && sky._drive.sun === false ? "cannot be above 1: cascades split the engine sun's shadow, and sky({ sun: false }) has no engine sun" : null) },
    maxFar: { type: 'number', default: 120, min: 0.001, neutral: true, cost: 'uniform', desc: 'meters from the camera that cascades cover' },
    fade: { type: 'bool', default: true, neutral: true, cost: 'uniform', desc: 'cascades blend into each other' },
    lightMargin: { type: 'number', default: 100, neutral: true, cost: 'uniform', desc: 'meters the cascade lights sit behind their frustum' },
    // follow / extent: before these the shadow box always followed engine.focus at the style's size; a game that stages its own scene had no way out
    follow: { type: 'any', default: 'focus', neutral: true, cost: 'uniform', desc: "what the shadow box centers on: 'focus' (engine.focus) | 'camera' | an Object3D | () => Vector3 | false (it stays where you put engine.lights.sun.target)",
      check: v => (v === false || v === 'focus' || v === 'camera' || v?.isObject3D || typeof v === 'function' ? null : `must be 'focus' | 'camera' | an Object3D | () => Vector3 | false; got ${JSON.stringify(v)}`) },
    extent: { type: 'number', default: 70, min: 1, neutral: true, cost: 'uniform', desc: 'half size of the shadow box in meters (one shadow map; cascades size their own)' },
    split: { type: 'any', default: 'practical', neutral: true, cost: 'uniform', desc: "'practical' | 'uniform' | 'logarithmic' | (count, near, far, out) => void",
      check: v => (typeof v === 'function' || SPLITS.includes(v) ? null : `must be ${SPLITS.map(s => `'${s}'`).join(' | ')} or a function (count, near, far, out) => void; got ${JSON.stringify(v)}`) },
  };
  part.author.extend(PARAMS);
  const style = { ...Object.fromEntries(KEYS.filter(k => sh[k] !== undefined).map(k => [k, sh[k]])), ...(sh.mapSize !== undefined ? { mapSize: sh.mapSize } : {}) };
  part.author.restyle(style);   // type in style.sky.shadow is the core key's style value; the rest are the keys just added
  part._skyApply = (v, changed) => {
    const o = {};
    for (const k of changed) if (KEYS.includes(k) && k !== 'type') o[k] = v[k];
    if (changed.has('mapSize')) sky.setShadowMapSize(v.mapSize);
    // a filter switch (the core key) still needs the sky's cascades synced and a shadow redraw when updateEvery > 1 (shadow.js)
    if (Object.keys(o).length || changed.has('type')) sky._applyShadow(o);
  };
  part._skyApply(part.author.values(), new Set(Object.keys(PARAMS)));   // extend() recomputes without apply: the sun takes the start values now
  // include: the opt-in for a game ShaderMaterial (lights: true) under cascaded shadows; built-in lit materials are patched without it (cascades.js header)
  const noInclude = part.include;
  part.include = m => includeInCascades(sky, m);
  sky._shadowOff = () => {
    part._skyApply = null; part.include = noInclude;
    for (const k of Object.keys(PARAMS)) part.author.retract(k);
    part.author.restyle({});   // the style's type goes with the sky that brought it
  };
  // describe().owned shows which of the game's own materials carry the csm patch (option A patches built-in lit types the game made, too)
  ownedRow(e, 'shadow.csm', () => {
    const g = sky.csm?.gameMaterials();
    return g?.length ? { part: 'shadow', key: 'csm', writer: 'engine (csm patch on your built-in lit materials; recipes/45)', materials: g } : undefined;
  });
}
