// Real physics (Rapier): objects that topple, roll, get pushed and float on water.
//
// Split from collision() (engine.collision, cheap walking collision covering the whole map): this is dynamic-body physics, more costly, simulated only for
// chunks within +-terrainRing of each physics engine.stream source (the player, a teleport destination; never a camera-only source).
// The player is a kinematic capsule: it pushes crates and balls but is not pushed by them.
//
// const crate = engine.rigid.addBox(mesh, { mass: 5 });     // crate
// const ball  = engine.rigid.addBall(mesh, { radius: 0.4, restitution: 0.6 });
// engine.rigid.impulse(ball, [0, 3, 5]);                     // kick (impulse vector: Vector3 / [x, y, z] / { x, y, z })
// Returns an entry (handle) { body, collider, mesh (= object, position written by physics), remove() }: remove only deletes the body; the model is yours
// (shadow settings are untouched too)
// const car = engine.rigid.addWheeled(carMesh, { wheels: [...] });   // vehicle, see Vehicles.js; engine.player.enter(car) to board; car.remove()
// Ray: once installed, engine.raycast(origin, direction, { targets: 'all' }) also hits rigid bodies (hit carries entry, kind: 'rigid'); no separate entry
// point.
//
// Rapier is downloaded on demand at start() (about 1.5MB); games without physics never load it.
import * as THREE from 'three';
import { vec3, xzOf } from '../../core/math.js';

import { readParams, keysSchema } from '../../core/params.js';
import { cellsChanged } from '../../core/streamCells.js';
import { createVehicle, VEHICLE_KEYS, STRINGS } from './Vehicles.js';
import { syncTerrain, syncTrees, treesChanged, syncGroundTrees, syncStatics, syncLevel, recordLocks, carryBody, carryCollider } from './sync.js';
import { codedError, coded } from '../../core/errorHints.js';
import { warnOnce, DEV } from '../../core/validate.js';
// Params of addBox / addBall / addHull
const PHYSICS = { physics: true };   // stream source filter (shared, not rebuilt every step)
const BODY_KEYS = ['id', 'mass', 'friction', 'restitution', 'damping', 'angularDamping', 'fixed'];

export class RigidBodies {
  /** gravity gravity = gravity; terrainRing = chunk rings around each physics stream source that get terrain collision; buoyancy = buoyancy toggle; buoyancyForce = buoyancy strength (1 = exactly floats); waterDrag = drag in water;
   * floatLine / floatDepth： floatLine / floatDepth: buoyancy starts when the body center is below floatLine meters above the surface and peaks floatDepth
   * meters deeper; treeColliderHeight = trunk collision cylinder height; treeRadius = trunks get cylinders only in chunks within this many meters of the player or a non-fixed body;
   *  playerCapsule { halfHeight, radius }  playerCapsule { halfHeight, radius } = player capsule size (default derived from engine.movement radius / height) */
  constructor(engine, { gravity = -9.81, terrainRing = 1, buoyancy = true, buoyancyForce = 1.6, waterDrag = 2.5, floatLine = 0.3, floatDepth = 0.8,
    treeColliderHeight = 6, treeRadius = 16, playerCapsule } = {}) {
    const mv = engine.movement;   // default capsule uses the shared character radius / height: total height = 2 * halfHeight + 2 * radius
    playerCapsule ??= { halfHeight: Math.max(0.05, (mv.height - 2 * mv.radius) / 2), radius: mv.radius };
    this.engine = engine;
    this.gravity = gravity;
    this.terrainRing = terrainRing;
    this.buoyancy = buoyancy; this.buoyancyForce = buoyancyForce; this.waterDrag = waterDrag; this.playerCapsule = playerCapsule;
    this.floatLine = floatLine; this.floatDepth = floatDepth; this.treeColliderHeight = treeColliderHeight; this.treeRadius = treeRadius;
    this.R = null; this.world = null;
    this.bodies = [];                 // { body, mesh, offset, enabled }
    /** @internal body handle -> entry for rays, rebuilt only after bodies changed (null): a ray cast every frame (aim, a camera probe) built a new Map each time */ this._byHandle = null;
    /** @internal a session:end asked for a rebuild that world:load / afterLoad has not run yet (one rebuild per new game or load) */ this._freshDue = false;
    this.terrain = new Map();         // chunk key -> { colliders: [] }
    this.trees = new Map();           // chunk key -> { token, colliders }: trunk cylinders of the chunks near the player / bodies (see sync.js)
    this._anchors = []; this._treeMemo = [];
    this.groundTrees = new Map();     // 'x,z,r' -> cylinder collider: circles from ground.forEachCollider when the ground has no chunked collision
    /** @internal houses / pillars of the collision module as colliders (engine.collision.mirror, built on the first step: sync.js syncStatics) */ this._statics = null;
    this.vehicles = [];
    /** @internal numbers vehicles added without an id */ this._vehicleSeq = 0;
    /** @internal id -> saved physics state of a body not built yet (the save part 'rigid'; claimed when a body with that id is added) */ this._saved = new Map();
    this.ready = false;
  }

