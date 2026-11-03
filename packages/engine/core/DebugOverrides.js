// engine.debug: diagnostic overrides with an owner ("show me this without X") and the diagnostic view modes. They change only what the screen shows,
// never the game state or a save, and describe().scene.overrides lists them so an AI knows the picture is not the real state. Why an owner: a tool
// (view mode, probe, AI session) removes everything it set with one clear(owner), whatever it forgot to remove(); a tool never touches another owner's.
// Generic on purpose: a patch is { visible?, material?, apply? }, and apply(obj) -> undo covers any other look (the view modes in debugView.js use it).
// All of engine.debug is core (it works without the debug panel); the F3 panel module only adds engine.debug.panel next to it (composition).
// One chain: every material / visibility change, from override() and from a view, is an entry in this._l. Removing any entry undoes the whole chain
// in reverse and re-applies the rest in order, so a view and an override on the same mesh can never restore each other's stale material, and nothing
// here disposes a material it did not create (stand-ins are cached on the original, so the original is never touched).
import { codedError } from './errorHints.js';
import { DebugView } from './debugView.js';
import { isWebGPU, webgpuPart } from '../render/backend.js';
import { reloadGlsl } from '../render/hotGlsl.js';
import { reloadAssets } from './assetHot.js';
import { ownersOn, ownerValues } from './look/points.js';

const KEYS = ['visible', 'material', 'apply'];
const MATERIALS = ['flat', 'wire'];   // 'cost' (the shaderCost view) is internal: it needs patch.colorOf

/** Drawable parts under obj (obj itself included) */
function meshes(obj) { const out = []; obj.traverse(o => { if (o.isMesh || o.isPoints || o.isLine) out.push(o); }); return out; }
const patchInfo = p => ({ ...p, ...(p.apply && { apply: 'function' }) });

export class DebugOverrides {
  /** @internal */
  constructor(e) {
    /** @internal */ this.e = e;
    /** @internal the override chain, in apply order */ this._l = [];
    /** @internal */ this._view = new DebugView(e, this);
    /** The F3 debug panel (the debug() module), or null when it is not installed @type {any} */
    this.panel = null;
    // a load can replace the objects a thing id names: an override still holding the old object would show on nothing and lie in describe
    e.events?.on?.('save:loaded', () => this._prune());
  }
  /**
   * Diagnostic view: 'albedo' | 'lighting' | 'shadow' | 'normals' to look at one part of the render, 'overdraw' (bright = many layers on a pixel),
   * 'shaderCost' (materials green -> red by compiled program cost, approximate), 'off' to restore; modules add their own (triggers: 'triggers' draws
   * the trigger zones), viewModes() lists them all. Temporary and owner-scoped; never saved
   * (describe().render says which view is active, so it is not mistaken for the real look). While one owner's view is on, another owner can neither switch it
   * nor turn it off without force: true; engine.debug.clear(owner) turns that owner's view off too.
   * @example engine.debug.view('normals');   // look at the screenshot, then engine.debug.view('off')
   * @param {'albedo' | 'lighting' | 'shadow' | 'normals' | 'overdraw' | 'shaderCost' | 'off' | string} mode @param {{ owner?: string, force?: boolean }} [opts]
   * @returns {{ mode: string, owner: string | null, what?: string, note?: string }}
   */
  view(mode, opts) { return this._view.set(mode, opts); }
  /**
   * Add a view mode for engine.debug.view (a module's overlay: zones, paths, volumes). apply(scene) draws it and returns the undo; it may run again
   * when the debug chain re-applies, so it builds from scratch each time. Returns { remove() }.
   * @example engine.debug.defineView('paths', { what: 'patrol paths as lines', apply: scene => { scene.add(g); return () => scene.remove(g); } });
   * @param {string} name @param {{ what: string, apply: (scene: import('three').Scene) => () => void }} def
   * @returns {{ remove(): void }}
   */
  defineView(name, def) { return this._view.define(name, def); }
  /** Every mode engine.debug.view accepts now (built-in and module-added) @returns {string[]} */
  viewModes() { return this._view.modes(); }
  /**
   * Shader hot reload: swap GLSL text `old` for `neu` in every scene material using it (ShaderMaterial code, shader patch code) and recompile them.
   * The vite preset calls it when a `?raw`-imported .glsl / .vert / .frag file changes in dev; returns how many materials changed (0: the page reloads).
   * @param {string} old @param {string} neu @param {string} [file] @returns {{ file: string | null, materials: number, names: string[] }}
   */
  reloadGlsl(old, neu, file) { return reloadGlsl(this.e, old, neu, file); }
  /**
   * Asset hot swap: register the asset packs again (the new module of an edited assets.js) and build what changed (a new generator function,
   * url or params schema); every live copy swaps geometry and material in place, the page, player, clock and world state stay. The vite preset
   * calls it when an art module imported by the game's assets.js is saved; returns what was swapped (also in describe().assetSwaps).
   * @example import packs from './assets.js'; if (import.meta.hot) import.meta.hot.accept('./assets.js', m => engine.debug.reloadAssets(m.default));
   * @param {any} packs @returns {Promise<{ why: string, names: string[], copies: Record<string, number>, ms: number, partsChanged?: string[] }>}
   */
  reloadAssets(packs) { return reloadAssets(this.e, packs); }
  /** The active view ({ mode: 'off', owner: null } when none) @returns {{ mode: string, owner: string | null, what?: string }} */
  viewState() { return this._view.state(); }

