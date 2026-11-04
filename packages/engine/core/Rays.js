// Rays: engine.raycast / engine.pick, with the registry engine.rays.
//   engine.raycast(origin, direction, { far, targets: 'static' | 'all' | [objects...], filter })  -> { point, distance, normal, object, face, entry?, kind? } | null
//   engine.pick(ndcX, ndcY)                         // cast from screen coordinates (-1..1)
//   hit.thing                                       // point -> thing (computed when read): { id, kind, template, definedAt, model, mesh, material, fields, edit } (core/Inspect.js thingOf)
//   engine.rays.addStatic(levelRoot)           // register static objects (builds a BVH for speed); returns a handle { remove() }
//   engine.rays.addProvider((origin, dir, far) => hit | null)   // a module merges its own hits (rigid adds rigid bodies once installed); asked only when targets is 'all'
//
// Acceleration uses three-mesh-bvh: importing this file patches three's prototypes the way it recommends (Mesh.prototype.raycast etc.),
// after which any mesh with geometry.boundsTree takes the fast path and the rest fall back to three's per-triangle check.
// By default only visible objects are hit (itself and every parent visible) and they must be in the scene; occluders: true hits only camera blockers (including hidden col_ collision meshes).
// Exception: an object with userData.rayVisible = true still counts as visible while hidden, for hiding that merely swaps in something else on screen (hlod marks the original this way when it hides it far away and shows the merged proxy).
// A registered mesh is unregistered automatically when its geometry is disposed; engine.remove unregisters too.
// Terrain chunks and instanced vegetation are not registered (use engine.surface for ground height and vegetation.instanceAt for trees).
/** @import { Handle, Vec3Like } from '../types/common' */
/** @import { RaycastOptions, RayHit, RayProvider } from '../types/core' */
import * as THREE from 'three';
import { vec3 } from './math.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { thingOf } from './Inspect.js';
import { RESERVED_LAYERS } from '../render/layers.js';
import { DEV, warnOnce } from './validate.js';

// No three.js prototype is changed: a registered static mesh gets its own BVH and its own raycast (an own property on that mesh), so the engine's
// rays are fast and the game's own Raycaster stays plain three.js. A game that wants BVH page-wide writes three-mesh-bvh's three documented lines.

// Meshes under this many triangles get no BVH (blocky buildings etc.: the per-triangle check is faster)
const BVH_MIN = 256;
const triangles = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _ndc = new THREE.Vector2(), _sph = new THREE.Sphere();

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
    /** Registered mesh -> { refs: registration count, occ: camera-blocker registration count } @type {Map<THREE.Object3D, { refs: number, occ: number }>} */
    this.statics = new Map();
    /** The three.js Raycaster (firstHitOnly is on) @type {any} */
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;       // only the nearest hit per mesh (faster with a BVH)
    this.ray.layers.enable(RESERVED_LAYERS.batched);   // originals drawn through engine.batching sit here and must still be hit
    this.ray.layers.enable(RESERVED_LAYERS.occlusionHidden);   // so must what occlusion culling is not drawing this frame
  }
  /**
   * Register a static object and every mesh under it (an array also works; meshes over 256 triangles get a BVH); occluder: true also blocks the camera. Returns a handle { remove() }.
   * Only visible objects are hit; hiding that just swaps in something else on screen (such as the far-away hlod original) is marked userData.rayVisible = true and is still hit.
   * Unregisters automatically on geometry dispose or engine.remove.
   * @param {THREE.Object3D | THREE.Object3D[]} obj
   * @param {{ occluder?: boolean }} [opts]
   * @returns {Handle}
   * @example engine.rays.addStatic(house, { occluder: true });
   */
  addStatic(obj, opts = {}) {
    const { occluder = false } = opts;
    const added = [];
    for (const o of [].concat(obj)) o.traverse(m => {
      if (DEV && (m.isInstancedMesh || m.isSkinnedMesh)) warnOnce(`engine.rays.addStatic: skipped ${m.isInstancedMesh ? 'an InstancedMesh' : 'a SkinnedMesh'} ("${m.name}"): rays do not hit these and they do not block the camera. Use a collider, or register a plain stand-in mesh.`, 'rays-skip-' + m.type);
      if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !m.geometry?.attributes.position) return;
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
  /** Unregister every mesh under the object (engine.remove calls this automatically) @param {THREE.Object3D} obj */
  forget(obj) { obj.traverse(m => this._drop(m)); }
  /** @internal */
  _drop(m) {
    const s = this.statics.get(m); if (!s) return;
    s.geometry.removeEventListener('dispose', s.onDispose);
    this.statics.delete(m);
  }
  /** @internal Clear all registrations (called by engine.dispose) */
  dispose() { for (const m of [...this.statics.keys()]) this._drop(m); this.providers = []; }
  /** A module merges its own hits (rigid adds rigid bodies; asked only when targets is 'all'). Returns a handle { remove() } @param {RayProvider} fn @returns {Handle} */
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
  cast(origin, dir, opts = {}) {
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
  pick(ndcX, ndcY, opts = {}) {
    const { far = Infinity, targets = 'static', filter = null } = opts;
    this.ray.setFromCamera(_ndc.set(ndcX, ndcY), this.engine.camera);
    this.ray.far = far;
    return this._cast(this.ray.ray.origin, this.ray.ray.direction, far, targets, filter, false);
  }

  /** @internal */
  _cast(o, d, far, targets, filter, occluders) {
    const scene = this.engine.scene, hits = [];
    let best = null;
    const take = h => { if (h && h.distance <= far && (!best || h.distance < best.distance) && (!filter || filter(h))) best = h; };
    if (Array.isArray(targets)) {
      this.ray.firstHitOnly = false;
      for (const h of this.ray.intersectObjects(targets, true)) { if (h.object.isMesh && shown(h.object)) { take(toHit(h)); if (best) break; } }
      this.ray.firstHitOnly = true;
    } else {
      const ray = this.ray.ray;
      for (const [m, s] of this.statics) {
        if (occluders && !s.occ) continue;   // first: a camera ray then pays one flag check for every mesh that is no blocker
        if (!mayHit(ray, m, far)) continue;   // most statics are nowhere near the ray: skip them before walking parents
        if (occluders ? !inScene(m, scene) : !shown(m, scene)) continue;
        hits.length = 0; m.raycast(this.ray, hits);
        for (const h of hits) take(toHit(h));
      }
      if (targets === 'all') for (const p of this.providers) take(p(o.clone(), d.clone(), far));
    }
    if (best) { const e = this.engine, h = best; Object.defineProperty(h, 'thing', { get: () => thingOf(e, h.object, h), configurable: true }); }   // computed only when read
    return best;
  }
}

// Shown: itself and all parents visible (or marked userData.rayVisible); with a scene given it must also be in that scene
function shown(o, scene) {
  for (let p = o; p; p = p.parent) { if (!p.visible && !p.userData.rayVisible) return false; if (p === scene) return true; }
  return !scene;
}
function inScene(o, scene) { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; }
function toHit(h) {
  const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
  return { point: h.point, distance: h.distance, normal, object: h.object, face: h.face };
}
