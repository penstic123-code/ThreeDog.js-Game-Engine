// Models in content: procedural model cache (vegetation, props, templates) and the shared-prototype model of a placed record (props and template instances).
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { list } from './rules.js';

/**
 * A model named in content (name or [name, params...]) whose asset entry is a generator (an asset pack's procedural model) goes through assets.cached:
 * name = model name, params count into the cache key. Returns a Promise (geometry or Object3D); null for a file model or an unknown name (assets.model takes those)
 */
export function cachedModel(e, m) {
  const [name, ...args] = list(m), fn = e.assets.builder(name);
  if (!fn) return null;
  // pass the generator function to cached as is (dev cache hashes its source); wrap only when there are several params
  return args.length > 1 ? e.assets.cached(name, p => fn(...p), args) : e.assets.cached(name, fn, args[0]);
}

// One prototype per model name: a generator entry -> assets.cached (baked file / dev cache); a file entry -> assets.model. Content names models only (no paths).
const protos = new WeakMap();   // engine.content → Map(model key → Promise<{ obj, size, center }>)
function protoOf(e, api, model) {
  if (!protos.has(api)) protos.set(api, new Map());
  const cache = protos.get(api), key = JSON.stringify(model);
  if (!cache.has(key)) {
    const gen = cachedModel(e, model);
    cache.set(key, (gen ? gen.then(r => {
      const p = r.isObject3D ? r : new THREE.Mesh(r, makeMaterial('prop', { vertexColors: !!r.attributes.color }));
      p.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      return p;
    }) : e.assets.model(list(model)[0])).then(obj => {
      const box = new THREE.Box3().setFromObject(obj);   // collision and the "build within what distance" check both use the prototype's bounding box, computed once
      return { obj, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
    }));
  }
  return cache.get(key);
}

/**
 * Align a built model and its collision to the record (once when built, again after the record moved or rot / scale changed).
 * look = { collide, static } comes from the prop record, or from the template definition for template instances. @internal
 */
export function settle(e, rec, o, look) {
  const { x, z } = rec.position, rot = rec.rot ?? 0, scale = rec.scale ?? 1, ud = o.userData;
  ud.fit = fitKey(rec);
  rec.position.y = e.surface(x, z, rec.floor) + (rec.offsetY ?? 0);
  o.position.y = rec.position.y; o.rotation.y = rot; o.scale.setScalar(scale);
  ud.unstatic?.remove(); ud.unstatic = null;
  for (const h of ud.colliders.splice(0)) h.remove();
  if (look.static !== false && e.rays) { o.updateMatrixWorld(true); ud.unstatic = e.rays.addStatic(o); }
  if (!look.collide || !e.collision) return;
  const size = ud.proto.size.clone().multiplyScalar(scale), c = ud.proto.center.clone().multiplyScalar(scale);
  const cx = x + c.x * Math.cos(rot) + c.z * Math.sin(rot), cz = z - c.x * Math.sin(rot) + c.z * Math.cos(rot);
  ud.colliders.push(look.collide === 'circle'
    ? e.collision.addCircle({ x: cx, z: cz }, { radius: Math.max(size.x, size.z) / 2, height: size.y })
    : e.collision.addBox({ x: cx, z: cz }, { halfWidth: size.x / 2, halfDepth: size.z / 2, rotation: rot, height: size.y }));
}
/** What settle last aligned to; update compares it because world.move sends no event @internal */
export const fitKey = rec => `${rec.position.x},${rec.position.z},${rec.rot ?? 0},${rec.scale ?? 1}`;

/** Clone the shared prototype of a model for one record and align it (props and template instances) @internal */
export async function buildModel(e, api, rec, model, look) {
  const proto = await protoOf(e, api, model), o = proto.obj.clone(), name = list(model)[0];
  o.name ||= name; o.userData.name ??= name;
  o.userData.proto = proto; o.userData.colliders = [];
  if (rec.batch === false) o.userData.batch = false;   // opt out of engine.batching for this record
  o.position.set(rec.position.x, 0, rec.position.z);   // world puts the model on the record after build; height and collision are aligned here
  settle(e, rec, o, look);
  return o;
}
/** Tear down only: geometry and material belong to the shared prototype, the next build clones it again @internal */
export function unbuildModel(e, o) { o.userData.unstatic?.remove(); for (const h of o.userData.colliders) h.remove(); e.detach(o); }
