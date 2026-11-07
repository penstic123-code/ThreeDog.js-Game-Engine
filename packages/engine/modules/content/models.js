// Models of placed content records: clone the shared prototype of a model name (core/assets/namedModel.js protoOf, the one path every system uses),
// align it and its collision to the record (props and template instances).
import * as THREE from 'three';
import { codedError } from '../../core/base/errorHints.js';
import { protoOf } from '../../core/assets/namedModel.js';
import { wrapLod } from '../../core/assets/assetLod.js';
import { Vector3 } from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { list } from '../../core/base/util.js';

const BASE_BAND = 0.2;   // the share of the model's height above the ground that counts as its base

/**
 * Where a model stands, in model space, measured once per prototype: { x, z } centre and width of the base (its larger side, so a plain box keeps the same radius).
 * Why this measure: the base is the geometry in the lowest fifth of the height above y = 0 (above its lowest point when it floats), clipped from the triangles, because a crown or an arm starts higher, a tall box has no vertex halfway up and a boulder's belly is what walkers hit.
 * @internal
 */
export function baseOf(proto) {
  if (proto.base) return proto.base;
  const meshes = [], p = new Vector3();
  let bottom = Infinity, top = -Infinity, instanced = false;
  proto.obj.updateMatrixWorld(true);
  proto.obj.traverse(m => {
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    instanced ||= !!(m.isInstancedMesh || m.isBatchedMesh);
    const pos = m.geometry.attributes.position, at = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).toArray(at, i * 3);
      bottom = Math.min(bottom, p.y); top = Math.max(top, p.y);
    }
    meshes.push({ at, index: m.geometry.index });
  });
  const low = top > 0 ? Math.max(bottom, 0) : bottom, high = low + (top - low) * BASE_BAND;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const take = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  const edge = (at, a, b) => {
    const ay = at[a + 1], by = at[b + 1];
    if (ay >= low && ay <= high) take(at[a], at[a + 2]);
    for (const y of [low, high]) if ((ay - y) * (by - y) < 0) { const t = (y - ay) / (by - ay); take(at[a] + (at[b] - at[a]) * t, at[a + 2] + (at[b + 2] - at[a + 2]) * t); }
  };
  for (const { at, index } of meshes) {
    const n = index ? index.count : at.length / 3, v = i => (index ? index.getX(i) : i) * 3;
    for (let i = 0; i + 2 < n; i += 3) { const a = v(i), b = v(i + 1), c = v(i + 2); edge(at, a, b); edge(at, b, c); edge(at, c, a); }
  }
  // shortcut: instanced parts and models without triangles (points, lines, sprites) use the bounding box; measure their instances if a prop ever needs it
  const { size, center } = proto;
  return proto.base = instanced || x0 > x1 ? { x: center.x, z: center.z, width: Math.max(size.x, size.z) }
    : { x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: Math.max(x1 - x0, z1 - z0) };
}

/**
 * Align a built model and its collision to the record (once when built, again after the record moved or rot / scale changed).
 * solid = { collide, static } comes from the prop record, or from the template definition for template instances.
 * A circle stands on the model's base (baseOf); { circle: radius } gives the radius in model meters, so it follows the scale as the model does.
 * mul: a template stage's scale, multiplied onto the record's own scale (the record keeps only its authored scale). @internal
 */
