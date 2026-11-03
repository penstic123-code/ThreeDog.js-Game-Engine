// A LookPart's keys on shared points: every look.<part>.<key> is one engine.stacks point (core/sharedPoint.js), so look values follow the
// same layers, owners, conflict errors and describe().shared rows as every other shared value. This file is the glue between a part and its points:
// which point a key is, writing a value for an owner on a layer, and the recompute that hands changed keys to the part's apply.
// Why points and not the part's own layer maps (the old layers.js): two layer systems decided differently (a game's look.lights.set covered the
// weather's multiplier, sky/frame.js), and a reader had to learn both. One table means "game sets 3, weather x0.6 on top" holds for every look value.
// Layers a part uses: the param default is the point's base (engine), a style pack writes owner 'style' on the style layer, a style-driven system
// (the sky's keyframes) writes on the style layer under its own name while it drives a key, games write the game layer (or one they name),
// effects (weather, sunset) write mul / add on effect, the settings menu restricts on settings, engine.debug.override writes debug.
import { markOwned, ownedOf } from '../owned.js';
import { parseSpec } from '../params.js';
import { coded, codedError } from '../errorHints.js';
import { DEV, warnOnce } from '../validate.js';
import { live } from './state.js';

// fn: the key also takes ({ time, weather, season, day, state, sky }) => value (number keys: evaluated each frame by tick(ctx), state.js)
// device: why the engine default differs on this device (a costly post effect off on a low-tier device or headless page); describe().look shows it
const LOOK_FIELDS = ['why', 'off', 'cost', 'neutral', 'check', 'fn', 'device'];
export const REPLACE = '@replace';
export const HOOK = 'hook:';

/** Parse param specs into part._params / part._meta and give each its point (constructor and extend share it) */
export function addParams(part, params, { skipKnown = false } = {}) {
  for (const [k, raw] of Object.entries(params ?? {})) {
    if (skipKnown && k in part._params) continue;
    const meta = {}, rest = { ...raw };
    for (const f of LOOK_FIELDS) if (f in rest) { meta[f] = rest[f]; delete rest[f]; }
    if (!('default' in rest)) throw codedError('look-param', `defineLookPart('${part._spec.id}'): param ${k} has no default. Every look param declares the value the engine uses when nobody sets it (and why / off when that value changes the picture)`);
    part._params[k] = parseSpec(part.id, k, rest, msg => codedError('look-param', msg));
    part._meta[k] = meta;
    pointOf(part, k);
  }
}

/** The shared point behind key ('look.fog.far'), made on first use. number params: kind number (effects multiply them); anything else
 *  (colors, switches, hooks, the replace slot): kind value, set only. A part registered again reuses its points with the new default. */
export function pointOf(part, key) {
  let s = part._points.get(key);
  if (s) return s;
  const S = part._e.stacks, id = part._spec.id, name = `look.${id}.${key}`, spec = part._params[key];
  const num = spec?.type === 'number' && typeof spec.default === 'number';
  if (S.has(name)) { s = S.get(name); s.clear(); s.base = spec ? spec.default : null; }
  else s = S.define(name, { kind: num ? 'number' : 'value', base: spec ? spec.default : null, min: num ? spec.min ?? -Infinity : -Infinity, max: num ? spec.max ?? Infinity : Infinity, save: false });
  // the conflict error's third fix: take it over on purpose. A key the engine writes on its own has manual(); any other is a set on system
  Object.defineProperty(s, 'manual', { configurable: true, get: () => (ownedOf(part._e, id, key).length
    ? `engine.look.${id}.manual('${key}')` : `engine.look.${id}.set({ '${key}': ... }, { owner, layer: 'system' })`) });
  s.onChange = () => { part._dirty.add(key); if (!part._hold) flush(part); };
  part._points.set(key, s);
  return s;
}

/** One owner's entry on a point (or undefined): the old value a failed write puts back */
const entryOf = (s, owner) => s._map(undefined)?.get(owner);

/** Every key that has a point: params, plus hooks / replace / slot keys someone wrote */
export const allKeys = part => [...part._points.keys()];

/** The value in effect for key: the point's layered result; a hook or slot key nobody wrote is undefined (not the null base) */
function valueOf(part, k) {
  const s = part._points.get(k);
  if (!s) return undefined;
  const v = s.value();
  return k in part._params || (v != null && s.size()) ? v : undefined;
}

/** Hold the recompute until fn is done: a set of five keys, or the sky's frame, applies once (a point change only marks its key dirty) */
export function batch(part, fn) {
  part._hold++;
  try { return fn(); } finally { if (!--part._hold && part._dirty.size) flush(part); }
}