  /**
   * Change how an object looks for diagnosis, owned by `owner`. Returns { remove() }. Never saved, never part of the game state; listed in
   * describe().scene.overrides while active. A thing id is remembered as the id: when that thing is removed, or a load replaces it, the override is dropped.
   * @param {string} owner who sets it (a tool or session name); engine.debug.clear(owner) removes all of that owner's overrides
   * @param {string | import('three').Object3D} target a thing id (engine.thing), an object name or any Object3D, or a look part id ('look.tone'): then patch is that part's set() values, written on its debug layer above every game owner
   * @param {{ visible?: boolean, material?: 'flat' | 'wire', apply?: (obj: any) => (() => void) | void }} patch flat = unlit base colour, wire = wireframe, apply = your own change (return its undo)
   * @example const h = engine.debug.override('ai-session', 'windmill', { material: 'flat' }); h.remove();   // or engine.debug.clear('ai-session')
   */
  override(owner, target, patch) {
    if (!owner || typeof owner !== 'string') throw codedError('debug-override', "engine.debug.override(owner, target, patch): owner is a non-empty string naming who sets it, e.g. 'ai-session', so engine.debug.clear(owner) can remove it");
    if (typeof target === 'string' && target.startsWith('look.')) return this._look(owner, target, patch);
    for (const k of Object.keys(patch ?? {})) if (!KEYS.includes(k)) throw codedError('debug-override', `engine.debug.override: unknown field '${k}'. Fields: ${KEYS.join(', ')}, e.g. { visible: false } or { material: 'flat' }`);
    if (patch.material !== undefined && !MATERIALS.includes(patch.material)) throw codedError('debug-override', `engine.debug.override: material must be ${MATERIALS.map(m => `'${m}'`).join(' or ')} (unlit base colour / wireframe), got ${JSON.stringify(patch.material)}`);
    const byId = typeof target === 'string';
    const obj = /** @type {any} */ (target)?.isObject3D ? target : this.e.thing(target).object;
    const id = byId ? target : this.e._things.entryOf(obj)?.[0].id ?? (obj.name || obj.type);
    return this._add({ owner, id, byId, obj, patch: { ...patch }, undo: null });
  }
  /**
   * Remove every override of one owner (nothing else), its look-part debug values and its view; returns how many were removed
   * @param {string} owner
   */
  clear(owner) {
    const mine = this._l.filter(o => o.owner === owner && !o.view);
    if (mine.length) this._rebuild(() => { this._l = this._l.filter(o => !mine.includes(o)); });
    let looks = 0;
    for (const p of Object.values(this.e.look ?? {})) if (p._drop('debug', owner)) looks++;
    const view = this._view.releaseOwner(owner) ? 1 : 0;
    return mine.length + looks + view;
  }
  /** Active overrides as plain data (describe().scene.overrides) */
  overrides() {
    this._prune();
    const looks = Object.values(this.e.look ?? {}).flatMap(p => ownersOn(p, 'debug').map(owner => ({ owner, target: p.id, ...ownerValues(p, 'debug', owner) })));
    return [...this._l.filter(o => !o.view).map(o => ({ owner: o.owner, target: o.id, ...patchInfo(o.patch) })), ...looks];
  }
  /** A look part's debug layer (look/part.js): same validation as set(), describe().look tags the keys 'debug:<owner>' */
  _look(owner, id, values) {
    const p = this.e.look?.[id.slice(5)];
    if (!p) throw codedError('debug-override', `engine.debug.override: no look part '${id}'; parts: ${Object.keys(this.e.look ?? {}).map(k => 'look.' + k).join(', ') || 'none'}`);
    return p._setOn('debug', owner, values ?? {});   // one path with set(): normalize, flatten, check (look/part.js, review M8)
  }
  /** Active overrides on one object, for engine.thing(id).explain() */
  overridesOn(obj) { this._prune(); return this._l.filter(o => o.obj === obj && !o.view).map(o => ({ owner: o.owner, ...patchInfo(o.patch) })); }
  /** Undo everything, drop / restore what the views put back, re-apply */
  dispose() { this._rebuild(() => { this._l = []; }); this._view.active = null; }

