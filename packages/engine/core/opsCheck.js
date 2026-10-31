// Dev checks for engine.ops (split out of Ops.js): op definition shape, argument plain-data and shape checks, and their error texts.
// Each message says what is wrong and how to write it, because the reader is usually an AI that will fix the call from the text alone.
import { closest, fmt } from './validate.js';
import { codedError } from './errorHints.js';

export const SOURCES = ['player', 'game', 'bridge', 'test', 'replay', 'net'];
const TYPES = ['string', 'number', 'int', 'bool', 'position', 'id', 'any'];
const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const DEF_KEYS = ['desc', 'args', 'can', 'run', 'offers', 'reasons', 'undo', 'net', 'owner'];
export { fmt };
const STRINGS = {
  badName: "ops.define('{name}'): name an op noun.verb, e.g. 'shop.buy' (lowercase start, camelCase)",
  noRun: "ops.define('{name}'): run(e, args, ctx) is required; it changes state. Put the \"may I\" checks in can(e, args, ctx)",
  badKey: "ops.define('{name}'): unknown field '{key}'{hint}. Fields: " + DEF_KEYS.join(', '),
  badType: "ops.define('{name}'): args.{key} has type '{type}'; use one of " + TYPES.join(' ') + " (add ? for optional, e.g. 'int?')",
  badNet: "ops.define('{name}'): net is 'peer' (remote players may request it) or 'local' (runs on each machine, e.g. UI settings); leave it out to let only the host run it",
  badOwner: "ops.define('{name}'): owner is a function of the args returning the world record id the actor must own, e.g. owner: a => a.id",
  notPlain: "ops.run('{name}'): argument {key} is {what}; pass plain data: {fix}",
  argsObj: "ops.run('{name}'): args must be a plain object like { item: 'bread' }, got {what}",
  missing: "ops.run('{name}') is missing {key} (args: {shape})",
  extra: "ops.run('{name}'): unknown argument {key}{hint} (args: {shape})",
  wrong: "ops.run('{name}'): {key} should be {type}, got {got} (args: {shape})",
  noRecord: "ops.run('{name}'): {key} '{id}' is not a world record id",
};
const what = v => typeof v === 'function' ? 'a function' : v?.isVector3 ? 'a Vector3' : v?.isObject3D ? 'a three.js object' : (v?.constructor?.name ? 'a ' + v.constructor.name : typeof v);

/** Plain data check (dev): returns null or a description of the first non-plain value. Plain = string, finite number, boolean, null, arrays and plain objects of those */
function notPlain(v, depth = 0) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : String(v);
  if (typeof v !== 'object' || depth > 8) return what(v);
  if (Array.isArray(v)) { for (const x of v) { const b = notPlain(x, depth + 1); if (b) return b; } return null; }
  const p = Object.getPrototypeOf(v);
  if (p !== Object.prototype && p !== null) return what(v);
  for (const k in v) { const b = notPlain(v[k], depth + 1); if (b) return b; }
  return null;
}
const isPos = v => Array.isArray(v) && (v.length === 2 || v.length === 3) && v.every(Number.isFinite);
const CHECK = {
  string: v => typeof v === 'string', number: v => Number.isFinite(v), int: v => Number.isInteger(v), bool: v => typeof v === 'boolean',
  position: isPos, id: v => typeof v === 'string', any: () => true,
};

/** Dev mistakes (wrong name, args, can result) are thrown straight to the caller, not treated as gameplay errors */
export function devError(msg) { const err = codedError('op-misuse', msg); err.opsDevError = true; return err; }

/** Check a definition and return its parsed args shape ({ key: { type, optional } } or null) */
export function checkDef(name, def) {
  if (typeof name !== 'string' || !NAME.test(name)) throw devError(fmt(STRINGS.badName, { name }));
  if (typeof def?.run !== 'function') throw devError(fmt(STRINGS.noRun, { name }));
  for (const key of Object.keys(def)) {
    if (DEF_KEYS.includes(key)) continue;
    const c = closest(key, DEF_KEYS);
    throw devError(fmt(STRINGS.badKey, { name, key, hint: c ? ` (did you mean ${c}?)` : '' }));
  }
  if (def.net !== undefined && def.net !== 'peer' && def.net !== 'local') throw devError(fmt(STRINGS.badNet, { name }));
  if (def.owner !== undefined && typeof def.owner !== 'function') throw devError(fmt(STRINGS.badOwner, { name }));
  if (!def.args) return null;
  const shape = {};
  for (const key in def.args) {
    const t = String(def.args[key]), type = t.replace(/\?$/, '');
    if (!TYPES.includes(type)) throw devError(fmt(STRINGS.badType, { name, key, type: t }));
    shape[key] = { type, optional: t.endsWith('?') };
  }
  return shape;
}

/** Dev: args are a plain object of plain data and fit the shape; throws with the fix */
export function checkArgs(e, d, args) {
  const name = d.name;
  const proto = typeof args === 'object' ? Object.getPrototypeOf(args) : undefined;
  if (proto !== Object.prototype && proto !== null) throw devError(fmt(STRINGS.argsObj, { name, what: Array.isArray(args) ? 'an array' : what(args) }));
  for (const key in args) {
    const bad = notPlain(args[key]);
    if (bad) throw devError(fmt(STRINGS.notPlain, { name, key, what: bad, fix: args[key]?.isVector3 || args[key]?.isObject3D ? `${key}: [x, y, z]` : 'strings, numbers, booleans, arrays and plain objects' }));
  }
  if (!d.shape) return;
  const shapeText = JSON.stringify(d.args).replace(/"/g, "'");
  for (const key in args) if (!d.shape[key]) { const c = closest(key, Object.keys(d.shape)); throw devError(fmt(STRINGS.extra, { name, key, hint: c ? ` (did you mean ${c}?)` : '', shape: shapeText })); }
  for (const key in d.shape) {
    const s = d.shape[key], v = args[key];
    if (v === undefined) { if (!s.optional) throw devError(fmt(STRINGS.missing, { name, key, shape: shapeText })); continue; }
    if (!CHECK[s.type](v)) throw devError(fmt(STRINGS.wrong, { name, key, type: s.type === 'position' ? '[x, y, z]' : s.type, got: JSON.stringify(v), shape: shapeText }));
    if (s.type === 'id' && e.world && !e.world.get(v)) throw devError(fmt(STRINGS.noRecord, { name, key, id: v }));
  }
}
