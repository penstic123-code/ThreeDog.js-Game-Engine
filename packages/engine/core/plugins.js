// engine.plugins: the plugins folder (docs/plans/2026-11-03-slot-map.md section 6). Each file in the game's plugins/ folder is imported at
// start and plugged in by WHAT it exports, through the one call a game would have written by hand:
//   Object3D                      -> engine.add(obj, { id: <file name> })        (same as scene.add, plus a stable save id)
//   three.js Pass (has render())  -> engine.look.post.add(pass, { name: <file name> })
//   post effect { name, create | node | fuse } -> engine.look.post.add(effect)   (create for WebGL, node for WebGPU: one file runs on both)
//   Material                      -> engine.look.materials.replace(role, mat)     role = mat.name, else the file name
//   ShaderPatch { slot, glsl|tsl } -> engine.look.materials.add(<file>, spec, { roles })
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
// A style pack is a bundle of the same plugins (style.plugins, core/styleParts.js stylePlugins): plugged here first, through this same code, named
// '<pack>/<file>', with materials and material patches on the style layer so the game, effects and settings still win; off('<pack>') takes the pack's out.
// Why not a second loader for styles: one path means a plugin file works alone in plugins/ or inside any number of style packs, unchanged.
import { codedError } from './errorHints.js';
import { stylePlugins } from './styleParts.js';

const SHAPES = 'an Object3D (goes in the scene), a three.js Pass with render() (post chain), a post effect { name, create: ctx => pass, node: (input, ctx) => node } or { name, fuse } (post chain, both renderers), ' +
  'a Material (look.materials role = material.name or the file name), a ShaderPatch { slot, glsl | tsl, roles? } (look.materials.add), ' +
  "a module { name, type, install / init } (engine.use), or an array of these. Export it as default (export default new THREE.Mesh(...))";

