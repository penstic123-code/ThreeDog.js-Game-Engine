// What any ground provider must give (an object contract, shared check @threedog/tools/contract): the plain flat ground, a terrain, a level and compositeGround's
// answer all pass it, and so must a game's own (engine.setGround(g) or ctx.ground.provide(g) in a module holding provides: ['ground']).
//   height(x, z, refY?)  ground height in meters; -Infinity where there is no ground. refY picks the layer on multi-layer ground (the highest not above refY + one step)
//   slope(x, z, refY?)   slope; type(x, z, refY?)  ground type name ('void' where there is no ground)
//   waterLevel           global water surface height (-Infinity = none); water that differs per point is engine.addWaterBody({ query })
//   has? / voidY? / forEachCollider? / chunkSize? ...  optional; missing ones are filled from the flat ground
// engine.surface / slope / groundType / waterAt(x, z, refY) read these. compositeGround({ parts }) is the way to run more than one provider.
export default {
  name: 'ground',
  kind: 'object',
  api: ['height', 'slope', 'type'],
  fields: ['waterLevel'],
  calls: [['height', 0, 0, 0], ['slope', 0, 0, 0], ['type', 0, 0, 0]],
};
