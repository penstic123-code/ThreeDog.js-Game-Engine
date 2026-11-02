// Field descriptions of content entries: one table per entry shape, in the core/params.js spec format (no second format).
// Three sources, one result (engine.content.fields(), content-check, the template loader all go through here):
//   1. placement fields of the engine's files (rules.js PLACEMENT_FIELDS: props, props.template, props.grid, pickups, views)
//   2. a template's state fields: the default is the value in state (the one place it is written), the type is inferred from it; the template's
//      optional `fields` adds range / values / desc:  crop: { state: { stage: 0 }, fields: { stage: { type: 'int', min: 0, max: 4 } } }
//   3. a game kind's `fields` (rules.js kinds.<name>.fields): the keys of each entry of content/<name>.js
// Why `default` is refused inside fields: a default written twice (state and fields) drifts; the value in state / the data is the only one.
// Node-safe (no three): packages/tools/content-check imports this file directly.
import { PLACEMENT_FIELDS } from './rules.js';
import { parseSpec, whyBad } from '../../core/params.js';
import { closest, fmt } from '../../core/validate.js';

const STRINGS = {
  noDefault: "{where}: fields.{key} has a default; defaults live only in {home} (one place), fields hold only type, min, max, values, desc",
  notState: "{where}: fields.{key} names no state field{hint}; fields describe the keys of state ({list})",
  stateBad: '{where}: state.{key} = {got} does not fit fields.{key}: {why}',
  unknown: "{where}: unknown field '{key}'{hint}. Fields: {list}",
  bad: '{where}: {key} {why}',
  required: '{where}: {key} is required',
  reserved: "{where}: state.{key} is a world record field of every instance (id, kind, position): rename the state field",
};
// state is spread onto the instance record after id / kind / position, so a state field with one of these names silently overwrote it
const RECORD_KEYS = ['id', 'kind', 'position'];
const hintOf = (k, list) => { const c = closest(k, list); return c ? ` (did you mean '${c}'?)` : ''; };

/** The spec type a value has, so a state default needs no written type ('number' for any number: an int default may still take 2.5) */
function typeOf(v) {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  if (v && typeof v === 'object') return 'object';
  return 'any';
}

/** Parse a whole table, collecting problems instead of throwing (content-check wants every message, the engine throws the first) */
function parseAll(where, specs, problems) {
  const out = {};
  for (const [key, spec] of Object.entries(specs)) {
    try { out[key] = parseSpec(where, key, spec, msg => new Error(msg)); } catch (err) { problems.push(err.message); }
  }
  return out;
}

const placementCache = new Map();
/** Parsed placement fields of an engine entry shape ('props', 'props.template', 'props.grid', 'pickups', 'views'), or null */
export function placementShape(shape) {
  if (!PLACEMENT_FIELDS[shape]) return null;
  if (!placementCache.has(shape)) placementCache.set(shape, parseAll(`content ${shape}`, PLACEMENT_FIELDS[shape], []));
  return placementCache.get(shape);
}

/**
 * A content `fields` table (template or game kind) -> { shape, problems }. With state (a template): every key must be a state key, the type is
 * inferred from the state value when not written, the state value must fit; state keys without an entry get { type: inferred }.
 * @param {string} where e.g. "template 'crop'" or "kind 'recipes'"
 * @param {Record<string, any> | undefined} fields
 * @param {Record<string, any> | null} [state]
 */
export function fieldsShape(where, fields, state = null) {
  const problems = [], specs = {}, home = state ? 'state' : 'the data itself (or the code that reads it)';
  const stateKeys = state ? Object.keys(state) : null;
  if (fields !== undefined && (!fields || typeof fields !== 'object' || Array.isArray(fields))) return { shape: {}, problems: [`${where}: fields must be an object { key: 'int?' | { type, min, max, values, desc } }`] };
  for (const [key, spec] of Object.entries(fields || {})) {
    if (stateKeys && !stateKeys.includes(key)) { problems.push(fmt(STRINGS.notState, { where, key, hint: hintOf(key, stateKeys), list: stateKeys.join(', ') || 'none' })); continue; }
    if (spec && typeof spec === 'object' && 'default' in spec) { problems.push(fmt(STRINGS.noDefault, { where, key, home })); continue; }
    // a template may leave the type out ({ min: 0, max: 4 }): it is the state value's type
    specs[key] = state && spec && typeof spec === 'object' && !('type' in spec) ? { type: typeOf(state[key]), ...spec } : spec;
  }
  for (const key of stateKeys || []) if (RECORD_KEYS.includes(key)) problems.push(fmt(STRINGS.reserved, { where, key }));
  for (const key of stateKeys || []) specs[key] ??= { type: typeOf(state[key]), optional: true };
  const shape = parseAll(where, specs, problems);
  for (const key of stateKeys || []) {
    if (!shape[key]) continue;
    shape[key].optional = true;   // a placement may leave any state field out: the state value fills it
    const why = whyBad(shape[key], state[key]);
    if (why) problems.push(fmt(STRINGS.stateBad, { where, key, got: JSON.stringify(state[key]), why }));
  }
  return { shape, problems };
}

/**
 * Problems of one entry against a parsed shape: unknown keys (with the closest name), values of the wrong type, out of range or not in values,
 * and (required: true) missing non-optional keys. Returns messages; an empty list = fine.
 * @param {string} where e.g. 'prop #3'
 * @param {Record<string, any>} entry
 * @param {Record<string, any>} shape
 * @param {{ required?: boolean, also?: Record<string, any> }} [opts] also: more parsed fields allowed on this entry (a template's state fields)
 */
export function entryProblems(where, entry, shape, { required = false, also = null } = {}) {
  const all = also ? { ...shape, ...also } : shape, keys = Object.keys(all), out = [];
  if (!entry || typeof entry !== 'object') return out;
  for (const [key, v] of Object.entries(entry)) {
    const s = all[key];
    if (!s) { out.push(fmt(STRINGS.unknown, { where, key, hint: hintOf(key, keys), list: keys.join(', ') })); continue; }
    if (v === undefined) continue;
    const why = whyBad(s, v);
    if (why) out.push(fmt(STRINGS.bad, { where, key, why }));
  }
  if (required) for (const key of keys) if (!all[key].optional && entry[key] === undefined) out.push(fmt(STRINGS.required, { where, key }));
  return out;
}
