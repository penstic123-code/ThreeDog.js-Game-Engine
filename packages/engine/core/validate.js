// Runtime checks: when an option or name is misspelled, print the fix to the console ("did you mean `xxx`?").
// Type checking (npm run types) catches mistakes while you write code; this catches the same kind at runtime, which also works for code without type checking.
//
//   checkOptions('npcs.add()', opts, ['name', 'schedule', ...])   // warns once on a key in opts that is not recognized
//   warnMissing('action', 'jupm', ['jump', 'run'])                // 'action "jupm" does not exist, did you mean `jump`? (available: jump, run)'
//   ownedProps('sky.sun.intensity', () => sun.intensity, "use engine.sky.modify('layerName', { sun })")   // warns when the game edits a property that is overwritten every frame
//
// On by default; createEngine({ validate: false }) turns it all off (for release builds). Each message warns only once.

import { hintText } from './errorHints.js';

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
  notOptions: '{where}: the second argument must be an options object {{ … }}, got {got}. API convention: a position is one argument, and size and the like go in the options object (see the API conventions)',
  owned: '{where} is recomputed every frame, so setting it directly gets overwritten{hint}',
  // Display names for each kind of name (the kind passed to warnMissing)
  kinds: {
    action: 'action', bus: 'audio bus', synth: 'synth', event: 'event', particle: 'particle effect', asset: 'asset', text: 'text key', module: 'module', weather: 'weather',
    dialogue: 'dialogue', node: 'dialogue node', shot: 'camera shot', track: 'music track', entityType: 'entity type', quest: 'quest', ease: 'easing',
    step: 'timeline step', animState: 'animation state', clip: 'animation clip', item: 'item', vegetation: 'vegetation', state: 'scenario', condition: 'condition word', effect: 'effect word', flowState: 'flow state', material: 'material role',
  },
};

/** Fill {name} placeholders from p (an unknown or null one stays as written). The one copy core shares (threadPure.js keeps its own: it must stay import-free). */
export const fmt = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m);
// Page-wide by design: the validate switch, the warn-once set and allowOwned exemptions are shared by every engine on the page
// (one validate setting per page; tests that run several engines all use the same setting).
let enabled = true;
/** Dev mode: npm run dev, or the test bundle built by npm test / npm run shot (vite.config defines import.meta.env.THREEDOG_TEST when THREEDOG_TEST is set). */
// Written exactly `import.meta.env`: the Vite 8 dev server only rewrites that literal form; `(import.meta).env` stayed undefined there, so every dev check was off under npm run dev
// @ts-ignore Vite's import.meta.env (undefined outside Vite)
const ENV = import.meta.env;
export const DEV = !!(ENV?.DEV || ENV?.THREEDOG_TEST);
const warned = new Set();

/** Global switch (the validate option of createEngine) */
export function setValidate(on) { enabled = on !== false; }

/** Warn only once (no warning when checks are off) */
export function warnOnce(msg) {
  if (!enabled || warned.has(msg)) return;
  warned.add(msg);
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

/** The entry of list closest to name; null if too far. Without maxDist the limit scales with length (longer names tolerate more errors). */
export function closest(name, list, maxDist) {
  name = String(name);
  const limit = maxDist ?? (name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3);
  let best = null, bd = Infinity;
  for (const c of list) { if (c === name) continue; const d = distance(name, String(c)); if (d < bd) { bd = d; best = c; } }
  return bd <= limit ? best : null;
}

const listText = list => { const a = [...list]; return a.length ? a.slice(0, 15).join(', ') + (a.length > 15 ? fmt(STRINGS.more, { n: a.length }) : '') : STRINGS.none; };

/** Text like 'xxx "name" does not exist, did you mean `yyy`? (available: a, b, c)', shared by errors and warnings. */
export function missingText(kind, name, list) {
  const c = closest(name, list), p = { what: STRINGS.kinds[kind] || kind, name, list: listText(list) };
  return c ? fmt(STRINGS.missing, { ...p, hint: fmt(STRINGS.didYouMean, { name: c }) }) : fmt(STRINGS.missingFar, p);
}
/** A name does not exist: warn once */
export function warnMissing(kind, name, list) {
  const id = kind + '\0' + name;   // may be called every frame: count each name once
  if (!enabled || warned.has(id)) return;
  warned.add(id);
  warnOnce(missingText(kind, name, list));
}

/**
 * Check an options object for unknown keys. where is the origin (such as 'npcs.add()'), known are the keys the code actually reads.
 * loose: warn only when a key is "very close to a known key" (for data like items and entities, where games often add their own fields).
 */
export function checkOptions(where, opts, known, { loose = false } = {}) {
  if (!enabled || !opts || typeof opts !== 'object' || Array.isArray(opts) || opts.isObject3D || opts.isVector3) return;
  for (const k of Object.keys(opts)) {
    if (known.includes(k)) continue;
    const c = closest(k, known);
    if (!c && loose) continue;
    warnOnce(fmt(STRINGS.unknownKey, { where, key: k, hint: c ? fmt(STRINGS.didYouMean, { name: c }) : fmt(STRINGS.available, { list: known.join(', ') }) }));
  }
}

/** Options argument under the new API convention: warn if a number or string was passed (most likely the old positional form), otherwise same as checkOptions. */
export function checkOptionsArg(where, opts, known) {
  if (opts != null && typeof opts !== 'object') { warnOnce(fmt(STRINGS.notOptions, { where, got: JSON.stringify(opts) }).replace('{{ … }}', '{ … }')); return; }
  checkOptions(where, opts, known);
}

/** Event name very close to another known event (dev only): warn only when 1 letter differs (2 for long names), to avoid false positives on the game's own events. */
export function checkEventName(name, known) {
  const c = closest(name, known, name.length >= 12 ? 2 : 1), digits = s => s.replace(/\d+/g, '#');
  if (c && digits(c) !== digits(name)) warnOnce(fmt(STRINGS.eventTypo, { name, hint: c }));
}

/** An engine.use dependency is not installed: text with the fix when the name is close to an installed module, otherwise null. */
export function requiresText(module, name, installed) {
  const c = closest(name, installed);
  return c ? fmt(STRINGS.requires, { module, name, hint: c, list: listText(installed) }) : null;
}

// ---------- properties overwritten every frame ----------
// Properties a module recomputes every frame (sky lights, camera position...) are silently overwritten if the game edits them directly. A module calls check() before writing and mark() after:
// if check() finds a value different from the last mark(), someone changed it in between, and it warns once. Active only in dev with checks on.

const exempt = new Set();
/** Legitimately take over these properties temporarily (such as a timeline tweening a light): allowOwned('timeline') ... allowOwned('timeline', false) */
export function allowOwned(owner, on = true) { if (on) exempt.add(owner); else exempt.delete(owner); }
/** where is the property name (for the message), read() returns a number or array of numbers (objects work too, compared by reference), hint is the fix. */
export function ownedProps(where, read, hint = '') {
  let snap = null;
  const on = () => enabled && DEV;
  return {
    check() {
      if (!on() || !snap || exempt.size) return;
      const v = [].concat(read());
      if (v.length !== snap.length || v.some((x, i) => x !== snap[i])) warnOnce(fmt(STRINGS.owned, { where, hint: hint ? '. ' + hint : '' }));
    },
    mark() { if (on()) snap = [].concat(read()); },
  };
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
