# engine.terrain — terrain(opts?: TerrainOptions)

Procedural terrain, data part (terrain() module: chunks, heights, edits, collision)

- Options `TerrainOptions` (also includes the fields of Partial<TerrainConfig>):
  - `viewChunks?: number` View distance (in chunks), default 4
  - `density?: number` Vegetation density multiplier, default 1
  - `viewFog?: boolean` true: the signal engine.uniforms.uViewDistance follows the view distance, so a game's fog can read it and fade the far chunk edge out (openWorld() sets true)
  - `material?: Material | ((engine: Engine) => Material)` Ground material (default neutral gray with vertex colors); chunks have position, normal, color and uv = world xz / chunk size. Cloud shadows, season tint and detail are added
  - `effects?: boolean` With material: false = draw it exactly as given, no cloud shadow / season / detail patch
  - `detail?: MaterialDetail | null` Detail layer over the ground: a noise, a texture asset name or your own glsl; defaults scale 0.25, strength 0.35, top-down world projection, multiply. Change it with engine.terrain.recolor({ detail })
  - `variation?: TerrainVariation` Ground color noise, baked into the chunks

## Methods and properties
- `terrain.recolor(o?: TerrainRecolor)` — Change at run time what terrain({...}) baked in. colors, biomeColors, steep, variation, shading, normals rebuild every chunk (edits stay); detail only patches the engine's material. Throws under a draw part that replaced 'terrain-draw'. Example: `engine.terrain.recolor({ colors: { grass: 0x6a8a3a }, biomeColors: { meadow: ['grass'] } });`
- `terrain.setViewChunks(n: number)` — Change the view distance (in chunks); camera far plane and, with viewFog, uViewDistance adjust too
- `terrain.setDensity(d: number)` — Change the vegetation density: plants are placed again on the loaded chunks; the ground and its collision stay
- `terrain.view(hooks: { add?, change?, remove?, show? }) → { remove(): void }` — Draw these chunks: the hooks a draw part that replaces 'terrain-draw' uses. add(c): generated (c.data holds pos / nor / col / uv / tex arrays, c.cx / c.cz the chunk); change(c): an edit rewrote c.data (same vertex count); remove(c): released; show(c, visible): in view or not. Chunks already loaded are added at once. Returns { remove() } (ctx.track it). Example: `ctx.track(engine.terrain.view({ add(c) { draw(c) }, remove(c) { undraw(c) } }))`
- `terrain.retry() → number` — Send chunks that failed every try (terrain:chunkFailed) again, e.g. after fixing what their rule reads. Returns how many were queued
- `terrain.rebuild()` — Rebuild all chunks
- `terrain.edit(position: PositionLike, opts: TerrainEditOptions) → { heights: number; cells: number }` — (experimental) Change the ground: dig, raise, flatten, paint the ground type. Saved gameplay state: call it from an op or a fixed step. engine.surface / slope / groundType, collision, paths and vegetation follow at once; it is saved, and chunks generated later come out edited. Example: `engine.terrain.edit(pos, { radius: 3, lower: 1.5 });                                                   // dig a pit engine.terrain.edit(pos, { shape: 'square', radius: engine.terrain.cellSize / 2, paint: 'tilled' });  // till one cell`
- `terrain.isReadyAround(position: PositionLike, opts?: { rings?: number }) → boolean` — Whether the chunks within rings rings (default 1) around position are all loaded
- Properties:
  - `T: TerrainGen` Pure-computation terrain (height, landform)
  - `material: Material | null` The plain three.js material every chunk draws with (null under a draw part that replaced 'terrain-draw'). The neutral one takes direct writes; setting one swaps it on every loaded chunk and draws it as given. Nothing is regenerated, collision is untouched. Chunks carry position, normal, color and uv (world xz / chunk size). Example: `engine.terrain.material = applyEffects(new THREE.MeshStandardMaterial({ vertexColors: true }), { patches: engine.terrain.patches });`
  - `patches: ShaderPatch[]` The engine's ground patches (world, clouds, season, detail), so a game material keeps them: applyEffects(mat, { patches: engine.terrain.patches })
  - `uniforms: Record<string, { value: any }>` The detail layer's { value } uniforms, written directly and live: uDetailStrength, uDetailScale, uDetailTint... ({} without a detail layer)
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
