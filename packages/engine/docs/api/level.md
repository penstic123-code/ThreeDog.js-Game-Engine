# engine.level — level(opts?: LevelOptions)

Hand-built level (level() module)

- Options `LevelOptions`:
  - `url?: string | null` glTF path (or asset name); pick one of this and scene
  - `scene?: Object3D | null` THREE.Object3D built in code; pick one of this and url
  - `walkable?: ((mesh: Object3D) => boolean) | null` Decide yourself which meshes are walkable
  - `colliders?: 'named' | 'auto' | false` 'named' only col_ meshes block the player / 'auto' every tall mesh that is not walkable blocks / false
  - `cellSize?: number` Heightfield cell size (meters), default 0.5
  - `outside?: number` Ground height outside the level (meters), default 0
  - `waterLevel?: number` Water surface height (meters), default no water
  - `colliderPad?: number` (experimental) Expand the collision box outward by this much (meters)
  - `colliderHeight?: number` (experimental) Minimum height of the collision box (meters)
  - `sharpEdge?: number` (experimental) Treat it as a step edge when the height difference between adjacent grid points exceeds this (meters), default 0.6
  - `hideMarkers?: boolean` (experimental) Hide the marker placeholder meshes, default true
  - `addToScene?: boolean` (experimental) Add the scene to engine.scene, default true

## Methods and properties
- `level.marker(name: string) → LevelMarker | null` — Get a marker, null if none
- `level.markersWith(prefix: string) → LevelMarker[]` — Get all markers whose names start with prefix, e.g. markersWith('npc_')
- `level.unload()` — (experimental) Unload the level (the scene is fully deleted with engine.remove; collision, ray registrations and things registered with track are removed together)
- `level.load(urlOrScene: string | Object3D) → Promise<void>` — Change level: unload the current one, load the new one (glTF path/asset name, or a THREE object), and emit level:loaded when done. When a load changes level, the save system waits for it
- `level.track(handle: T) → T` — Register things that belong to the current level and need not be kept (the { remove() } handles of triggers...); they are deleted automatically on level change / unload; returns the same handle. world data that keeps state (NPCs, pickups, props) needs no registration: with a zone, a level change only tears down the model
- Properties:
  - `root: Object3D | null` Scene root node
  - `markers: Record<string, LevelMarker>` All markers: name -> marker
  - `spawn: Vector3` Spawn point position
  - `heightfield: any` (experimental) Heightfield (for debugging)
  - `ready: boolean` Whether loading is finished

## Data structures
- **LevelMarker** Markers in the level (spawn, npc_*, trigger_*, marker_*), in world coordinates
  - `name: string`
  - `position: Vector3`
  - `quaternion: Quaternion`
  - `scale: Vector3`
  - `userData: Record<string, any>`
  - `object: Object3D`
