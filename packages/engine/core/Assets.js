// Asset management:
//   1. Asset manifest: register every model, texture and sound under a name; code uses names only, so swapping a file means editing the manifest.
//   2. Preload: load everything marked preload once at startup; the loading screen shows progress.
//   3. Cache and reuse: one file downloads once; models return independent copies (geometry and materials shared), so you can place many.
//   4. Release: models count usage per copy; release(name) frees only when the last copy is removed, trim() frees every model with no copy in use (see their docs below).
//   5. Compression: Draco / Meshopt models and .ktx2 textures load as-is; the decoder downloads on first use (npm run assets produces compressed files).
//   6. Code-generated models: write a function (or { build, params }) in the manifest; it is built on demand and cached automatically, see cached() below.
//   7. Observable: every load is a task in engine.loading. A registered file that fails falls back (gray placeholder / silence / the entry's fallback)
//      unless it is critical: true, which stops start() instead (assetEntry.js).
//   8. Asset packs: a manifest is a plain object, so a folder or an npm package can ship one and a game registers it with one call (recipes/05-props-bake.md "Asset packs").
//
// Put files under public/: public/models/house.glb -> write the path as '/models/house.glb'
//
// engine.assets.manifest({
//   name: 'main',                                        // shown as the source manifest in engine.loading
//   models:   { house: '/models/house.glb', hero: { url: '/models/hero.glb', critical: true }, block: buildBlock },
//   textures: { paper: { url: '/textures/paper.jpg', color: true }, ground: '/textures/ground.ktx2' },
//   sounds:   { bgm: '/sounds/morning.mp3' },
//   fonts:    { pixel: '/fonts/pixel.woff2', pixelBold: { url: '/fonts/pixel-bold.woff2', family: 'pixel', weight: 700 } },   // style.ui.fonts names them
// });
// engine.assets.manifest({ name: 'forest', base: '/packs/forest/', models: { oak: 'oak.glb' } });   // -> /packs/forest/oak.glb
// await engine.assets.preload(p => console.log(p));     // p: 0-1 (code-generated models are built ahead only if marked preload)
// const house = await engine.assets.model('house');      // get by name
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { warnMissing, warnOnce, fmt, checkOptions } from './validate.js';
import { codedError, coded } from './errorHints.js';
import { Animator } from './Animator.js';
import { fetchEntry, freeEntry, preloadEntries } from './assetEntry.js';

