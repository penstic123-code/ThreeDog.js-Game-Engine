// Real physics (Rapier): objects that topple, roll, get pushed and float on water.
//
// Split from collision() (engine.collision, cheap walking collision covering the whole map): this is dynamic-body physics, more costly, simulated only for chunks within +-terrainRing of each physics engine.load source (the player, a teleport destination; never a camera-only source).
// The player is a kinematic capsule: it pushes crates and balls but is not pushed by them.
//
// const crate = engine.rigid.addBox(mesh, { mass: 5 });     // crate
// const ball  = engine.rigid.addBall(mesh, { radius: 0.4, restitution: 0.6 });
// engine.rigid.impulse(ball, [0, 3, 5]);                     // kick (impulse vector: Vector3 / [x, y, z] / { x, y, z })
// Returns an entry (handle) { body, collider, mesh (= object, position written by physics), remove() }: remove only deletes the body; the model is yours (shadow settings are untouched too)
// const car = engine.rigid.addVehicle(carMesh, { wheels: [...] });   // vehicle, see Vehicles.js; engine.player.enter(car) to board; car.remove()
// Ray: once installed, engine.raycast(origin, direction, { targets: 'all' }) also hits rigid bodies (hit carries entry, kind: 'rigid'); no separate entry point.
//
// Rapier is downloaded on demand at start() (about 1.5MB); games without physics never load it.
import * as THREE from 'three';
import { vec3, xzOf } from '../../core/math.js';
import { checkOptions } from '../../core/validate.js';
import { createVehicle, VEHICLE_KEYS, STRINGS } from './Vehicles.js';
// Params of addBox / addBall / addHull
const BODY_KEYS = ['mass', 'friction', 'restitution', 'damping', 'angularDamping', 'fixed'];

