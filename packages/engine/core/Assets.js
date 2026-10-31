// Asset management:
//   1. Asset manifest: register every model, texture and sound under a name; code uses names only, so swapping a file means editing the manifest.
//   2. Preload: load everything marked preload once at startup; the loading screen shows progress.
//   3. Cache and reuse: one file downloads once; models return independent copies (geometry and materials shared), so you can place many.
//   4. Release: models count usage per copy (model() adds one, engine.remove of a copy subtracts one). release(name) frees only when the last copy is removed;
//      trim() frees every model with no copy in use (level calls it after a level change). Geometry handed out by geometry() / cached() is not counted, so such models are freed only by release.
//   5. Compression: Draco / Meshopt models and .ktx2 textures load as-is; the decoder downloads on first use (npm run assets produces compressed files).
//   6. Code-generated models: write a function (or { build, params }) in the manifest; it is built on demand and cached automatically, see cached() below.
//   7. Observable: every load is a task in engine.loading (phase, error with path + HTTP status, which manifest). A registered file that fails
//      falls back (gray placeholder / silence, or the entry's fallback asset) unless it is critical: true, which stops start() instead.
//
// Put files under public/: public/models/house.glb -> write the path as '/models/house.glb'
//
// engine.assets.manifest({
//   models:   { house: '/models/house.glb', hero: { url: '/models/hero.glb', critical: true }, block: buildBlock },
//   textures: { paper: { url: '/textures/paper.jpg', color: true }, ground: '/textures/ground.ktx2' },
//   sounds:   { bgm: '/sounds/morning.mp3' },
// }, { name: 'main' });                                  // name: shown as the source manifest in engine.loading
// await engine.assets.preload(p => console.log(p));     // p: 0-1 (code-generated models are built ahead only if marked preload)
// const house = await engine.assets.model('house');      // get by name
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { warnMissing, warnOnce, fmt } from './validate.js';
import { codedError, coded } from './errorHints.js';
import { Animator } from './Animator.js';
import { loadGltf, loadTexture, generated, placeholder, LoadError } from './assetLoad.js';
import { failureText } from './Loading.js';

