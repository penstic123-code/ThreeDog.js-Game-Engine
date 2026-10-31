// Built-in mover (default): snap to ground height, step up within step height, back off slopes that are too steep, light collision push-out, swimming, jumping.
// Needs no physics engine, cheap on large maps.
import { steer, water, float, tryJump, land, finish } from './common.js';

/** Create the 'simple' mover (c is the character) */
export function simpleMover(c) {
  return {
    name: 'simple',
    move(dirX, dirZ, run, dt, speedOverride) {
      const e = c.engine, p = c.root.position;
      steer(c, dirX, dirZ, run, dt, speedOverride);

      const ox = p.x, oz = p.z, oh = e.surface(ox, oz, p.y);
      p.x += c.velocity.x * dt; p.z += c.velocity.y * dt;
      // back to the old position where it cannot climb: step up directly within step height; above that check the slope; hitting ground higher than itself in the air counts as a wall
      const nh = e.surface(p.x, p.z, p.y), step = Math.hypot(p.x - ox, p.z - oz), maxClimb = e.collision?.maxClimb ?? e.movement.slopeRatio, rise = nh - Math.max(oh, c.grounded ? oh : p.y);
      const blocked = c.grounded ? (rise > c.stepHeight && step > 1e-4 && (nh - oh) / step > maxClimb) : nh > p.y + c.stepHeight;
      if (blocked) { p.x = ox; p.z = oz; c.velocity.set(0, 0); }
      e.collision?.resolve(p, c.radius);

      const { ground, swimY } = water(c, ox, oz);

      // vertical: gravity, jump, walking off an edge, landing
      c._jumpBuffer -= dt; c._coyote -= dt;
      if (c.swimming) float(c, swimY);
      else {
        if (c.grounded && ground < p.y - c.stepHeight) { c.grounded = false; c._coyote = c.coyoteTime; }   // walked off an edge
        tryJump(c);
        if (c.grounded) { p.y = ground; c.vy = 0; }
        else {
          c.vy += c.gravity * dt; p.y += c.vy * dt;
          if (p.y <= ground) { const impact = -c.vy; p.y = ground; land(c, impact); }
        }
      }
      finish(c, dt);
    },
  };
}
