// Colliders the rigid module keeps in sync with what the game draws: terrain chunks (trimesh + trunk cylinders), trunks on a level or code-built ground, the
// collision module's houses / pillars, and a level's static ground. Each function takes the RigidBodies instance as `r` and is called from its step().
import * as THREE from 'three';

// Chunks around physics stream sources ([cx, cz, rings] each): terrain uses triangle-mesh colliders (identical to what is drawn), vegetation uses cylinders.
// Data comes from the ground API ground.chunkCollision
export function syncTerrain(r, src) {
  const e = r.engine, R = r.R, want = new Set();
  for (const [pcx, pcz, n] of src) for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
    const cx = pcx + dx, cz = pcz + dz, key = cx + ',' + cz; if (want.has(key)) continue; want.add(key);
    const have = r.terrain.get(key);
    const data = e.ground.chunkCollision(cx, cz);
    if (have?.ready && data && have.token === data.token) continue;
    if (have) dropTerrain(r, key);
    if (!data) { r.terrain.set(key, { ready: false, colliders: [] }); continue; }
    const idx = new Uint32Array(data.positions.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i;
    const ground = R.ColliderDesc.trimesh(new Float32Array(data.positions), idx).setTranslation(data.ox, 0, data.oz).setFriction(0.9);
    const colliders = [r.world.createCollider(ground)], half = r.treeColliderHeight / 2;
    for (const k of data.circles) for (let i = 0; i < k.length; i += 3) {
      const h = e.surface(k[i], k[i + 1]);
      colliders.push(r.world.createCollider(R.ColliderDesc.cylinder(half, k[i + 2]).setTranslation(k[i], h + half, k[i + 1])));
    }
    r.terrain.set(key, { ready: true, token: data.token, colliders });
  }
  for (const key of [...r.terrain.keys()]) if (!want.has(key)) dropTerrain(r, key);
}
// Vegetation on a level model or code-built ground has no chunked collision: its trunks reach us only as circles through
// ground.forEachCollider (the same source character collision and path planning read). Make them cylinders around the physics sources
export function syncGroundTrees(r, src, CH) {
  const e = r.engine, G = e.ground, R = r.R, half = r.treeColliderHeight / 2, want = new Set();
  if (G.forEachCollider) for (const [pcx, pcz, n] of src) {
    G.forEachCollider((pcx + 0.5) * CH, (pcz + 0.5) * CH, (n + 0.5) * CH * Math.SQRT2, (x, z, rad) => {
      const key = x + ',' + z + ',' + rad;
      want.add(key);
      if (r.groundTrees.has(key)) return;
      const h = e.surface(x, z);
      r.groundTrees.set(key, r.world.createCollider(R.ColliderDesc.cylinder(half, rad).setTranslation(x, h + half, z)));
    });
  }
  for (const [key, col] of r.groundTrees) if (!want.has(key)) { r.world.removeCollider(col, false); r.groundTrees.delete(key); }
}
export function dropTerrain(r, key) {
  const t = r.terrain.get(key);
  if (t) for (const c of t.colliders) r.world.removeCollider(c, false);
  r.terrain.delete(key);
}
// Sync houses and pillars from the collision module into the physics world (only when they are added or removed)
export function syncStatics(r) {
  const ph = r.engine.collision;
  if (ph.version === r._staticVersion) return;
  r._staticVersion = ph.version;
  const R = r.R, seen = new Set();
  ph.forEachStatic((type, o) => {
    seen.add(o);
    if (r.statics.has(o)) return;
    const g = o.y ?? r.engine.surface(o.x, o.z);
    if (type === 'box') {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
      const d = R.ColliderDesc.cuboid(o.hw, o.h / 2, o.hd).setTranslation(o.x, g + o.h / 2, o.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      r.statics.set(o, r.world.createCollider(d));
    } else r.statics.set(o, r.world.createCollider(R.ColliderDesc.cylinder(o.h / 2, o.r).setTranslation(o.x, g + o.h / 2, o.z)));
  });
  for (const [o, col] of r.statics) if (!seen.has(o)) { r.world.removeCollider(col, false); r.statics.delete(o); }
}

// Ground of a level (hand-built scene): one static triangle mesh, rebuilt when the level changes
export function syncLevel(r) {
  const G = r.engine.ground; if (!G.staticTrimeshes) return;
  const v = G.staticVersion?.() ?? 0; if (v === r._levelVersion) return;
  r._levelVersion = v;
  for (const c of r._levelColliders || []) r.world.removeCollider(c, false);
  const desc = t => r.R.ColliderDesc.trimesh(t.positions, t.indices).setFriction(0.9);
  r._levelColliders = G.staticTrimeshes().map(t => r.world.createCollider(desc(t)));
}
