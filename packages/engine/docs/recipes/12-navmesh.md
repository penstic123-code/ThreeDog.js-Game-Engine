# Navigation mesh (nav)

There is a single pathfinding entry point: `engine.characters.findPath(from, to)`; NPC schedules use it too.
- Without `nav()` (or before it is built): the collision module's grid A* (good enough for open terrain with a few obstacles).
- With `nav()`: after a level loads, a Recast navmesh is built; paths are more accurate and go around walls more cleverly. **Only level ground (the
  level module) is supported for now**; procedural terrain keeps using A*.

## 1. Install (main.js)
```js
import { level, collision, followCamera, characters, nav } from 'threedog';
engine.use(level({ url: '/models/town.glb' }), collision(), followCamera(), characters(),
  nav({ agentRadius: 0.4, agentHeight: 1.8, maxClimb: 0.45, maxSlope: 45, debug: false }));   // debug: true draws the navmesh
```
- Mesh source: the walkable meshes in the level (naming convention in `10-blender-level.md`). Walls = the level's `col_` boxes + every
  `addBox / addCircle` in the collision module;
  they sync automatically as dynamic obstacles: add an obstacle in game and the affected tiles rebuild themselves, no manual refresh.
- Recast (about 1 MB) is downloaded only in start(); until it is ready findPath falls back to A*.

## 2. Use
```js
const path = engine.characters.findPath(engine.player.position, { x: 4, z: 5 });   // [{ x, z }...] or null (unreachable)
const wall = engine.collision.addBox([16, 0, 0], { halfWidth: 4.5, halfDepth: 1 });   // temporarily block a gap (center, half width, half depth); the navmesh updates with it
wall.remove();                                       // remove the obstacle
engine.npcs.add({ name: '信使', position: [4, 0, -5], schedule: [{ at: 0, position: [4, 0, 5] }] });  // the NPC finds its own way there
engine.nav.dispose();                                // unload the navmesh; afterwards A* is used again
```
Native Recast objects: `engine.nav.navMesh / query / tileCache / crowd` (crowd needs `nav({ crowd: true })`).

## 3. Verify
- `describe().nav`: `{ ready: true, version, obstacles: number of obstacles }`; in `describeText()` it is the "nav: {...}" line.
- In a test: after `engine.haltLoop()` call `findPath` and look at the waypoints (going around a wall they pass through the gap); after `addBox`,
  `engine.step(0.1)` and query again: the path should switch sides.
- Did the NPC arrive: after `engine.step(30)`, check `engine.npcs.get('信使').position`.
- To see the mesh: `nav({ debug: true })` + `npm run shot -- /your-page.html`. Related test: `threedog test 导航网格` (test page in the engine repository:
  `packages/engine/tests/nav/`).

## 4. Many paths at once: findPathAsync
`findPath` answers now, on the main thread. For crowds (dozens of NPCs repathing, AI squads) use `findPathAsync`: the same search (navmesh if ready, else A*)
runs in `engine.threads` workers and `done(path, status)` runs at the start of a fixed step about 4 steps (67 ms) later, through `engine.commits`.
```js
const req = engine.characters.findPathAsync(guard.position, target, (path, status) => {   // status 'ok' | 'noPath' | 'notReady', as findPath({ detailed: true })
  guard.path = path;
}, { radius: 0.5 });
req.remove();                                  // the target changed before the answer came: done is never called
engine.characters.pathsPerStep = 64;           // requests sent per fixed step (default 32); the rest wait in order
```
- Built-in NPCs already use it; keep `findPath` for the few calls that need a path this step (player click-to-move).
- threads on / off / slow / crashed give identical paths on the identical step: the worker mirrors the navmesh (exported bytes) and the collision colliders;
  if either changes while a batch is in flight, that batch is recomputed on the main thread on the new state.
- With A*, ground shape (water, slope) is sampled on a 1 m raster cached 5 s (colliders and terrain trees are tested exactly), and the search stays inside
  the start-goal box plus a margin, so an async path can differ slightly from `findPath`'s.
- A save taken while a request is in flight does not keep it: the NPC asks again after loading. Tests: `threedog test "paths:"`.

## 5. One source for "can walk there"
`createEngine({ movement: { radius, height, maxSlope, stepHeight } })` sets it once; read it as `engine.movement`. Collision, the Rapier capsule, the
navmesh, A* and level steps all read it, so a module never writes its own 0.4 or 0.45. A character's position belongs to its mover: other systems
request movement (`placeAt`, `move`, vehicle `enter`) and never set `player.position`.

## Fences and rivers (collision)

Walls and water that are not meshes: `engine.collision.addSegment(a, b, { thickness })` is a thin wall along a line; `addBlocked(fn)` marks ground impassable where `fn(x, z)` is true. Both return `{ remove() }` and are free when unused.

```js
// A river along x 5..9 with a bridge at z -1..1: the bridge is just a hole in the blocked function
engine.collision.addBlocked((x, z) => x > 5 && x < 9 && !(z > -1 && z < 1), { bounds: { minX: 5, maxX: 9, minZ: -50, maxZ: 50 } });
// A fence with a gate: two segments, the gap between them is the gate
engine.collision.addSegment([-18, 0, -12], [-18, 0, -4]);
engine.collision.addSegment([-18, 0, 0], [-18, 0, 12], { thickness: 0.4 });
```

Walkers stop at the edge and slide along it; `collision.walkable()` and A* pathing, sync and async, see both. `fn` must be pure and deterministic (no clock, no random). Async paths cannot send a function to the worker, so `fn` is sampled into the 1 m ground raster instead (re-sampled when you add or remove a field): give `bounds`, or every requested tile is sampled in full. Navmesh mode (`nav()` installed) does not see `addBlocked`; use `addSegment` or bake the river into the mesh there.

## Line of sight and straight-line checks: collision.lineClear
`engine.collision.lineClear(a, b, { radius })` answers "is anything solid between a and b?" for a 3D segment: boxes, circles and terrain trees, with heights (a 1 m wall does not block a sight line 3 m above it; a collider's `y` / `height` count). It is a boolean; `addBlocked` water is ignored. Give eye heights in `a` / `b`; `radius` fattens the line (pass the character radius for "can I walk straight there").
```js
const sees = engine.collision.lineClear([guard.x, 1.6, guard.z], [player.x, 1.6, player.z]);   // true = clear view
const straight = engine.collision.lineClear(me.position, goal, { radius: engine.movement.radius });
```
The A* fallback smooths paths with the same idea: it samples each shortcut at most one character radius apart (so a thin fence cannot be skipped), starts from the character's real position, and its cell size follows `radius` (1-2 m) unless you pass `step`.
