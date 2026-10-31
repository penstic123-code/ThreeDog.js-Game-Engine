// Rapier character-controller mover (mover: 'rapier', needs the rigid module): real collision shapes, auto step-up, slope snapping.
// Feel parameters (speed, acceleration, jump, air control, swimming) match simple; while physics is not ready or the collision under the feet is not built, simple is used temporarily.
// Native objects: mover.controller (KinematicCharacterController), mover.body, mover.collider.
// The player uses rigid.playerBody / playerCollider (rigid syncs it to the player position each step); each NPC builds its own kinematic capsule.
import { steer, water, float, tryJump, land, finish } from './common.js';

/** Create the 'rapier' mover (c is the character, fallback is the simple mover used when not ready) */
export function rapierMover(c, fallback) {
  const m = {
    name: 'rapier', controller: null, body: null, collider: null,
    move(dirX, dirZ, run, dt, speedOverride) {
      const e = c.engine, r = e.rigid, p = c.root.position;
      if (!r?.ready || !r.groundReady(p)) return fallback.move(dirX, dirZ, run, dt, speedOverride);
      if (!m.controller) setup(e, r);
      const col = m.collider, body = m.body.translation();
      // teleported (placeAt, load, leaving a vehicle): first move the collider to the current position
      if (Math.abs(body.x - p.x) + Math.abs(body.y - p.y) + Math.abs(body.z - p.z) > 0.3) {
        m.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true); r.world.propagateModifiedBodyPositionsToColliders();
      }
      steer(c, dirX, dirZ, run, dt, speedOverride);
      const ox = p.x, oz = p.z;

      // vertical intent: float to the surface when swimming, otherwise gravity + jump
      c._jumpBuffer -= dt; c._coyote -= dt;
      let dy;
      if (c.swimming) dy = e.waterAt(p.x, p.z) - c.swimDepth - p.y;
      else {
        tryJump(c);
        if (c.grounded && c.vy <= 0) { c.vy = 0; dy = 0; }   // do not press down while standing (it would break auto step-up); downhill relies on ground snapping
        else { c.vy += c.gravity * dt; dy = c.vy * dt; }
      }
      const wasGrounded = c.grounded;
      m.controller.computeColliderMovement(col, { x: c.velocity.x * dt, y: dy, z: c.velocity.y * dt }, r.R.QueryFilterFlags.EXCLUDE_DYNAMIC | r.R.QueryFilterFlags.EXCLUDE_SENSORS);
      const mv = m.controller.computedMovement();
      p.x += mv.x; p.y += mv.y; p.z += mv.z;
      // hit a wall (not stepping up): velocity becomes the wall-sliding velocity, so standing at a wall does not keep walking
      const want = Math.hypot(c.velocity.x, c.velocity.y) * dt, got = Math.hypot(mv.x, mv.z);
      if (wasGrounded && mv.y <= 1e-3 && got < want * 0.5) c.velocity.set(mv.x / dt, mv.z / dt);
      const grounded = m.controller.computedGrounded();
      if (c.vy > 0 && mv.y < dy * 0.5) c.vy = 0;                                   // hit the ceiling

      const { swimY } = water(c, ox, oz);
      if (c.swimming) float(c, swimY);
      else if (grounded && !wasGrounded && c.vy <= 0) land(c, -c.vy);
      else if (!grounded && wasGrounded && c.vy <= 0) { c.grounded = false; c._coyote = c.coyoteTime; }   // walked off an edge
      else c.grounded = grounded;
      if (m.body !== r.playerBody) m.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      finish(c, dt);
    },
    /** Called when the character is deleted: release the NPC's own capsule and controller */
    dispose() {
      const r = c.engine.rigid;
      if (!m.controller) return;
      r.world.removeCharacterController(m.controller);
      if (m.body !== r.playerBody) r.world.removeRigidBody(m.body);
      m.controller = m.body = m.collider = null;
    },
  };

  function setup(e, r) {
    const R = r.R, w = r.world, p = c.root.position;
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
