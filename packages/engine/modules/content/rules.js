// Content vocabulary: the "conditions" and "effects" that content files (content/*.js) can use. Shared by the loader, the validator packages/tools/content-check.mjs and the map packages/tools/gamemap.mjs.
// Plain data + small functions, no import of three or the engine (the validator reads it directly in node). Real execution is in loader.js.
//
// Conditions (quest step done, dialogue option if, line variant if): several items in one object must all hold; array = every item holds
//   { flag: 'metFisher' }  { notFlag: 'x' }  { has: { berry: 3 } }  { lacks: { film: 6 } }  { counter: { sunsetPhotos: 1 } }
//   { can: ['shop.buy', { shop: 'bakery', item: 'bread' }] }   an op would succeed now (engine.ops.can)
// Effects (dialogue node/option do, quest reward, trigger onEnter/onExit): same, one or several items or an array
//   { setFlag: 'metFisher' }  { give: { film: 6 } }  { take: { berry: 3 } }  { bump: 'sunsetPhotos' }  { startQuest: 'first-light' }
//   { toast: 'text' }  { particles: { name: 'sparks', at: [x, y, z], count: 40 } }
//   { marker: 'river' } or { marker: { place: 'home', x: 2, z: 0, label: '门口' } } adds an objective marker (hud module); { clearMarker: 'river' } removes it
//   { op: ['shop.buy', { shop: 'bakery', item: 'bread' }] }   runs a game op (engine.ops.run). A game's own actions are ops (recipes/23-ops.md), never new effect words,
//   so every action has one registration and one log.
//
// Game condition words: in content/rules.js, export default { conditions: { word: { ref, desc, describe, test } } } (conditions only read state),
// registered automatically when the engine loads, and the validator and map read it too. ref is the value notation (the validator checks by it, the loader converts by it):
//   flag flag name · counter counter name · itemCounts { item: count } · counterCounts { counter: count } · quest quest id · text text
//   particles { name, at, count } · clock 'HH:MM' (test/run receive a 0-1 fraction) · position place name or { place, x, z } (receive { x, z })
//   op ['noun.verb', { args }] · any not checked
//
// Game content kinds: the same content/rules.js may export kinds: { name: { desc, load, check, map } }, so a game keeps its own data
// (enemies, recipes, loot tables, waves, shop stock) in content/<name>.js. The loader, content-check and GAMEMAP all read this one table:
//   desc  one line (map, file list) · load(e, data, content) hands the data to the game when engine.content.load runs (required)
//   check(data, ctx)  optional validation in npm run check: ctx.err(msg) / ctx.warn(msg); ctx.data is all content (items, npcs…), ctx.known(obj) lists ids
//   map(data)  optional GAMEMAP lines (default: the number of entries and their ids)
//   export default { kinds: { recipes: { desc: 'crafting recipes (id -> { needs: { item: n }, makes })', load: (e, data) => e.crafting.add(data),
//     check: (data, ctx) => { for (const [id, r] of Object.entries(data)) if (!ctx.data.items?.[r.makes]) ctx.err(`recipe ${id} makes unknown item ${r.makes}`); } } } };

const counts = o => Object.entries(o || {}).map(([k, n]) => `${k}×${n}`).join('、');
const opText = v => Array.isArray(v) ? `${v[0]}${v[1] ? ' ' + Object.entries(v[1]).map(([k, x]) => `${k}=${x}`).join(' ') : ''}` : String(v);
const posText = v => typeof v === 'string' ? v : v.place ? `${v.place}${v.x || v.z ? `(${v.x ?? 0},${v.z ?? 0})` : ''}` : `(${v.x},${v.z})`;

