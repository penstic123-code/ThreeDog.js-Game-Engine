// Rapier 0.21 keeps its query structures in the broad phase, and only a step rebuilds them: World has no updateSceneQueries and no query pipeline, and
// propagateModifiedBodyPositionsToColliders moves colliders without touching the broad phase. So a frozen engine refreshes with a step of no time, here and nowhere else.
// Twice: the first leaves a moved body's collider in the old place, the second catches it up. Tools test `rapier refresh` holds each of these, per Rapier version.

/** @internal Rebuild what queries read and nothing else (velocities, positions, sleep and contacts stay); the step length comes back even if Rapier throws */
export function refreshQueries(world) {
  const dt = world.timestep;
  world.timestep = 0;
  try { world.step(); world.step(); } finally { world.timestep = dt; }
}
