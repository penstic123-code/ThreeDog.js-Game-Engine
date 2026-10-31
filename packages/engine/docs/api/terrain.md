# engine.terrain — terrain(opts?: TerrainOptions)

Procedural terrain (terrain() module)

- Options `TerrainOptions` (also includes the fields of Partial<TerrainConfig>):
  - `viewChunks?: number` View distance (in chunks), default 4
  - `density?: number` Vegetation density multiplier, default 1
  - `viewFog?: boolean` true: the fog distance (engine.fogFar) follows the view distance so the far chunk edge fades out; default false keeps the game's fog (openWorld() sets true)
  - `material?: Material | ((engine: Engine) => Material)` Ground material (default style.terrain.material, else the 'terrain' role with vertex colors); chunks have uv = world xz / chunk size. Cloud shadows and season tint are added

## Methods and properties
- `terrain.setViewChunks(n: number)` — Change the view distance (in chunks); fog and camera far plane adjust too
- `terrain.setDensity(d: number)` — Change the vegetation density (rebuilds all chunks)
- `terrain.rebuild()` — Rebuild all chunks
- `terrain.edit(position: PositionLike, opts: TerrainEditOptions) → { heights: number; cells: number }` — (experimental) Change the ground: dig, raise, flatten, paint the ground type. Saved gameplay state: call it from an op or a fixed step. engine.surface / slope / groundType, collision, paths and vegetation follow at once; it is saved, and chunks generated later come out edited. Example: `engine.terrain.edit(pos, { radius: 3, lower: 1.5 });                                                   // dig a pit engine.terrain.edit(pos, { shape: 'square', radius: engine.terrain.cellSize / 2, paint: 'tilled' });  // till one cell`
- `terrain.isReadyAround(position: PositionLike, opts?: { rings?: number }) → boolean` — Whether the chunks within rings rings (default 1) around position are all loaded
- Properties:
  - `T: TerrainGen` Pure-computation terrain (height, landform)
  - `CHUNK: number` Chunk edge length (meters)
  - `chunks: Map<string, any>` Loaded chunks: 'cx,cz' → chunk
  - `viewChunks: number` View distance (in chunks)
  - `density: number` Vegetation density multiplier
  - `applyBudgetMs: number` Time budget (milliseconds) for uploading chunks per frame
  - `stats: { builtThisFrame, applyMs, queued, visible?, loaded?, instances? }` Statistics (for the debug panel)
  - `cellSize: number` Grid spacing (meters) = chunkSize / resolution: edits snap to it, paint colors whole cells of this size

## Data structures
- **FlattenZone** Flattened plot (for villages, houses): center x/z, radius (meters), height optionally fixes the height
  - `x: number`
  - `z: number`
  - `radius: number`
  - `height?: number`
  - `clearRatio?: number`
