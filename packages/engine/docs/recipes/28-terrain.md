# Terrain: your own generator, digging, raising and painting the ground

Requires module `terrain()` (in the `openWorld()` preset). The API list is in `../api/terrain.md`.

The engine always does the chunks, streaming, workers, collision and vegetation. What the ground looks like (its height and type) can come from the built-in generator, your own two functions, or both, and the player can change it during play.

## 1. Your own generator
```js
import { terrain } from 'threedog';
terrain({
  // meters at (x, z); n = { fbm(x, z, octaves), noise(x, z), hash(x, z, salt), seed }
  height: (x, z, n) => 4 + 30 * n.fbm(x * 0.004, z * 0.004) - 8 * Math.abs(Math.sin(x * 0.01)),
  // a ground type name, or null to use the built-in biome rules; its colors come from biomeColors[type]
  groundType: (x, z, h, slope) => slope > 0.8 ? 'rock' : h < 1 ? 'beach' : null,
  rivers: false,
});
```
Both functions run in workers, so they are **pure**: they see only their parameters and globals like `Math`. Reading a variable from outside (`(x, z) => x * scale`) throws at `terrain()` and names the variable; put the number inside the function. Rivers and `flatten` plots still apply on top (`rivers: false` turns rivers off). A new type name needs colors: `terrain({ biomeColors: { lava: ['lavaA', 'lavaB'] }, colors: { lavaA: 0xd04010, lavaB: 0xa03008 } })`.

## 2. Changing the ground: `engine.terrain.edit`
```js
const at = { x: 12, z: 20 };
engine.ops.define('ground.dig', { args: { at: 'position' }, run(e, a) { e.terrain?.edit(a.at, { radius: 3, lower: 1.5 }); } });
engine.ops.define('ground.level', { args: { at: 'position' }, run(e, a) {
  e.terrain?.edit(a.at, { shape: 'square', radius: 6, flatten: e.surface(a.at) });   // a flat foundation at the height of its center
} });
engine.ops.run('ground.dig', { at });
```
- One of `raise` / `lower` (meters) / `flatten` (target height), and / or `paint` (a ground type, `null` gives back the generated type). `shape` is `'circle'` (default) or `'square'`, `radius` in meters.
- Edits snap to the terrain grid: heights to grid points, paint to whole cells of `engine.terrain.cellSize` meters (`chunkSize / resolution`, default 4). A shape smaller than a cell takes the nearest one. For finer paint use a higher `terrain({ resolution })` (64 gives 1 m cells); per-cell gameplay state belongs in a grid layer (section 3).
- It is saved gameplay state: call it from an op or a fixed step (in development a call from a plain button handler warns).
- Everything follows at once: the mesh, `engine.surface / slope / groundType`, character and physics collision, path rasters (`ground:change` event), and vegetation (trees and grass on edited cells are removed). Edits are saved with the save, and a chunk that unloads and comes back is generated edited (workers get the edits, so threads on and off build the same chunk).

## 3. Farming soil and ground types
Gameplay soil state (tilled, watered, crops) is **not** terrain paint: keep it in a grid layer (`grids()`, `farm.layer('soil')`), which is per cell, saved, works on levels and indoors, and draws its own tiles. See `recipes/29-grid.md` section 3.
`terrain.edit({ paint })` is for landscape ground types: roads, sand, a coarse visual layer (the built-in `'tilled'` / `'wet'` colors are for that look only). `engine.groundType(pos)` reads the painted type (footsteps, `can` checks):
```js
engine.ops.define('path.sand', { args: { at: 'position' },   // a sandy path; a new type name needs biomeColors (section 1)
  run(e, a) { e.terrain?.edit(a.at, { shape: 'square', radius: (e.terrain.cellSize ?? 4) / 2, paint: 'beach' }); } });
```

## 4. Height and snapping
Read the ground with `engine.surface(x, z)` (also `slope`, `groundType`, `waterAt`) and put an object on it with `engine.snapToGround(obj)`. Don't raycast the terrain for this: the height function is exact and works before the chunk has a mesh.
