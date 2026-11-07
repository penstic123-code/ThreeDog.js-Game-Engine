// What any level module must provide (fields: see gameplay/inventory.contract.js; shared check: @threedog/tools/contract).
// Exactly what other code reads from engine.level: marker(name) (content places, the HUD), track(handle) (a handle that goes when the level unloads),
// load (a level change); root / ready (hlod), markers (triggers), heightfield (vegetation's area; null when there is none).
// A replacement also claims provides: ['level', 'ground'] and gives the ground with ctx.ground.provide({ height, slope, type }) and emits 'level:loaded' after each load and 'level:unloaded' when a level leaves: nav and the path caches rebuild on
// it (not exercised by the shared check: it needs a scene). A game with several levels registers a 'level' save with first: true, so the level is up before the player lands.
export default {
  name: 'level',
  api: ['marker', 'track', 'load'],
  fields: ['root', 'markers', 'ready', 'heightfield'],
  ops: [],
  events: ['level:loaded', 'level:unloaded', 'level:failed'],
  saves: {},
  describe: true,
  options: {},
  probe: { setup: [], emits: [], state: null },
};
