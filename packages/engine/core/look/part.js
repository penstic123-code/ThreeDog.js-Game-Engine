// engine.look.<part>: what a game calls. Every part has the same small set (docs/plans/2026-11-03-look-api.md):
//   set(params, { owner })        change values (shallow merge into that owner's layer; null drops a key so the layer below shows again)
//   patch(hook, code, { owner })  swap one named hook the part declares (GLSL / TSL; null gives the default back). Only that meaning
//   add(thing, ...)               put one more named thing in next to the engine's (look.post.add, look.materials.add); remove() takes it out
//   replace(thing, { owner })     swap the one three.js thing the part draws (a texture, a sky object, a Material, an effect list); null gives it
//                                 back. A whole module (behaviour, saves) is engine.use(mine(), { replaces: '<slot>' }) instead
//   manual(keys?)                 the engine stops writing values it writes on its own; the three.js object is yours
//   value(key)                    the one read: the value in effect (who set it: describe().look); object: the three.js object(s) behind it
// A verb a part does not have throws with the part's pointer and the verbs it has. Everything else (raw writes, extending keys, drivers, the
// per-frame tick) is for module code and lives on part.author, so engine.look.fog. autocompletes to the game verbs only.
// Why one helper and not per-part code: layering, owner records, validation, catalog and describe were written differently in every module
// (sky.modify had owners, engine.look.tone.set had none, describeRender guessed the source by comparing against start values). A part author writes only
// apply / applyHook / applyReplace; everything a reader (describe, catalog, debug.override) needs comes from the same records.
// Every key is a shared point 'look.<part>.<key>' (points.js, core/sharedPoint.js): engine default < style < game < effect (weather, sunset:
// mul / add) < system < settings (restrict only, above system) < debug. Two owners setting one key on one layer is a dev error naming both, with the fix.
// Hooks and the replace slot are keys too ('hook:<name>', '@replace'), so they get the same layering and records for free.
import { closest } from '../validate.js';
import { codedError } from '../errorHints.js';
import { REPLACE, HOOK, addParams, allKeys, sourceOf, flush, quietRefresh, retractKeys, batch, driveKeys, tick, pointOf, ownerValues, dropOwner } from './points.js';
import { LAYERS } from '../sharedPoint.js';
import { setOn, setStyle, writeLayer, takeVerb, example } from './write.js';
import { manualVerb, ownedOf } from '../owned.js';
import { defineState } from './state.js';

export { REPLACE };

/** A patch(name, value) hook value as an object: a bare GLSL string becomes { glsl }, a { glsl, uniforms, ... } spec passes through */
export const hookSpec = v => (typeof v === 'string' ? { glsl: v } : v);
export { disposeLooksOf } from './points.js';
const SPEC_FIELDS = ['id', 'group', 'module', 'object', 'params', 'style', 'read', 'apply', 'applyAtStart', 'hooks', 'applyHook', 'noPatch',
  'replace', 'applyReplace', 'noReplace', 'noAdd', 'docs', 'normalize', 'validate', 'verbs', 'appliesTo', 'extraSignatures', 'info'];
const SIG = { set: "set(params, { owner, layer? })", patch: 'patch(hook, code, { owner })', replace: 'replace(thing, { owner })', manual: 'manual(keys?, on = true)' };

class LookPart {
  /** @param {any} e @param {any} spec see defineLookPart */
  constructor(e, spec) {
    this._e = e; this._spec = spec;
    this._params = {}; this._meta = {};
    /** key -> its shared point; _fns: function values on number keys (tick evaluates them); _dirty / _hold: batch(points.js) */
    this._points = new Map(); this._fns = new Map(); this._dirty = new Set(); this._hold = 0;
    this._style = new Map();
    this._resolved = new Map();
    addParams(this, spec.params);
    this._rev = 0;   // goes up whenever refresh changed a resolved key, so a per-frame reader rebuilds its view only after a change
    this._driven = new Map();   // key -> who writes it every frame from the style (sky keyframes drive the sun)
    this._started = false;   // true once defineLookPart wrote the style layer: apply runs only after that
    /** module code's half (PartAuthor below); not enumerable, so a logged part shows the game's view */
    this.author = /** @type {PartAuthor} */ (/** @type {unknown} */ (null));
    Object.defineProperty(this, 'author', { value: new PartAuthor(this), enumerable: false });
  }
  /** Catalog / override id: 'look.<part>' */
  get id() { return `look.${this._spec.id}`; }
  /** The three.js object(s) behind this part (renderer, lights ...); changing them directly works but is tagged 'three' in describe().look */
  get object() { return this._spec.object?.(); }