export class RigidBodies {
  /** gravity gravity = gravity; terrainRing = chunk rings around each physics load source that get terrain collision; buoyancy = buoyancy toggle; buoyancyForce = buoyancy strength (1 = exactly floats); waterDrag = drag in water;
   *  floatLine / floatDepth： floatLine / floatDepth: buoyancy starts when the body center is below floatLine meters above the surface and peaks floatDepth meters deeper; treeColliderHeight = trunk collision cylinder height;
   *  playerCapsule { halfHeight, radius }  playerCapsule { halfHeight, radius } = player capsule size (default derived from engine.movement radius / height) */
  constructor(engine, { gravity = -9.81, terrainRing = 1, buoyancy = true, buoyancyForce = 1.6, waterDrag = 2.5, floatLine = 0.3, floatDepth = 0.8,
    treeColliderHeight = 6, playerCapsule } = {}) {
    const mv = engine.movement;   // default capsule uses the shared character radius / height: total height = 2 * halfHeight + 2 * radius
    playerCapsule ??= { halfHeight: Math.max(0.05, (mv.height - 2 * mv.radius) / 2), radius: mv.radius };
    this.engine = engine;
    this.gravity = gravity;
    this.terrainRing = terrainRing;
    this.buoyancy = buoyancy; this.buoyancyForce = buoyancyForce; this.waterDrag = waterDrag; this.playerCapsule = playerCapsule;
    this.floatLine = floatLine; this.floatDepth = floatDepth; this.treeColliderHeight = treeColliderHeight;
    this._staticVersion = -1;
    this.R = null; this.world = null;
    this.bodies = [];                 // { body, mesh, offset, enabled }
    this.terrain = new Map();         // chunk key -> { colliders: [] }
    this.statics = new Map();         // houses/pillars from Physics.js -> collider
    this.vehicles = [];
    /** @internal numbers vehicles added without an id */ this._vehicleSeq = 0;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    const mod = await import('@dimforge/rapier3d-compat');
    const R = this.R = mod.default ?? mod;
    await R.init();
    this.world = new R.World({ x: 0, y: this.gravity, z: 0 });
    this.world.timestep = 1 / 60;
    // Player capsule (kinematic: the character controller decides position; physics only pushes other things away)
    this.playerBody = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const pc = this.playerCapsule;
    this.playerCollider = this.world.createCollider(R.ColliderDesc.capsule(pc.halfHeight, pc.radius).setTranslation(0, pc.halfHeight + pc.radius, 0), this.playerBody);
    // When the ground provides no chunked collision (no terrain module): use an infinite flat plane (y = 0)
    const G = this.engine.ground;
    if (!G.chunkCollision && !G.staticTrimeshes) this.world.createCollider(R.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0));
    this.ready = true;
  }

  // ---------- Add bodies ----------
  _add(mesh, desc, { mass = 1, friction = 0.7, restitution = 0.1, damping = 0.05, angularDamping = 0.1, fixed = false } = {}) {
    if (!this.ready) { console.warn('Physics is not ready: add bodies after engine.start() or in the world:ready event'); return null; }
    const R = this.R, p = mesh.position, q = mesh.quaternion;
    const bd = (fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic())
      .setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(damping).setAngularDamping(angularDamping).setCanSleep(true);
    const body = this.world.createRigidBody(bd);
    desc.setFriction(friction).setRestitution(restitution).setMass(mass);
    const collider = this.world.createCollider(desc, body);
    if (!mesh.parent) this.engine.add(mesh);   // shadow casting/receiving follows the model's own settings (not forced)
    const entry = { body, collider, mesh, object: mesh, enabled: true, volume: 0, damping, angularDamping };
    entry.remove = () => this._remove(entry);
    this.bodies.push(entry);
    return entry;
  }
  /** Box. When size is omitted it is computed from the model bounding box */
  addBox(mesh, o = {}) {
    checkOptions('rigid.addBox()', o, [...BODY_KEYS, 'size']);
    const s = o.size || new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).toArray();
    const e = this._add(mesh, this.R.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2), o);
    if (e) e.volume = s[0] * s[1] * s[2];
    return e;
  }
  /** Ball */
  addBall(mesh, o = {}) {
    checkOptions('rigid.addBall()', o, [...BODY_KEYS, 'radius']);
    const r = o.radius ?? new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x / 2;
    const e = this._add(mesh, this.R.ColliderDesc.ball(r), o);
    if (e) e.volume = 4.19 * r * r * r;
    return e;
  }
  /** Convex hull: auto-wrapped around the model shape (irregular objects such as rocks, barrels) */
  addHull(mesh, o = {}) {
    checkOptions('rigid.addHull()', o, BODY_KEYS);
    const g = mesh.geometry, pts = new Float32Array(g.attributes.position.array.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < g.attributes.position.count; i++) {
      v.fromBufferAttribute(g.attributes.position, i).multiply(mesh.scale); pts.set([v.x, v.y, v.z], i * 3);
    }
    const e = this._add(mesh, this.R.ColliderDesc.convexHull(pts), o);
    if (e) { g.computeBoundingBox(); const s = g.boundingBox.getSize(v).multiply(mesh.scale); e.volume = s.x * s.y * s.z * 0.5; }
    return e;
  }
  /** Vehicle (Rapier vehicle controller): id (stable, for saves; default vehicle1, vehicle2... in creation order), wheels, mass, engineForce, brakeForce, maxSteer, suspension, seat, camera; see Vehicles.js */
  addVehicle(mesh, o) {
    checkOptions('rigid.addVehicle()', o, VEHICLE_KEYS);
    if (o.id != null && this.vehicles.some(v => v.id === o.id)) throw new Error(`rigid.addVehicle(): id '${o.id}' is already used by another vehicle; ids name the vehicle in saves, pick a unique one`);
    if (!this.ready) return this._add(mesh);   // warns "physics is not ready"
    const { id = 'vehicle' + ++this._vehicleSeq, ...rest } = o;
    const v = createVehicle(this, mesh, rest);
    /** Stable id: the player's save names the vehicle it sits in by this (give one when vehicles are created in a varying order) */ v.id = id;
    v.remove = () => this._removeVehicle(v);
    this.vehicles.push(v);
    return v;
  }
  /** Remove a vehicle (the occupant exits first): called by vehicle.remove() */
  _removeVehicle(v) {
    if (!this.vehicles.includes(v)) return;
    v.driver?.exit(); v._use?.remove();
    this.vehicles = this.vehicles.filter(x => x !== v);
    this.world.removeVehicleController(v.controller);
    this._remove(v);
  }
  /** Whether the physics ground under a position is built (used by mover: 'rapier'; always true without chunked terrain) */
  groundReady(position) {
    if (!this.engine.ground.chunkCollision) return true;
    const [x, z] = xzOf(position), CH = this.engine.ground.chunkSize ?? 64;
    return !!this.terrain.get(Math.floor(x / CH) + ',' + Math.floor(z / CH))?.ready;
  }
  /** Delete the body (called by entry.remove()); the model stays */
  _remove(entry) {
    const i = this.bodies.indexOf(entry); if (i < 0) return;
    this.world.removeRigidBody(entry.body); this.bodies.splice(i, 1);
  }
  /** Push: impulse vector v (Vector3 / [x, y, z] / { x, y, z }) */
  impulse(entry, v) { const { x, y, z } = vec3(v); entry.body.wakeUp(); entry.body.applyImpulse({ x, y, z }, true); }
  /** Teleport to position (velocity zeroed) */
  setPosition(entry, position) {
    const { x, y, z } = vec3(position);
    entry.body.setTranslation({ x, y, z }, true); entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Ray (provider for engine.raycaster, called by engine.raycast when targets: 'all'): hits dynamic bodies only, returns RayHit (with entry, kind: 'rigid') */
  _raycast(origin, dir, far) {
    if (!this.ready || !this.bodies.length) return null;
    const byHandle = new Map(this.bodies.map(b => [b.body.handle, b]));
    const max = Number.isFinite(far) ? far : 1e6;
    const only = c => byHandle.has(c.parent()?.handle);
    const hit = this.world.castRayAndGetNormal(new this.R.Ray(origin, dir), max, true, undefined, undefined, undefined, this.playerBody, only);
    if (!hit) return null;
    const entry = byHandle.get(hit.collider.parent()?.handle);
    if (!entry) return null;
    const t = hit.timeOfImpact;
    const point = new THREE.Vector3(origin.x, origin.y, origin.z).addScaledVector(dir, t);
    return { point, distance: t, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), object: entry.object, face: null, entry, kind: 'rigid' };
  }

  // ---------- Every fixed step ----------
  step(dt) {
    if (!this.ready) return;
    const e = this.engine, G = e.ground, CH = G.chunkSize ?? 64, chunked = !!G.chunkCollision;
    const focus = e.player ? e.player.position : e.focus;   // player-body: the player's own kinematic body follows the character, not engine.actor
    // terrain collision around physics load sources: sync at once when their chunks change, otherwise check every 0.5 s (tree felling etc.)
    const src = e.load.list({ physics: true }).map(s => [Math.floor(s.x / CH), Math.floor(s.z / CH), Math.min(this.terrainRing, s.radius == null ? Infinity : Math.max(1, Math.ceil(s.radius / CH)))]);
    const key = src.join(';');
    this._syncT = (this._syncT || 0) + dt;
    if (chunked && (key !== this._srcKey || this._syncT > 0.5)) { this._syncTerrain(src); this._srcKey = key; this._syncT = 0; }
    this._syncStatics();
    this._syncLevel();
    // player capsule follows the player (the rapier mover computes collision and writes the position itself); turned off while driving to avoid colliding with the car
    if (e.player) this.playerBody.setNextKinematicTranslation({ x: focus.x, y: focus.y, z: focus.z });
    const onFoot = !e.player?.vehicle;
    if (this.playerCollider.isEnabled() !== onFoot) this.playerCollider.setEnabled(onFoot);
    for (const v of this.vehicles) if (v.enabled) v._update(dt);

    // freeze bodies without terrain collision under them (unfrozen they would fall through)
    for (const b of this.bodies) {
      const t = b.body.translation();
      const ok = !chunked || !!this.terrain.get(Math.floor(t.x / CH) + ',' + Math.floor(t.z / CH))?.ready;
      if (ok !== b.enabled) { b.body.setEnabled(ok); b.enabled = ok; }
      // buoyancy: the submerged part gets an upward force, and water adds drag
      const water = this.buoyancy ? e.waterAt(t.x, t.z) : -Infinity;
      if (ok && this.buoyancy && t.y < water + this.floatLine && b.body.isDynamic()) {
        const depth = Math.min(1, (water + this.floatLine - t.y) / this.floatDepth);
        const m = b.body.mass();
        b.body.resetForces(true);
        b.body.addForce({ x: 0, y: -this.gravity * m * (this.buoyancyForce * depth), z: 0 }, true);
        b.body.setLinearDamping(this.waterDrag); b.body.setAngularDamping(this.waterDrag);
        b.wet = true;
      } else if (b.wet) {
        b.body.resetForces(true); b.body.setLinearDamping(b.damping); b.body.setAngularDamping(b.angularDamping); b.wet = false;
      }
    }

    this.world.step();

    for (const b of this.bodies) {
      if (!b.enabled || b.body.isSleeping()) continue;
      const t = b.body.translation(), r = b.body.rotation();
      b.mesh.position.set(t.x, t.y, t.z);
      b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (t.y < -200) this.setPosition(b, [t.x, e.surface(t.x, t.z) + 2, t.z]);   // fallback for falling out of the world
    }
    for (const v of this.vehicles) v._sync();
  }

  // Chunks around physics load sources ([cx, cz, rings] each): terrain uses triangle-mesh colliders (identical to what is drawn), vegetation uses cylinders. Data comes from the ground API ground.chunkCollision
  _syncTerrain(src) {
    const e = this.engine, R = this.R, want = new Set();
    for (const [pcx, pcz, n] of src) for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
      const cx = pcx + dx, cz = pcz + dz, key = cx + ',' + cz; if (want.has(key)) continue; want.add(key);
      const have = this.terrain.get(key);
      const data = e.ground.chunkCollision(cx, cz);
      if (have?.ready && data && have.token === data.token) continue;
      if (have) this._dropTerrain(key);
      if (!data) { this.terrain.set(key, { ready: false, colliders: [] }); continue; }
      const idx = new Uint32Array(data.positions.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i;
      const ground = R.ColliderDesc.trimesh(new Float32Array(data.positions), idx).setTranslation(data.ox, 0, data.oz).setFriction(0.9);
      const colliders = [this.world.createCollider(ground)], half = this.treeColliderHeight / 2;
      for (const k of data.circles) for (let i = 0; i < k.length; i += 3) {
        const h = e.surface(k[i], k[i + 1]);
        colliders.push(this.world.createCollider(R.ColliderDesc.cylinder(half, k[i + 2]).setTranslation(k[i], h + half, k[i + 1])));
      }
      this.terrain.set(key, { ready: true, token: data.token, colliders });
    }
    for (const key of [...this.terrain.keys()]) if (!want.has(key)) this._dropTerrain(key);
  }
  _dropTerrain(key) {
    const t = this.terrain.get(key);
    if (t) for (const c of t.colliders) this.world.removeCollider(c, false);
    this.terrain.delete(key);
  }
  // Sync houses and pillars from the collision module into the physics world (only when they are added or removed)
  _syncStatics() {
    const ph = this.engine.collision;
    if (ph.version === this._staticVersion) return;
    this._staticVersion = ph.version;
    const R = this.R, seen = new Set();
    ph.forEachStatic((type, o) => {
      seen.add(o);
      if (this.statics.has(o)) return;
      const g = o.y ?? this.engine.surface(o.x, o.z);
      if (type === 'box') {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
        const d = R.ColliderDesc.cuboid(o.hw, o.h / 2, o.hd).setTranslation(o.x, g + o.h / 2, o.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        this.statics.set(o, this.world.createCollider(d));
      } else this.statics.set(o, this.world.createCollider(R.ColliderDesc.cylinder(o.h / 2, o.r).setTranslation(o.x, g + o.h / 2, o.z)));
    });
    for (const [o, col] of this.statics) if (!seen.has(o)) { this.world.removeCollider(col, false); this.statics.delete(o); }
  }

  // Ground of a level (hand-built scene): one static triangle mesh, rebuilt when the level changes
  _syncLevel() {
    const G = this.engine.ground; if (!G.staticTrimeshes) return;
    const v = G.staticVersion?.() ?? 0; if (v === this._levelVersion) return;
    this._levelVersion = v;
    for (const c of this._levelColliders || []) this.world.removeCollider(c, false);
    const desc = t => this.R.ColliderDesc.trimesh(t.positions, t.indices).setFriction(0.9);
    this._levelColliders = G.staticTrimeshes().map(t => this.world.createCollider(desc(t)));
  }

  get stats() {
    const active = this.bodies.filter(b => b.enabled && !b.body.isSleeping()).length;
    return { bodies: this.bodies.length, active, colliders: this.world ? this.world.colliders.len() : 0 };
  }
}

/** Real physics module (Rapier). Installs as engine.rigid. Requires collision() to be installed first */
export function rigid(opts = {}) {
  let r = null;
  return {
    name: 'rigid', label: 'Physics', optional: ['interactions'], requires: ['collision'],
    install(e) {
      checkOptions('rigid()', opts, ['gravity', 'terrainRing', 'buoyancy', 'buoyancyForce', 'waterDrag', 'floatLine', 'floatDepth', 'treeColliderHeight', 'playerCapsule']);
      e.i18n.add(STRINGS); r = new RigidBodies(e, opts);
      e.budget.metric('rigidBodies', () => r.bodies.length);
      e.load.readyCheck('rigid', s => !s.physics || r.ready && r.groundReady(s));   // a physics load source waits for the collider under it
      e.raycaster.addProvider((o, d, far) => r._raycast(o, d, far));   // engine.raycast(..., { targets: 'all' }) includes rigid bodies
      return r;
    },
    async init() { await r.init(); },
    counts() { return r.bodies.length; },   // engine.counts().rigid
    fixed(dt) { if (r.ready) r.step(dt); },
    dispose() { r.world?.free(); r.world = null; },
  };
}
