// A style built from parts: createEngine({ style: [lowpoly, { sky: mySky }, toonMaterials] }) merges the parts left to right into engine.style.
// Why parts and not one object: a look is often borrowed piecemeal (one pack's materials, another's sky, the game's own UI colors), and a
// spread `{ ...lowpoly, sky }` loses lowpoly's other sky fields; a deep merge keeps them. Rules (one place; recipes/09-style-pack.md "Composing"):
//   - parts merge left to right, later wins; nested arrays are flattened (a pack may itself be a list of parts); null / undefined / false parts are skipped
//   - plain objects ({ } literals) merge key by key, recursively: { sky: { sunSize: 600 } } changes only sunSize
//   - anything else replaces whole: arrays (sky.keyframes, post, terrain.steep), functions, numbers, strings, three.js objects and class instances
//   - a key set to undefined is ignored; a key set to null removes it (e.g. { post: null } = no post effects from earlier parts)
//   - parts are never mutated; plain objects are copied, functions and three.js objects are shared by reference
// Zero cost when unused: a single object (not a list) is used as it is, engine.style === that object.

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

function mergeInto(out, part) {
  for (const [k, v] of Object.entries(part)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
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
  if (!Array.isArray(style)) return style ?? {};
  const out = {};
  for (const part of style.flat(Infinity)) {
    if (!part) continue;
    if (!plain(part)) throw new Error(`createEngine({ style: [...] }): each part must be a plain object (a style pack or { key: value }), got ${typeof part}`);
    // copy the part's plain objects too, so a later part never writes into an earlier pack
    mergeInto(out, part);
  }
  return out;
}
