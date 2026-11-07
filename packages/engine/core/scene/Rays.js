// Rays: engine.raycast / engine.pick, with the registry engine.rays.
//   engine.raycast(origin, direction, { far, targets: 'static' | 'all' | [objects...], filter })  -> { point, distance, normal, object, face, entry?, kind? } | null
//   engine.pick(ndcX, ndcY)                         // cast from screen coordinates (-1..1)
//   hit.thing                                       // point -> thing (computed when read): { id, kind, template, definedAt, model, mesh, material, fields, edit } (core/inspect/Inspect.js thingOf)
//   engine.rays.addStatic(levelRoot)           // register static objects (builds a BVH for speed); returns a handle { remove() }
//   engine.rays.addProvider((origin, dir, far) => hit | null)   // a module merges its own hits (rigid adds rigid bodies once installed); asked only when targets is 'all'
//
// By default only visible objects are hit (itself and every parent visible) and they must be in the scene; occluders: true hits only camera blockers (including hidden col_ collision meshes).
// A registered mesh is unregistered automatically when its geometry is disposed; engine.remove unregisters too.
// Terrain chunks and instanced vegetation are not registered (use engine.surface for ground height and vegetation.instanceAt for trees).
/** @import { Handle, Vec3Like } from '../../types/common' */
/** @import { RaycastOptions, RayHit, RayProvider } from '../../types/core' */
import * as THREE from 'three';
import { vec3 } from '../base/math.js';
import { isUnder } from '../base/util.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { thingOf } from '../inspect/Inspect.js';
import { RESERVED_LAYERS } from '../../render/layers.js';
import { DEV, warnOnce } from '../base/validate.js';

// No three.js prototype is changed: a registered static mesh gets its own BVH and its own raycast (an own property on that mesh), so the engine's
// rays are fast and the game's own Raycaster stays plain three.js. A game that wants BVH page-wide writes three-mesh-bvh's three documented lines.

// Meshes under this many triangles get no BVH (blocky buildings etc.: the per-triangle check is faster)
const BVH_MIN = 256;
const triangles = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _ndc = new THREE.Vector2(), _sph = new THREE.Sphere(), _m = new THREE.Matrix4(), _i = new THREE.Matrix4(), _n = new THREE.Matrix3();

/** Cheap broadphase per static: does the ray pass the mesh's world bounding sphere within far? (the same test Mesh.raycast starts with, done before the parent walk) */
// Measured (5000 statics, 4 casts a frame, node): about 12 ms -> 3-5 ms per frame; caching the world sphere per static was slower than recomputing it.
// Still O(statics): a spatial grid over statics is the next step if a game registers tens of thousands.
function mayHit(ray, m, far) {
  const g = m.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _sph.copy(g.boundingSphere).applyMatrix4(m.matrixWorld);
  if (!ray.intersectsSphere(_sph)) return false;
  return far === Infinity || ray.origin.distanceTo(_sph.center) - _sph.radius <= far;
}