const RULE_STRINGS = {
  conditions: {
    flag: { ref: 'flag', desc: 'story flag is set', describe: v => `flag ${v}` },
    notFlag: { ref: 'flag', desc: 'story flag is not set', describe: v => `no flag ${v}` },
    has: { ref: 'itemCounts', desc: 'inventory has at least', describe: v => `has ${counts(v)}` },
    lacks: { ref: 'itemCounts', desc: 'inventory has fewer than', describe: v => `fewer than ${counts(v)}` },
    counter: { ref: 'counterCounts', desc: 'counter is at least', describe: v => `counter ${Object.entries(v).map(([a, n]) => `${a}≥${n}`).join(', ')}` },
    can: { ref: 'op', desc: 'an op would succeed now (engine.ops.can)', describe: v => `can ${opText(v)}` },
  },
  effects: {
    setFlag: { ref: 'flag', desc: 'set a story flag', describe: v => `set flag ${v}` },
    give: { ref: 'itemCounts', desc: 'give items', describe: v => `give ${counts(v)}` },
    take: { ref: 'itemCounts', desc: 'take items', describe: v => `take ${counts(v)}` },
    bump: { ref: 'counter', desc: 'counter +1', describe: v => `counter ${v}+1` },
    startQuest: { ref: 'quest', desc: 'start a quest', describe: v => `start quest ${v}` },
    toast: { ref: 'text', desc: 'show a toast', describe: v => `toast "${v}"` },
    particles: { ref: 'particles', desc: 'play particles', describe: v => `particles ${v.name}×${v.count ?? ''}` },
    marker: { ref: 'position', desc: 'add an objective marker (hud module)', describe: v => `marker ${posText(v)}${v.label ? `"${v.label}"` : ''}` },
    clearMarker: { ref: 'position', desc: 'remove an objective marker', describe: v => `remove marker ${posText(v)}` },
    op: { ref: 'op', desc: "run a game op (engine.ops.run); the game's own actions are ops", describe: v => `op ${opText(v)}` },
  },
  // content file name -> description (only these files are recognized in content/)
  files: {
    items: 'items (id -> name, icon, description); also export startItems for starting items',
    pickups: 'pickups on the ground (list)',
    containers: 'chests / shelves (container id -> { capacity, items: starting goods }; starting goods are placed only the first time, then saved)',
    npcs: 'NPCs (id -> name, schedule, dialogue)',
    dialogues: 'dialogues (id -> speaker, nodes)',
    quests: 'quests (id -> title, steps, reward; a step can have a target position)',
    actions: 'own key actions of the game (action name -> default key, label)',
    places: 'place names (coordinates computed at runtime in main.js)',
    triggers: 'trigger zones (tag -> position / from level, enter/exit effects)',
    level: 'level markers (spawn point, NPCs, trigger zones)',
    vegetation: 'vegetation (name -> model, growth rule)',
    props: 'props (list: model, position, facing, collision; or { template, x, z } = an instance of a template; or { id, grid, item, cell } = a grid item), streamed in on demand',
    templates: 'reusable objects (name -> model, collide, interact, container, sound, animate, state defaults, physics body); shared read-only definitions',
    audio: 'sounds by asset name, ambience and music rules as data, footsteps (sounds, ambience, music: { tracks, rules }, footsteps)',
    views: 'named fixed camera views (name -> { position: [x, y, z], target?: [x, y, z], fov? }); engine.views.show(name), ?view=name, npm run shot -- -w game --view name',
    grids: 'placement grids (name -> { cell, origin, size, zone?, flat? }); layout rules, not saved',
    renames: "renamed or deleted authored ids (old id -> new id, or null = deleted on purpose): the player's saved changes follow the new id",
    rules: 'condition words added by the game ({ conditions }); actions are ops, not effect words',
  },
  // ref of conditions / effects -> how to write the value (used to generate API docs)
  refs: {
    flag: "value is a flag name, e.g. 'metFisher'", counter: "value is a counter name, e.g. 'sunsetPhotos'", itemCounts: 'value is { itemId: count }, e.g. { berry: 3 }',
    counterCounts: 'value is { counterName: count }, e.g. { sunsetPhotos: 1 }', quest: 'value is a quest id', text: 'value is text',
    particles: 'value is { name, at: [x, y, z], count }', op: "value is ['noun.verb', { args }], e.g. ['shop.buy', { shop: 'bakery', item: 'bread' }]", position: 'value is a place name, or { place, x, z } / { x, z }', clock: "value is 'HH:MM'", any: 'value is passed to the function as is',
  },
  and: ' and ', then: ', ', fn: '(function)',
};
const S = RULE_STRINGS;