/** Which slot a value plugs into, or null when it is none of the accepted shapes */
function shapeOf(v) {
  if (v?.isObject3D) return 'scene';
  if (v?.isMaterial) return 'material';
  if (v && typeof v === 'object') {
    if (typeof v.render === 'function' && 'needsSwap' in v) return 'post';   // three's Pass base class sets needsSwap: a Pass, not a module with render()
    if (typeof v.name === 'string' && v.type && (v.install || v.init || v.fixed || v.frame || v.dispose)) return 'module';
    if (typeof v.name === 'string' && (typeof v.create === 'function' || typeof v.node === 'function' || (v.fuse && typeof v.fuse === 'object'))) return 'post';
    if (typeof v.glsl === 'string' || typeof v.glsl === 'object' || v.tsl) return 'patch';
  }
  return null;
}

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
  add(files, { order = [], off = [] } = {}) { return this._add(files, { order, off }); }

  /** @internal the one loader: the game's folder (group null) and each style pack's plugins (group = the pack's name, style layer) */
  _add(files, { order = [], off = [], group = null }) {
    const paths = Object.keys(files).sort((a, b) => baseOf(a) < baseOf(b) ? -1 : baseOf(a) > baseOf(b) ? 1 : 0);
    const rank = n => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
    paths.sort((a, b) => rank(baseOf(a)) - rank(baseOf(b)));   // stable sort: listed names first, the rest keep file-name order
    for (const n of [...order, ...off]) if (!paths.some(p => baseOf(p) === n))
      throw codedError('plugin-shape', `plugins.json names '${n}', but there is no plugins/${n}.js; files: ${paths.map(baseOf).join(', ') || 'none'}`);
    const where = group ? `style ${group}: plugins/` : 'plugins/';
    for (const path of paths) {
      const ns = files[path], name = group ? `${group}/${baseOf(path)}` : baseOf(path);
      const values = ns && 'default' in ns ? [].concat(ns.default) : Object.values(ns ?? {}).flat();
      if (!values.length) throw codedError('plugin-shape', `${where}${baseOf(path)}: the file exports nothing. Export one of: ${SHAPES}`);
      for (const v of values) if (!shapeOf(v)) throw codedError('plugin-shape', `${where}${baseOf(path)} exports ${describeValue(v)}, which is not a plugin. Accepted: ${SHAPES}`);
      const file = group ? `${where}${baseOf(path)}.js` : path.replace(/^.*?(plugins\/)/, '$1');
      this._list.set(name, { name, group, file, values, on: !off.includes(name), plugged: [] });
    }
    if (!group) this._added = true;
    if (this._e._started) this._plugAll();
    return this;
  }

  /** @internal start(): plug every file that is on, in order (before module init, so a module from a plugin inits with the others) */
  _plugAll() { for (const p of this._list.values()) if (p.on && !p.plugged.length) this._plug(p); }

  /** @internal */
  _plug(p) {
    const e = this._e, owner = p.group ? 'style:' + p.group : 'plugin:' + p.name, layer = p.group ? 'style' : 'game';   // a style's plugins sit under the game
    try {
      for (const v of p.values) {
        const slot = shapeOf(v);
        let remove;
        if (slot === 'scene') { e.add(v, { id: p.values.length > 1 ? `${p.name}/${p.plugged.length}` : p.name }); remove = () => { v.removeFromParent(); e._things.forget(v); e.rays.forget(v); }; }   // not engine.remove: that disposes, and on() puts it back
        // an effect keeps its own name (look.post.set({ bloom: false }) reads the same from any source); a bare Pass is named by its file
        else if (slot === 'post') { const h = e.look.post.add(v, { owner, layer, ...(v.isPass || 'needsSwap' in v ? { name: p.values.length > 1 ? `${p.name}/${p.plugged.length}` : p.name } : {}) }); remove = () => h.remove(); }
        else if (slot === 'material') { const h = e.look.materials.replace(v.name || baseOf(p.name), v, { owner, layer }); remove = () => h.remove(); }
        else if (slot === 'patch') { const { roles, ...spec } = v, h = e.look.materials.add(p.name, spec, { roles, owner, layer }); remove = () => h.remove(); }
        else { e.use(v); remove = () => { if (e.modules.get(v.name) === v) e._unuse(v.name); }; }
        p.plugged.push({ slot, value: v, remove });
      }
    } catch (err) {
      this._unplug(p);   // all or nothing per file: half a plugin is harder to read than none
      err.message = `${p.file}: ${err.message}`;
      throw err;
    }
  }
  /** @internal */
  _unplug(p) { for (const x of p.plugged.splice(0).reverse()) x.remove(); }

  /**
   * Switch a plugin off: everything it plugged is taken out again (the object leaves the scene, the pass the chain, the patch its layer,
   * the module is unloaded). No code change: plugins.json "off" does the same at start. A style pack's name switches off all of that pack's
   * plugins ('ink'), '<pack>/<file>' one of them. @param {string} name file name without .js, or a style pack's name
   */
  off(name) { for (const p of this._get(name)) { p.on = false; this._unplug(p); } }
  /** Switch a plugin (or a style pack's plugins) back on (plugged at once after start) @param {string} name */
  on(name) { for (const p of this._get(name)) { p.on = true; if (this._e._started && !p.plugged.length) this._plug(p); } }
  /** @internal the plugin by name, or every plugin of the style pack by that name */
  _get(name) {
    const p = this._list.get(name), pack = p ? [p] : [...this._list.values()].filter(x => x.group === name);
    if (!pack.length) throw codedError('plugin-shape', `engine.plugins: no plugin '${name}' (nor a style pack by that name); plugins: ${[...this._list.keys()].join(', ') || 'none (no plugins folder, no style plugins)'}`);
    return pack;
  }

  /** The plugins in plug order (a style's first): { name, file, on, slots, style } (style: the pack's name, null for the game's folder) @returns {{ name: string, file: string, on: boolean, slots: string[], style: string | null }[]} */
  list() { return [...this._list.values()].map(p => ({ name: p.name, file: p.file, on: p.on, slots: p.values.map(v => shapeOf(v)), style: p.group })); }
}

function describeValue(v) {
  if (v == null) return String(v);
  if (typeof v === 'function') return `a function${v.name ? ` (${v.name})` : ''}. A factory (module, material, effect)? Export what it returns: export default lightPool({ point: 8 }). ` +
    "A post node pass? Export it as an effect: export default { name: 'glow', node: (input, ctx) => ..., create: ctx => pass }";
  if (typeof v !== 'object') return `a ${typeof v}`;
  return `an object with keys ${Object.keys(v).slice(0, 6).join(', ') || '(none)'}`;
}

