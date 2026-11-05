// A model, used by name: the one path for "a model made in code (or a file), reused by name". Content (props, templates, vegetation), pickups and
// vegetation.define all resolve a model name here, so caching (baked file -> dev cache -> build), the per-name prototype and the shadow rule exist once.
// It lives in core because several modules need it and none of them owns it (content, inventory, vegetation): no module depends on another for it.
import * as THREE from 'three';
import { neutralMaterial } from '../render/neutral.js';
import { shadowDefaults } from './assetEntry.js';
import { paramValues } from './assetManifest.js';
import { list } from './util.js';

/**
 * A model name (name or [name, params...]) whose asset entry is a generator (an asset pack's procedural model) goes through assets.cached:
 * name = model name, params count into the cache key. Returns a Promise (geometry or Object3D); null for a file model or an unknown name (assets.model takes those)
 */
export function cachedModel(e, m) {
  const [name] = list(m), fn = e.assets.builder(name);
  if (!fn) return null;
  // every model asked for by name is remembered, so a dev hot swap (core/assetHot.js) can build the same name + params list again
  const made = (e.assets._made ||= new Map());
  (made.get(name) ?? made.set(name, new Map()).get(name)).set(JSON.stringify(m), m);
  const args = builderArgs(e, m);
  // pass the generator function to cached as is (dev cache hashes its source); wrap only when there are several params
  return args.length > 1 ? e.assets.cached(name, function (p) { return fn.apply(this, p); }, args) : e.assets.cached(name, fn, args[0]);
}

/** What a generator is called with for a model name: a generator with a params schema gets one object, defaults < dev panel values < the call's own object (assetManifest.js paramValues) @internal */
export function builderArgs(e, m) {
  const [name, ...args] = list(m), entry = e.assets.entries.get(name);
  return entry?.schema ? [paramValues(entry, args[0])] : args;
}

/**
 * A vegetation model by name: { geometry } for a generator that returns geometry or for a file model (its first mesh), { model } for a generator
 * that returns an Object3D (one material per mesh kept). content's vegetation table and vegetation.define(name, { model: 'pine' }) both resolve here,
 * so a name means the same thing in data and in code. @internal
 */
export async function vegetationModel(e, m) {
  const r = await (cachedModel(e, m) ?? e.assets.geometry(list(m)[0]));
  return r?.isObject3D ? { model: r } : { geometry: r };
}

// One prototype per model name: a generator entry -> assets.cached (baked file / dev cache); a file entry -> assets.model. Content names models only (no paths).
// The only entry for "reuse a code-made model by name": content props / templates / vegetation and ground pickups all take it from here, so cache, bake and shadow rules exist once.
const protos = new WeakMap();   // owner (engine.content, or the inventory for pickups) → Map(model key → Promise<{ obj, size, center, fromGeometry }>)
const protoPalette = new WeakMap();   // prototype promise → the palette it was built from (null for a file model)
const owners = new WeakMap();   // engine → Set(owner): a hot swap walks every owner's prototypes of a changed name
/** Every prototype cache of this engine: [{ api, cache }] (cache: model key → Promise of the prototype). For core/assetHot.js @internal */
export const protoCaches = e => [...(owners.get(e) ?? [])].map(api => ({ api, cache: protos.get(api) }));
/**
 * The shared prototype of a model name (or [name, ...params]): { obj, size, center, fromGeometry }. fromGeometry: the generator returned a bare
 * geometry, wrapped here in a mesh of neutral gray; a caller with a material of its own (pickups) swaps that one. @internal
 */
export function protoOf(e, api, model) {
  if (!protos.has(api)) protos.set(api, new Map());
  (owners.get(e) ?? owners.set(e, new Set()).get(e)).add(api);
  const cache = protos.get(api), key = JSON.stringify(model), palette = e.assets.builder(list(model)[0]) ? e.assets._paletteKey : null;
  // a palette written since this prototype was built: the next placement builds again, the same rule assets.cached has by its key
  if (cache.has(key) && protoPalette.get(cache.get(key)) !== palette) cache.delete(key);
  if (!cache.has(key)) {
    const gen = cachedModel(e, model);
    cache.set(key, (gen ? gen.then(r => {
      const p = r.isObject3D ? r : new THREE.Mesh(r, neutralMaterial('prop', { vertexColors: !!r.attributes.color }));
      if (!r.isObject3D) p.userData.fromGeometry = true;
      // the generator's own castShadow / receiveShadow are kept (a decal or flat rug that must not cast); the manifest entry can set them;
      // a generator that set none gets cast + receive. Same rule as assets.model (core/assetEntry.js shadowDefaults)
      return shadowDefaults(p, e.assets.entries.get(list(model)[0])?.opts);
    }) : e.assets.model(list(model)[0])).then(obj => {
      const box = new THREE.Box3().setFromObject(obj);   // collision and the "build within what distance" check both use the prototype's bounding box, computed once
      obj.userData.modelKey = key;   // copies carry it (clone copies userData): a hot swap whose new model has other parts finds them by it
      return { obj, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), fromGeometry: !!obj.userData.fromGeometry };
    }));
    protoPalette.set(cache.get(key), palette);
  }
  return cache.get(key);
}

