// engine.plugins: the plugins folder (docs/plans/2026-11-03-slot-map.md section 6). Each file in the game's plugins/ folder is imported at
// start and plugged in by WHAT it exports, through the one call a game would have written by hand:
//   Object3D                      -> engine.add(obj, { id: <file name> })        (same as scene.add, plus a stable save id)
//   three.js Pass (has render())  -> engine.post.add(pass, { name: <file name> })
//   post effect { name, create | node | fuse } -> engine.post.add(effect)   (create for WebGL, node for WebGPU: one file runs on both)
//   module { name, type, install / init }  -> engine.use(mod)
//   an array of those              -> each one, in array order
// anything else is a dev error naming the file and the shapes above. A function is never a plugin, on either renderer: a plugin says what it
// is by its shape, and a bare function says nothing (a library factory, a material maker and a node pass all look the same), so taking it
// as a WebGPU node pass made one file behave differently per renderer. Why only existing calls: the folder adds no new slot and no new rule,
// it only saves the registration lines, so everything a hand-written call gets (describe, layering, remove) a plugin gets too.
// Which export: the default export when there is one (named exports are then free for helpers), else every named export in order.
// Order: by file name (10-fog.js before 20-bloom.js), or plugins/plugins.json { "order": [...], "off": [...] }. Nothing is sorted behind
// the game's back: describe().slots lists the order used.
// Off: plugins.json "off" (no code change), or engine.plugins.off(name) at run time; on(name) plugs it again.
// Owners: every plugin is its own owner ('plugin:<file>'). Why: with one owner for all, B's remove dropped the key A had written too (A said on,
// the base came back). Two plugins writing one key on one layer is a shared-conflict naming both, unless one file says `export const replaces = '<other file>'` (then the other is unplugged while this one is on).
// A Material or a ShaderPatch is no plugin: it says nothing about which mesh it belongs to, so it goes on that mesh or module in plain code.
// Places: a post effect keeps the place it first got (its name is reserved in plugin order), so off / on never reorders the chain.
import { codedError } from '../base/errorHints.js';

const SHAPES = 'an Object3D (goes in the scene), a three.js Pass with render() (post chain), a post effect { name, create: ctx => pass, node: (input, ctx) => node } or { name, fuse } (post chain, both renderers), ' +
  "a module { name, type, install / init } (engine.use), or an array of these. Export it as default (export default new THREE.Mesh(...))";

/** Which slot a value plugs into, or null when it is none of the accepted shapes */
function shapeOf(v) {
  if (v?.isObject3D) return 'scene';
  if (v?.isMaterial) return null;   // it has name, type and dispose(), so the module test below would take it for a module
  if (v && typeof v === 'object') {
    if (typeof v.render === 'function' && 'needsSwap' in v) return 'post';   // three's Pass base class sets needsSwap: a Pass, not a module with render()
    if (typeof v.name === 'string' && (v.install || v.init || v.fixed || v.frame || v.dispose)) return 'module';
    if (typeof v.name === 'string' && (typeof v.create === 'function' || typeof v.node === 'function' || (v.fuse && typeof v.fuse === 'object'))) return 'post';
  }
  return null;
}

/** The post chain name of a plugin's post value: an effect keeps its own name, a bare Pass is named by its file ('<file>/<i>' with several) */
const postName = (p, v, i) => (v.isPass || 'needsSwap' in v ? (p.values.length > 1 ? `${p.name}/${i}` : p.name) : v.name);

/** File name without folder and extension: './plugins/10-crate.js' -> '10-crate' */
const baseOf = path => path.split('/').pop().replace(/\.[cm]?[jt]s$/, '');

export class Plugins {
  /** @param {any} e @internal */
  constructor(e) {
    /** @internal */ this._e = e;
    /** @internal name -> { name, file, values, on, plugged: [{ slot, value, remove }] } in plug order */
    this._list = new Map();
    /** @internal set by add(); start() plugs them */
    this._added = false;
  }

