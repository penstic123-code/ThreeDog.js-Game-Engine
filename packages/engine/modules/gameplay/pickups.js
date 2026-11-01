// Pickups on the ground: plain kind 'pickup' records in engine.world (saved with it); the model is built only near the engine.stream sources (unloading never deletes the record).
// Taken by the interact key (radius per pickup, default inventory pickupRadius) or, with auto: true, just by walking into it (bullets, coins, health packs).
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { xzOf } from '../../core/math.js';
import { checkOptionsArg, warnOnce } from '../../core/validate.js';
import { copyData } from './Container.js';

/** inventory.spawnPickup implementation @internal */
export function spawnPickup(inv, item, position, opts = {}) {
  const [x, z] = xzOf(position);
  // a given y is the reference height on multi-layer ground (as snapToGround): a pickup on a bridge deck or a second floor stays there; without one it sits on the top layer
  const p = /** @type {any} */ (position).isObject3D ? /** @type {any} */ (position).position : position, refY = Array.isArray(p) ? p[1] : p.y;
  checkOptionsArg('inventory.spawnPickup()', opts, ['count', 'data', 'mesh', 'respawnSeconds', 'bob', 'id', 'initial', 'zone', 'radius', 'auto']);
  if (typeof opts !== 'object' || !opts) opts = {};
  inv._known(item);
  const { count = 1, mesh = null, respawnSeconds = 0, bob = true, id, initial = false, zone, radius, auto = false } = opts;
  if (radius != null && !(radius > 0)) throw new Error(`inventory.spawnPickup('${item}'): radius must be a positive number of meters, got ${radius}`);
  const data = copyData('spawnPickup', item, opts.data);
  const e = inv.engine, w = presentPickups(inv);
  const def = { id, kind: 'pickup', item, count, bob, ...(data && { data }), ...(radius != null && { radius }), ...(auto && { auto: true }),
    ...(respawnSeconds > 0 && { respawn: respawnSeconds }), ...(zone != null && { zone }), position: [x, e.surface(x, z, refY) + (e.style.pickup?.lift ?? 0.4), z] };
  const rec = initial ? w.add(def, { initial }) : id != null && w.get(id) || w.add(def);   // initial data: world decides whether it exists / was deleted from the save (null)
  if (rec && (rec.kind !== 'pickup' || rec.item !== item)) throw new Error(`pickup id '${id}' is already used by other data (${rec.kind}${rec.item ? ' ' + rec.item : ''}): use a different id`);
  const wid = rec?.id ?? id;
  if (mesh) inv._meshes.set(wid, mesh);
  return { id: item, worldId: wid, get object() { return w.view(wid); }, remove: () => { w.remove(wid); inv._meshes.delete(wid); } };
}

/** Register how pickups look, respawn and get auto-taken (once, on first use; needs world installed first) @internal */
export function presentPickups(inv) {
  const e = inv.engine, w = e.world;
  if (!w) throw new Error('Pickup data lives in world: call engine.use(world()) first (the openWorld() preset already does) and order it before inventory().');
  if (inv._presented) return w;
  inv._presented = true;
  w.present('pickup', {
    radius: inv.bobDistance,
    show: rec => rec.until == null,   // waiting to respawn: no model
    build: rec => model(inv, rec),
    update: (rec, o) => {   // bobbing spin: world places the model at the data position each frame first, this adds the bob on top
      if (rec.bob === false) return;
      const t = e.elapsed, x = rec.position.x;
      o.rotation.y = t * 1.5 + x; o.position.y = rec.position.y + Math.sin(t * 2 + x) * 0.08;
    },
    dispose: (rec, o) => { o.userData.useHandle?.remove(); if (inv._meshes.has(rec.id)) e.detach(o); else e.remove(o); },   // a mesh passed in by the game is only detached
  });
  // waiting to respawn: when due (game clock) clear until and return to the ground. Far ones are also checked once a second, so they grow back on time even when not nearby
  const wake = rec => { if (rec.until != null && e.clock.now >= rec.until) w.set(rec.id, { until: undefined }); };
  // auto pickups in reach are queued here and taken in the inventory's fixed step (records are not removed while world is iterating them)
  const reach = rec => {
    const p = e.player || e.actor !== 'player' ? e.actorPosition() : null;   // whoever the user controls (engine.actor); no player and no actor: nobody walks into it
    if (!rec.auto || rec.until != null || !p) return;
    const r = rec.radius ?? inv.pickupRadius, dx = rec.position.x - p.x, dy = rec.position.y - p.y, dz = rec.position.z - p.z;
    if (dx * dx + dy * dy + dz * dz <= r * r) inv._autoQueue.push(rec);
  };
  w.simulate('pickup', { near: rec => { wake(rec); reach(rec); }, far: wake });
  return w;
}

