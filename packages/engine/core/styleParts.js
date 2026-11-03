// A style built from parts: createEngine({ style: [basePack, { sky: mySky }, toonMaterials] }) merges the parts left to right into engine.style.
// Why parts and not one object: a look is often borrowed piecemeal (one pack's materials, another's sky, the game's own UI colors), and a
// spread `{ ...basePack, sky }` loses basePack's other sky fields; a deep merge keeps them. Rules (one place; recipes/09-style.md "Composing"):
//   - parts merge left to right, later wins; nested arrays are flattened (a pack may itself be a list of parts); null / undefined / false parts are skipped
//   - plain objects ({ } literals) merge key by key, recursively: { sky: { sunSize: 600 } } changes only sunSize
//   - anything else replaces whole: arrays (sky.keyframes, terrain.steep), functions, numbers, strings, three.js objects and class instances
//   - a key set to undefined is ignored; a key set to null removes it (e.g. { ui: null } = no UI look from earlier parts)
//   - parts are never mutated; plain objects are copied, functions and three.js objects are shared by reference
//   - plugins (the part's look plugins, stylePlugins below) are not merged file by file: each part's stay grouped under its name; plugins: null drops the earlier parts'
//     (post effects are plugins too: one way in, look.post.add; switch one of a pack off with engine.plugins.off('<pack>/<file>') or look.post.set({ name: false }))
// Zero cost when unused: a single object (not a list) is used as it is, engine.style === that object.
// Looks only: a style never holds world state (water level, sea, terrain shape); checkStyleLooks throws in dev.
import { DEV } from './validate.js';
import { isPlainObject as plain, getPath } from './util.js';
import { codedError } from './errorHints.js';


/** Merge part into out. src (path -> pack label) records which part set each leaf, so describe can name the pack behind a style value */
function mergeInto(out, part, src = null, label = '', at = '') {
  for (const [k, v] of Object.entries(part)) {
    if (v === undefined) continue;
    const path = at + k;
    if (v === null) { delete out[k]; if (src) for (const p of [...src.keys()]) if (p === path || p.startsWith(path + '.')) src.delete(p); }
    else if (plain(v)) out[k] = mergeInto(plain(out[k]) ? out[k] : {}, v, src, label, path + '.');
    else { out[k] = v; src?.set(path, label); }
  }
  return out;
}

// style object -> Map(path -> label of the part that set it), only for a style merged from several parts (one object has one source: itself)
const SOURCES = new WeakMap();
/** A part's name in describe: its own name field (packs set one), else its place in the list */
const partLabel = (part, i) => typeof part.name === 'string' && part.name ? part.name : `style[${i}]`;
/**
 * Which style part set the value a look key shows, when engine.style was merged from several: the merged path whose last segment is the key's
 * last segment and whose value is that value. null when the style is one object, or when no path (or more than one pack) matches.
 * @param {any} style engine.style @param {string} key a look part's flat key ('far', 'sun.intensity') @param {any} value the style layer's value
 * @internal
 */
export function stylePackOf(style, key, value) {
  const src = style && SOURCES.get(style);
  if (!src) return null;
  const last = key.split('.').at(-1), found = new Set();
  for (const [path, label] of src) if (path.split('.').at(-1) === last && getPath(style, path) === value) found.add(label);
  return found.size === 1 ? [...found][0] : null;
}

// merged style object -> [{ group, files }]: the plugins of each part, in part order (a single style object reads its own `plugins` field)
const PLUGINS = new WeakMap();
const checkPlugins = files => {
  if (!plain(files)) throw codedError('style-value', `style.plugins is what engine.plugins.add takes: import.meta.glob('./plugins/*.js', { eager: true }) or { name: { default: value } }; got ${Array.isArray(files) ? 'an array' : typeof files}`);
  return files;
};
/**
 * The look plugins a style brings, grouped by the pack that brought them: engine.plugins plugs them (core/plugins.js), the same path as the
 * game's plugins/ folder. Why grouped: a style is one folder, so it is plugged and taken out as one (engine.plugins.off('<pack name>')).
 * @param {any} style engine.style @returns {{ group: string, files: Record<string, any> }[]} @internal
 */
export function stylePlugins(style) {
  if (PLUGINS.has(style)) return PLUGINS.get(style);
  return style?.plugins ? [{ group: typeof style.name === 'string' && style.name ? style.name : 'style', files: checkPlugins(style.plugins) }] : [];
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
    const src = new Map();
    const plugins = [];
    style.flat(Infinity).forEach((part, i) => {
      if (!part) return;
      if (!plain(part)) throw codedError('style-value', `createEngine({ style: [...] }): each part must be a plain object (a style or { key: value }), got ${typeof part}`);
      // each part's plugins stay grouped under that part's name (not merged file by file), so off('<pack>') takes out exactly that pack's
      const { plugins: own, ...rest } = part;
      if (own === null) plugins.length = 0;
      else if (own !== undefined) plugins.push({ group: partLabel(part, i), files: checkPlugins(own) });
      // copy the part's plain objects too, so a later part never writes into an earlier pack
      mergeInto(out, rest, src, partLabel(part, i));
    });
    SOURCES.set(out, src);
    PLUGINS.set(out, plugins);
  } else if (out.plugins != null) checkPlugins(out.plugins);   // a wrong shape fails at createEngine, not at start
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
  + 'making the art is part of building the game. Fill your own style (style/index.js in a new game; recipes/09-style.md, recipes/52-look.md)';
/** true when createEngine got no style, or only empty parts ({} / [{}, {}]): the game has no look yet */
export const styleIsEmpty = st => !st || (Array.isArray(st) ? st.every(styleIsEmpty) : typeof st === 'object' && Object.keys(st).every(k => k === 'name'));   // a name alone (the new-game empty style) is still empty