  /**
   * Hand the engine a folder of plugin files: the result of Vite's import.meta.glob('./plugins/*.js', { eager: true }) or any
   * { path: moduleNamespace } map. The vite preset does this for you (tools/vite/vite-threedog-plugins.js); call it yourself only without it.
   * Before start() the files are plugged at start; after start() at once.
   * @param {Record<string, any>} files @param {{ order?: string[], off?: string[] }} [o] order: file names first, in this order; off: not plugged
   * @returns {this}
   * @example engine.plugins.add(import.meta.glob('./plugins/*.js', { eager: true }), { off: ['20-bloom'] });
   */
  add(files, { order = [], off = [] } = {}) {
    const paths = Object.keys(files).sort((a, b) => baseOf(a) < baseOf(b) ? -1 : baseOf(a) > baseOf(b) ? 1 : 0);
    const rank = n => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
    paths.sort((a, b) => rank(baseOf(a)) - rank(baseOf(b)));   // stable sort: listed names first, the rest keep file-name order
    for (const n of [...order, ...off]) if (!paths.some(p => baseOf(p) === n))
      throw codedError('plugin-shape', `plugins.json names '${n}', but there is no plugins/${n}.js; files: ${paths.map(baseOf).join(', ') || 'none'}`);
    for (const path of paths) {
      const ns = files[path], name = baseOf(path);
      // replaces: a word about the file, never plugged (a string is no plugin shape)
      const named = ns && 'default' in ns ? [['default', ns.default]] : Object.entries(ns ?? {}).filter(([k]) => k !== 'replaces'), values = named.flatMap(([, v]) => [].concat(v));
      if (!values.length) throw codedError('plugin-shape', `plugins/${baseOf(path)}.js exports nothing. Fix: export default one of: ${SHAPES}`);
      for (const [key, x] of named) for (const v of [].concat(x)) if (!shapeOf(v)) throw codedError('plugin-shape', notAPlugin(`plugins/${baseOf(path)}.js`, key, v));
      const file = path.replace(/^.*?(plugins\/)/, '$1');
      const replaces = [].concat(ns?.replaces ?? []).map(String);
      this._list.set(name, { name, file, values, replaces, replacedBy: null, on: !off.includes(name), plugged: [] });
    }
    for (const p of this._list.values()) for (const r of p.replaces) if (!this._list.has(r))
      throw codedError('plugin-shape', `${p.file}: export const replaces = '${r}', but there is no plugin '${r}'; plugins: ${[...this._list.keys()].join(', ')}`);
    this._added = true;
    if (this._e._initsDone) this._plugAll();
    return this;
  }

  /** @internal start(): plug every file that is on, in order (before module init, so a module from a plugin inits with the others) */
  _plugAll() {
    const e = this._e, all = [...this._list.values()];
    // every post effect's place is reserved in plugin order, on or off, so one switched on later still lands where the list says (PostFX._place)
    for (const p of all) p.values.forEach((v, i) => { if (shapeOf(v) === 'post') e.post?._place(postName(p, v, i), true); });
    const todo = all.filter(p => p.on && !p.plugged.length && !p.replacedBy);
    for (const p of todo) if (p.on && !p.plugged.length && !p.replacedBy) this._plug(p);   // re-checked: a plug can unplug a later one it replaces
  }

  /** @internal */
  _plug(p) {
    const e = this._e;
    let at = null;   // the value being plugged, so a clash can name the other plugin
    for (const r of p.replaces) { const q = this._list.get(r); q.replacedBy = p.name; this._unplug(q); }
    try {
      for (const v of p.values) {
        at = v;
        const slot = shapeOf(v);
        let remove;
        if (slot === 'scene') { e.add(v, { id: p.values.length > 1 ? `${p.name}/${p.plugged.length}` : p.name }); remove = () => { v.removeFromParent(); e._things.forget(v); e.rays.forget(v); }; }   // not engine.remove: that disposes, and on() puts it back
        // an effect keeps its own name (engine.post.get('bloom') reads the same from any source); a bare Pass is named by its file
        else if (slot === 'post') { const h = e.post.add(v, v.isPass || 'needsSwap' in v ? { name: postName(p, v, p.plugged.length) } : {}); remove = () => h.remove(); }
        else { e.use(v); remove = () => { if (e.modules.get(v.name) === v) e._unuse(v.name); }; }
        p.plugged.push({ slot, value: v, remove });
      }
    } catch (err) {
      this._unplug(p);   // all or nothing per file: half a plugin is harder to read than none
      this._giveBack(p);
      err.message = `${p.file}: ${err.message}`;
      // two plugins naming one post effect: the error comes from the post chain, which knows names and not files, so the file of the first is added here
      const first = [...this._list.values()].find(q => q !== p && q.plugged.some(x => x.slot === 'post' && at?.name && x.value.name === at.name));
      if (first) err.message += ` ${first.file} added it first.`;
      if (first || /shared-conflict/.test(err.message)) err.message += ` Two plugins write the same key: keep one, or say which wins in the file that should: export const replaces = '<the other file>';`;
      throw err;
    }
  }
  /** @internal */
  _unplug(p) { for (const x of p.plugged.splice(0).reverse()) x.remove(); }
  /** @internal p is out: the plugins it replaced plug again (when they are on) */
  _giveBack(p) {
    for (const q of this._list.values()) if (q.replacedBy === p.name) { q.replacedBy = null; if (q.on && this._e._initsDone && !q.plugged.length) this._plug(q); }
  }

