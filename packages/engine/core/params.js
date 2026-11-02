// Param schemas: one plain-object description per field, shared by op args (ops.define args) and module params (readParams).
// Why one shape for both: the same schema validates the call, fills its defaults and is what engine.catalog() shows, so code,
// catalog and the dev bridge cannot disagree about a field (no second copy in docs or TypeScript).
//   short form:  'int' / 'int?'  (type, ? = optional)
//   full form:   { type: 'int', default: 1, min: 1, max: 99, values: [...], desc: 'how many', optional: true }  (default implies optional)
import { closest, fmt, DEV, warnOnce, unknownOptionText } from './validate.js';
import { codedError, coded } from './errorHints.js';

/** Types an op arg may use: plain data only. Two meanings of 'id' on purpose: as a module param it is any string; as an op arg it must also be a world record id (checked in dev by opsCheck) */
export const OP_TYPES = ['string', 'number', 'int', 'bool', 'position', 'id', 'any'];
// 'color': 0xRRGGBB or '#rrggbb' (a model generator's params, shown as a color picker in the dev panel); not an op arg type
const TYPES = ['string', 'number', 'int', 'bool', 'position', 'id', 'any', 'object', 'array', 'function', 'color'];
const SPEC_KEYS = ['type', 'default', 'min', 'max', 'values', 'desc', 'optional'];
const isPos = v => Array.isArray(v) && (v.length === 2 || v.length === 3) && v.every(Number.isFinite);
/** type name -> value check (op args use the first seven: plain data only) */
export const CHECK = {
  string: v => typeof v === 'string', number: v => Number.isFinite(v), int: v => Number.isInteger(v), bool: v => typeof v === 'boolean',
  position: isPos, id: v => typeof v === 'string', any: () => true, object: v => !!v && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray, function: v => typeof v === 'function',
  color: v => (Number.isInteger(v) && v >= 0 && v <= 0xffffff) || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)),
};
const STRINGS = {
  badType: "{where}: {key} has type '{type}'; use one of {list} (add ? for optional, e.g. 'int?', or { type: 'int', default: 1 })",
  badSpec: '{where}: {key} has unknown schema field {field}{hint}; schema fields: ' + SPEC_KEYS.join(', '),
  badDefault: '{where}: the default of {key} ({got}) does not fit its own schema: {why}',
  wrong: '{where}: {key} {why}',
  notOptions: '{where}: the options argument must be an object { … }, got {got}. API convention: a position is one argument, and size and the like go in the options object',
};
// 为什么缓存：公开 API（collision.addCircle、particles.emit …）每次调用都走 readParams，同一个 schema 对象只解析一次；
// 每次新写的字面量 schema 不进缓存（WeakMap 按对象认，用完即回收），只是多解析一遍
const parsed = new WeakMap(), keyCache = new WeakMap();
/** Is o an options object (not a number, string, array, Three.js object or vector)? Data checks use it where a field may also be a name or a list */
export const isOptions = o => !!o && typeof o === 'object' && !Array.isArray(o) && !o.isObject3D && !o.isVector3 && !o.isColor;
const parsedOf = (where, schema) => { let s = parsed.get(schema); if (!s) { s = parseSchema(where, schema); parsed.set(schema, s); } return s; };

/** Parse one field spec ('int?' or { type, default, ... }) into { type, optional, default?, min?, max?, values?, desc? }; throws on a bad spec */
export function parseSpec(where, key, spec, err = codedError.bind(null, 'engine-misuse')) {
  const s = typeof spec === 'string' ? { type: spec.replace(/\?$/, ''), optional: spec.endsWith('?') } : { ...spec };
  if (typeof spec !== 'string') {
    for (const f of Object.keys(s)) if (!SPEC_KEYS.includes(f)) {
      const c = closest(f, SPEC_KEYS);
      throw err(fmt(STRINGS.badSpec, { where, key, field: f, hint: c ? ` (did you mean ${c}?)` : '' }));
    }
    s.optional = !!s.optional || 'default' in s;
  }
  if (!TYPES.includes(s.type)) throw err(fmt(STRINGS.badType, { where, key, type: String(s.type ?? spec), list: TYPES.join(' ') }));
  if ('default' in s) { const why = whyBad(s, s.default); if (why) throw err(fmt(STRINGS.badDefault, { where, key, got: JSON.stringify(s.default), why })); }
  return s;
}

/** Parse a whole schema ({ key: spec }) -> { key: parsed } (null when there is none) */
export function parseSchema(where, schema, err) {
  if (!schema) return null;
  const out = {};
  for (const key in schema) out[key] = parseSpec(where, key, schema[key], err);
  return out;
}

/** Why v does not fit the parsed spec s (type, range, allowed values), or null when it does */
export function whyBad(s, v) {
  if (!CHECK[s.type](v)) return `should be ${s.type === 'position' ? '[x, y, z]' : s.type}, got ${JSON.stringify(v) ?? typeof v}`;
  if (s.min != null && v < s.min) return `must be >= ${s.min}, got ${v}`;
  if (s.max != null && v > s.max) return `must be <= ${s.max}, got ${v}`;
  if (s.values && !s.values.includes(v)) return `must be one of ${s.values.map(x => JSON.stringify(x)).join(', ')}, got ${JSON.stringify(v)}`;
  return null;
}