  /**
   * The error for a verb this part does not have. Every part says it the same way: why not, the part's own pointer (noPatch / noAdd / noReplace)
   * or a set() example, then the verbs it does have with their call shapes (the same list as engine.catalog('look.<part>').signatures), so the
   * next call is always on screen and no part's message can drift from what the part offers.
   * @param {string} verb @param {string} why @param {string} [hint]
   */
  _lacks(verb, why, hint) {
    const has = Object.values(this.author.signatures).map(sig => `${this.id}.${sig}`).join(', ');
    const next = (hint ?? `Change it with ${this.id}.set(${example(this)})`).replace(/\.\s*$/, '');   // a hint may end in a period: not two
    return codedError('look-verb', `${this.id}.${verb}(): ${why}. ${next}. Verbs it has: ${has}`);
  }

  /**
   * Change parameters for one owner. Nested objects flatten to the part's dotted keys ({ sun: { intensity: 3 } } -> 'sun.intensity').
   * @param {Record<string, any>} params null drops a key from this owner's layer
   * @param {{ owner?: string, layer?: 'style' | 'game' | 'effect' | 'system' | 'settings' | 'debug' }} [o] layer: game by default; an effect
   *   module writes 'effect', 'system' takes the key over above every effect (the settings layer only restricts: set false)
   * @returns {{ remove(): void }} removes what this call wrote
   */
  set(params, { owner = 'game', layer = 'game' } = {}) {
    // 'engine' is outside the JSDoc type, but an untyped caller can pass it
    if (!(layer in LAYERS) || /** @type {string} */ (layer) === 'engine') throw codedError('shared-layer', `${this.id}.set(params, { layer }): layer is one of ${Object.keys(LAYERS).slice(1).join(' < ')}, got ${JSON.stringify(layer)}`);
    return this._setOn(layer, owner, params);
  }
  /**
   * Swap one named hook the part declares (only that: adding a thing is add()). Names and signatures: engine.catalog('look.<part>').hooks
   * @param {string} name @param {any} code a GLSL string (or the part's hook spec { glsl, tsl, uniforms }); null gives the default back
   * @param {{ owner?: string }} [o]
   */
  patch(name, code, o) {
    const hooks = this._spec.hooks;
    if (!hooks) throw this._lacks('patch', 'this part has no named hook to swap', this._spec.noPatch);
    if (!(name in hooks)) {
      const c = closest(name, Object.keys(hooks)); throw codedError('look-verb', `${this.id}.patch('${name}'): unknown hook${c ? ` (did you mean '${c}'?)` : ''}; hooks: ${Object.keys(hooks).join(', ')}`);
    }
    return this._write('game', o?.owner ?? 'game', { [HOOK + name]: code });
  }
  /**
   * Put one more named thing in next to the engine's (look.post.add: an effect; look.materials.add: a shader patch for some roles); the part's
   * call shape: engine.catalog('look.<part>').signatures.add. A part with nothing to add throws with its pointer
   * @param {...any} args @returns {{ remove(): void }}
   */
  add(...args) {
    if (this._spec.verbs?.add?.take) return this._take('add', args);
    throw this._lacks('add', 'this part has nothing to add', this._spec.noAdd);
  }
  /**
   * Swap the one three.js thing this part draws (what it accepts and what is lost: engine.catalog('look.<part>').replace); null gives it back
   * @param {any} impl @param {{ owner?: string, [option: string]: any }} [o] owner, plus the part's own options (catalog replace.options)
   */
  replace(impl, o) {
    if (!this._spec.replace) throw this._lacks('replace', 'this part has no thing to swap', this._spec.noReplace);
    if (this._spec.verbs?.replace?.take) return this._take('replace', [...arguments]);
    // options besides owner are the part's own (look.ground: { effects: false }); a key the part does not take throws instead of doing nothing
    const extra = Object.keys(o ?? {}).filter(k => k !== 'owner'), takes = this._spec.replace.options ?? [];
    const bad = extra.find(k => !takes.includes(k));
    if (bad) throw codedError('look-param', `${this.id}.replace(impl, { ${bad} }): ${takes.length ? `options are owner, ${takes.join(', ')}` : 'the only option is owner'}`);
    if (extra.length) this._spec.replace.withOptions(impl, o);
    return this._write('game', o?.owner ?? 'game', { [REPLACE]: impl });
  }
  /**
   * Take properties the engine writes on its own (every frame or on a timer) for the game, or hand them back. Taken, the engine stops writing them
   * and the three.js object is yours (engine.lights.sun.intensity = 3 sticks); manual(keys, false) or the returned remove() gives them back.
   * Keys match by dotted prefix ('sun' takes sun.intensity and sun.color); none = every one of this part. Which keys: describe().owned.
   * A direct write without manual() does the same (the engine yields and warns once), manual() just says it on purpose.
   * @example engine.look.lights.manual('sun'); engine.lights.sun.intensity = 3;   engine.look.lights.manual('sun', false);   engine.look.fog.manual();
   * @param {string | string[]} [keys] @param {boolean} [on] @returns {{ remove(): void }}
   */
  manual(keys, on) { return manualVerb(this._e, this._spec.id, keys, on); }
  /** The value in effect for a key (after all layers): the one read. Who set it and how: engine.describe().look.<part> */
  value(key) { return this._resolved.get(key); }

