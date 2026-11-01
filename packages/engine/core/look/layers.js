// The layer arithmetic behind a LookPart (part.js): where a key's value comes from, and the recompute that hands changed keys to apply.
// Why a file of its own: part.js holds the verbs a game and a part author call; this file is the bookkeeping they share, kept apart so
// both stay under the file-size cap and the verbs read without the loops in between.
import { parseSpec } from '../params.js';
import { DEV } from '../validate.js';
import { codedError, renamed } from '../errorHints.js';

/** Look-only fields of a param spec; stripped before the shared params schema (params.js) parses the rest */
const LOOK_FIELDS = ['why', 'off', 'cost', 'neutral', 'check'];
export const REPLACE = '@replace';
export const HOOK = 'hook:';

const FRAME = /\(?((?:[a-z]+:\/\/[^/\s]+)?[^\s()]+?\.[cm]?[jt]sx?)(?:\?[^:\s)]*)?:(\d+):\d+\)?\s*$/i;
const ENGINE_FRAME = /(?:engine|threedog)\/(?:core|modules|render|ui)\//;   // engine code (engine.look.tone.set and the like, called from inside the engine) is skipped: `at` names the game's line

/** 'main.js:50' of the first caller outside the engine (dev only: release builds keep no stacks) */
export function callerAt() {
  if (!DEV) return null;
  const lim = Error.stackTraceLimit; Error.stackTraceLimit = 14;
  const stack = String(new Error().stack ?? ''); Error.stackTraceLimit = lim;
  for (const l of stack.split('\n').slice(1)) {
    const f = FRAME.exec(l);
    if (f && !ENGINE_FRAME.test(f[1].replace(/\\/g, '/'))) return `${f[1].replace(/^[a-z]+:\/\/[^/]+\//i, '').replace(/^\/+/, '')}:${f[2]}`;
  }
  return null;
}

/** Parse param specs into part._params / part._meta (constructor and extend share it, so a key added later is checked the same way) */
export function addParams(part, params, { skipKnown = false } = {}) {
  for (const [k, raw] of Object.entries(params ?? {})) {
    if (skipKnown && k in part._params) continue;
    const meta = {}, rest = { ...raw };
    for (const f of LOOK_FIELDS) if (f in rest) { meta[f] = rest[f]; delete rest[f]; }
    if (!('default' in rest)) throw codedError('look-param', `defineLookPart('${part._spec.id}'): param ${k} has no default. Every look param declares the value the engine uses when nobody sets it (and why / off when that value changes the picture)`);
    part._params[k] = parseSpec(part.id, k, rest, msg => codedError('look-param', msg));
    part._meta[k] = meta;
  }
}

/** Highest game / debug record holding key: debug beats game, later beats earlier within a layer */
export function topOf(part, key) {
  for (const layer of ['debug', 'game']) {
    let best = null;
    for (const [owner, r] of part._owners[layer]) if (r.values.has(key) && (!best || r.seq > best.seq)) best = { owner, layer, at: r.at, seq: r.seq, value: r.values.get(key) };
    if (best) return best;
  }
  return null;
}

/** Every key that has a value anywhere: params, plus hooks / replace that someone set */
export function allKeys(part) {
  const ks = new Set(Object.keys(part._params));
  for (const k of part._style.keys()) ks.add(k);
  for (const l of ['game', 'debug']) for (const r of part._owners[l].values()) for (const k of r.values.keys()) ks.add(k);
  return ks;
}

