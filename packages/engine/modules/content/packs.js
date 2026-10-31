// Content packs: engine.content.load([basePack, dlcPack, levelPack]) loads several data packs as one load.
// Why one load and not several load() calls: a repeated load deliberately overrides the same name (hot reload, a later chapter replacing a quest),
// so two packs that both define items.apple would silently fight. Inside one load the packs must not overlap: the same id in two packs is an error
// naming both. Rules:
//   - packs load in list order, so a pack may use what an earlier pack defines (a level pack placing a template from a base pack)
//   - keyed tables (items, npcs, dialogues, quests, templates, vegetation, triggers, game kinds..., and rules.conditions / rules.kinds): one id, one pack
//   - audio: sounds, footsteps and music.tracks are keyed tables; ambience and music.rules lists concatenate
//   - startItems add up (two packs that both give 'gold' give the sum), so it is not an id table
//   - lists (props, pickups) concatenate; their ids are checked across all packs by the same IdCheck as a single load (ids.js)
//   - a pack may carry name: 'forest-dlc' for error messages; no other extra key (unknown keys are errors)
// Content references assets by name only: a model written as a file path or a function is reported here in dev (the static check is
// npm run check -> content-check, packages/tools/content-check/world.mjs).
import { DEV, warnOnce, fmt } from '../../core/validate.js';

const STRINGS = {
  dup: 'content.load: {key}.{id} is defined by both {a} and {b}. Packs loaded together may not share an id: rename one, or drop it from one pack',
  notPack: 'content.load: pack {at} must be a plain object of content tables ({ items, props, ... }), got {got}',
  path: 'content: {what} names the model "{m}" as a file path. Content refers to assets by name only: register the file in an asset pack '
    + "(engine.assets.manifest({ models: { {short}: '{m}' } })) and write model: '{short}'",
  code: 'content: {what} gives a function as its model. Content is data: register the generator in an asset pack (engine.assets.manifest({ models: { name: fn } })) and write its name',
};
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// plain-object tables that are not "one id, one pack": their entries combine (startItems counts add, each pack's load gives its own)
const NOT_KEYED = new Set(['startItems']);
const PATH = /[/\\]|\.(glb|gltf|fbx|obj|png|jpe?g|webp|ktx2|mp3|ogg|wav)$/i;

/** Label of a pack in messages: its name, else its position @param {any} p @param {number} i */
const packLabel = (p, i) => (p?.name ? `pack "${p.name}"` : `pack #${i + 1}`);

/**
 * Normalize content.load's argument to a list of packs and throw on an id defined by two packs (rules at the top of this file) @internal
 * @param {any} data  one pack or a list of packs
 * @returns {any[]}
 */
export function packsOf(data) {
  const packs = Array.isArray(data) ? data.flat(Infinity) : [data];
  if (packs.length < 2) { if (DEV && packs[0]) modelRefs(packs[0]); return packs; }
  const owner = new Map();   // 'items.apple' -> pack index
  const claim = (key, table, i) => {
    for (const id of Object.keys(table || {})) {
      const k = key + '.' + id, was = owner.get(k);
      if (was !== undefined) throw new Error(fmt(STRINGS.dup, { key, id, a: packLabel(packs[was], was), b: packLabel(packs[i], i) }));
      owner.set(k, i);
    }
  };
  packs.forEach((p, i) => {
    if (!plain(p)) throw new Error(fmt(STRINGS.notPack, { at: i + 1, got: Array.isArray(p) ? 'an array' : typeof p }));
    for (const [key, v] of Object.entries(p)) {
      if (key === 'rules') { claim('rules.conditions', v?.conditions, i); claim('rules.kinds', v?.kinds, i); }
      // audio: named tables are ids (a sound in two packs is an error), rule lists concatenate
      else if (key === 'audio') { claim('audio.sounds', v?.sounds, i); claim('audio.footsteps', v?.footsteps, i); claim('audio.music.tracks', v?.music?.tracks, i); }
      else if (key !== 'name' && !NOT_KEYED.has(key) && plain(v)) claim(key, v, i);
    }
    if (DEV) modelRefs(p);
  });
  return packs;
}

/** Dev: model fields that hold a file path (warn) or a function (throw) instead of an asset name */
function modelRefs(p) {
  const check = (what, m) => {
    const name = Array.isArray(m) ? m[0] : m;
    if (typeof name === 'function') throw new Error(fmt(STRINGS.code, { what }));
    if (typeof name === 'string' && PATH.test(name)) warnOnce(fmt(STRINGS.path, { what, m: name, short: name.split(/[/\\]/).pop().replace(/\.\w+$/, '') }));
  };
  for (const [n, v] of Object.entries(p.vegetation || {})) { check(`vegetation.${n}`, v?.model); if (v?.lod) check(`vegetation.${n}.lod`, v.lod); }
  for (const [n, t] of Object.entries(p.templates || {})) check(`templates.${n}`, t?.model);
  (Array.isArray(p.props) ? p.props : []).forEach((x, i) => { if (x?.model !== undefined) check(`props[${i}]`, x.model); });
}