/** engine.rays is the ray registry (engine.raycast hits whatever is registered here). */
export class Rays {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.providers = [];
    /** @internal the tick the statics' world matrices were last brought up to date */ this.fresh = -1;
    /** Registered mesh -> { refs: registration count, occ: camera-blocker registration count } @type {Map<THREE.Object3D, { refs: number, occ: number }>} @experimental */
    this.statics = new Map();
    /** The three.js Raycaster (firstHitOnly is on) @type {any} @experimental */
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;       // only the nearest hit per mesh (faster with a BVH)
    this.ray.layers.enable(RESERVED_LAYERS.batched);   // originals drawn through engine.batching sit here and must still be hit
  }
  /**
   * Register a static object and every mesh under it (an array also works; meshes over 256 triangles get a BVH); occluder: true also blocks the camera. Returns a handle { remove() }.
   * Only visible objects are hit. Something that is merely not drawn is still hit: batched originals, far hlod originals and the full model of a far assets.lod sit on a reserved layer, with their visible true.
   * Unregisters automatically on geometry dispose or engine.remove.
   * @param {THREE.Object3D | THREE.Object3D[]} obj
   * @param {{ occluder?: boolean }} [opts]
   * @returns {Handle}
   * @example engine.rays.addStatic(house, { occluder: true });
   */
  addStatic(obj, opts = {}) {
    const { occluder = false } = opts;
    const added = [];
    this.fresh = -1;
    for (const o of [].concat(obj)) o.traverse(m => {
      if (DEV && (m.isInstancedMesh || m.isSkinnedMesh)) warnOnce(`engine.rays.addStatic: skipped ${m.isInstancedMesh ? 'an InstancedMesh' : 'a SkinnedMesh'} ("${m.name}"): rays do not hit these and they do not block the camera. Use a collider, or register a plain stand-in mesh.`, 'rays-skip-' + m.type);
      if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.userData.lodLevel || !m.geometry?.attributes.position) return;   // a low level stands in on screen only: rays use the full model
      if (!m.geometry.boundsTree && triangles(m.geometry) >= BVH_MIN) computeBoundsTree.call(m.geometry);
      if (m.geometry.boundsTree && m.raycast === THREE.Mesh.prototype.raycast) m.raycast = acceleratedRaycast;   // a game's own raycast override wins
      let s = this.statics.get(m);
      if (!s) {
        s = { refs: 0, occ: 0, geometry: m.geometry, onDispose: () => this._drop(m) };
        m.geometry.addEventListener('dispose', s.onDispose);
      }
      s.refs++; if (occluder) s.occ++;
      this.statics.set(m, s); added.push(m);
    });
    return { remove: () => {
      for (const m of added.splice(0)) {
        const s = this.statics.get(m); if (!s) continue;
        s.refs--; if (occluder) s.occ--;
        if (s.refs <= 0) this._drop(m);
      }
    } };
  }
  /** Unregister every mesh under the object (engine.remove calls this automatically) @param {THREE.Object3D} obj @experimental */
  forget(obj) { obj.traverse(m => this._drop(m)); }
  /** @internal */
  _drop(m) {
    const s = this.statics.get(m); if (!s) return;
    s.geometry.removeEventListener('dispose', s.onDispose);
    this.statics.delete(m);
  }
  /** @internal Clear all registrations (called by engine.dispose) */
  dispose() { for (const m of [...this.statics.keys()]) this._drop(m); this.providers = []; }
  /** A module merges its own hits (rigid adds rigid bodies; asked only when targets is 'all'). Returns a handle { remove() } @param {RayProvider} fn @returns {Handle} @experimental */
  addProvider(fn) {
    this.providers.push(fn);
    return { remove: () => { this.providers = this.providers.filter(f => f !== fn); } };
  }
  /**
   * Cast a ray from origin along dir and return the nearest hit or null (same as engine.raycast).
   * @param {Vec3Like} origin
   * @param {Vec3Like} dir
   * @param {RaycastOptions} [opts]
   * @returns {RayHit | null}
   */
  _ray(origin, dir, opts = {}) {
    const { far = Infinity, targets = 'static', filter = null, occluders = false } = opts;
    const o = vec3(origin, _v), d = vec3(dir, _d).normalize();
    this.ray.set(o, d); this.ray.near = 0; this.ray.far = far;
    return this._cast(o, d, far, targets, filter, occluders);
  }
  /**
   * Cast from screen coordinates (-1..1) through the camera (same as engine.pick).
   * @param {number} ndcX
   * @param {number} ndcY
   * @param {RaycastOptions} [opts]
   * @returns {RayHit | null}
   */
  _rayAt(ndcX, ndcY, opts = {}) {
    const { far = Infinity, targets = 'static', filter = null, occluders = false } = opts;
    this.engine.camera.updateWorldMatrix(true, false);   // moved in this step: the matrix is only refreshed by the render
    this.ray.setFromCamera(_ndc.set(ndcX, ndcY), this.engine.camera);
    this.ray.far = far;
    return this._cast(this.ray.ray.origin, this.ray.ray.direction, far, targets, filter, occluders);
  }

  /** @internal */
  _cast(o, d, far, targets, filter, occluders) {
    const scene = this.engine.scene, hits = [];
    let best = null;
    const take = h => { if (h && h.distance <= far && (!best || h.distance < best.distance) && (!filter || filter(h))) best = h; };
    if (Array.isArray(targets)) {
      for (const t of targets) t.updateWorldMatrix(true, true);
      this.ray.firstHitOnly = false;
      for (const h of this.ray.intersectObjects(targets, true)) { if (shown(h.object)) { take(toHit(h)); if (best) break; } }
      this.ray.firstHitOnly = true;
    } else {
      const ray = this.ray.ray, tick = this.engine.time.tick;
      // matrices are refreshed by the render, and a fixed step runs before it: what moved or was added since would answer from where it was.
      // shortcut: once per tick and not per ray (a walk up the parents of 5000 statics costs more than the rays): something moved between two rays of one step answers from the next tick
      if (this.fresh !== tick) { this.fresh = tick; for (const m of this.statics.keys()) m.updateWorldMatrix(true, false); }
      for (const [m, s] of this.statics) {
        if (occluders && !s.occ) continue;   // first: a camera ray then pays one flag check for every mesh that is no blocker
        if (!mayHit(ray, m, far)) continue;   // most statics are nowhere near the ray: skip them before walking parents
        if (occluders ? !isUnder(m, scene) : !shown(m, scene)) continue;
        hits.length = 0; m.raycast(this.ray, hits);
        for (const h of hits) take(toHit(h));
      }
      if (targets === 'all') for (const p of this.providers) take(p(o.clone(), d.clone(), far));
    }
    if (best) { const e = this.engine, h = best; Object.defineProperty(h, 'thing', { get: () => thingOf(e, h.object, h), configurable: true }); }   // computed only when read
    return best;
  }
}

// Shown: itself and all parents visible; with a scene given it must also be in that scene
function shown(o, scene) {
  if (o.userData.lodLevel) return false;   // a low level of a THREE.LOD (assetLod.js) stands in on screen only: the full model answers for it
  for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === scene) return true; }
  return !scene;
}
/** three's hit as it came (instanceId, batchId, uv stay on it), with the normal in the world: an instance has a matrix of its own, and an uneven scale needs the normal matrix */
function toHit(h) {
  const o = h.object;
  let normal = null;
  if (h.face) {
    _m.copy(o.matrixWorld);
    const id = o.isInstancedMesh ? h.instanceId : o.isBatchedMesh ? h.batchId : undefined;
    if (id !== undefined) { o.getMatrixAt(id, _i); _m.multiply(_i); }
    normal = h.face.normal.clone().applyNormalMatrix(_n.getNormalMatrix(_m));
  }
  return { ...h, normal };
}

export const handRolled = [{ kind: 'picking', seen: 'a pointer-to-object raycast of its own', use: 'engine.pick(x, y), or engine.raycast / engine.rays: colliders and moving things are in the same query (recipe 19)', quiet: /\b(engine|e|eng|ctx)\.(rays|raycast|pick)\b/, code: /\.setFromCamera\s*\(/ }];
