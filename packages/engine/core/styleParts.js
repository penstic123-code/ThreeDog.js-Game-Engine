// A style built from parts: createEngine({ style: [basePack, { sky: mySky }, toonMaterials] }) merges the parts left to right into engine.style.
// Why parts and not one object: a look is often borrowed piecemeal (one pack's materials, another's sky, the game's own UI colors), and a
// spread `{ ...basePack, sky }` loses basePack's other sky fields; a deep merge keeps them. Rules (one place; recipes/09-style-pack.md "Composing"):
//   - parts merge left to right, later wins; nested arrays are flattened (a pack may itself be a list of parts); null / undefined / false parts are skipped
//   - plain objects ({ } literals) merge key by key, recursively: { sky: { sunSize: 600 } } changes only sunSize
//   - anything else replaces whole: arrays (sky.keyframes, post, terrain.steep), functions, numbers, strings, three.js objects and class instances
//   - a key set to undefined is ignored; a key set to null removes it (e.g. { post: null } = no post effects from earlier parts)
//   - parts are never mutated; plain objects are copied, functions and three.js objects are shared by reference
//   - post is the one list you often edit rather than replace: postAdd(effect) / postRemove(name) are parts that change the list built so far
// Zero cost when unused: a single object (not a list) is used as it is, engine.style === that object.
// Looks only: a style never holds world state (water level, sea, terrain shape); checkStyleLooks throws in dev.
import { DEV } from './validate.js';
import { isPlainObject as plain, getPath } from './util.js';
import { codedError } from './errorHints.js';


// A post edit is a function carrying this mark: mergeInto calls it with the list built so far instead of replacing the list
const EDIT = Symbol('threedog.postEdit');
const edit = fn => ({ post: Object.assign(fn, { [EDIT]: true }) });

/**
 * A style part that adds post effects to the ones before it (a plain { post: [...] } would replace the whole list). An effect with the same name as
 * an earlier one replaces it in place; names are the effects' own ('bloom', 'ao', 'outline', or your own).
 * @example createEngine({ style: [basePack, postAdd(myGrain, bloom({ strength: 0.6 }))] })   // grain added, the pack's bloom swapped for yours
 * @param {...import('../render/PostFX.js').PostEffect} effects
 * @returns {{ post: any }}
 */
export function postAdd(...effects) {
  return edit(list => {
    const out = [...(list ?? [])];
    for (const e of effects) { const i = out.findIndex(o => o.name === e.name); if (i >= 0) out[i] = e; else out.push(e); }
    return out;
  });
}

/**
 * A style part that removes post effects by name from the ones before it.
 * @example createEngine({ style: [basePack, postRemove('ao', 'outline')] })
 * @param {...string} names
 * @returns {{ post: any }}
 */
export function postRemove(...names) {
  return edit(list => (list ?? []).filter(e => !names.includes(e.name)));
}

function mergeInto(out, part) {
  for (const [k, v] of Object.entries(part)) {
    if (v === undefined) continue;
    if (v?.[EDIT]) out[k] = v(out[k]);
    else if (v === null) delete out[k];
    else if (plain(v)) out[k] = mergeInto(plain(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

/**
 * The style object engine.style is built from: a single style object as is, or a list of parts deep-merged (rules at the top of this file)
 * @param {any} style
 * @returns {Record<string, any>}
 * @internal
 */
export function styleFrom(style) {
  let out = style ?? {};
  if (Array.isArray(style)) {
    out = {};
    for (const part of style.flat(Infinity)) {
      if (!part) continue;
      if (!plain(part)) throw codedError('style-value', `createEngine({ style: [...] }): each part must be a plain object (a style or { key: value }), got ${typeof part}`);
      // copy the part's plain objects too, so a later part never writes into an earlier pack
      mergeInto(out, part);
    }
  }
  if (DEV) checkStyleLooks(out);
  return out;
}

// World state a style must not carry: [style path, is this key world state, where it goes instead]. Why: with the same map and rules, swapping
// the style may only change how things look; a style that moved the sea or reshaped the hills would make "same game, new look" impossible
const WORLD = [
  ['water', k => ['level', 'sea', 'size'].includes(k), 'engine.use(water({ level, sea, size })) (WaterOptions); without level the terrain waterLevel is used'],
  // looks of the ground: shading, colorResolution, normals, normalFn; diagonal moves engine.surface, so it is the game's
  ['terrain.config', k => !['shading', 'colorResolution', 'normals', 'normalFn'].includes(k), "terrain({ ... }) (TerrainConfig: seed, chunkSize, resolution, diagonal, waterLevel, height...); only shading, colorResolution, normals, normalFn are looks"],
];
function checkStyleLooks(style) {
  for (const [path, isWorld, where] of WORLD) {
    const obj = getPath(style, path);
    if (!obj || typeof obj !== 'object') continue;
    for (const k of Object.keys(obj))
      if (isWorld(k)) throw codedError('style-value', `style.${path}.${k} is world state, not a look: swapping the style would change the map or the rules. Set it where the world is made: ${where}`);
  }
}

// Dev warning when createEngine gets no style (shown once from Engine.js)
export const NO_STYLE = 'createEngine(): the style is missing or empty, so everything is a neutral gray placeholder on a technical render baseline (AgX tone mapping, '
  + 'soft sun shadows, a generated neutral room environment, white hemisphere + sun; see describe().look.tone / .lights), gray background, ground, capsule characters and box props. Not an error, but the game has no look yet: '
  + 'making the art is part of building the game. Fill your own style (style/index.js in a new game; recipes/09-style-pack.md, recipes/52-look.md)';
/** true when createEngine got no style, or only empty parts ({} / [{}, {}]): the game has no look yet */
export const styleIsEmpty = st => !st || (Array.isArray(st) ? st.every(styleIsEmpty) : typeof st === 'object' && Object.keys(st).every(k => k === 'name'));   // a name alone (the new-game empty style) is still empty
