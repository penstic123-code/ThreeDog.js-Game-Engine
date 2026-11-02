// Rapier character-controller mover (mover: 'rapier', needs the rigid module): real collision shapes, auto step-up, slope snapping.
// Feel parameters (speed, acceleration, jump, air control, swimming) match simple; while physics is not ready or the collision under the feet is not built, simple is used temporarily.
// Native objects: mover.controller (KinematicCharacterController), mover.body, mover.collider.
// The player uses rigid.playerBody / playerCollider (rigid syncs it to the player position each step); each NPC builds its own kinematic capsule.
import { steer, water, float, tryJump, tickJump, leaveGround, land, finish, stat, inherited } from './common.js';
import { beginMove, endMove } from './support.js';

/** Create the 'rapier' mover (c is the character, fallback is the simple mover used when not ready) */
export function rapierMover(c, fallback) {
  const m = {
    name: 'rapier', controller: null, body: null, collider: null,
    move(dirX, dirZ, run, dt) {
      const e = c.engine, r = e.rigid, p = c.root.position;
      if (!r?.ready || !r.groundReady(p)) return fallback.move(dirX, dirZ, run, dt);
      const fresh = !m.controller || m.gen !== r.gen;   // rigid rebuilt its world (newGame / load, RigidBodies._fresh): the old controller is gone with it
      if (fresh) setup(e, r);
      const col = m.collider;
      // moved outside the mover (placeAt, load, leaving a vehicle, a platform carrying it; support.js tells exactly): the collider goes there first
      if (beginMove(c) || fresh) { m.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true); r.world.propagateModifiedBodyPositionsToColliders(); }
      steer(c, dirX, dirZ, run, dt);
      const ox = p.x, oz = p.z, inh = c.grounded ? null : inherited(c);

      // vertical intent: float to the surface when swimming, otherwise gravity + jump
      tickJump(c, dt);
      let dy;
      if (c.swimming) dy = e.waterAt(p.x, p.z) - c.swimDepth - p.y;
      else {
        tryJump(c);
        if (c.grounded && c.vy <= 0) { c.vy = 0; dy = 0; }   // do not press down while standing (it would break auto step-up); downhill relies on ground snapping
        else { c.vy += stat(c, 'gravity') * dt; dy = c.vy * dt; }
      }
      const wasGrounded = c.grounded;
      m.controller.computeColliderMovement(col, { x: (c.velocity.x + (inh?.x ?? 0)) * dt, y: dy, z: (c.velocity.y + (inh?.y ?? 0)) * dt }, r.R.QueryFilterFlags.EXCLUDE_DYNAMIC | r.R.QueryFilterFlags.EXCLUDE_SENSORS);
      const mv = m.controller.computedMovement();
      p.x += mv.x; p.y += mv.y; p.z += mv.z;
      // hit a wall (not stepping up): velocity becomes the wall-sliding velocity, so standing at a wall does not keep walking
      const want = Math.hypot(c.velocity.x, c.velocity.y) * dt, got = Math.hypot(mv.x, mv.z);
      if (wasGrounded && mv.y <= 1e-3 && got < want * 0.5) c.velocity.set(mv.x / dt, mv.z / dt);
      const grounded = m.controller.computedGrounded();
      if (c.vy > 0 && mv.y < dy * 0.5) c.vy = 0;                                   // hit the ceiling

      const { swimY, ground, hit } = water(c, ox, oz);
      if (c.swimming) float(c, swimY);
      else if (grounded && !wasGrounded && c.vy <= 0) land(c, -c.vy);
      else if (!grounded && wasGrounded && c.vy <= 0) leaveGround(c);   // walked off an edge
      else c.grounded = grounded;
      if (m.body !== r.playerBody) m.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      finish(c, dt);
      endMove(c, dt, hit && Math.abs(ground - p.y) < 0.1 ? hit : null, 'collider');   // a support counts when the capsule stands on its top
    },
    /** Called when the character is deleted: release the NPC's own capsule and controller */
    dispose() {
      const r = c.engine.rigid;
      if (!m.controller) return;
      if (m.gen !== r.gen) { m.controller = m.body = m.collider = null; return; }   // built for a world that was rebuilt (and freed) since
      r.world.removeCharacterController(m.controller);
      if (m.body !== r.playerBody) r.world.removeRigidBody(m.body);
      m.controller = m.body = m.collider = null;
    },
  };

  function setup(e, r) {
    const R = r.R, w = r.world, p = c.root.position;
    m.gen = r.gen;
    if (c === e.player) { m.body = r.playerBody; m.collider = r.playerCollider; }
    else {
      const hh = r.playerCapsule.halfHeight;
      m.body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
      m.collider = w.createCollider(R.ColliderDesc.capsule(hh, c.radius).setTranslation(0, hh + c.radius, 0), m.body);
    }
    const k = m.controller = w.createCharacterController(0.02);
    k.enableAutostep(c.stepHeight, 0.15, false);
    k.setMaxSlopeClimbAngle(Math.atan(e.collision?.maxClimb ?? e.movement.slopeRatio));
    k.enableSnapToGround(c.stepHeight);
  }
  return m;
}