export function settle(e, rec, o, solid, mul = 1) {
  const { x, z } = rec.position, rot = rotOf(rec), sv = scaleOf(rec, mul), ud = o.userData;
  ud.fit = fitOf(rec, mul); ud.shape = shapeOf(rec, mul); ud.holder = holderOf(e, rec);
  const tilted = isTilted(rec);
  if (tilted && solid.collide && !e.collider3d) throw tiltError(rec);
  // ground: false keeps the written height (a floating or hung model); a body's height is the solver's (templates.js addBody). The height comes from the ground, not from play,
  // so it stays out of the save (world.rest), and a ground ray's rounding (1e-16 off a turned level) is no new height: a load would write a change for it
  const y = e.surface(x, z, rec.floor) + (rec.offsetY ?? 0);
  if (rec.ground !== false && !solid.body && Math.abs(rec.position.y - y) > 1e-6 && !e.world.rest(rec.id, { x, y, z })) rec.position.y = y;
  o.position.y = rec.position.y; o.rotation.set(rot[0], rot[1], rot[2]); o.scale.set(sv[0], sv[1], sv[2]);
  ud.unstatic?.remove(); ud.unstatic = null;
  for (const h of ud.colliders.splice(0)) h.remove();
  // a solid prop blocks the camera with its whole mesh, not only its footprint collider: crowns and eaves stand outside the footprint, and no game code should have to say so
  const blocks = !!solid.collide && solid.collide.occluder !== false && solid.occluder !== false;
  if (solid.static !== false && e.rays) { o.updateMatrixWorld(true); ud.unstatic = e.rays.addStatic(o, { occluder: blocks }); }
  if (!solid.collide) return;
  const { collide } = solid, set = typeof collide === 'object' ? collide : null, base = set || collide === 'circle' ? baseOf(ud.proto) : null;
  const size = ud.proto.size.clone().multiply(new THREE.Vector3(...sv));
  if (tilted) {   // a turned-over solid is not a footprint on the ground: the three-axis provider holds it (o.quaternion carries the same turn the model has)
    const mid = ud.proto.center.clone().multiply(new THREE.Vector3(...sv)).applyQuaternion(o.quaternion).add(o.position);
    ud.colliders.push(e.collider3d.addSolid(base
      ? { position: [mid.x, mid.y, mid.z], radius: (set?.circle ?? base.width / 2) * Math.max(sv[0], sv[2]) }
      : { position: [mid.x, mid.y, mid.z], size: [size.x, size.y, size.z], rotation: rot }));
    return;
  }
  if (!e.collision) return;
  const c = base ?? ud.proto.center, ox = c.x * sv[0], oz = c.z * sv[2];
  const cx = x + ox * Math.cos(rot[1]) + oz * Math.sin(rot[1]), cz = z - ox * Math.sin(rot[1]) + oz * Math.cos(rot[1]);
  ud.colliders.push(base
    ? e.collision.addCircle({ x: cx, z: cz }, { radius: (set?.circle ?? base.width / 2) * Math.max(sv[0], sv[2]), height: size.y, occluder: blocks })
    : e.collision.addBox({ x: cx, z: cz }, { halfWidth: size.x / 2, halfDepth: size.z / 2, rotation: rot[1], height: size.y, occluder: blocks }));
}
/** Is the model still as settle aligned it, with its collider in the holder installed now (a new one starts empty; with none there is nothing to do yet)? update asks every frame for every built prop, because world.move sends no event @internal */
/** rot / scale of a record as [x, y, z]: a number is the facing about Y and a uniform scale, as it always was; an array sets each axis (the model's Euler order XYZ) */
export const rotOf = rec => Array.isArray(rec.rot) ? rec.rot : [0, rec.rot ?? 0, 0];
export const scaleOf = (rec, mul = 1) => (Array.isArray(rec.scale) ? rec.scale : [rec.scale ?? 1, rec.scale ?? 1, rec.scale ?? 1]).map(v => v * mul);
const fitOf = (rec, mul) => JSON.stringify([rec.position.x, rec.position.z, rec.ground === false ? rec.position.y : null, rotOf(rec), scaleOf(rec, mul)]);
export const fits = (e, o, rec, mul = 1) => { const h = holderOf(e, rec); return (!h || o.userData.holder === h) && o.userData.fit === fitOf(rec, mul); };
const shapeOf = (rec, mul) => JSON.stringify([rotOf(rec), scaleOf(rec, mul)]);
/** The turn and size it was built with still hold (a body moves itself, so its place says nothing) @internal */
export const fitsShape = (o, rec, mul = 1) => o.userData.shape === shapeOf(rec, mul);
/** A tilted solid needs the three-axis provider (collider3d); the same error at load (props.js) and at build, so a mistake shows once, early @internal */
export const tiltError = rec => codedError('content-misuse', `prop ${JSON.stringify(rec.id ?? rec.model)}: collide on a model turned about x or z (rot ${JSON.stringify(rec.rot)}) needs a collider3d provider: install rigid() (or your own collider3d), or set collide: false`);
export const isTilted = rec => { const r = rotOf(rec); return !!(r[0] || r[2]); };
const holderOf = (e, rec) => isTilted(rec) ? e.collider3d : e.collision;

/** Clone the shared prototype of a model for one record and align it (props and template instances). skeletonClone: a skinned part of a plain clone keeps the prototype's bones and draws where they stand @internal */
export async function buildModel(e, api, rec, model, solid, mul = 1) {
  const proto = await protoOf(e, api, model), name = list(model)[0], lod = rec.lod ?? solid.lod;
  // settle below measures proto, never o, so collision stays the full model's; the record keeps only the word `lod`, so a save holds no level
  const o = lod ? await wrapLod(e.assets, name, skeletonClone(proto.obj), { distances: Array.isArray(lod) ? lod : undefined, scale: Math.max(...scaleOf(rec, mul)) }) : skeletonClone(proto.obj);
  o.name ||= name; o.userData.name ??= name;
  o.userData.proto = proto; o.userData.colliders = [];
  o.userData.refit = r => { if (!solid.body && !fits(e, o, r, mul)) settle(e, r, o, solid, mul); };   // a body places itself; a stale solid or mul is put right by the presenter's next update
  // a file model only: a generator's prototype is pinned for good (Assets.cached), so nothing could free it. The built prop counts in describe().assets until it is torn down
  if (!e.assets.builder(name)) o.userData.lease = await e.assets.lease(name);
  if (rec.batch === false) o.userData.batch = false;   // opt out of engine.batching for this record
  o.position.set(rec.position.x, 0, rec.position.z);   // world puts the model on the record after build; height and collision are aligned here
  settle(e, rec, o, solid, mul);
  return o;
}
/** ctx.feeds: every built solid goes into the holder installed now, so the line after use() reads it. The presenters' update asks the same every frame, for what moved @internal */
export const refit = e => { for (const rec of e.world?.query({}) ?? []) e.world.view(rec.id)?.userData.refit?.(rec); };

/** Tear down only: geometry and material belong to the shared prototype, the next build clones it again @internal */
export function unbuildModel(e, o) { o.userData.lease?.remove(); o.userData.unstatic?.remove(); for (const h of o.userData.colliders) h.remove(); o.removeFromParent(); }
