// engine.look.<part>: set / patch / replace and the layers.
// Parts: tone, lights, cloudShadow (core), env (sky); fog / sky / water / post ... come from their modules.
//   set(params, { owner })      change parameters (shallow merge into that owner's layer; null drops a key so the layer below shows again)
//   patch(name, glsl, { owner }) swap one named GLSL hook the part registered (null gives the default back)
//   replace(impl, { owner })    take the whole part over (null gives it back to the engine / style)
// Why one helper and not per-part code: layering, owner records, validation, catalog and describe were written differently in every module
// (sky.modify had owners, engine.look.tone.set had none, describeRender guessed the source by comparing against start values). A part author writes only
// apply / applyHook / applyReplace; everything a reader (describe, catalog, debug.override) needs comes from the same records.
// Layers per key, the upper one wins: engine default < style < game (each owner; the last one written wins) < debug (engine.debug.override).
// Hooks and the replace slot are keys too ('hook:<name>', '@replace'), so they get the same layering and records for free.
// A part author never touches `_` fields: write / ownerValue / extend / retract / has / resolved are the public author methods (review r2 #2).
import { closest } from '../validate.js';
import { codedError } from '../errorHints.js';
import { REPLACE, HOOK, addParams, topOf, allKeys, sourceOf, refresh, quietRefresh, commit, retractKeys, aliased } from './layers.js';
import { setOn, setStyle, writeLayer, dropLayer, takeVerb, example } from './write.js';

export { REPLACE };
export { disposeLooksOf } from './layers.js';
const SPEC_FIELDS = ['id', 'group', 'module', 'object', 'params', 'style', 'read', 'apply', 'applyAtStart', 'hooks', 'applyHook', 'noPatch',
  'replace', 'applyReplace', 'noReplace', 'docs', 'normalize', 'validate', 'verbs', 'appliesTo', 'extraSignatures'];
const SIG = { set: 'set(params, { owner })', patch: 'patch(name, glsl, { owner })', replace: 'replace(impl, { owner })' };

class LookPart {
  /** @param {any} e @param {any} spec see defineLookPart */
  constructor(e, spec) {
    this._e = e; this._spec = spec; this._seq = 0;
    this._params = {}; this._meta = {};
    addParams(this, spec.params);
    this._style = new Map();
    this._owners = { game: new Map(), debug: new Map() };   // owner -> { values: Map, seq, at }
    this._resolved = new Map();
    this._driven = new Map();   // key -> who writes it every frame from the style (sky keyframes drive the sun)
  }
  /** Catalog / override id: 'look.<part>' */
  get id() { return `look.${this._spec.id}`; }
  /** The three.js object(s) behind this part (renderer, lights ...); changing them directly works but is tagged 'three' in describe().look */
  get object() { return this._spec.object?.(); }
  /** Each verb's call shape (spec.verbs overrides a default); the catalog lists it and verb errors quote it */
  get signatures() {
    const s = this._spec, out = { set: SIG.set };
    if (s.hooks) out.patch = s.verbs?.patch?.signature ?? SIG.patch;
    if (s.replace) out.replace = s.verbs?.replace?.signature ?? SIG.replace;
    return Object.assign(out, s.extraSignatures);   // a part's own verb (look.post.add), listed so the catalog shows it
  }