const STRINGS = {
  failed: 'Asset failed to load: {what}',
  fellBack: '; using {fallback} instead, the game continues (mark it critical: true if the game cannot start without it)',
  missingRefs: 'Asset loaded with missing references: {what} (missing {list}); materials show without those files',
  clash: 'assets.manifest(): "{name}" is already registered as a {was} (manifest "{list}"), and now as a {type}; one name is one asset, ' +
    'so the second would replace the first. Rename one, e.g. {name}_{type}',
  sameName: 'assets.cached(\'{name}\'): the same name was used with two different generator functions, so the cache would mix them (keyed by name + params). Use a different name per model; if the result depends on outer variables, put them in params',
};
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
   * Register the asset manifest (may be called repeatedly). A model may be a generator function or { build, params, preload }.
   * Per entry: critical: true = start() stops if it fails (otherwise it falls back and the game continues); fallback: 'otherName' replaces the gray placeholder.
   * opts.name labels the manifest in engine.loading (default 'manifest#1', '#2'...), so a failure says which list it came from.
   * @example engine.assets.manifest({ models: { hero: { url: '/models/hero.glb', critical: true }, bush: { url: '/models/bush.glb', fallback: 'rock' } } }, { name: 'level-1' });
  */
  manifest({ models = {}, textures = {}, sounds = {} } = {}, { name: list = 'manifest#' + (this._lists = (this._lists || 0) + 1) } = {}) {
    const add = (type, map) => {
      for (const [name, v] of Object.entries(map)) {
        const o = typeof v === 'string' ? { url: v } : typeof v === 'function' ? { build: v } : v;
        const old = this.entries.get(name);
        if (old?.named && old.type !== type) throw codedError('asset-name-clash', fmt(STRINGS.clash, { name, was: old.type, list: old.manifest, type }));
        this.entries.set(name, { type, name, url: o.url ?? name, opts: o, promise: null, named: true, manifest: list });
      }
    };
    add('model', models); add('texture', textures); add('sound', sounds);
    return this;
  }

  _resolve(nameOrUrl, type) {
    let e = this.entries.get(nameOrUrl);
    // not path-like (no / or .) and not registered: most likely a misspelled name
    if (!e && !/[/.]/.test(nameOrUrl)) warnMissing('asset', nameOrUrl, [...this.entries].filter(([, x]) => x.type === type && x.named).map(([n]) => n));
    if (!e) { e = { type, name: nameOrUrl, url: nameOrUrl, opts: {}, promise: null }; this.entries.set(nameOrUrl, e); }
    return e;
  }
  /** Load an entry as a task in engine.loading; a registered, non-critical file that fails resolves to its fallback */
  _fetch(e) {
    if (e.promise) return e.promise;
    const L = this.engine.loading, name = e.variantOf ?? e.name ?? e.url;
    const t = L._begin(name, e.type, { critical: e.opts.critical === true, url: e.opts.build ? null : e.url, manifest: e.manifest ?? null });
    if (e.type === 'model') e.promise = (e.opts.build ? (t.phase('build'), generated(this, e.url, e.opts.build, e.opts.params, t)) : loadGltf(this, e.url, t)).then(g => this._share(g));
    else if (e.type === 'texture') e.promise = loadTexture(this, e, t);
    else if (e.type === 'sound') e.promise = (t.phase('download'), this.engine.audio.load(e.url).catch(err => { throw new LoadError(err.message, { url: e.url }); }));
    e.promise = e.promise.then(v => {
      L._done(t);
      const what = `${e.type} "${name}" <- ${e.url}`;
      if (t.missing.length) warnOnce(coded('asset-missing-ref', fmt(STRINGS.missingRefs, { what, list: t.missing.join(', ') })));
      return (e.value = v);
    }, err => this._failed(e, t, err));
    return e.promise;
  }
  /** A load failed: a registered file entry degrades (warn + fallback); anything else is recorded and rethrown to the caller */
  _failed(e, t, err) {
    e.promise = null;
    const degrade = e.named && !e.opts.build && !e.opts.critical;
    const fb = degrade ? (e.opts.fallback ?? (e.type === 'sound' ? 'silence' : 'gray placeholder')) : null;
    this.engine.loading._fail(t, err, fb);
    const msg = fmt(STRINGS.failed, { what: failureText(t) });
    if (!degrade) throw codedError('asset-load', msg);
    warnOnce(coded('asset-load', msg + fmt(STRINGS.fellBack, { fallback: e.opts.fallback ? `"${fb}"` : fb })));
    if (e.opts.fallback) return (e.promise = this._fetch(this._resolve(e.opts.fallback, e.type)));   // e.value stays null: the fallback entry owns the memory
    e.value = e.type === 'model' ? this._share(placeholder('model')) : placeholder(e.type);
    return (e.promise = Promise.resolve(e.value));
  }
  /** Mark the model template's geometry and materials as shared */
  _share(g) {
    g.scene.traverse(o => { if (o.geometry) this.shared.add(o.geometry); for (const m of [].concat(o.material || [])) this.shared.add(m); });
    return g;
  }

  /**
   * Preload manifest assets (all by default; onlyMarked=true loads only those marked preload). Code-generated models are built ahead only if marked preload. onProgress(0-1, current name).
   * Finishing is not succeeding: failed lists every entry that failed, including those now showing their fallback (details in engine.loading).
  */
  async preload(onProgress, { onlyMarked = false } = {}) {
    const list = [...this.entries.entries()].filter(([, e]) => e.opts.build ? e.opts.preload : !onlyMarked || e.opts.preload);
    let done = 0;
    onProgress?.(list.length ? 0 : 1, '');
    // critical failures are reported by start(); others not already warned about (generated models) are warned here
    await Promise.all(list.map(([name, e]) => this._fetch(e).catch(err => { if (!e.opts.critical) console.warn(err.message); }).finally(() => { done++; onProgress?.(done / list.length, name); })));
    const failed = list.filter(([name, e]) => this.engine.loading.get(name, e.type)?.phase === 'failed').map(([name]) => name);
    return { loaded: list.length - failed.length, failed, ok: !failed.length };
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
    const e = this.entries.get(name); if (e) this._free(e);
  }
  /** Release every model with no copy in use (call after a level change; level calls it). Returns the names released */
  trim() {
    const freed = [];
    for (const [k, e] of this.entries) if (e.type === 'model' && e.value && !e.users && !e.pinned) { this._free(e); freed.push(k); }
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
      if (--e.users <= 0 && e.releasePending) this._free(e);
    });
  }
  _free(e) {
    if (!e.value) return;
    if (e.users > 0) { e.releasePending = true; return; }
    if (e.type === 'texture') e.value.dispose();
    if (e.value.isBufferGeometry) e.value.dispose();   // code-generated geometry
    else if (e.type === 'model') (e.value.scene ?? e.value).traverse?.(o => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach(m => { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); }); } });
    e.value = null; e.promise = null; e.releasePending = e.pinned = false;
  }
  /** Release all loaded assets and decoders (engine.dispose calls it) */
  dispose() {
    for (const e of this.entries.values()) { e.users = 0; this._free(e); }
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