  /** @internal Add one entry at the end of the chain: applied all-or-nothing, pushed only once it applied */
  _add(o) {
    this._apply(o);   // throws with nothing left changed (see _apply)
    this._l.push(o);
    return { remove: () => this._drop(o) };
  }
  /** @internal */
  _drop(o) { if (this._l.includes(o)) this._rebuild(() => { this._l = this._l.filter(x => x !== o); }); }
  /** @internal Undo the whole chain newest first, change the list, re-apply in order: no entry ever restores a value another entry set after it */
  _rebuild(change) {
    for (const x of [...this._l].reverse()) { x.undo?.(); x.undo = null; }
    change();
    const keep = [];
    for (const x of this._l) { try { this._apply(x); keep.push(x); } catch { /* an apply that throws now (its object was disposed) is dropped */ } }
    this._l = keep;
  }
  /** @internal Drop overrides set by thing id whose thing is gone: removed (detached from the scene) or the id now names another object (a load rebuilt it) */
  _prune() {
    const live = id => this.e._things?.live?.(id);
    const gone = this._l.filter(o => o.byId && (!inScene(o.obj, this.e.scene) || (live(o.id) ?? o.obj) !== o.obj));
    if (gone.length) this._rebuild(() => { this._l = this._l.filter(o => !gone.includes(o)); });
  }
  /** @internal Apply one entry; when a step throws, the steps already done are undone before the error goes on (all-or-nothing) */
  _apply(o) {
    const { patch, obj } = o, undos = [];
    const undo = () => { for (const u of undos.reverse()) u(); };
    try {
      if (patch.visible !== undefined) { const was = obj.visible; obj.visible = patch.visible; undos.push(() => { obj.visible = was; }); }
      if (patch.material) {
        for (const m of meshes(obj)) {
          const was = m.material;
          if (!was) continue;
          m.material = Array.isArray(was) ? was.map(x => this._stand(x, patch.material, patch.colorOf)) : this._stand(was, patch.material, patch.colorOf);
          undos.push(() => { m.material = was; });
        }
      }
      if (patch.apply) { const u = patch.apply(obj); if (typeof u === 'function') undos.push(u); }
    } catch (err) { undo(); throw err; }
    o.undo = undo;
  }
  /** @internal One cached unlit stand-in per material and kind, kept on the original's userData (we created it; the original is never disposed here) */
  _stand(m, kind, colorOf) {
    if (m.userData._dbgOf) m = m.userData._dbgOf;   // already a stand-in (a view under an override): derive from the original, never stack copies
    const cache = m.userData._dbg ??= {};
    if (cache[kind]) { if (colorOf) cache[kind].color.setHex(colorOf(m)); return cache[kind]; }
    // a plain material on purpose: a diagnostic stand-in must not depend on the style it is diagnosing (rule 1 allows dev-only debug overlays)
    // on WebGPURenderer a MeshBasicNodeMaterial carrying the material's shape nodes (a NodeMaterial's own, or a patched material's tsl chain): a
    // plain stand-in would drop positionNode / vertexNode, so swaying trees froze and TSL-displaced meshes changed shape in the very view meant to
    // show them; colorNode is its base color (not for cost)
    const Node = isWebGPU(this.e.renderer) ? webgpuPart('classes', 'debug.view').MeshBasicNodeMaterial : null;
    const s = new (Node ?? this.e.THREE.MeshBasicMaterial)({ color: colorOf ? colorOf(m) : m.color ?? 0xffffff, map: colorOf ? null : m.map ?? null, alphaMap: m.alphaMap ?? null, vertexColors: !!m.vertexColors,
      transparent: !!m.transparent, opacity: m.opacity ?? 1, side: m.side, alphaTest: m.alphaTest ?? 0, wireframe: kind === 'wire', fog: false });
    if (Node) { s.positionNode = m.positionNode ?? null; s.vertexNode = m.vertexNode ?? null; if (!colorOf) s.colorNode = m.colorNode ?? null; }
    s.name = `debug:${kind}:${m.name || ''}`; s.userData._dbgOf = m;
    return cache[kind] = s;
  }
}

/** True while obj hangs under the scene (a removed thing is detached) */
function inScene(obj, scene) { for (let o = obj; o; o = o.parent) if (o === scene) return true; return !scene; }
