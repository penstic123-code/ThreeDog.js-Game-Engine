// What any navmesh module must provide (fields: see gameplay/inventory.contract.js; shared check: @threedog/tools/contract).
// Exactly what other code reads from engine.nav: findPath (characters, once ready is true), reach(radius) and exportMesh() (the path worker), crowd (NPC steering;
// null: NPCs steer on their own), query (the path solver), version / revision (a new mesh / a changed one: caches drop on them).
export default {
  name: 'nav',
  api: ['findPath', 'reach', 'exportMesh'],
  fields: ['ready', 'crowd', 'query', 'version', 'revision'],
  ops: [],
  events: [],
  saves: {},
  describe: true,
  options: {},
  probe: { setup: [], emits: [], state: null },
};
