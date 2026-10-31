// One shared definition of "can walk there": character radius, height, max slope and step height are defined only here (1.12).
// Lightweight collision (resolve / walkable / maxClimb), the Rapier capsule, navigation (Recast agentRadius / agentHeight / maxClimb / maxSlope),
// the A* fallback pathfinding, the level heightfield step height and Character's default radius / step all read engine.movement by default, so no one keeps a private number.
// Core only holds this data and depends on no module (hard rule 2); a module's same-named option can still be passed and acts as an override.
//   createEngine({ movement: { radius: 0.5 } })  ->  engine.movement.radius === 0.5 (read-only, never changed at runtime)
import { checkOptions } from './validate.js';
import { codedError } from './errorHints.js';

/** Defaults (meters / degrees): radius is the character radius, height the character height, maxSlope the steepest walkable slope (degrees), stepHeight the step it can climb directly. */
export const MOVEMENT_DEFAULTS = { radius: 0.4, height: 1.8, maxSlope: 48, stepHeight: 0.45 };

/** Build the read-only movement parameters. slopeRatio (rise over run) is maxSlope converted to a ratio, which lightweight collision tests against. */
export function createMovement(opts = {}) {
  checkOptions('createEngine({ movement })', opts, Object.keys(MOVEMENT_DEFAULTS));
  const m = { ...MOVEMENT_DEFAULTS, ...opts };
  for (const k of Object.keys(MOVEMENT_DEFAULTS)) if (!(m[k] > 0)) throw codedError('movement', `movement.${k} must be a positive number; got ${m[k]}`);
  m.slopeRatio = Math.tan(m.maxSlope * Math.PI / 180);
  return Object.freeze(m);
}