/**
 * Recompute the dirty keys (force: every key) and hand the changed ones to the part's apply / applyHook / applyReplace.
 */
export function flush(part, force = false) {
  const keys = force ? allKeys(part) : [...part._dirty], changed = [];
  part._dirty.clear();
  for (const k of keys) {
    const v = valueOf(part, k);
    if (force || part._resolved.get(k) !== v || !part._resolved.has(k)) changed.push(k);
    v === undefined ? part._resolved.delete(k) : part._resolved.set(k, v);
  }
  if (!changed.length) return;
  part._rev++;
  if (!part._started) return;
  const s = part._spec, params = changed.filter(k => k in part._params);
  if (changed.includes(REPLACE)) s.applyReplace?.(part._resolved.get(REPLACE) ?? null);
  for (const k of changed) if (k.startsWith(HOOK)) s.applyHook?.(k.slice(HOOK.length), part._resolved.get(k) ?? null);
  if (params.length) s.apply?.(part._values(), new Set(params));
  // the engine wrote these on the game's request: re-read the owned properties so the next frame does not take it for an outside write (owned.js)
  markOwned(part._e, s.id);
}

/**
 * Evaluate a number key's function value: the number, or undefined when it threw or gave something that is not a finite number. Then the point
 * keeps its last good value, the record counts the failure (describe().look shows fnErrors / fnError on the key) and dev warns once per key and
 * owner. Why not silent: `({ state }) => state.boss.dist * 3` before the boss exists left the fog still with no word, and the AI blamed the layers.
 */
function evalFn(part, rec, ctx) {
  let n, bad;
  try { n = live(rec.fn, ctx); if (!Number.isFinite(n)) bad = `returned ${typeof n === 'number' ? String(n) : n === undefined ? 'undefined' : JSON.stringify(n) ?? String(n)}`; }
  catch (err) { bad = `threw "${err?.message ?? err}"`; }
  if (bad === undefined) return n;
  rec.errors = (rec.errors ?? 0) + 1; rec.lastError = bad;
  if (DEV) warnOnce(coded('look-fn', `${part.id}.${rec.key}: the function value set by '${rec.owner}' (layer ${rec.layer}) ${bad}, not a finite number; ` +
    'the key keeps its last good value (describe().look counts it in fnErrors)'), `look-fn\0${part.id}\0${rec.key}\0${rec.owner}`);
  return undefined;
}

/** Put one value for owner on layer. A function on a number key is kept and re-evaluated by tick(ctx); value keys keep the function itself
 *  (their module evaluates it while applying) */
function put(part, s, k, layer, owner, v) {
  const fk = `${k}\0${owner}`;
  if (typeof v === 'function' && s.kind === 'number') {
    const rec = { key: k, owner, layer, fn: v };
    part._fns.set(fk, rec);
    // no frame context before the sky's first frame: the first tick evaluates it
    const n = part._e._lookCtx ? evalFn(part, rec, part._e._lookCtx) : undefined;
    if (n !== undefined) s.take({ owner, layer, set: n });
    return;
  }
  part._fns.delete(fk);
  s.take({ owner, layer, set: v });
}

/** Drop owner's value for key (and a kept function) */
function drop(part, k, owner) { part._fns.delete(`${k}\0${owner}`); part._points.get(k)?.release(owner); }

/**
 * Write owner's keys on layer; null drops a key. All or nothing: if a conflict or the part's apply throws, every key goes back to the entry
 * it had and the picture is re-applied (review H1). The handle drops only what this call wrote and still holds (a later write wins).
 */
export function writeKeys(part, layer, owner, values) {
  const undo = [];
  try {
    batch(part, () => {
      for (const [k, v] of Object.entries(values)) {
        const s = pointOf(part, k), old = entryOf(s, owner), oldFn = part._fns.get(`${k}\0${owner}`);
        undo.push(() => { drop(part, k, owner); if (oldFn) part._fns.set(`${k}\0${owner}`, oldFn); if (old) s.take({ owner, layer: old.layer, set: old.value }); });
        v === null ? drop(part, k, owner) : put(part, s, k, layer, owner, v);
      }
    });
  } catch (err) {
    part._hold++;
    try { for (const u of undo.reverse()) u(); } finally { part._hold--; part._dirty.clear(); }
    try { flush(part, true); } catch { /* the rethrow below is the error that broke it; this one is its echo on the old values */ }
    throw err;
  }
  const wrote = Object.entries(values).filter(([, v]) => v !== null);
  // remove() answers whether it dropped anything: false once the owner wrote the key again (a stale handle) or on a second call
  return { remove: () => batch(part, () => {
    let any = false;
    for (const [k, v] of wrote) {
      const fn = part._fns.get(`${k}\0${owner}`), e = entryOf(part._points.get(k) ?? { _map() {} }, owner);
      if (fn ? fn.fn === v : e && e.value === v && e.layer === layer) { drop(part, k, owner); any = true; }
    }
    return any;
  }) };
}