/** Where a key's value comes from: { value, owner, layer, at } plus the layers it covers (under) */
export function sourceOf(part, key) {
  const under = [];
  for (const layer of ['debug', 'game']) for (const [owner, r] of part._owners[layer]) if (r.values.has(key)) under.push({ owner, layer, at: r.at, seq: r.seq, value: r.values.get(key) });
  under.sort((a, b) => (a.layer === b.layer ? b.seq - a.seq : a.layer === 'debug' ? -1 : 1));
  if (part._driven.has(key)) under.push({ owner: part._driven.get(key), layer: 'style', at: null, driven: true, value: undefined });
  if (part._style.has(key)) under.push({ owner: 'style', layer: 'style', at: null, value: part._style.get(key) });
  if (key in part._params) under.push({ owner: 'engine', layer: 'engine', at: null, value: part._params[key].default });
  const top = under.shift();
  return top ? { ...top, under } : null;
}

/**
 * Recompute every key; hand the changed ones to the part's apply / applyHook / applyReplace.
 * The key set is taken once per call, not once per key, so a set costs O(keys) (review #14).
 */
export function refresh(part, force = false) {
  const changed = [], keys = allKeys(part);
  for (const k of keys) {
    const v = sourceOf(part, k)?.value;
    if (force || !part._resolved.has(k) || part._resolved.get(k) !== v) changed.push(k);
    v === undefined ? part._resolved.delete(k) : part._resolved.set(k, v);
  }
  for (const k of [...part._resolved.keys()]) if (!keys.has(k)) { part._resolved.delete(k); changed.push(k); }
  if (!part._started) return;
  const s = part._spec, params = changed.filter(k => k in part._params);
  if (changed.includes(REPLACE)) s.applyReplace?.(part._resolved.get(REPLACE) ?? null);
  for (const k of changed) if (k.startsWith(HOOK)) s.applyHook?.(k.slice(HOOK.length), part._resolved.get(k) ?? null);
  if (params.length) s.apply?.(part.values(), new Set(params));
}

/**
 * Recompute after a record change; on a throw put the records back (undo), re-apply the old values to the three.js objects and rethrow.
 * Why: apply used to throw after the layer was already written, leaving a record that described a picture nobody saw (review H1).
 */
export function commit(part, undo) {
  const before = new Map(part._resolved);
  try { refresh(part); } catch (err) {
    undo(); part._resolved = before;
    try { refresh(part, true); } catch { /* reported: the rethrow below is the error that broke it; this one is its echo on the old values */ }
    throw err;
  }
}

/** Remove every key starting with prefix, with the values any layer holds for them (LookPart.retract) */
export function retractKeys(part, prefix) {
  const mine = k => k.startsWith(prefix);
  for (const k of Object.keys(part._params)) if (mine(k)) { delete part._params[k]; delete part._meta[k]; }
  for (const k of [...part._style.keys()]) if (mine(k)) part._style.delete(k);
  for (const l of ['game', 'debug']) for (const [o, r] of part._owners[l]) {
    for (const k of [...r.values.keys()]) if (mine(k)) r.values.delete(k);
    if (!r.values.size) part._owners[l].delete(o);
  }
  quietRefresh(part);
}

/** Old part names: reading one throws renamed-api and names the new part (recipes/52-look.md "Renamed in 0.2"); hidden, so describe / catalog never list it */
const ALIASES = { clouds: 'cloudShadow' };
/** engine.look with the old names as hidden throwing getters */
export function aliased(look) {
  for (const [old] of Object.entries(ALIASES)) if (!(old in look)) Object.defineProperty(look, old, { get: () => renamed('lookClouds'), enumerable: false, configurable: true });
  return look;
}

/** A module went away (dispose, or engine.use rolled it back): drop the parts it registered and release the keys it drives (review M9) */
export function disposeLooksOf(e, name) {
  if (!name) return;
  for (const p of Object.values(e.look ?? {})) {
    if (p._spec.module === name) { p.dispose(); continue; }
    const mine = [...p._driven].filter(([, by]) => by === name).map(([k]) => k);
    if (mine.length) p.drive(mine, null);
  }
}

/** Recompute without calling apply: a key added later describes the object its owner just made, its default must not be pushed onto it */
export function quietRefresh(part) {
  const was = part._started; part._started = false;
  try { refresh(part); } finally { part._started = was; }
}
