// Runtime checks: when an option or name is misspelled, print the fix to the console ("did you mean `xxx`?").
// Type checking (npm run types) catches mistakes while you write code; this catches the same kind at runtime, which also works for code without type checking.
//
//   readParams('npcs.add()', NPC_PARAMS, opts)                    // options: an unknown key throws in dev (core/params.js)
//   checkOptions('inventory.define()', def, KEYS, { loose: true })  // extensible data: warns once on a near-miss key
//   warnMissing('action', 'jupm', ['jump', 'run'])                // 'action "jupm" does not exist, did you mean `jump`? (available: jump, run)'
// Properties the engine writes every frame (sky lights, camera ...) are core/owned.js defineOwned: the engine yields to a direct write and warns once
//
// On by default; createEngine({ validate: false }) turns it all off (for release builds). Each message warns only once.

import { hintText, coded, codedError } from './errorHints.js';

const STRINGS = {
  unknownKey: '{where}: unknown option "{key}", {hint}',
  didYouMean: 'did you mean `{name}`?',
  available: 'available options: {list}',
  missing: '{what} "{name}" does not exist, {hint} (available: {list})',
  missingFar: '{what} "{name}" does not exist (available: {list})',
  none: 'none yet',
  more: ', ... {n} total',
  eventTypo: 'event "{name}" was never emitted or listened to; did you mean `{hint}`? (shown only because the names are similar; ignore it if this really is a new event)',
  requires: 'module {module} requires module "{name}", which is not installed; did you mean `{hint}`? (installed: {list})',
  // Display names for each kind of name (the kind passed to warnMissing)
  kinds: {
    action: 'action', bus: 'audio bus', synth: 'synth', event: 'event', particle: 'particle effect', asset: 'asset', text: 'text key', module: 'module', weather: 'weather',
    dialogue: 'dialogue', node: 'dialogue node', shot: 'camera shot', track: 'music track', entityType: 'entity type', quest: 'quest', ease: 'easing',
    step: 'timeline step', animState: 'animation state', clip: 'animation clip', item: 'item', vegetation: 'vegetation', state: 'scenario', condition: 'condition word', effect: 'effect word', flowState: 'flow state', material: 'material role',
  },
};

/**
 * Fill {name} placeholders from p (an unknown or null one stays as written). The one copy core shares (threadPure.js keeps its own: it must stay import-free).
 */
export const fmt = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m);
// Page-wide by design: the validate switch, the warn-once set and owned.js allowOwned exemptions are shared by every engine on the page
// (one validate setting per page; tests that run several engines all use the same setting).
let enabled = true;
/** Dev mode: npm run dev, or the test bundle built by npm test / npm run shot (vite.config defines import.meta.env.THREEDOG_TEST when THREEDOG_TEST is set). */
// Written exactly `import.meta.env`: the Vite 8 dev server only rewrites that literal form; `(import.meta).env` stayed undefined there, so every dev check was
// off under npm run dev
// @ts-ignore Vite's import.meta.env (undefined outside Vite)
const ENV = import.meta.env;
export const DEV = !!(ENV?.DEV || ENV?.THREEDOG_TEST);
const warned = new Set();

/**
 * Renamed fields of a plain data object the engine hands back (an op / trade / grid result, runState, describe()): in dev, reading an old name
 * throws [renamed-field] with the new one. Why one helper instead of per-field code: a renamed field reads `undefined` silently, so 0.2 code took
 * the wrong branch without a word; every such object goes through this one place. Non-enumerable, so JSON, spreads and Object.keys never see it.
 * @template {object} T @param {T} obj @param {Record<string, string>} renamed old name -> the new way to read it @param {string} where @returns {T}
 */
export function renamedFields(obj, renamed, where) {
  if (!DEV) return obj;
  for (const [old, now] of Object.entries(renamed)) {
    Object.defineProperty(obj, old, { enumerable: false, configurable: true, get() { throw codedError('renamed-field', `${where}.${old} was renamed: read ${now}`); } });
  }
  return obj;
}

/** Global switch (the validate option of createEngine) */
export function setValidate(on) { enabled = on !== false; }
/** Are dev checks on (createEngine({ validate }) / setValidate) */
export const validateOn = () => enabled;

/**
 * Warn only once (no warning when checks are off). The one dedupe for engine warnings: modules do not keep private "already warned" sets.
 * @param {string} msg  the text, usually coded(code, text) so it carries its fix
 * @param {string} [key]  what counts as "the same warning" when the text has changing parts (a measured value each second, a stack line); default the text
 */
export function warnOnce(msg, key = msg) {
  if (!enabled || warned.has(key)) return;
  warned.add(key);
  console.warn(DEV ? msg + hintText(msg) : msg);   // the fix + doc page only in dev: release builds drop the hint table
}

/** Edit distance (case-insensitive; swapping two adjacent letters counts as 1, e.g. jupm -> jump) */
function distance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/**
 * The entry of list closest to name; null if too far. Without maxDist the limit scales with length (longer names tolerate more errors).
 * Too far by spelling, a name of 4+ letters that is part of exactly one entry still matches ('forward' -> 'moveForward'): AIs often drop a prefix.
 */
export function closest(name, list, maxDist) {
  name = String(name);
  const limit = maxDist ?? (name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3);
  let best = null, bd = Infinity;
  for (const c of list) { if (c === name) continue; const d = distance(name, String(c)); if (d < bd) { bd = d; best = c; } }
  if (bd <= limit) return best;
  if (maxDist != null || name.length < 4) return null;
  const low = name.toLowerCase(), part = [...list].filter(c => String(c).toLowerCase().includes(low));
  return part.length === 1 ? part[0] : null;
}

