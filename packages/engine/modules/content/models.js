// Models of placed content records: clone the shared prototype of a model name (core/assets/namedModel.js protoOf, the one path every system uses),
// align it and its collision to the record (props and template instances).
import { protoOf } from '../../core/assets/namedModel.js';
import { wrapLod } from '../../core/assets/assetLod.js';
import { Vector3 } from 'three';
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
  const { x, z } = rec.position, rot = rec.rot ?? 0, scale = (rec.scale ?? 1) * mul, ud = o.userData;
  ud.fit = { x, z, rot, scale };
  rec.position.y = e.surface(x, z, rec.floor) + (rec.offsetY ?? 0);
  o.position.y = rec.position.y; o.rotation.y = rot; o.scale.setScalar(scale);
  ud.unstatic?.remove(); ud.unstatic = null;
  for (const h of ud.colliders.splice(0)) h.remove();
  // a solid prop blocks the camera with its whole mesh, not only its footprint collider: crowns and eaves stand outside the footprint, and no game code should have to say so
  const blocks = !!solid.collide && solid.collide.occluder !== false && solid.occluder !== false;
  if (solid.static !== false && e.rays) { o.updateMatrixWorld(true); ud.unstatic = e.rays.addStatic(o, { occluder: blocks }); }
  if (!solid.collide || !e.collision) return;
  const { collide } = solid, set = typeof collide === 'object' ? collide : null, base = set || collide === 'circle' ? baseOf(ud.proto) : null;
  const size = ud.proto.size.clone().multiplyScalar(scale), c = base ?? ud.proto.center, ox = c.x * scale, oz = c.z * scale;
  const cx = x + ox * Math.cos(rot) + oz * Math.sin(rot), cz = z - ox * Math.sin(rot) + oz * Math.cos(rot);
  ud.colliders.push(base
    ? e.collision.addCircle({ x: cx, z: cz }, { radius: (set?.circle ?? base.width / 2) * scale, height: size.y, occluder: blocks })
    : e.collision.addBox({ x: cx, z: cz }, { halfWidth: size.x / 2, halfDepth: size.z / 2, rotation: rot, height: size.y, occluder: blocks }));
}
/** Is the model still as settle aligned it? update asks every frame for every built prop, because world.move sends no event: four compares, no text @internal */
export const fits = (o, rec, mul = 1) => { const f = o.userData.fit, p = rec.position; return f.x === p.x && f.z === p.z && f.rot === (rec.rot ?? 0) && f.scale === (rec.scale ?? 1) * mul; };

/** Clone the shared prototype of a model for one record and align it (props and template instances) @internal */
export async function buildModel(e, api, rec, model, solid, mul = 1) {
  const proto = await protoOf(e, api, model), name = list(model)[0], lod = rec.lod ?? solid.lod;
  // settle below measures proto, never o, so collision stays the full model's; the record keeps only the word `lod`, so a save holds no level
  const o = lod ? await wrapLod(e.assets, name, proto.obj.clone(), { distances: Array.isArray(lod) ? lod : undefined, scale: (rec.scale ?? 1) * mul }) : proto.obj.clone();
  o.name ||= name; o.userData.name ??= name;
  o.userData.proto = proto; o.userData.colliders = [];
  if (rec.batch === false) o.userData.batch = false;   // opt out of engine.batching for this record
  o.position.set(rec.position.x, 0, rec.position.z);   // world puts the model on the record after build; height and collision are aligned here
  settle(e, rec, o, solid, mul);
  return o;
}
/** Tear down only: geometry and material belong to the shared prototype, the next build clones it again @internal */
export function unbuildModel(e, o) { o.userData.unstatic?.remove(); for (const h of o.userData.colliders) h.remove(); e.detach(o); }
