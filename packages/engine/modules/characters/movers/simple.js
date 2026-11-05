// Built-in mover (default): snap to ground height, step up within step height, back off slopes that are too steep, light collision push-out, swimming, jumping.
// Needs no physics engine, cheap on large maps. Registered supports (characters.support) are ground too, and carry the character (support.js).
import { steer, water, float, tryJump, tickJump, leaveGround, land, finish, stat, inherited, climbLimit } from './common.js';
import { groundAt, beginMove, endMove } from './support.js';

/** Create the 'simple' mover (c is the character) */
export function simpleMover(c) {
  return {
    name: 'simple',
    move(dirX, dirZ, run, dt) {
      const e = c.engine, p = c.root.position;
      beginMove(c);   // a platform under the feet moved since last step: move with it first
      steer(c, dirX, dirZ, run, dt);

      const ox = p.x, oz = p.z, oh = groundAt(c, ox, oz, p.y), inh = c.grounded ? null : inherited(c);
      p.x += (c.velocity.x + (inh?.x ?? 0)) * dt; p.z += (c.velocity.y + (inh?.y ?? 0)) * dt;
      // back to the old position where it cannot climb: step up directly within step height; above that check the slope; hitting ground higher than itself in the air counts as a wall
      const nh = groundAt(c, p.x, p.z, p.y), step = Math.hypot(p.x - ox, p.z - oz), maxClimb = climbLimit(e), rise = nh - Math.max(oh, c.grounded ? oh : p.y);
      const blocked = c.grounded ? (rise > c.stepHeight && step > 1e-4 && (nh - oh) / step > maxClimb) : nh > p.y + c.stepHeight;
      if (blocked) { p.x = ox; p.z = oz; c.velocity.set(0, 0); }
      const col = e.collision;
      if (col?.blockedAt(p.x, p.z, c.radius)) {   // addBlocked ground (river): slide along it, else stay put
        const nx = p.x, nz = p.z;
        if (!col.blockedAt(nx, oz, c.radius)) p.z = oz; else if (!col.blockedAt(ox, nz, c.radius)) p.x = ox; else { p.x = ox; p.z = oz; c.velocity.set(0, 0); }
      }
      col?.resolve(p, c.radius);

      const { ground, swimY, hit } = water(c, ox, oz);

      // vertical: gravity, jump, walking off an edge, landing
      tickJump(c, dt);
      if (c.swimming) float(c, swimY);
      else {
        if (c.grounded && ground < p.y - c.stepHeight) leaveGround(c);   // walked off an edge
        tryJump(c);
        if (c.grounded) { p.y = ground; c.vy = 0; }
        else {
          c.vy += stat(c, 'gravity') * dt; p.y += c.vy * dt;
          if (p.y <= ground) { const impact = -c.vy; p.y = ground; land(c, impact); }
        }
      }
      finish(c, dt);
      endMove(c, dt, hit, 'ground');
    },
  };
}