const listText = list => { const a = [...list]; return a.length ? a.slice(0, 15).join(', ') + (a.length > 15 ? fmt(STRINGS.more, { n: a.length }) : '') : STRINGS.none; };

/** Text like 'xxx "name" does not exist, did you mean `yyy`? (available: a, b, c)', shared by errors and warnings. */
export function missingText(kind, name, list) {
  const c = closest(name, list), p = { what: STRINGS.kinds[kind] || kind, name, list: listText(list) };
  return c ? fmt(STRINGS.missing, { ...p, hint: fmt(STRINGS.didYouMean, { name: c }) }) : fmt(STRINGS.missingFar, p);
}
/** A name does not exist: warn once */
export function warnMissing(kind, name, list) {
  // may be called every frame: keyed by the name, so the list text is built only the first time
  if (!enabled || warned.has(kind + '\0' + name)) return;
  warnOnce(coded('unknown-name', missingText(kind, name, list)), kind + '\0' + name);
}

/**
 * The one unknown-option rule, shared by readParams (options: strict) and checkOptions (extensible data): text for a key not in known, or null when it is fine.
 * Why one function: the "did you mean" search and the wording must not drift between the two readers.
 * soft: a key with no close match is not reported (data like items and template state, where games add their own fields).
 */
export function unknownOptionText(where, key, known, { soft = false } = {}) {
  if (known.includes(key)) return null;
  const c = closest(key, known);
  if (!c && soft) return null;
  return fmt(STRINGS.unknownKey, { where, key, hint: c ? fmt(STRINGS.didYouMean, { name: c }) : fmt(STRINGS.available, { list: known.join(', ') }) });
}
/** Is options an object a game passed (not a Three.js object, array or missing)? */
const isOptionsObject = o => !!o && typeof o === 'object' && !Array.isArray(o) && !o.isObject3D && !o.isVector3;

/**
 * Unknown keys in extensible data (item definitions, template instance state, material specs: objects where games add their own fields): warn once.
 * Options bags of public calls do not come here: they go through readParams (core/params.js), where an unknown key throws in dev with the
 * did-you-mean and warns once in a release build. 为什么分两条：选项拼错一定是 bug，该当场停下；可扩展数据里多出的字段可能是游戏自己的，只提示近似拼写（loose）。
 * where is the origin (such as 'inventory.define()'), known are the keys the code reads. loose: report only near-misses.
 */
export function checkOptions(where, opts, known, { loose = false } = {}) {
  if (!enabled || !isOptionsObject(opts)) return;
  for (const k of Object.keys(opts)) {
    const msg = unknownOptionText(where, k, known, { soft: loose });
    if (!msg) continue;
    warnOnce(coded('unknown-option', msg));
  }
}

/**
 * Event name very close to another known event (dev only): warn only when 1 letter differs (2 for long names), to avoid false positives on the game's own
 * events.
 */
export function checkEventName(name, known) {
  const c = closest(name, known, name.length >= 12 ? 2 : 1), digits = s => s.replace(/\d+/g, '#');
  if (c && digits(c) !== digits(name)) warnOnce(coded('event-typo', fmt(STRINGS.eventTypo, { name, hint: c })));
}

/** An engine.use dependency is not installed: text with the fix when the name is close to an installed module, otherwise null. */
export function requiresText(module, name, installed) {
  const c = closest(name, installed);
  return c ? fmt(STRINGS.requires, { module, name, hint: c, list: listText(installed) }) : null;
}

/**
 * Freeze a shared definition (content template, item, entity type) and every plain object / array inside it, in place; returns it.
 * Every instance reads the same definition, so a write would silently change all of them: frozen, the write throws instead
 * (error hint 'frozen-definition' says to keep per-instance state on the world record). Functions and class instances are left alone.
 * @example const def = freezeDef({ state: { opened: false } }); def.state.opened = true;   // TypeError: Cannot assign to read only property 'opened'
 * @template T
 * @param {T} v
 * @returns {T}
 */
export function freezeDef(v) {
  if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) freezeDef(v[k]);
  return v;
}

/**
 * A module's key for its action (inventory's open key, quests', photo's): the game passes keys (keys: [] for none), binds the action itself in
 * createEngine({ bindings }), or spreads a presets.keys bundle. No module picks a key on its own: I / J / P are one genre's habits, not every game's.
 * @param {string} fn  the module call for the message, e.g. 'inventory()'
 * @param {string} action
 * @param {string | string[] | undefined} keys
 * @param {string} preset  the presets.keys entry that bundles a key, e.g. 'inventory'
 * @param {any} input  engine.input
 * @returns {string[]}
 * @internal
 */
export function moduleKeys(fn, action, keys, preset, input) {
  if (keys !== undefined) return [].concat(keys);
  if (input._bound[action]) return [].concat(input._bound[action]);
  const call = fn.replace('()', '');
  throw new TypeError(`[input-keys] ${fn}: no key for the '${action}' action (the engine binds no gameplay key). Pick one: ${call}({ ...presets.keys.${preset} }) `
    + `(import { presets } from 'threedog'), ${call}({ keys: ['KeyX'] }), createEngine({ bindings: { ${action}: ['KeyX'] } }), or ${call}({ keys: [] }) for no key`);
}
