# engine.stream (Stream) — engine.stream builds on demand by space: only entries near the focus get built

- `stream.cellKey(x: number, z: number) → string` — Key 'cx,cz' of the cell containing (x, z) (hlod and others share the same grid)
- `stream.add(def: StreamEntryOptions) → StreamHandle` — Register something to stream in (not built at once); an object returned by build with no parent is added to the scene automatically. Example: `engine.stream.add({ position: [40, 0, 12], radius: 6, build: () => makeHouse() });`
- `stream.setRange(m: number)` — Set the build range in meters
- `stream.update()` — Called by the engine each frame (after the frame hooks, before jobs). Skips re-checking while no load source moved more than 1/8 of a cell.
- Properties:
  - `range: number | null` Build range in meters around each full-detail load source (a source radius caps it); null = follow the terrain view distance (the fog distance engine.fogFar without terrain)
  - `cellSize: number` Grid cell edge in meters, shared with hlod, default 64
  - `unloadFactor: number` Unload only beyond range x this (walking back and forth does not rebuild), default 1.25
  - `activeRange: number` The build range actually in use, in meters
  - `ready: boolean` Everything registered within range is built (start() waits for it before the loading screen goes away)
  - `stats: { entries: number; built: number; queued: number }` entries is the registered count, built the built count, queued the queued count

## Data structures
- **StreamEntryOptions** Parameters of engine.stream.add(): position is the location, radius the size (meters), build generates (may be async), dispose unloads
  - `position: PositionLike` Position (Vector3 / object / [x, y, z] / { x, z }; only the horizontal coordinates count)
  - `radius?: number` Object size (meters); larger ones are built earlier
  - `build: () => Object3D | Promise<Object3D>` Generate the object (called when entering range, run spread over frames through engine.jobs)
  - `dispose?: (obj: Object3D) => void` Unload (called when leaving range), default engine.remove (full removal); write your own when the object is reused (e.g. engine.detach)
  - `keep?: boolean` Do not unload even when out of range
  - `priority?: number` Build order: larger first (nearer first within the same priority), default 0
- **StreamHandle** Handle returned by stream.add(): object is the generated object (null while not generated)
  - `def: StreamEntryOptions`
  - `object: Object3D | null`
  - `built: boolean`
  - `remove()`