  // ---- internal (layering: points.js, write.js); module code goes through part.author ------------------------------------------------------

  /** @internal drop every layer owner wrote (every layer above style), for tests and tools that did not keep the handle; returns how many */
  _clear(owner) { let n = 0; for (const l of Object.keys(LAYERS)) if (l !== 'engine' && l !== 'style' && this._drop(l, owner)) n++; return n; }
  /** @internal set() and engine.debug.override share this (write.js: normalize, flatten, check, write) */
  _setOn(layer, owner, params) { return setOn(this, layer, owner, params); }
  /** @internal Replace the style layer (start, or a style swap); game and debug layers stay */
  _setStyle(values) { setStyle(this, values); }
  _write(layer, owner, values) { return writeLayer(this, layer, owner, values); }
  _drop(layer, owner) { return dropOwner(this, layer, owner); }
  /** @internal recompute (force: every key to apply again); _keys / _source: report.js */
  _refresh(force = false) { flush(this, force); }
  _keys() { return allKeys(this); }
  _source(key) { return sourceOf(this, key); }
  /** @internal Resolved params as a plain object */
  _values() { const o = {}; for (const k in this._params) o[k] = this._resolved.get(k); return o; }
  /** A verb with its own call shape (spec.verbs[verb].take) */
  _take(verb, args) { return takeVerb(this, verb, args); }
}

/**
 * part.author: what module code that defines or drives a part calls (render/postLook.js, terrain, weather, the sky's keyframes ...); a game never
 * needs it. Kept off the part so a game's autocomplete shows only set / patch / add / replace / manual / value; public (not `_`) so no module
 * reaches into a part's fields.
 */
