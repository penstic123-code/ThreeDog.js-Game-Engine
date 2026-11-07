// What any collision module must provide (fields: see gameplay/inventory.contract.js; shared check: @threedog/tools/contract).
// Exactly what other code reads from engine.collision: addBox / addCircle (content models, level colliders), walkableAt / blockedAt / resolve (characters, NPC avoidance), groundWalkable (the path worker's tiles),
// cameraDistance (the follow camera's arm), forEachStatic / mirror (rigid and nav copy the static colliders). Fields: version and blockedVersion go up when
// colliders change (cached paths resample), maxClimb is the steepest walkable slope, grid is what the path worker queries.
export default {
  name: 'collision',
  api: ['addBox', 'addCircle', 'walkableAt', 'blockedAt', 'groundWalkable', 'resolve', 'cameraDistance', 'forEachStatic', 'mirror'],
  fields: ['version', 'blockedVersion', 'maxClimb', 'grid'],
  ops: [],
  events: [],
  saves: {},
  describe: true,
  options: {},
  probe: { setup: [], emits: [], state: null },
};
