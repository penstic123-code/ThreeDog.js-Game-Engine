# engine.stream (Stream) — engine.stream builds on demand by space: only entries near the focus get built

- `stream.add(def: StreamEntryOptions) → StreamHandle` — Register something to stream in (not built at once); an object returned by build with no parent is added to the scene automatically. Example: `engine.stream.add({ position: [40, 0, 12], radius: 6, build: () => makeHouse() });`
- `stream.setRadius(m: number)` — Set the build radius in meters
- `stream.source(position: any, opts?: StreamSourceOptions) → StreamSource` — (experimental) Add a stream source: the world around position is loaded (terrain chunks, colliders, nearby models, stream entries) until remove() or until. position may be live (an Object3D or Vector3 that moves) or a function. detail 'simple' loads only terrain and hlod proxies (a far view); physics defaults to true for 'full'; pass false for a camera that only needs a picture. radius caps every loader's range (default: each loader's own range). until: a Promise (removed when it settles) or a function checked every frame (removed when it returns true). Example: `const dest = engine.stream.source([800, 0, 300], { radius: 64 }); await dest.whenReady; engine.player.placeAt([800, 0, 300]); dest.remove();`
- `stream.teleport(position: any, opts?: { radius?, move?, timeout? }) → Promise<void>` — (experimental) Load the destination first, then move: resolves after the player (engine.focus without one) is placed. Until the destination is ready (terrain chunks, collision, nearby models) the player stays where it is. move replaces the default placement (for a vehicle or a custom character). timeout (seconds of frame time, default 60; Infinity waits forever): when the destination is still not ready, the Promise rejects (code stream-timeout, naming the loaders still waiting) and the player is not moved. Example: `await engine.stream.teleport([800, 0, 300]);`
- `stream.readyCheck(name: string, fn: (source: StreamSource) => boolean) → { remove(): void }` — (experimental) Register a readiness check for loaders: fn(source) returns whether this loader finished what that source asks for. For module authors whose loader reads stream sources; games only read source.ready. Example: `engine.stream.readyCheck('props', s => s.detail !== 'full' // props.queued === 0)`
- `stream.sources(pick?: { detail?, physics? }) → StreamSource[]` — (experimental) Sources with fresh positions, filtered: { detail: 'full' } for models and stream entries, { physics: true } for colliders, no filter for terrain
- Properties:
  - `radius: number | null` Build radius in meters around each full-detail stream source (a source radius caps it); null = follow the terrain view distance (the fog distance engine.fogFar without terrain)
  - `cellSize: number` Grid cell edge in meters, shared with hlod, default 64
  - `unloadFactor: number` Unload only beyond radius x this (walking back and forth does not rebuild), default 1.25
  - `player: StreamSource` Built-in source at the gameplay anchor (world.anchor, else the player, else engine.focus): full detail and physics
  - `camera: StreamSource` Built-in source at the camera focus engine.focus: full detail, no physics
  - `activeRadius: number` The build radius actually in use, in meters
  - `ready: boolean` Everything registered within radius is built (start() waits for it before the loading screen goes away)
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