class PartAuthor {
  /** @param {LookPart} p */
  constructor(p) { this._p = p; }
  /** Each verb's call shape (spec.verbs overrides a default); the catalog lists it and verb errors quote it */
  get signatures() {
    const p = this._p, s = p._spec, out = /** @type {Record<string, string>} */ ({ set: SIG.set });
    if (s.hooks) out.patch = SIG.patch;
    if (s.verbs?.add) out.add = s.verbs.add.signature;
    if (s.replace) out.replace = s.verbs?.replace?.signature ?? SIG.replace;
    if (ownedOf(p._e, s.id).length) out.manual = SIG.manual;
    return Object.assign(out, s.extraSignatures);   // a part's own verb (look.post.add, look.materials.glow), listed so the catalog shows it
  }
  /** Write raw keys (params, 'hook:<name>', '@replace', a part's own slot keys) for an owner on the game layer, no normalize; null drops a key */
  write(owner, values, { layer = 'game' } = {}) { return this._p._write(layer, owner, values); }
  /** What one owner holds for a key (undefined when it holds nothing): look.weather.replace adds to the object its owner put in the replace slot */
  ownerValue(owner, key, { layer = 'game' } = {}) { return ownerValues(this._p, layer, owner)[key]; }
  /** Add declared keys to a started part (same spec fields as params; a known key is left alone). Values recompute without calling apply */
  extend(params) { addParams(this._p, params, { skipKnown: true }); quietRefresh(this._p); }
  /** Remove every key starting with prefix (e.g. 'bloom.'), with the values any layer holds for them */
  retract(prefix) { retractKeys(this._p, prefix); }
  /** Replace the style layer (post: a replaced effect chain brings its own defaults) */
  restyle(values) { this._p._setStyle(values); }
  /** Is key a declared param of this part */
  has(key) { return key in this._p._params; }
  /** [key, value] pairs in effect whose key starts with prefix ('hook:' lists the patches set) */
  resolved(prefix = '') { return [...this._p._resolved].filter(([k]) => k.startsWith(prefix)); }
  /** Resolved params as a plain object */
  values() { return this._p._values(); }
  /** Only what the game (or a layer above it) set for a key, else undefined: render/lookSurface.js reads a game's material choice through it */
  top(key) {
    const p = this._p, s = p._points.get(key);
    let best = null;
    for (const en of s?._map(undefined)?.values() ?? []) if (en.op === 'set' && LAYERS[en.layer] >= LAYERS.game && (!best || LAYERS[en.layer] >= LAYERS[best.layer])) best = en;
    return best ? p._fns.get(`${key}\0${best.owner}`)?.fn ?? best.value : undefined;
  }
  /** The shared point behind key (engine.stacks.get('look.<part>.<key>')): take() on it adds an effect entry */
  point(key) { if (!(key in this._p._params)) throw this._p._lacks('point', `no key ${key}`); return pointOf(this._p, key); }
  /**
   * Declare keys a style-driven system writes every frame (the sky drives sun and hemisphere from style.sky.keyframes). While driven, the
   * driver's value (feed) is the style layer of those keys; a game set, the weather's mul and the settings still apply on top, and the part's
   * apply leaves the three.js object to the driver, which writes value(key). drive(keys, null) hands them back to the layers.
   * @param {string[]} keys @param {string | null} by the driver's name, e.g. 'sky' (a module name: disposing that module releases them)
   */
  drive(keys, by) { driveKeys(this._p, keys, by); }
  /** Who drives key every frame ('sky'), or null */
  driven(key) { return this._p._driven.get(key) ?? null; }
  /** The driver's value for a driven key this frame (the keyframes' sun intensity); the layers above still apply */
  feed(key, value) { const p = this._p, by = p._driven.get(key); if (by) pointOf(p, key).take({ owner: by, layer: 'style', set: value }); }
  /** Once per frame with the frame context: function values on number keys are evaluated (a function on a color key is the module's to read) */
  tick(ctx) { tick(this._p, ctx); }
  /** Run fn with the recompute held, so several writes apply once */
  batch(fn) { return batch(this._p, fn); }
  /** Unregister the part (its module is disposed, or its install failed): engine.look.<id> goes away and nothing drives its keys any more.
   * remove(), not dispose(): the part owns no GPU resource (the cancel convention for everything that only unregisters) */
  remove() {
    const p = this._p, look = p._e.look;
    if (look?.[p._spec.id] === p) delete look[p._spec.id];
    // its points stay registered (a part registered again reuses them) but hold nothing: every entry, the weather's too, goes with the part
    for (const s of p._points.values()) { s.onChange = null; s.clear(); }
    p._driven.clear(); p._fns.clear(); p._started = false;
  }
}