/** Every entry owner holds on layer, as { key: value } (DebugOverrides lists and clears the debug layer through it) */
export function ownerValues(part, layer, owner) {
  const out = {};
  for (const [k, s] of part._points) { const e = entryOf(s, owner); if (e?.layer === layer) out[k] = part._fns.get(`${k}\0${owner}`)?.fn ?? e.value; }
  return out;
}

/** The owners with an entry on layer */
export function ownersOn(part, layer) {
  const out = new Set();
  for (const s of part._points.values()) for (const e of s._map(undefined)?.values() ?? []) if (e.layer === layer) out.add(e.owner);
  return [...out];
}

/** Drop everything owner wrote on layer; true when it held something */
export function dropOwner(part, layer, owner) {
  const keys = Object.keys(ownerValues(part, layer, owner));
  if (keys.length) batch(part, () => { for (const k of keys) drop(part, k, owner); });
  return keys.length > 0;
}

/** Replace the style layer (start, or a style swap): owner 'style' on the style layer; a key a driver drives keeps the driver's value */
export function writeStyle(part, given) {
  batch(part, () => {
    for (const k of part._style.keys()) if (!(k in given)) drop(part, k, 'style');
    part._style = new Map(Object.entries(given));
    for (const [k, v] of part._style) if (!part._driven.has(k)) put(part, pointOf(part, k), k, 'style', 'style', v);
  });
}

/**
 * Drive keys every frame from a style-driven system (the sky's keyframes): while driven, the driver's value sits on the style layer under its
 * name and the style's own value steps aside; game / effect / settings / debug entries still apply on top. by null hands them back.
 */
export function driveKeys(part, keys, by) {
  batch(part, () => {
    for (const k of keys) {
      const was = part._driven.get(k);
      if (by) { part._driven.set(k, by); drop(part, k, 'style'); continue; }
      part._driven.delete(k);
      if (was) drop(part, k, was);
      if (part._style.has(k)) put(part, pointOf(part, k), k, 'style', 'style', part._style.get(k));
    }
  });
}

/** Re-evaluate every function value on a number key with this frame's context (the sky calls it once per frame) */
export function tick(part, ctx) {
  if (!part._fns.size) return;
  batch(part, () => {
    for (const rec of part._fns.values()) {
      const n = evalFn(part, rec, ctx);
      if (n !== undefined) part._points.get(rec.key)?.take({ owner: rec.owner, layer: rec.layer, set: n });
    }
  });
}

/** Where a key's value comes from, from its point's describe row: { value, owner, layer, at, under } (report.js, look.lights env) */
export function sourceOf(part, key) {
  const s = part._points.get(key);
  if (!s) return null;
  const r = s.row();
  if (r.writer === 'default' && !(key in part._params)) return null;
  const top = r.writer === 'default' ? { owner: 'engine', layer: 'engine', at: null } : { owner: r.writer, layer: r.layer ?? 'engine', at: r.at ?? null };
  return { ...top, value: valueOf(part, key), driver: part._driven.get(key) ?? null, how: r.how,
    under: r.also.filter(h => h.hidden).map(h => ({ owner: h.owner, layer: h.layer, at: h.at ?? null, value: h.value })) };
}

/** Remove every key starting with prefix, with every entry on it (LookPart.retract) */
export function retractKeys(part, prefix) {
  part._hold++;
  try {
    for (const [k, s] of [...part._points]) if (k.startsWith(prefix)) {
      s.onChange = null; s.clear();
      for (const fk of [...part._fns.keys()]) if (fk.startsWith(k + '\0')) part._fns.delete(fk);
      part._points.delete(k); part._style.delete(k); part._driven.delete(k); part._resolved.delete(k);
      delete part._params[k]; delete part._meta[k];
    }
  } finally { part._hold--; part._dirty.clear(); }
}

/** A module went away (dispose, or engine.use rolled it back): drop the parts it registered and release the keys it drives (review M9) */
export function disposeLooksOf(e, name) {
  if (!name) return;
  for (const p of Object.values(e.look ?? {})) {
    if (p._spec.module === name) { p.author.remove(); continue; }
    const mine = [...p._driven].filter(([, by]) => by === name).map(([k]) => k);
    if (mine.length) p.author.drive(mine, null);
  }
}

/** Recompute without calling apply: a key added later describes the object its owner just made, its default must not be pushed onto it */
export function quietRefresh(part) {
  const was = part._started; part._started = false;
  try { flush(part, true); } finally { part._started = was; }
}