  /**
   * @internal Import and instantiate Rapier once. Started at install: the import plus WASM compile took 0.8-1.1 s on a cold start and used to
   * begin only when start() reached this module's init, with every later init waiting behind it; begun at install it overlaps the world build
   */
  _wasm() { return (this._rapier ??= import('@dimforge/rapier3d-compat').then(async mod => { const R = mod.default ?? mod; await R.init(); return R; })); }

  /** @internal module hook */
  async init() {
    if (this.ready) return;
    this.R = await this._wasm();
    this._newWorld();
    this.ready = true;
  }
  /** @internal A fresh Rapier world with the player capsule (and the flat plane without chunked ground): what init builds, and what _fresh rebuilds */
  _newWorld() {
    const R = this.R;
    /** @internal bumps with every world: a character mover holding a controller of an older world builds a new one (movers/rapier.js) */
    this.gen = (this.gen ?? 0) + 1;
    this.world = new R.World({ x: 0, y: this.gravity, z: 0 });
    this.world.timestep = 1 / 60;
    // Player capsule (kinematic: the character controller decides position; physics only pushes other things away)
    this.playerBody = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const pc = this.playerCapsule;
    this.playerCollider = this.world.createCollider(R.ColliderDesc.capsule(pc.halfHeight, pc.radius).setTranslation(0, pc.halfHeight + pc.radius, 0), this.playerBody);
    // When the ground provides no chunked collision (no terrain module): use an infinite flat plane (y = 0)
    const G = this.engine.ground;
    if (!G.chunkCollision && !G.staticTrimeshes) this.world.createCollider(R.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0));
  }

  /**
   * @internal New playthrough or a load (world:load, else afterLoad after a session:end): physics starts over like a fresh page. Velocities, sleep and the solver's warm
   * start live inside the Rapier world, and so does the order bodies were created in (freed handles are reused last-in first-out), so the same
   * crate pushed the same way after newGame landed a few millimetres off the fresh-page result (durability audit). The world is rebuilt: the
   * player capsule first, every body still here (bodies of world records were already removed by the load and come back with their views) at its
   * pose with no velocity, and terrain / tree / static colliders on the next step, the order a fresh page builds them in. What the game wrote on a
   * body or collider itself (gravityScale, axis locks, ccd, dominance, sensor, groups, enabled) is carried onto the rebuilt one (carryBody / carryCollider in sync.js). Joints are not carried: Rapier has no getters for a joint's
   * whole description (rope length, motor settings), and copying one would mean patching Rapier. The game re-creates its own joints on rigid:rebuilt,
   * emitted once the bodies are back (the coordination point); a dev warning names a game whose joints vanished with no re-creation. Movers'
   * character controllers are freed with the old world (World.free frees them; movers/rapier.js sees the new gen and builds new ones).
   * Vehicles hold a controller built for one world: with a vehicle present only the bodies are stopped and put to sleep (no rebuild).
   */
  _fresh() {
    this._freshDue = false;
    if (!this.ready) return;
    if (this.vehicles.length) {
      for (const b of this.bodies) { const y = b.body; y.setLinvel({ x: 0, y: 0, z: 0 }, false); y.setAngvel({ x: 0, y: 0, z: 0 }, false); y.resetForces(false); y.resetTorques(false); if (y.isDynamic()) y.sleep(); }
      return;
    }
    const old = this.world, R = this.R, hadJoints = old.impulseJoints.len();
    this._newWorld();
    this.terrain.clear(); this.trees.clear(); this.groundTrees.clear(); this._statics?.clear();
    this._levelVersion = undefined; this._levelColliders = [];
    this._srcMemo = null; this._srcPending = false; this._syncT = 0; this._anchors = []; this._treeMemo = [];
    for (const b of this.bodies) {
      const t = b.body.translation(), q = b.body.rotation();
      const bd = (b.fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic()).setTranslation(t.x, t.y, t.z).setRotation(q)
        .setLinearDamping(b.damping).setAngularDamping(b.angularDamping).setCanSleep(true);
      const ob = b.body, oc = b.collider;
      b.body = this.world.createRigidBody(bd);
      b.collider = this.world.createCollider(b._desc, b.body);
      // what the game wrote on the Rapier body / collider (gravityScale, locks, ccd, sensor, groups, enabled...) is its own and survives the rebuild
      carryBody(b, ob, b.body); carryCollider(oc, b.collider);
      // b.enabled stays: it is the engine's own freeze flag (no ground under it), which the step loop compares with; a game's setEnabled(false) was carried
      b.wet = false; b._void = false;
    }
    old.free(); this._byHandle = null;   // every body has a new handle
    // the old world's joints (every one is the game's: the engine makes none) went with it. The game re-creates them here, between the rebuilt bodies
    const bodies = {};
    for (const b of this.bodies) if (b.id != null) bodies[b.id] = b.body;
    this.engine.events.emit('rigid:rebuilt', { world: this.world, player: this.playerBody, bodies });
    // checked on the next step, not here: on a load, a presenter's build re-adds its bodies (and their joints) after world:load
    if (DEV && hadJoints) this._jointsGone = hadJoints;
  }

  // ---------- Add bodies ----------
  /** @internal Rapier loads during engine.start(): a body added before has no world. Dev throws at the call (a null handle used to fail far
   *  away, at crate.body.applyImpulse); release warns once and the add returns null */
  _ready(call) {
    if (this.ready) return true;
    const msg = `engine.rigid.${call}() ran before physics was ready (Rapier loads during engine.start()). Add bodies after it: ` +
      `\`await engine.start(); engine.rigid.${call}(mesh, { ... })\`, or inside engine.events.on('engine:ready', () => { ... })`;
    if (DEV) throw codedError('module-needs', msg);
    warnOnce(coded('module-needs', msg)); return false;
  }
  _add(mesh, desc, { id, mass = 1, friction = 0.7, restitution = 0.1, damping = 0.05, angularDamping = 0.1, fixed = false } = {}) {
    // id names the body in the save part 'rigid': two live bodies with one id would load into each other
    if (id != null && this.bodies.some(b => b.id === id)) throw codedError('rigid-misuse', `rigid: id '${id}' is already used by another body or vehicle; ids name the body in saves, pick a unique one (e.g. the world record id)`);
    const R = this.R, p = mesh.position, q = mesh.quaternion;
    const bd = (fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic())
      .setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(damping).setAngularDamping(angularDamping).setCanSleep(true);
    const body = this.world.createRigidBody(bd);
    desc.setFriction(friction).setRestitution(restitution).setMass(mass);
    const collider = this.world.createCollider(desc, body);   // desc is kept on the entry (_desc): _fresh rebuilds the collider from it
    if (!mesh.parent) this.engine.add(mesh, { owner: 'engine:rigid' });   // shadow casting/receiving follows the model's own settings (not forced)
    const entry = { id, body, collider, mesh, object: mesh, enabled: true, volume: 0, damping, angularDamping, fixed, _x: p.x, _z: p.z, _desc: desc };   // _x / _z: where sync.js looks for trunks to give it
    entry.remove = () => this._remove(entry);
    recordLocks(entry, body);
    this.bodies.push(entry); this._byHandle = null;
    // a loaded save holds this body's state (it is built after the load, e.g. by a world presenter): it continues from there, not from the record's pose
    const s = id != null && this._saved.get(id);
    if (s) { this._saved.delete(id); putState(entry, s); }
    return entry;
  }
  /** Box. When size is omitted it is computed from the model bounding box */
  addBox(mesh, o = {}) {
    readParams('rigid.addBox()', keysSchema([...BODY_KEYS, 'size']), o);
    if (!this._ready('addBox')) return null;
    const s = o.size || new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).toArray();
    const e = this._add(mesh, this.R.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2), o);
    if (e) e.volume = s[0] * s[1] * s[2];
    return e;
  }
  /** Ball */
  addBall(mesh, o = {}) {
    readParams('rigid.addBall()', keysSchema([...BODY_KEYS, 'radius']), o);
    if (!this._ready('addBall')) return null;
    const r = o.radius ?? new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x / 2;
    const e = this._add(mesh, this.R.ColliderDesc.ball(r), o);
    if (e) e.volume = 4.19 * r * r * r;
    return e;
  }
  /** Convex hull: auto-wrapped around the model shape (irregular objects such as rocks, barrels) */
  addHull(mesh, o = {}) {
    readParams('rigid.addHull()', keysSchema(BODY_KEYS), o);
    if (!this._ready('addHull')) return null;
    const g = mesh.geometry, pts = new Float32Array(g.attributes.position.array.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < g.attributes.position.count; i++) {
      v.fromBufferAttribute(g.attributes.position, i).multiply(mesh.scale); pts.set([v.x, v.y, v.z], i * 3);
    }
    const e = this._add(mesh, this.R.ColliderDesc.convexHull(pts), o);
    if (e) { g.computeBoundingBox(); const s = g.boundingBox.getSize(v).multiply(mesh.scale); e.volume = s.x * s.y * s.z * 0.5; }
    return e;
  }
  /**
   * Wheeled vehicle (Rapier ray-cast vehicle controller): id (stable, for saves; default vehicle1, vehicle2... in creation order), wheels, mass,
   * engineForce, brakeForce, maxSteer, suspension, seats (local seat positions, the first drives; default one at the chassis center), hideDriver
   * (default true; false keeps riders visible on their seats: bikes, open carts), camera; see Vehicles.js
   * @example const kart = engine.rigid.addWheeled(mesh, { wheels, seats: [[-0.4, 0.6, 0], [0.4, 0.6, 0]], hideDriver: false });
   */
  addWheeled(mesh, o) {
    readParams('rigid.addWheeled()', keysSchema(VEHICLE_KEYS), o);
    if (!this._ready('addWheeled')) return null;
    const { id = 'vehicle' + ++this._vehicleSeq, ...rest } = o;
    // id: the player's save names the vehicle it sits in by it, and the save part 'rigid' its body state (the unique check is _add's)
    const v = createVehicle(this, mesh, rest, id);
    v.remove = () => this._removeVehicle(v);
    this.vehicles.push(v);
    return v;
  }
  /** Remove a vehicle (the occupant exits first): called by vehicle.remove() */
  _removeVehicle(v) {
    if (!this.vehicles.includes(v)) return;
    for (const p of [...v.passengers]) p.exit();
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
    this.world.removeRigidBody(entry.body); this.bodies.splice(i, 1); this._byHandle = null;
  }
  /** Push: impulse vector v (Vector3 / [x, y, z] / { x, y, z }) */
  impulse(entry, v) { const { x, y, z } = vec3(v); entry.body.wakeUp(); entry.body.applyImpulse({ x, y, z }, true); }
  /** Teleport to position (velocity zeroed) */
  setPosition(entry, position) {
    const { x, y, z } = vec3(position);
    entry._x = x; entry._z = z;
    entry.body.setTranslation({ x, y, z }, true); entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Ray (provider for engine.rays, called by engine.raycast when targets: 'all'): hits dynamic bodies only, returns RayHit (with entry, kind: 'rigid') */
  _raycast(origin, dir, far) {
    if (!this.ready || !this.bodies.length) return null;
    let byHandle = this._byHandle;
    if (!byHandle) { byHandle = this._byHandle = new Map(); for (const b of this.bodies) byHandle.set(b.body.handle, b); }
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

  // ---------- Save part 'rigid' ----------
  /**
   * @internal What a save keeps of each body with an id (addBox / addBall / addHull({ id }), vehicles always): pose, velocities, asleep. Without it a
   * load put a toppling crate back upright and at rest wherever its record was, so the game after the load was not the game that was saved. Bodies
   * not built yet keep their loaded state (it is still the saved game). Not kept: Rapier's contact / warm-start caches (docs/recipes/11-vehicles.md, section 3).
   */
  _saveState() {
    const out = Object.fromEntries(this._saved);
    for (const b of this.bodies) if (b.id != null) out[b.id] = stateOf(b.body);
    return out;
  }
  /** @internal Load: bodies here now take their state in afterLoad (after _fresh rebuilt them); the rest when they are added */
  _loadState(d) { this._saved = new Map(Object.entries(d ?? {})); }
  /** @internal afterLoad: hand the loaded state to the bodies that exist (vehicles, bodies the game keeps across a load) */
  _claimSaved() {
    for (const b of this.bodies) { const s = b.id != null && this._saved.get(b.id); if (s) { this._saved.delete(b.id); putState(b, s); } }
  }

  // ---------- Every fixed step ----------
  /** @internal module hook */
  step(dt) {
    if (!this.ready) return;
    const e = this.engine, G = e.ground, CH = G.chunkSize ?? 64, chunked = !!G.chunkCollision;
    const focus = e.player ? e.player.position : e.focus;   // player-body: the player's own kinematic body follows the character, not engine.actor
    // terrain collision around physics stream sources: sync at once when their chunks change, otherwise check every 0.5 s (tree felling etc.)
    // compared in place against last step's cells (no array, no string key while nothing crosses a chunk border); the list is built only when syncing
    const memo = this._srcMemo || (this._srcMemo = []);
    const moved = cellsChanged(e.stream, memo, CH, this.terrainRing, PHYSICS), n = memo.length;
    const treesMoved = chunked && treesChanged(this, focus, CH);
    this._syncT = (this._syncT || 0) + dt;
    if (moved || treesMoved || this._srcPending || this._syncT > 0.5) {
      const src = [];
      for (let i = 0; i < n; i += 3) src.push([memo[i], memo[i + 1], memo[i + 2]]);
      let pending = false;
      if (chunked) { pending = syncTerrain(this, src); pending = syncTrees(this, focus, CH) || pending; } else syncGroundTrees(this, src, CH);
      this._srcPending = pending; this._syncT = 0;   // pending: chunks still waiting for their turn, sync again next step
    }
    syncStatics(this);
    syncLevel(this);
    if (this._jointsGone) {   // dev only (set in _fresh): the old world had the game's joints and nothing re-created one since the rebuild
      if (!this.world.impulseJoints.len()) warnOnce(coded('rigid-misuse', `rigid: ${this._jointsGone} joint(s) were freed with the old physics world by newGame / load and none was re-created. The engine rebuilds the world and does not copy joints: re-create them in a rigid:rebuilt listener ({ world }), between entry.body of the rebuilt bodies (recipes/11-vehicles.md, Joints)`));
      this._jointsGone = 0;
    }
    // player capsule follows the player (the rapier mover computes collision and writes the position itself); turned off while driving to avoid colliding with
    // the car
    if (e.player) this.playerBody.setNextKinematicTranslation({ x: focus.x, y: focus.y, z: focus.z });
    const onFoot = !e.player?.vehicle;
    if (this.playerCollider.isEnabled() !== onFoot) this.playerCollider.setEnabled(onFoot);
    for (const v of this.vehicles) if (v.enabled) v._update(dt);

    // freeze bodies without terrain collision under them (unfrozen they would fall through)
    for (const b of this.bodies) {
      const t = b.body.translation();
      b._x = t.x; b._z = t.z;
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
      if (t.y < -200 && e.ground.has(t.x, t.z)) this.setPosition(b, [t.x, e.surface(t.x, t.z) + 2, t.z]);   // fell through the ground
      // fell off terrain({ shape }): one terrain:void per fall, the game decides what next
      const under = t.y < e.ground.voidY();
      if (under && !b._void) e.events.emit('terrain:void', { who: b, position: { x: t.x, y: t.y, z: t.z } });
      b._void = under;
    }
    for (const v of this.vehicles) v._sync();
  }

  get stats() {
    const active = this.bodies.filter(b => b.enabled && !b.body.isSleeping()).length;
    return { bodies: this.bodies.length, active, colliders: this.world ? this.world.colliders.len() : 0 };
  }
}

// A body's state in the save: [x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, asleep]. Rapier stores f32, which JSON keeps exactly
function stateOf(b) {
  const t = b.translation(), q = b.rotation(), v = b.linvel(), w = b.angvel();
  return [t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z, b.isSleeping() ? 1 : 0];
}
function putState(entry, s) {
  const b = entry.body, m = entry.mesh;
  b.setTranslation({ x: s[0], y: s[1], z: s[2] }, false); b.setRotation({ x: s[3], y: s[4], z: s[5], w: s[6] }, false);
  b.setLinvel({ x: s[7], y: s[8], z: s[9] }, false); b.setAngvel({ x: s[10], y: s[11], z: s[12] }, false);
  if (s[13]) b.sleep(); else b.wakeUp();
  m.position.set(s[0], s[1], s[2]); m.quaternion.set(s[3], s[4], s[5], s[6]);
  entry._x = s[0]; entry._z = s[2];
}

const RIGID_PARAMS = keysSchema(['gravity', 'terrainRing', 'buoyancy', 'buoyancyForce', 'waterDrag', 'floatLine', 'floatDepth', 'treeColliderHeight', 'treeRadius', 'playerCapsule']);

/** Real physics module (Rapier). Installs as engine.rigid. Requires collision() to be installed first */
export function rigid(opts = {}) {
  readParams('rigid', RIGID_PARAMS, opts);
  let r = null;
  return {
    name: 'rigid', type: 'world', provides: ['rigid'], params: RIGID_PARAMS, options: opts, label: 'Physics', noSkip: 'bodies rest while time jumps (stepping seconds of physics would only scatter them)', optional: ['interactions'], requires: ['collision'],
    install(e, ctx) {
      e.i18n.add(STRINGS); e.i18n.add({ 'zh-CN': { 'module.rigid': '物理引擎' }, en: { 'module.rigid': 'physics' } }); r = new RigidBodies(e, opts);
      r._wasm().catch(() => {});   // start loading now (see _wasm); a failure surfaces in init, which awaits the same promise
      e.budget.metric('rigidBodies', () => r.bodies.length);
      e.stream.readyCheck('rigid', s => !s.physics || r.ready && r.groundReady(s));   // a physics stream source waits for the collider under it
      e.rays.addProvider((o, d, far) => r._raycast(o, d, far));   // engine.raycast(..., { targets: 'all' }) includes rigid bodies
      // a new playthrough / a load is a fresh page for physics too (_fresh), rebuilt once per load: session:end only marks it due. With the world
      // module the rebuild runs on world:load, after the load removed the records' bodies, so the rebuilt world gets them back in view order; without
      // it, afterLoad (newGame / load / quit all apply a save) runs it. Rebuilding on both events built the world twice per new game.
      // A refused load (session:failed) leaves the game as it was, physics included.
      ctx.track(e.events.on('session:end', () => { r._freshDue = true; }));
      ctx.track(e.events.on('session:failed', () => { r._freshDue = false; }));
      ctx.track(e.events.on('world:load', () => r._fresh()));
      e.saves.register('rigid', { save: () => r._saveState(), load: d => r._loadState(d) });
      return r;
    },
    afterLoad() { if (r._freshDue) r._fresh(); r._claimSaved(); },   // after every part loaded and _fresh rebuilt the world (world:load is emitted inside the world part's load)
    async init() { await r.init(); },
    counts() { return r.bodies.length; },   // engine.counts().rigid
    // bodies by type and what they are doing: sleeping = at rest (normal), frozen = disabled because no terrain collider is under them yet (they wait, not fall)
    describe() {
      const B = r.bodies, n = f => B.filter(f).length;
      return { ready: r.ready, bodies: B.length, dynamic: n(b => !b.fixed), fixed: n(b => b.fixed), sleeping: n(b => b.enabled && b.body.isSleeping()),
        frozen: n(b => !b.enabled), vehicles: r.vehicles.length, colliders: r.world ? r.world.colliders.len() : 0 };
    },
    fixed(dt) { if (r.ready) r.step(dt); },
    dispose() { r.world?.free(); r.world = null; },
  };
}