/**
 * Register a look part: engine.look.<id> gets set / patch / add / replace / manual / value (the verbs the spec supports; the others throw and
 * say which verb to use; module code reaches the rest through part.author), engine.catalog('look.<id>') lists its params, hooks, replace
 * contract and verb signatures, describe().look shows every key's value and who set it, and engine.debug.override(owner, 'look.<id>', values)
 * writes its debug layer. Every param needs a default; a default that changes the picture needs why (what it is for) and off (how to turn it
 * off), or neutral: true (checked by `npm run check`, rule R35). Its module's failed install drops it again (disposeLooksOf).
 * @param {any} engine @param {{ id: string, group?: string, module?: string, object?: () => any, params?: Record<string, any>, style?: () => object,
 *   read?: () => object, apply?: (values: object, changed: Set<string>) => void, applyAtStart?: boolean,
 *   hooks?: Record<string, { signature?: string, scope?: string[], example?: string }>, applyHook?: (name: string, glsl: any) => void, noPatch?: string,
 *   replace?: { accepts: string, loses?: string[], options?: string[], withOptions?: (impl: any, o: object) => void }, applyReplace?: (impl: any) => void, noReplace?: string, docs?: string[],
 *   normalize?: (params: Record<string, any>) => Record<string, any>, validate?: (key: string, value: any) => string | null | undefined, noAdd?: string,
 *   verbs?: Partial<Record<'add' | 'replace', { signature: string, take: (bad: (msg: string) => never, ...args: any[]) => [Record<string, any>, string?, string?] }>>,
 *   appliesTo?: string, info?: () => Record<string, object>, extraSignatures?: Record<string, string> }} spec validate: why a value is wrong (checked
 *   before anything is written); normalize: rewrites a set() / debug.override value before the key check (a part's shorthand, or a pointed error
 *   for a removed key); verbs: a verb with its own call shape (materials.add(name, patch, { roles }), materials.replace(role, impl));
 *   extraSignatures: the call shapes of the part's own verbs (look.post.add, look.materials.glow); appliesTo: what a change reaches when not
 *   everything ('new materials'); info: read-only rows describe().look adds beside the params (look.env's source: which map, does it follow the time)
 * @returns {LookPart}
 * @example
 * defineLookPart(engine, { id: 'glow', group: 'screen', module: 'myGlow', object: () => glowPass,
 *   params: { strength: { type: 'number', default: 0, min: 0, neutral: true, desc: 'bloom strength' } },
 *   apply(v, changed) { glowPass.strength = v.strength; } });
 * engine.look.glow.set({ strength: 0.6 }, { owner: 'night' });
 */
export function defineLookPart(engine, spec) {
  for (const k of Object.keys(spec ?? {})) if (!SPEC_FIELDS.includes(k)) { const c = closest(k, SPEC_FIELDS); throw codedError('look-param', `defineLookPart: unknown spec field ${k}${c ? ` (did you mean ${c}?)` : ''}; fields: ${SPEC_FIELDS.join(', ')}`); }
  if (!/^[a-z][\w]*$/i.test(spec?.id ?? '')) throw codedError('look-param', `defineLookPart: id is the part name, e.g. 'fog' (engine.look.fog, catalog id 'look.fog'); got ${JSON.stringify(spec?.id)}`);
  const look = engine.look ??= {};
  defineState(look, engine);   // engine.look.state(patch): the game's half of the frame context function values read (state.js)
  if (look[spec.id] && look[spec.id]._spec.module !== spec.module) throw codedError('look-param', `defineLookPart('${spec.id}'): engine.look.${spec.id} is already registered (by ${look[spec.id]._spec.module ?? 'core'})`);
  const part = new LookPart(engine, spec);
  part._setStyle(spec.style?.());
  part._started = true;
  // applyAtStart false: the module writes the three.js object itself at start, but value(key) must already answer (fogFarOf reads it)
  if (spec.applyAtStart !== false) part._refresh(true); else quietRefresh(part);
  look[spec.id] = part;
  return part;
}