/** { key: default } of the fields that declare one, or null when none do (so callers skip the copy) */
export function defaultsOf(shape) {
  let out = null;
  for (const key in shape || {}) if ('default' in shape[key]) (out ??= {})[key] = shape[key].default;
  return out;
}

/** args with the missing fields filled from defaults (a new object; args itself may be frozen) */
export function withDefaults(defaults, args) {
  if (!defaults) return args;
  const out = { ...args };
  for (const k in defaults) if (out[k] === undefined) out[k] = defaults[k];
  return out;
}

/** Shape as plain data for engine.catalog() and the dev bridge: functions and undefined fields left out */
export function schemaInfo(shape) {
  if (!shape) return null;
  const out = {};
  for (const key in shape) {
    const s = shape[key], o = /** @type {Record<string, any>} */ ({ type: s.type });
    if (s.optional) o.optional = true;
    for (const f of ['default', 'min', 'max', 'values', 'desc']) if (s[f] !== undefined && typeof s[f] !== 'function') o[f] = s[f];
    out[key] = o;
  }
  return out;
}

/**
 * Module options read through a params schema: unknown keys and wrong types throw (with the fix), defaults are filled in.
 * Put the schema on the module definition too (`params`, `options`), so engine.catalog(name) shows every option, its default and the value in use.
 * @param {string} where who reads them, for the error text (the module name)
 * @param {Record<string, string | { type: string, default?: any, min?: number, max?: number, values?: any[], desc?: string, optional?: boolean }>} schema
 * @param {object} [opts] what the game passed
 * @returns {object} opts with defaults filled in
 * @example
 * const PARAMS = { radius: { type: 'number', default: 2, min: 0, desc: 'pickup reach in m' }, sound: 'string?' };
 * export const magnet = (opts) => {
 *   const o = readParams('magnet', PARAMS, opts);
 *   return { name: 'magnet', params: PARAMS, options: o, install(e) { return { radius: o.radius }; } };
 * };
 */
export function readParams(where, schema, opts = {}) {
  const shape = parsedOf(where, schema), err = msg => codedError('module-params', msg);
  if (opts != null && !isOptions(opts)) {
    // 选项位置传了数字 / 字符串 / 数组：多半是旧的按位置传参写法。和未知键同一条规矩（开发时抛错，发布版提示一次后当没传）
    const msg = fmt(STRINGS.notOptions, { where, got: JSON.stringify(opts) ?? typeof opts });
    if (DEV) throw err(msg);
    warnOnce(coded('module-params', msg)); opts = {};
  }
  const out = withDefaults(defaultsOf(shape), opts ?? {});   // checked in every build: it runs once per factory call, and a wrong option is a bug anywhere
  const keys = Object.keys(shape);
  for (const key of Object.keys(out)) if (!shape[key]) {
    const msg = unknownOptionText(where, key, keys);   // one rule with checkOptions (validate.js)
    if (DEV) throw err(msg);   // an option typo: dev throws, a release build warns once and ignores it (decision 2026-11-01), so a shipped game never dies on a typo
    warnOnce(coded('module-params', msg));
  }
  for (const key of keys) {
    const v = out[key];
    if (v === undefined) { if (!shape[key].optional) throw err(fmt(STRINGS.wrong, { where, key, why: 'is required' })); continue; }
    const why = whyBad(shape[key], v);
    if (why) throw err(fmt(STRINGS.wrong, { where, key, why }));
  }
  return out;
}

/**
 * Schema for a module whose options are a key list (and maybe a defaults object): every key is `any` (nothing about the value is checked
 * beyond the spelling of the key), and a key present in `defaults` shows that default in engine.catalog(). Why `any`: these modules' options
 * accept several shapes (number | [x, z], preset name | object), and their own code already checks the values; the schema is for the key
 * list, the catalog and R06. Pass `specs` ({ key: 'int?' | { type, ... } }) to give a key a real type; it wins over the generic one.
 * @param {string[]} keys
 * @param {Record<string, any>} [defaults] defaults shown in the catalog (not applied: the module's own code still does that)
 * @param {Record<string, any>} [specs]
 */
export function keysSchema(keys, defaults, specs) {
  // 只有键表时按数组对象缓存：模块顶层的 KEYS 常量每次调用拿到同一个 schema，readParams 的解析缓存也就命中（热路径如 particles.emit 不重复解析）
  if (!defaults && !specs) { let s = keyCache.get(keys); if (!s) keyCache.set(keys, s = keysSchema(keys, {}, {})); return s; }
  defaults ??= {}; specs ??= {};
  const out = {};
  for (const k of keys) out[k] = specs[k] ?? (defaults[k] !== undefined ? { type: 'any', default: defaults[k] } : 'any?');
  return out;
}