  /**
   * Switch a plugin off: everything it plugged is taken out again (the object leaves the scene, the pass the chain,
   * the module is unloaded). No code change: plugins.json "off" does the same at start.
   * To pause a post effect and keep everything else, engine.post.get('<effect>').enabled = false is lighter: off unloads.
   * @param {string} name file name without .js
   * @returns {{ off: string[], note: string }}
   */
  off(name) {
    const p = this._get(name);
    p.on = false; this._unplug(p);
    this._giveBack(p);
    return this._result('off', p);
  }
  /**
   * Switch a plugin back on (plugged at once after start). @param {string} name
   * @returns {{ on: string[], note: string }}
   */
  on(name) {
    const p = this._get(name);
    p.on = true; if (this._e._initsDone && !p.plugged.length && !p.replacedBy) this._plug(p);
    return this._result('on', p);
  }
  /** @internal what off / on did, in words a reader can act on */
  _result(verb, p) {
    const notes = [];
    const fx = p.values.map((v, i) => (shapeOf(v) === 'post' ? postName(p, v, i) : null)).filter(Boolean);
    if (verb === 'off' && fx.length) notes.push(`plugins.off unloads; to pause an effect in its place use ${fx.map(n => `engine.post.get('${n}').enabled = false`).join('; ')}`);
    if (p.replacedBy) notes.push(`${p.name} stays out while ${p.replacedBy} (replaces it) is on`);
    return { [verb]: [p.name], note: notes.join('; ') };
  }
  /** @internal */
  _get(name) {
    const p = this._list.get(name);
    if (!p) throw codedError('plugin-shape', `engine.plugins: no plugin '${name}'; plugins: ${[...this._list.keys()].join(', ') || 'none (no plugins folder)'}`);
    return p;
  }

  /**
   * The plugins in plug order: { name, file, on, slots, replacedBy } (replacedBy: the plugin that holds it out)
   * @returns {{ name: string, file: string, on: boolean, slots: string[], replacedBy: string | null }[]}
   */
  list() { return [...this._list.values()].map(p => ({ name: p.name, file: p.file, on: p.on, slots: p.values.map(v => shapeOf(v)), replacedBy: p.replacedBy })); }
}

/**
 * The plugin-shape error for one export that is not a plugin: the file, what was found, and the exact fix for that case
 * (a factory function, a module missing its type or hooks, a post effect missing its name, anything else).
 */
function notAPlugin(file, key, v) {
  const what = key === 'default' ? 'the default export' : `the export '${key}'`;
  if (v?.isMaterial) return `${file}: ${what} is a Material, which says nothing about what it goes on. Fix: put it on its mesh in your picture/ code, or on a module (engine.water.material = mat)`;
  if (v && typeof v === 'object' && !v.isObject3D && (v.slot || typeof v.glsl === 'string' || typeof v.glsl === 'object' || v.tsl))
    return `${file}: ${what} is a ShaderPatch, which says nothing about which material it changes. Fix: applyEffects(material, { patches: [patch] }) in your picture/ code`;
  if (typeof v === 'function') {
    const fn = v.name && v.name !== 'default' ? v.name : 'make';
    return `${file}: ${what} is a function (${v.name || 'anonymous'}). A function is never a plugin: it does not say where it plugs in. ` +
      (key === 'default' ? `Fix: make it a named export and plug in what it returns: export function ${fn}(...) { ... }  export default ${fn}({ ... });`
        : `Fix: plug in what it returns, add to the file: export default ${key}({ ... }); (the default export is plugged; named exports stay helpers)`) +
      " A post node pass: export default { name: 'glow', node: (input, ctx) => ..., create: ctx => pass }. Library code: threedog lib pull writes this wiring file for you";
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).slice(0, 8).join(', ') || '(none)';
    const hooks = ['install', 'init', 'fixed', 'frame', 'dispose'].filter(h => typeof v[h] === 'function');
    if (typeof v.name === 'string' && v.type && !hooks.length)
      return `${file}: ${what} is a module '${v.name}' (type '${v.type}') with no install / init / fixed / frame hook (keys: ${keys}). Fix: add the hook that sets it up: { name: '${v.name}', type: '${v.type}', install(engine, ctx) { ... } }`;
    if (typeof v.name !== 'string' && (typeof v.create === 'function' || typeof v.node === 'function' || v.fuse))
      return `${file}: ${what} looks like a post effect (keys: ${keys}) but has no name. Fix: add one: { name: '${key === 'default' ? 'my-effect' : key}', ${typeof v.node === 'function' ? 'node' : 'create'}: ... }`;
    return `${file}: ${what} is an object with keys ${keys}, which matches no plugin shape. Fix: export default one of: ${SHAPES}`;
  }
  return `${file}: ${what} is ${v == null ? String(v) : `a ${typeof v} (${String(v).slice(0, 40)})`}, which is not a plugin. Fix: export default one of: ${SHAPES}`;
}

