// Models of placed content records: clone the shared prototype of a model name (core/namedModel.js protoOf, the one path every system uses),
// align it and its collision to the record (props and template instances).
import { protoOf } from '../../core/namedModel.js';
import { list } from './rules.js';

/**
 * Align a built model and its collision to the record (once when built, again after the record moved or rot / scale changed).
 * look = { collide, static } comes from the prop record, or from the template definition for template instances.
 * mul: a template stage's scale, multiplied onto the record's own scale (the record keeps only its authored scale). @internal
 */
export function settle(e, rec, o, look, mul = 1) {
  const { x, z } = rec.position, rot = rec.rot ?? 0, scale = (rec.scale ?? 1) * mul, ud = o.userData;
  ud.fit = fitKey(rec, mul);
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
export const fitKey = (rec, mul = 1) => `${rec.position.x},${rec.position.z},${rec.rot ?? 0},${(rec.scale ?? 1) * mul}`;

/** Clone the shared prototype of a model for one record and align it (props and template instances) @internal */
export async function buildModel(e, api, rec, model, look, mul = 1) {
  const proto = await protoOf(e, api, model), o = proto.obj.clone(), name = list(model)[0];
  o.name ||= name; o.userData.name ??= name;
  o.userData.proto = proto; o.userData.colliders = [];
  if (rec.batch === false) o.userData.batch = false;   // opt out of engine.batching for this record
  o.position.set(rec.position.x, 0, rec.position.z);   // world puts the model on the record after build; height and collision are aligned here
  settle(e, rec, o, look, mul);
  return o;
}
/** Tear down only: geometry and material belong to the shared prototype, the next build clones it again @internal */
export function unbuildModel(e, o) { o.userData.unstatic?.remove(); for (const h of o.userData.colliders) h.remove(); e.detach(o); }
