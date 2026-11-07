// What a module in the nav slot must provide (fields: see gameplay/inventory.contract.js; shared check: @threedog/tools/contract).
// The slot does not swap the navigation library: navSearch (navPath.js) calls Recast's findPath and findStraightPath on query and getOffMeshConnectionByRef on navMesh, characters/pathJob.js gives exportMesh()'s bytes to Recast's importNavMesh,
// and NPC steering calls addAgent on crowd. A replacement is Recast underneath.
// Exactly what other code reads from engine.nav: findPath (characters, once ready is true), point(p) (the surface nearest the caller's height there, the ground when none is given), reach(radius), mesh(radius) (the mesh cut for that body), meshes and exportMesh(mesh) (the path worker), crowd (NPC steering;
// null: NPCs steer on their own), query (the path solver), version / revision (a new mesh / a changed one: caches of this module drop on them; they count per module, so another nav says nothing by its number).
export default {
  name: 'nav',
  api: ['findPath', 'point', 'reach', 'mesh', 'exportMesh'],
  fields: ['ready', 'crowd', 'query', 'navMesh', 'links', 'meshes', 'version', 'revision'],
  ops: [],
  events: [],
  saves: {},
  describe: true,
  options: {},
  probe: { setup: [], emits: [], state: null },
};