/**
 * Plug what the page's plugins folder gave (the vite preset puts it on globalThis.__threedogPlugins before main.js runs) and the files
 * engine.plugins.add received. Called once by start(). @param {any} e
 */
export function plugAtStart(e) {
  const page = typeof globalThis !== 'undefined' ? globalThis.__threedogPlugins : null;
  if (page && !e.plugins._added) e.plugins.add(page.files, page.config ?? {});
  e.plugins._plugAll();
}

/**
 * describe().slots: one table of what is plugged in where. Each row: { slot, plugged, file, on, affects }; file is the plugin file, the
 * file:line that called scene.add / engine.add (dev), or the call that plugged it ('engine.use', 'engine.post.add'). Why one table:
 * a reader asking "what did this game add to the engine" had to put describe().scene, render.post and modules side by side.
 * @param {any} e
 */
export function describeSlots(e) {
  const rows = [], fromPlugin = new Set();
  const passOf = v => e.post?._list.find(h => h._def === v || h._def._pass === v || h._def.node === v);
  const affects = (slot, v) => {
    if (slot === 'scene') { const t = e._things.byObj.get(v); return t ? [`engine.thing('${t.id}')`, `save tier ${e._things.tier(t)}`] : ['scene']; }
    if (slot === 'post') { const h = passOf(v); return [h ? `picture: post chain ${h.slot} slot, ${h.name}` : 'picture: post chain']; }
    if (slot === 'light') return ["budget 'lights'", ...(v.castShadow ? ["budget 'shadowLights'", 'idle shadow redraw rule'] : [])];
    return [`engine.${v.name}`, `type ${v.type}`, ...(v.provides ?? []).map(s => `provides ${s}`)];
  };
  for (const p of e.plugins?._list.values() ?? []) for (const v of p.values) {
    const slot = shapeOf(v);
    fromPlugin.add(v);
    const live = p.on && !p.replacedBy;
    rows.push({ slot, plugged: (slot === 'module' ? v.name : v.name || v.type) || p.name, file: p.file, on: live,
      affects: live ? affects(slot, v) : p.replacedBy ? [`replaced by ${p.replacedBy}`] : [] });
  }
  for (const o of e.scene.children) { const en = e._things.byObj.get(o); if (en?.owner === 'game' && !fromPlugin.has(o) && !o.isLight)
    rows.push({ slot: 'scene', plugged: o.name || o.type, file: en.at ?? 'scene.add / engine.add', on: true, affects: affects('scene', o) }); }
  for (const h of e.post?._list ?? []) if (![h._def, h._def._pass, h._def.node].some(v => v && fromPlugin.has(v)))
    rows.push({ slot: 'post', plugged: h.name, file: 'engine.post.add', on: h.enabled, affects: [`picture: post chain ${h.slot} slot, ${h.name}`] });
  for (const m of e.post?._plain ?? []) if (m.output)
    rows.push({ slot: 'post', plugged: 'OutputPass (skipped: the engine tone maps; passes after it run in ldr)', file: 'engine.post.add', on: true, affects: ['picture: where display color starts'] });
  for (const m of e.modules.values()) if (!fromPlugin.has(m))
    rows.push({ slot: 'module', plugged: m.name, file: 'engine.use', on: true, affects: affects('module', m) });
  for (const l of e._gameLights?.list() ?? [])
    rows.push({ slot: 'light', plugged: l.name || l.type, file: e._things.entryOf(l)?.[0]?.at ?? 'scene.add', on: true, affects: affects('light', l) });
  return rows;
}
