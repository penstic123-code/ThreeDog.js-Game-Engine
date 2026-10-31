// Shared by all movers: horizontal velocity smoothing, swim check, jump buffer and coyote time, landing, facing and action state.
// Used by simple.js (built-in) and rapier.js (Rapier character controller), so feel parameters (acceleration, air control, jump) match.
import { xzOf } from '../../../core/math.js';

/** Smooth horizontal velocity toward the target velocity (c.velocity x/y map to world x/z) */
export function steer(c, dirX, dirZ, run, dt, speedOverride) {
  // push() overrides the requested direction for its duration (knockback, dodge displacement)
  if (c._push > 0) { c._push -= dt; c.velocity.set(c._pushX, c._pushZ); return; }
  const len = Math.hypot(dirX, dirZ);
  let speed = speedOverride ?? (run ? c.runSpeed : c.speed);
  if (c.swimming) speed *= c.swimSpeedFactor;
  const tvx = len > 0.01 ? dirX * speed : 0, tvz = len > 0.01 ? dirZ * speed : 0;
  const k = 1 - Math.exp(-dt * c.acceleration * (c.grounded || c.swimming ? 1 : c.airControl));
  c.velocity.x += (tvx - c.velocity.x) * k; c.velocity.y += (tvz - c.velocity.y) * k;
}

/** Water: decide whether swimming (sets c.swimming); a non-swimmer is put back at (ox, oz). Returns { ground: ground height under the feet, swimY: body height when swimming } */
export function water(c, ox, oz) {
  const e = c.engine, p = c.root.position;
  let ground = e.surface(p.x, p.z, p.y);   // pass the current height: walk the ground under a bridge, the deck on top
  const swimY = e.waterAt(p.x, p.z) - c.swimDepth;
  if (!c.canSwim && ground < swimY) { p.x = ox; p.z = oz; c.velocity.set(0, 0); ground = e.surface(ox, oz, p.y); }   // cannot swim: no deep water
  c.swimming = c.canSwim && ground < swimY && p.y <= swimY + 0.3;
  return { ground, swimY };
}

/** Float on the water surface when swimming (gentle bob) */
export function float(c, swimY) { c.vy = 0; c.grounded = false; c.root.position.y = swimY + Math.sin(c.engine.elapsed * 2) * 0.05; }

/** Jump if requested and on the ground (or within coyote time after walking off an edge) */
export function tryJump(c) {
  if (c._jumpBuffer > 0 && (c.grounded || c._coyote > 0)) {
    c.vy = c.jumpSpeed; c.grounded = false; c._jumpBuffer = 0; c._coyote = 0;
    c.engine.events.emit('character:jump', { character: c });
  }
}

/** Landing: impact is the landing speed */
export function land(c, impact) {
  c.vy = 0; c.grounded = true;
  c.onLand?.(impact); c.engine.events.emit('character:land', { character: c, impact });
}

/** Angle the character wants to face by its faceMode; null = keep the current facing. While pushed it never turns (a knockback must not spin it round) */
function faceAngle(c, sp) {
  if (c._push > 0 || c.faceMode === 'manual') return null;
  if (c.faceMode === 'camera') { const f = c.engine.cameraRig?.forward(); if (f) return Math.atan2(f.x, f.z); }
  else if (c.faceMode === 'target' && c.faceTarget) { const [x, z] = xzOf(c.faceTarget), p = c.root.position; return Math.atan2(x - p.x, z - p.z); }
  return sp > 0.3 ? Math.atan2(c.velocity.x, c.velocity.y) : null;
}

/** Turn by faceMode (default: toward the move direction), update moveAmount and action state */
export function finish(c, dt) {
  const sp = c.velocity.length(), want = faceAngle(c, sp);
  if (want != null) {
    let d = want - c.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
    c.facing += d * Math.min(1, dt * c.turnSpeed);
    c.root.rotation.y = c.facing;
  }
  c.moveAmount = sp;
  c.state = c.swimming ? 'swim' : !c.grounded ? (c.vy > 0 ? 'jump' : 'fall') : sp > c.speed * 1.3 ? 'run' : sp > 0.4 ? 'walk' : 'idle';
}
