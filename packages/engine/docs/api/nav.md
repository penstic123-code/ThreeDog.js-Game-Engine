# engine.nav — nav(opts?: NavOptions)

Navmesh (nav() module)

- Options `NavOptions`:
  - `cellSize?: number` Voxel cell size (meters), default 0.3; smaller is more accurate but slower to build
  - `agentRadius?: number` Character radius (meters), default reads engine.movement.radius (this is an override)
  - `agentHeight?: number` Character height (meters), default reads engine.movement.height
  - `maxClimb?: number` Step height that can be climbed (meters), default reads engine.movement.stepHeight
  - `maxSlope?: number` Max walkable slope (degrees), default reads engine.movement.maxSlope
  - `tileSize?: number` Tile size (in cells), default 32
  - `crowd?: boolean` NPCs use Recast crowd avoidance, default false
  - `debug?: boolean` Show the navmesh (debug), default false
  - `maxObstacles?: number` Most TileCache obstacles (collision boxes are cut into several), default 1024
  - `maxAgents?: number` Most crowd agents (with crowd: true), default 128
  - `arrive?: number` Meters past the character's radius a path may end short of its goal and still count as arrived, default 0.6

## Methods and properties
- `nav.findPath(from: PositionLike, to: PositionLike, opts?: { radius?, detailed? }) → XZ[] | null` / `findPath(from: PositionLike, to: PositionLike, opts: { radius?: number; detailed: true }) → { status, path }` — Path from from to to [{ x, z }…] (meters); null if not ready or unreachable. Usually use engine.characters.findPath
- `nav.dispose()` — Unload the navmesh (frees native objects); characters.findPath then falls back to A*
- Properties:
  - `ready: boolean` The navmesh has been generated
  - `navMesh: any` (experimental) Native Recast NavMesh (null until ready)
  - `query: any` (experimental) Native Recast NavMeshQuery
  - `tileCache: any` (experimental) Native Recast TileCache (for dynamic obstacles)
  - `crowd: any` (experimental) Native Recast Crowd (only when crowd: true)
  - `helper: any` (experimental) three.js object for the debug display (only when debug: true)
  - `version: number` +1 on rebuild / unload: code that cached native objects (crowd agents etc.) must recreate them when it changes
  - `agent: { radius, height, maxClimb, maxSlope } | null` Character size actually in effect (from engine.movement, or the override in nav())