/** Take the queued auto pickups (fixed step) @internal */
export function takeAuto(inv) {
  const q = inv._autoQueue; if (!q.length) return;
  inv._autoQueue = [];
  for (const rec of q) if (inv.engine.world.get(rec.id) === rec && rec.until == null) take(inv, rec);
}

/** Into the player inventory, then off the ground; { ok: false, reason: 'full' } (it stays on the ground) when it doesn't fit, { ok: true } otherwise.
 *  Pickup onUse returns this, and the interaction.use op passes it on as value, so callers can tell the player why @internal */
function take(inv, rec) {
  const e = inv.engine, W = e.world;
  if (!inv.add(rec.item, rec.count, rec.data && { data: rec.data })) return { ok: false, reason: 'full' };
  // without respawn the record is deleted; with respawn time it gets until (show tears down the model), saved so the countdown continues after a load
  if (rec.respawn > 0) W.set(rec.id, { until: e.clock.now + rec.respawn });
  else { W.remove(rec.id); inv._meshes.delete(rec.id); }
  e.events.emit('item:pickup', { id: rec.item, x: rec.position.x, z: rec.position.z });
  return { ok: true };
}
const NO_PICKUP = 'pickups: no style pack / model given, so items on the ground are gray boxes (a placeholder). Pass a style pack with '
  + "style.pickup.model(item, { color, size }), e.g. createEngine({ style: lowpoly }) with lowpoly from '@threedog/style-lowpoly'";
/** The model (built when near) + interaction for this pickup record @internal */
function model(inv, rec) {
  const e = inv.engine, def = inv.item(rec.item), st = e.style.pickup || {};
  let obj = inv._meshes.get(rec.id);
  if (!obj) {
    const color = def.color ?? st.color ?? 0xcccccc, size = st.size ?? 0.25;
    // shape is the style pack's; without one a neutral box
    if (!st.model) warnOnce(NO_PICKUP);
    const m = st.model ? st.model(def, { color, size }, e) : new THREE.BoxGeometry(size, size, size);
    obj = m.isObject3D ? m : new THREE.Mesh(m, makeMaterial('pickup', { color }, e));
  }
  obj.castShadow = true;
  if (rec.auto) return obj;   // taken by walking into it: no key prompt
  if (!e.interactions) { console.warn('Pickups require the interactions() module: install it first.'); return obj; }
  obj.userData.useHandle = e.interactions.add(obj, {
    id: rec.id,
    label: () => e.t('inventory.pickup', { name: def.name }), radius: rec.radius ?? inv.pickupRadius,
    enabled: () => e.world.get(rec.id) === rec && rec.until == null,
    onUse: () => take(inv, rec),   // { ok, reason? } goes back through interaction.use's value
  });
  return obj;
}

/** Pickup data of an item still on the ground nearest to from (default engine.actorPosition()); null if none @internal */
export function nearestPickup(inv, item, from) {
  const w = inv.engine.world, f = from ?? inv.engine.actorPosition();
  let best = null, bd = Infinity;
  for (const r of w?.query({ kind: 'pickup', where: r => r.item === item && r.until == null }) || []) {
    const dx = r.position.x - f.x, dy = r.position.y - (f.y ?? 0), dz = r.position.z - f.z, d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