/**
 * Plug the style's plugins (style layer), then what the page's plugins folder gave (the vite preset puts it on globalThis.__threedogPlugins
 * before main.js runs) and the files engine.plugins.add received. Called once by start(). @param {any} e
 */
export function plugAtStart(e) {
  // the style's first, so their list order (and describe().slots) reads base look, then the game's additions
  const before = [...e.plugins._list.entries()];
  e.plugins._list.clear();
  for (const { group, files } of stylePlugins(e.style)) e.plugins._add(files, { group });
  for (const [k, v] of before) e.plugins._list.set(k, v);
  const page = typeof globalThis !== 'undefined' ? globalThis.__threedogPlugins : null;
  if (page && !e.plugins._added) e.plugins.add(page.files, page.config ?? {});
  e.plugins._plugAll();
}

/**
 * describe().slots: one table of what is plugged in where. Each row: { slot, plugged, file, on, affects }; file is the plugin file, the
 * file:line that called scene.add / engine.add (dev), or the call that plugged it ('engine.use', 'look.post.add'). Why one table:
 * a reader asking "what did this game add to the engine" had to put describe().scene, render.post, look and modules side by side.
 * @param {any} e
 */
export function describeSlots(e) {
  const rows = [], fromPlugin = new Set();
  const passOf = v => e.post?._list.find(h => h._def === v || h._def._pass === v || h._def.node === v);
  const affects = (slot, v, name) => {
    if (slot === 'scene') { const t = e._things.byObj.get(v); return t ? [`engine.thing('${t.id}')`, `save tier ${e._things.tier(t)}`] : ['scene']; }
    if (slot === 'post') { const h = passOf(v); return [h ? `picture: post chain ${h.slot} slot, ${h.name}` : 'picture: post chain']; }
    if (slot === 'material') { const r = v.name || baseOf(name); return [`look.materials replace:${r}`, `makeMaterial('${r}')`]; }
    if (slot === 'patch') return [`look.materials hook:${name}`, v.roles ? `materials of roles ${v.roles.join(', ')}` : 'every makeMaterial material', `shader slot ${v.slot ?? '?'}`];
    if (slot === 'light') return ["budget 'lights'", ...(v.castShadow ? ["budget 'shadowLights'", 'idle shadow redraw rule'] : [])];
    return [`engine.${v.name}`, `type ${v.type}`, ...(v.provides ?? []).map(s => `provides ${s}`)];
  };
  for (const p of e.plugins?._list.values() ?? []) for (const v of p.values) {
    const slot = shapeOf(v);
    fromPlugin.add(v);
    rows.push({ slot, plugged: (slot === 'module' ? v.name : v.name || v.type) || p.name, file: p.file, on: p.on, affects: p.on ? affects(slot, v, p.name) : [] });
  }
  for (const o of e.scene.children) { const en = e._things.byObj.get(o); if (en?.owner === 'game' && !fromPlugin.has(o) && !o.isLight)
    rows.push({ slot: 'scene', plugged: o.name || o.type, file: en.at ?? 'scene.add / engine.add', on: true, affects: affects('scene', o) }); }
  for (const h of e.post?._list ?? []) if (![h._def, h._def._pass, h._def.node].some(v => v && fromPlugin.has(v)))
    rows.push({ slot: 'post', plugged: h.name, file: 'look.post.add', on: h.enabled, affects: [`picture: post chain ${h.slot} slot, ${h.name}`] });
  for (const m of e.post?._plain ?? []) if (m.output)
    rows.push({ slot: 'post', plugged: 'OutputPass (skipped: the engine tone maps; passes after it run in ldr)', file: 'look.post.add', on: true, affects: ['picture: where display color starts'] });
  for (const m of e.modules.values()) if (!fromPlugin.has(m))
    rows.push({ slot: 'module', plugged: m.name, file: 'engine.use', on: true, affects: affects('module', m) });
  for (const l of e._gameLights?.list() ?? [])
    rows.push({ slot: 'light', plugged: l.name || l.type, file: e._things.entryOf(l)?.[0]?.at ?? 'scene.add', on: true, affects: affects('light', l) });
  return rows;
}