const STRINGS = {
  clash: 'assets.manifest(): "{name}" is already registered as a {was} (manifest "{list}"), and now as a {type}; one name is one asset, ' +
    'so the second would replace the first. Rename one, e.g. {name}_{type}',
  replaced: 'assets.manifest(): {type} "{name}" from manifest "{was}" is replaced by manifest "{list}" (the later one wins). If both packs mean their own asset, rename one; '
    + 'if the override is intended (a mod replacing a model), ignore this',
  noFont: 'assets.font(\'{name}\'): no font named {name}{known}. Register the file in an asset pack: engine.assets.manifest({ fonts: { {name}: \'/fonts/{name}.woff2\' } })',
  sameName: 'assets.cached(\'{name}\'): the same name was used with two different generator functions, so the cache would mix them (keyed by name + params). Use a different name per model; if the result depends on outer variables, put them in params',
};
/** Keys of a manifest / asset pack: anything else is a typo (checkOptions says "did you mean") */
const MANIFEST_KEYS = ['name', 'base', 'models', 'textures', 'sounds', 'fonts'];
/** Keys of one fonts entry: the file, the CSS family it registers (default: the asset name), FontFace descriptors, and the usual asset flags */
const FONT_KEYS = ['url', 'family', 'weight', 'style', 'stretch', 'unicodeRange', 'display', 'featureSettings', 'variationSettings', 'critical', 'preload'];
/** Short hash of the source (cache key; tells apart same-name, different-function cases) */
const srcHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export class Assets {
  constructor(engine) {
    this.engine = engine;
    this.entries = new Map();   // name -> { type, url, opts, promise, value }
    this.gltf = new GLTFLoader();
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.draco = null;          // DRACOLoader / KTX2Loader：created on the first compressed data
    this.ktx2 = null;
    this.tex = new THREE.TextureLoader();
    this.shared = new WeakSet(); // geometry and materials shared by model copies (engine.remove does not dispose them)
    this._instances = new WeakMap();   // model copy root -> asset entry (counts usage)
    this._animators = new WeakMap();   // model root -> Animator from animate(): engine.remove disposes it with the model
    this.cacheMinMs = 20;       // builds faster than this are not cached (reading the file would be slower)
    this._loaders = {};
  }

  /**
   * Register an asset manifest or asset pack (may be called repeatedly; a later entry with the same name replaces the earlier one). A model may be a generator function or { build, params, preload }.
   * Per entry: critical: true = start() stops if it fails (otherwise it falls back and the game continues); fallback: 'otherName' replaces the gray placeholder.
   * name labels the manifest in engine.loading (default 'manifest#1', '#2'...), so a failure says which list it came from.
   * base (a pack's folder: '/packs/forest/', a CDN URL, or new URL('./files/', import.meta.url)) resolves the relative paths of this manifest; '/x' and full URLs stay as written.
   * @example engine.assets.manifest({ name: 'level-1', models: { hero: { url: '/models/hero.glb', critical: true }, bush: { url: '/models/bush.glb', fallback: 'rock' } } });
   * @example import forest from 'my-forest-assets'; engine.assets.manifest(forest);   // { name: 'forest', base, models: { oak: 'oak.glb' } }
  */
  manifest(pack = {}) {
    checkOptions('assets.manifest()', pack, MANIFEST_KEYS);
    const { models = {}, textures = {}, sounds = {}, fonts = {}, base = null } = pack, list = pack.name ?? 'manifest#' + (this._lists = (this._lists || 0) + 1);
    const at = base == null ? null : new URL(String(base).replace(/\/?$/, '/'), location.href);
    const resolve = u => at && typeof u === 'string' && !u.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(u) ? new URL(u, at).href : u;
    const add = (type, map) => {
      for (const [name, v] of Object.entries(map)) {
        const o0 = typeof v === 'string' ? { url: v } : typeof v === 'function' ? { build: v } : v;
        if (type === 'font') checkOptions(`assets.manifest() fonts.${name}`, o0, FONT_KEYS);
        const o = o0.url && at ? { ...o0, url: resolve(o0.url) } : o0;
        const old = this.entries.get(name);
        if (old?.named && old.type !== type) throw codedError('asset-name-clash', fmt(STRINGS.clash, { name, was: old.type, list: old.manifest, type }));
        // same type from another manifest: allowed (a mod overriding a model) but never silent, the two packs may just share a name by accident
        if (old?.named && old.manifest !== list) warnOnce(fmt(STRINGS.replaced, { type, name, was: old.manifest, list }));
        this.entries.set(name, { type, name, url: o.url ?? name, opts: o, promise: null, named: true, manifest: list });
      }
    };
    add('model', models); add('texture', textures); add('sound', sounds); add('font', fonts);
    return this;
  }

  /**
   * The generator function registered under a model name (manifest models: { pine: fn } or { build }), null for a file model or an unknown name.
   * Content uses it to build parametrized procedural models ([name, ...params]) through cached(); code rarely needs it
   * @example const fn = engine.assets.builder('flower'); if (fn) engine.assets.cached('flower', fn, 0xff0000);
   * @param {string} name
   * @returns {((...args: any[]) => any) | null}
   */
  builder(name) {
    const e = this.entries.get(name);
    return e?.named && e.type === 'model' && e.opts.build || null;
  }

  _resolve(nameOrUrl, type) {
    let e = this.entries.get(nameOrUrl);
    // not path-like (no / or .) and not registered: most likely a misspelled name
    if (!e && !/[/.]/.test(nameOrUrl)) warnMissing('asset', nameOrUrl, [...this.entries].filter(([, x]) => x.type === type && x.named).map(([n]) => n));
    if (!e) { e = { type, name: nameOrUrl, url: nameOrUrl, opts: {}, promise: null }; this.entries.set(nameOrUrl, e); }
    return e;
  }
  /** @internal Load an entry as a task in engine.loading (assetEntry.js) */
  _fetch(e) { return fetchEntry(this, e); }

  /**
   * Preload manifest assets (all by default; onlyMarked=true loads only those marked preload). Code-generated models and fonts are loaded ahead only if marked preload (style.ui.fonts loads its own at start()). onProgress(0-1, current name).
   * Finishing is not succeeding: failed lists every entry that failed, including those now showing their fallback (details in engine.loading).
  */
  async preload(onProgress, { onlyMarked = false } = {}) {
    return preloadEntries(this, onProgress, onlyMarked);
  }

  /**
   * A font from an asset pack, by name: downloads it once, adds it to document.fonts and resolves to the FontFace (null when the file
   * failed and the entry is not critical: text then shows the next family of style.ui.font). Only registered names work, because a font
   * needs its CSS family and descriptors; style.ui.fonts calls this for you at start().
   * @example engine.assets.manifest({ name: 'ui', fonts: { pixel: '/fonts/pixel.woff2' } }); await engine.assets.font('pixel');
   * @param {string} name
   * @returns {Promise<FontFace | null>}
   */
  async font(name) {
    const e = this.entries.get(name);
    if (e?.type !== 'font') {
      const known = [...this.entries.values()].filter(x => x.type === 'font' && x.named).map(x => x.name);
      throw codedError('unknown-name', fmt(STRINGS.noFont, { name, known: known.length ? ` (fonts: ${known.join(', ')})` : '' }));
    }
    return this._fetch(e);
  }

  /** Get a model copy (name or path); skinned characters clone correctly. static: true registers it with engine.rays (builds ray acceleration) */
  async model(nameOrUrl, opts = {}) {
    const e = this._resolve(nameOrUrl, 'model'), gltf = await this._fetch(e);
    return this._copy(e, gltf, opts);
  }
  /**
   * A model copy right now if that model has already loaded, else null (never starts a load, never waits). For code that rebuilds often,
   * such as a character coming back into view, so it skips the frame of placeholder an await would cost. Same options as model()
   * @example const m = engine.assets.modelNow('villager') ?? await engine.assets.model('villager');
   */
  modelNow(nameOrUrl, opts = {}) {
    const e = this.entries.get(nameOrUrl);
    return e?.type === 'model' && e.value ? this._copy(e, e.value, opts) : null;
  }
  /** @internal one counted copy of a loaded model */
  _copy(e, gltf, { castShadow, receiveShadow, static: isStatic = false } = {}) {
    const root = skeletonClone(gltf.scene);
    e.users = (e.users || 0) + 1; e.releasePending = false; this._instances.set(root, e);
    // code-generated models keep their own shadow settings; file models cast and receive shadows by default
    const cast = castShadow ?? (e.opts.build ? null : true), recv = receiveShadow ?? (e.opts.build ? null : true);
    root.traverse(o => { if (o.isMesh) { if (cast != null) o.castShadow = cast; if (recv != null) o.receiveShadow = recv; } });
    root.userData.animations = gltf.animations;
    if (isStatic) this.engine.rays.addStatic(root);
    return root;
  }
  /** Get the geometry of the first mesh in a model (for vegetation and bulk placement) */
  async geometry(nameOrUrl) {
    const e = this._resolve(nameOrUrl, 'model'), gltf = await this._fetch(e);
    e.pinned = true;   // the geometry was handed out and we cannot know who still uses it: trim does not free it
    let g = null; gltf.scene.traverse(o => { if (!g && o.isMesh) g = o.geometry; });
    return g;
  }
  /**
   * Get a texture (name or path; .ktx2 works too). Color textures default to sRGB; pass { color: false } for normal/roughness maps.
   * opts is part of the cache key: the same image fetched with different opts gives two separately configured textures (never silently reuses the first one's settings)
  */
  async texture(nameOrUrl, opts = {}) {
    const base = this._resolve(nameOrUrl, 'texture');
    const diff = Object.keys(opts).filter(k => k !== 'url' && JSON.stringify(opts[k]) !== JSON.stringify(base.opts[k]));
    if (!diff.length) return this._fetch(base);
    const key = nameOrUrl + '#' + JSON.stringify(Object.fromEntries(diff.sort().map(k => [k, opts[k]])));
    let v = this.entries.get(key);
    if (!v) this.entries.set(key, v = { type: 'texture', url: base.url, opts: { ...base.opts, ...opts }, promise: null, variantOf: nameOrUrl });
    return this._fetch(v);
  }

  /**
   * Release an asset and return its GPU memory (reloaded on next use). A texture is released together with all its opts variants.
   * A model with copies still in the scene is not released yet; it is freed when the last copy is engine.remove'd (copies in use are never broken)
  */
  release(name) {
    for (const [k, v] of this.entries) if (v.variantOf === name) { this.release(k); this.entries.delete(k); }
    const e = this.entries.get(name); if (e) freeEntry(e);
  }
  /** Release every model with no copy in use (call after a level change; level calls it). Returns the names released */
  trim() {
    const freed = [];
    for (const [k, e] of this.entries) if (e.type === 'model' && e.value && !e.users && !e.pinned) { freeEntry(e); freed.push(k); }
    return freed;
  }
  /** How many copies of this model are in use (taken by model() and not yet engine.remove'd) */
  users(name) { return this.entries.get(name)?.users ?? 0; }
  /** Called when an object is fully removed (engine.remove calls it): decrements the usage count of model copies beneath it and stops their animators */
  forget(obj) {
    obj.traverse(o => {
      const anim = this._animators.get(o); if (anim) { this._animators.delete(o); anim.dispose(); }
      const e = this._instances.get(o); if (!e) return;
      this._instances.delete(o);
      if (--e.users <= 0 && e.releasePending) freeEntry(e);
    });
  }
  /** Release all loaded assets and decoders (engine.dispose calls it) */
  dispose() {
    for (const e of this.entries.values()) { e.users = 0; freeEntry(e); }
    this.draco?.dispose(); this.ktx2?.dispose();
  }

  /**
   * Code-generated model (build returns an Object3D or BufferGeometry): built once per name + params, returns a copy (geometry returns the same instance).
   * Cache key = name + generator source + params: outer variables build uses (colors, sizes, seeds in the closure...) must go in params,
   * otherwise changing a variable still reads the stale cache. In dev, one name paired with different source warns once.
   * Lookup order: files baked by npm run bake (public/models/baked/) -> the dev auto-cache (.threedog/cache, invalidated when code changes) -> build now.
   * In dev, if the generator code is newer than the baked file, it builds now and warns once.
  */
  async cached(name, build, params) {
    const src = String(build), seen = (this._cachedSrc ||= new Map()).get(name);
    if (seen != null && seen !== src) warnOnce(coded('asset-name-clash', fmt(STRINGS.sameName, { name })));
    else this._cachedSrc.set(name, src);
    const key = 'cached:' + name + ':' + JSON.stringify(params ?? null) + ':' + srcHash(src);
    const e = this.entries.get(key) || this.entries.set(key, { type: 'model', url: name, opts: { build, params }, promise: null }).get(key);
    const g = await this._fetch(e);
    e.pinned = true;   // neither copies nor geometry are counted: trim does not free it
    return g.geometry ?? skeletonClone(g.scene);
  }
  /** Current usage: number of geometries and textures in GPU memory */
  get memory() { return { ...this.engine.renderer.info.memory }; }

  /** Skeletal animation: returns the animation state machine, see Animator.js; it runs per frame, so gameplay timing must not read it */
  animate(root, config) {
    const a = new Animator(this.engine, root, config);
    this._animators.get(root)?.dispose();   // one animator per model: a new one replaces the old
    this._animators.set(root, a);
    return a;
  }
}