  /**
   * Change parameters for one owner. Nested objects flatten to the part's dotted keys ({ sun: { intensity: 3 } } -> 'sun.intensity').
   * @param {Record<string, any>} params null drops a key from this owner's layer
   * @param {{ owner?: string }} [o]
   * @returns {{ remove(): void }} removes this owner's whole layer on this part
   */
  set(params, { owner = 'game' } = {}) { return this._setOn('game', owner, params); }
  /**
   * Swap one named GLSL hook. Names and signatures: engine.catalog('look.<part>').hooks
   * @param {string} name @param {any} glsl a GLSL string (or the part's hook spec); null gives the default back
   * @param {{ owner?: string }} [o]
   */
  patch(name, glsl, o) {
    const hooks = this._spec.hooks;
    if (!hooks) throw codedError('look-verb', `${this.id}.patch(): this part has no GLSL hooks. ${this._spec.noPatch ?? `Change it with ${this.id}.set(${example(this)})`}`);
    if (this._spec.verbs?.patch?.take) return this._take('patch', [...arguments]);
    if (!(name in hooks) && !hooks['*']) {   // hooks['*'] = any name the game picks (post: patch(name, fuse) makes an effect)
      const c = closest(name, Object.keys(hooks)); throw codedError('look-verb', `${this.id}.patch('${name}'): unknown hook${c ? ` (did you mean '${c}'?)` : ''}; hooks: ${Object.keys(hooks).join(', ')}`);
    }
    return this.write(o?.owner ?? 'game', { [HOOK + name]: glsl });
  }
  /**
   * Take the whole part over (what it accepts and what is lost: engine.catalog('look.<part>').replace); null gives it back
   * @param {any} impl @param {{ owner?: string }} [o]
   */
  replace(impl, o) {
    if (!this._spec.replace) throw codedError('look-verb', `${this.id}.replace(): this part cannot be swapped whole. ${this._spec.noReplace ?? `Change it with ${this.id}.set(${example(this)})`}`);
    if (this._spec.verbs?.replace?.take) return this._take('replace', [...arguments]);
    return this.write(o?.owner ?? 'game', { [REPLACE]: impl });
  }
  /** Remove every layer `owner` wrote on this part (game and debug); returns how many layers were removed (the same count shape as engine.debug.clear) */
  clear(owner) { let n = 0; for (const l of ['game', 'debug']) if (this._drop(l, owner)) n++; return n; }
  /** The value in effect for a key (after all layers) */
  value(key) { return this._resolved.get(key); }
  /** Only what the game or a debug override set for a key, else undefined (a driver writes its own value, then this one over it) */
  top(key) { const t = topOf(this, key); return t ? t.value : undefined; }

  /**
   * Declare keys a style-driven system writes every frame (the sky drives sun and hemisphere from style.sky.keyframes). Those keys then read
   * as by: 'style' in describe with the live value, and apply() gets undefined for them unless a game or debug layer set one (that system
   * should write top(key) over its own value). drive(keys, null) hands them back to the layers.
   * @param {string[]} keys @param {string | null} by the driver's name, e.g. 'sky' (a module name: disposing that module releases them)
   */
  drive(keys, by) {
    for (const k of keys) by ? this._driven.set(k, by) : this._driven.delete(k);
    this._refresh();
  }
  /** For a driver, after it wrote its keys this frame: re-apply the driven keys a game or debug layer set, so those layers win (cheap: a few keys) */
  applyTop() {
    let v = null, changed = null;
    for (const k of this._driven.keys()) { const t = topOf(this, k); if (t) { (v ??= {})[k] = t.value; (changed ??= new Set()).add(k); } }
    if (changed) this._spec.apply?.(v, changed);
  }

  // ---- for part authors (render/postLook.js, terrain, weather ...): public so no author reaches into `_` fields ------------------------------