/** Built-in condition words of the engine */
export const CONDITIONS = RULE_STRINGS.conditions;
/** Built-in effect words of the engine */
export const EFFECTS = RULE_STRINGS.effects;
/** ref → ref -> how to write the value */
export const REFS = RULE_STRINGS.refs;
/** content file name -> description */
export const CONTENT_FILES = RULE_STRINGS.files;
/** Clock time notation 'HH:MM' (24-hour) */
export const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Merge the engine vocabulary and the game vocabulary (default export of the game's content/rules.js) -> { conditions, effects }. Games add conditions only */
export function mergeRules(game = {}) {
  return { conditions: { ...CONDITIONS, ...game.conditions }, effects: EFFECTS };
}
/** Every content name a game may use: the engine's files plus the game's kinds (rules.js kinds) -> description; the one list loader, content-check and GAMEMAP share */
export function contentFiles(game = {}) {
  const out = { ...CONTENT_FILES, startItems: 'starting items (exported from items.js)' };
  for (const [name, k] of Object.entries(game?.kinds || {})) out[name] ??= k?.desc || 'game data kind';
  return out;
}
/** Problems with a game's kinds table (name clashes with an engine file, no load): a list of messages */
export function kindProblems(game = {}) {
  return Object.entries(game?.kinds || {}).flatMap(([name, k]) => [
    ...(CONTENT_FILES[name] || name === 'startItems' ? [`kind "${name}" is an engine content file name: pick another name (engine files: ${Object.keys(CONTENT_FILES).join(', ')})`] : []),
    ...(typeof k?.load !== 'function' ? [`kind "${name}" has no load(e, data) function, so its data would never reach the game`] : []),
  ]);
}
/** Error text for a content name that is neither an engine file nor a registered kind */
export const unknownContent = (name, game) => `unknown content "${name}". Known: ${Object.keys(contentFiles(game)).join(', ')}. `
  + `For the game's own data, register it in content/rules.js: export default { kinds: { ${name}: { desc: '…', load: (e, data) => { … } } } }`;
/** Error text when a game's content/rules.js still exports effects */
export const NO_GAME_EFFECTS = "content/rules.js: games no longer add effect words. Register the action as an op (engine.ops.define('noun.verb', { can, run }) in main.js) "
  + "and call it from content with { op: ['noun.verb', { args }] }; see recipes/23-ops.md";

/** Wrap a single value into an array (a model written as 'tree' or ['tree', ...args]); the one copy for the content files @param {any} v @returns {any[]} */
export const list = v => (Array.isArray(v) ? v : [v]);
const say = (vocab, x) => Object.entries(x).map(([k, v]) => vocab[k]?.describe?.(v) ?? `${k} ${JSON.stringify(v)}`);

/** Describe a condition as one human-readable sentence (for the map); vocab defaults to the engine vocabulary */
export function describeCond(c, vocab = CONDITIONS) {
  if (!c) return '';
  if (typeof c === 'function') return S.fn;
  return list(c).map(x => say(vocab, x).join(S.and)).join(S.and);
}
/** Describe an effect as one human-readable sentence (for the map); vocab defaults to the engine vocabulary */
export function describeEffect(a, vocab = EFFECTS) {
  if (!a) return '';
  if (typeof a === 'function') return S.fn;
  return list(a).map(x => say(vocab, x).join(S.then)).join(S.then);
}
