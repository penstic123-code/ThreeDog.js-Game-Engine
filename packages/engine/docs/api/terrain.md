# engine.terrain — terrain(opts?: TerrainOptions)

Procedural terrain, data part (terrain() module: chunks, heights, edits, collision)

- Options `TerrainOptions` (also includes the fields of Partial<TerrainConfig>):
  - `viewChunks?: number` View distance (in chunks), default 4
  - `density?: number` Vegetation density multiplier, default 1
  - `viewFog?: boolean` true: the fog distance (look.fog far, engine layer, owner 'terrainLook') follows the view distance so the far chunk edge fades out; default false keeps the game's fog (openWorld() sets true)
  - `material?: Material | ((engine: Engine) => Material)` Ground material (default style.terrain.material, else the 'terrain' role with vertex colors); chunks have uv = world xz / chunk size. Cloud shadows and season tint are added
  - `effects?: boolean` With material: false = draw it exactly as given, no cloud shadow / season / detail patch (same as look.ground.replace(m, { effects: false }))

## Methods and properties
- `terrain.setViewChunks(n: number)` — Change the view distance (in chunks); fog and camera far plane adjust too
- `terrain.setDensity(d: number)` — Change the vegetation density: plants are placed again on the loaded chunks; the ground and its collision stay
- `terrain.view(hooks: { add?, change?, remove?, show? }) → { remove(): void }` — Draw these chunks: the hooks a look that replaces 'terrain-look' uses. add(c): generated (c.data holds pos / nor / col / uv / tex arrays, c.cx / c.cz the chunk); change(c): an edit rewrote c.data (same vertex count); remove(c): released; show(c, visible): in view or not. Chunks already loaded are added at once. Returns { remove() } (ctx.track it). Example: `ctx.track(engine.terrain.view({ add(c) { draw(c) }, remove(c) { undraw(c) } }))`
- `terrain.retry() → number` — Send chunks that failed every try (terrain:chunkFailed) again, e.g. after fixing what their rule reads. Returns how many were queued
- `terrain.rebuild()` — Rebuild all chunks
- `terrain.edit(position: PositionLike, opts: TerrainEditOptions) → { heights: number; cells: number }` — (experimental) Change the ground: dig, raise, flatten, paint the ground type. Saved gameplay state: call it from an op or a fixed step. engine.surface / slope / groundType, collision, paths and vegetation follow at once; it is saved, and chunks generated later come out edited. Example: `engine.terrain.edit(pos, { radius: 3, lower: 1.5 });                                                   // dig a pit engine.terrain.edit(pos, { shape: 'square', radius: engine.terrain.cellSize / 2, paint: 'tilled' });  // till one cell`
- `terrain.isReadyAround(position: PositionLike, opts?: { rings?: number }) → boolean` — Whether the chunks within rings rings (default 1) around position are all loaded
- Properties:
  - `T: TerrainGen` Pure-computation terrain (height, landform)
  - `CHUNK: number` Chunk edge length (meters)
  - `voidY: number` terrain({ shape }) only: below this height the player or a moving rigid body has fallen out of the world (one terrain:void per fall). shape.voidY, else 50 m under the lowest island chunk loaded so far; -Infinity without a shape. Example: `engine.events.on('terrain:void', ({ who }) => { if (who === engine.player) engine.player.placeAt(home); });`
  - `chunks: Map<string, TerrainChunk>` Loaded chunks: 'cx,cz' → chunk
  - `viewChunks: number` View distance (in chunks)
  - `density: number` Vegetation density multiplier
  - `applyBudgetMs: number` Time budget (milliseconds) for uploading chunks per frame
  - `stats: { builtThisFrame, applyMs, queued, failed, visible?, loaded?, … }` Statistics (for the debug panel); failed = chunks that failed every try (terrain:chunkFailed)
  - `cellSize: number` Grid spacing (meters) = chunkSize / resolution: edits snap to it, paint colors whole cells of this size

## Data structures
- **FlattenZone** Flattened plot (for villages, houses): center x/z, radius (meters), height optionally fixes the height
  - `x: number`
  - `z: number`
  - `radius: number`
  - `height?: number`
  - `clearRatio?: number`