  /** Write raw keys (params, 'hook:<name>', '@replace', a part's own slot keys) for an owner on the game layer, no normalize; null drops a key */
  write(owner, values, { layer = 'game' } = {}) { return this._write(layer, owner, values); }
  /** What one owner holds for a key (undefined when it holds nothing): look.weather.replace adds to the object its owner put in the replace slot */
  ownerValue(owner, key, { layer = 'game' } = {}) { return this._owners[layer].get(owner)?.values.get(key); }
  /** Add declared keys to a started part (same spec fields as params; a known key is left alone). Values recompute without calling apply */
  extend(params) { addParams(this, params, { skipKnown: true }); quietRefresh(this); }
  /** Remove every key starting with prefix (e.g. 'bloom.'), with the values any layer holds for them */
  retract(prefix) { retractKeys(this, prefix); }
  /** Replace the style layer (post: a replaced effect chain brings its own defaults) */
  restyle(values) { this._setStyle(values); }
  /** Is key a declared param of this part */
  has(key) { return key in this._params; }
  /** [key, value] pairs in effect whose key starts with prefix ('hook:' lists the patches set) */
  resolved(prefix = '') { return [...this._resolved].filter(([k]) => k.startsWith(prefix)); }
  /** Unregister the part (its module is disposed, or its install failed): engine.look.<id> goes away and nothing drives its keys any more */
  dispose() {
    const look = this._e.look;
    if (look?.[this._spec.id] === this) delete look[this._spec.id];
    this._driven.clear(); this._started = false;
  }

  // ---- internal (layering: layers.js) ------------------------------------------------------------------------------------------------------

  /** @internal set() and engine.debug.override share this (write.js: normalize, flatten, check, write) */
  _setOn(layer, owner, params) { return setOn(this, layer, owner, params); }
  /** @internal Replace the style layer (start, or a style swap); game and debug layers stay */
  _setStyle(values) { setStyle(this, values); }
  _write(layer, owner, values) { return writeLayer(this, layer, owner, values); }
  _drop(layer, owner) { return dropLayer(this, layer, owner); }
  /** @internal recompute (force: every key to apply again); _keys / _source: report.js */
  _refresh(force = false) { refresh(this, force); }
  _keys() { return allKeys(this); }
  _source(key) { return sourceOf(this, key); }
  /** @internal Resolved params as a plain object */
  values() { const o = {}; for (const k in this._params) o[k] = this._resolved.get(k); return o; }
  /** A verb with its own call shape (spec.verbs[verb].take) */
  _take(verb, args) { return takeVerb(this, verb, args); }
}

/**
 * Register a look part: engine.look.<id> gets set / patch / replace (the verbs the spec supports; the others throw and say which verb to use),
 * engine.catalog('look.<id>') lists its params, hooks, replace contract and verb signatures, describe().look shows every key's value and who
 * set it, and engine.debug.override(owner, 'look.<id>', values) writes its debug layer. Every param needs a default; a default that changes the
 * picture needs why (what it is for) and off (how to turn it off), or neutral: true (checked by `npm run check`, rule R35).
 * Its module's failed install drops it again (disposeLooksOf).
 * @param {any} engine @param {{ id: string, group?: string, module?: string, object?: () => any, params?: Record<string, any>, style?: () => object,
 *   read?: () => object, apply?: (values: object, changed: Set<string>) => void, applyAtStart?: boolean,
 *   hooks?: Record<string, { signature?: string, scope?: string[], example?: string }>, applyHook?: (name: string, glsl: any) => void, noPatch?: string,
 *   replace?: { accepts: string, loses?: string[] }, applyReplace?: (impl: any) => void, noReplace?: string, docs?: string[],
 *   validate?: (key: string, value: any) => string | null | undefined,
 *   verbs?: Record<'patch' | 'replace', { signature: string, take: (bad: (msg: string) => never, ...args: any[]) => [Record<string, any>, string?] }>,
 *   appliesTo?: string }} spec validate: why a value is wrong (checked before anything is written); verbs: a verb with its own call shape
 *   (materials.replace(role, impl)); appliesTo: what a change reaches when not everything ('new materials')
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
  const look = aliased(engine.look ??= {});
  if (look[spec.id] && look[spec.id]._spec.module !== spec.module) throw codedError('look-param', `defineLookPart('${spec.id}'): engine.look.${spec.id} is already registered (by ${look[spec.id]._spec.module ?? 'core'})`);
  const part = new LookPart(engine, spec);
  part._setStyle(spec.style?.());
  part._started = true;
  if (spec.applyAtStart !== false) part._refresh(true);
  look[spec.id] = part;
  return part;
}
