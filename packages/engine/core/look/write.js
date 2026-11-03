// How a value gets into a LookPart: normalize, flatten, check, then write one owner's layer (part.js has the verbs a game and a part author call).
// Why a file of its own: this is the one path set(), engine.debug.override and a style swap share, and it is the part that grows with every new
// kind of check; the verbs in part.js stay short and the file-size cap holds. Functions take the part as `p`; LookPart methods delegate here.
import { closest, warnOnce } from '../validate.js';
import { whyBad } from '../params.js';
import { codedError, coded } from '../errorHints.js';
import { isPlainObject } from '../util.js';
import { REPLACE, HOOK, writeKeys, writeStyle } from './points.js';

/** A sample call for error texts: { <first key>: <its default> } */
export function example(p) { const k = Object.keys(p._params)[0]; return k ? `{ ${k}: ${JSON.stringify(p._params[k].default)} }` : '{...}'; }

/** { sun: { intensity } } -> { 'sun.intensity' } for keys the part declares dotted */
function flat(p, params) {
  const out = {}, keys = Object.keys(p._params);
  for (const [k, v] of Object.entries(params)) {
    if (!(k in p._params) && isPlainObject(v) && keys.some(q => q.startsWith(k + '.'))) for (const [s, sv] of Object.entries(v)) out[`${k}.${s}`] = sv;
    else out[k] = v;
  }
  return out;
}

/** Unknown keys and wrong values throw with the fix (same schema and wording as module params, params.js) */
function check(p, values) {
  const keys = Object.keys(p._params);
  for (const [k, v] of Object.entries(values)) {
    if (!(k in p._params)) { const c = closest(k, keys); throw codedError('look-param', `${p.id}.set(): unknown key ${k}${c ? ` (did you mean ${c}?)` : ''}; keys: ${keys.join(', ')}`); }
    if (v === null || (typeof v === 'function' && p._meta[k].fn)) continue;   // fn keys: a function of the frame context (state.js)
    const why = whyBad(p._params[k], v) ?? p._meta[k].check?.(v);
    if (why) throw codedError('look-param', `${p.id}.set(): ${k} ${why}`);
  }
  return values;
}

/** set() and engine.debug.override share this, so both normalize, flatten and check the same way (review M8) */
export function setOn(p, layer, owner, params) {
  if (!isPlainObject(params)) throw codedError('look-param', `${p.id}.set(params): params is an object of keys to change, e.g. ${example(p)}; got ${JSON.stringify(params)}`);
  const values = check(p, flat(p, p._spec.normalize?.(params) ?? params));   // normalize: a part's shorthand (post: { bloom: false })
  const to = p._spec.appliesTo;
  if (layer === 'debug' && to) warnOnce(coded('look-param', `${p.id}: a debug override changes only ${to}; what was made before keeps its look`));
  return writeLayer(p, layer, owner, values);
}

/** Replace the style layer (start, or a style swap); game and debug layers stay */
export function setStyle(p, values) {
  const given = Object.fromEntries(Object.entries(flat(p, values ?? {})).filter(([, v]) => v != null));
  const params = Object.fromEntries(Object.entries(given).filter(([k]) => k !== REPLACE && !k.startsWith(HOOK) && !k.startsWith('replace:')));   // a style may also fill the replace slot(s) / hooks
  check(p, params);   // a style value of the wrong type throws at start, with the key
  writeStyle(p, given);
}

/** Where spec.validate's answer is quoted: the verb that carried the bad value, so the fix reads as a call */
const quoteVerb = (p, k) => k === REPLACE ? `${p.id}.replace(impl): impl` : k.startsWith(HOOK) ? `${p.id}.patch('${k.slice(HOOK.length)}', glsl):` : `${p.id}: ${k}`;

/** Write one owner's keys on a layer (game unless named). All or nothing: if apply throws, the points and the picture go back (review H1) */
export function writeLayer(p, layer, owner, values) {
  if (!owner || typeof owner !== 'string') throw codedError('look-param', `${p.id}: owner is a non-empty string naming who changes it, e.g. { owner: 'cave' }`);
  for (const [k, v] of Object.entries(values)) {   // spec.validate stops a bad hook / replace value (or any key) before anything is written
    const why = v === null ? null : p._spec.validate?.(k, v);
    if (why) throw codedError(k === REPLACE || k.startsWith(HOOK) ? 'look-verb' : 'look-param', `${quoteVerb(p, k)} ${why}`);
  }
  return writeKeys(p, layer, owner, values);
}

/** A verb with its own call shape (spec.verbs[verb].take): take(bad, ...args) -> [values, owner]; bad(msg) throws quoting the signature */
export function takeVerb(p, verb, args) {
  const sig = p.author.signatures[verb], bad = msg => { throw codedError('look-verb', `${p.id}.${verb}: ${msg}. Call it as ${p.id.slice(5)}.${sig}`); };
  const [values, owner = 'game', layer = 'game'] = p._spec.verbs[verb].take(bad, ...args);
  return p._write(layer, owner, values);   // layer: a style pack's plugin writes the style layer (core/plugins.js)
}
