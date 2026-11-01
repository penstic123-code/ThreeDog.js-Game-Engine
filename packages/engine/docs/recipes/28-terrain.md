# Terrain: your own generator, digging, raising and painting the ground

Requires module `terrain()` (in the `openWorld()` preset). The API list is in `../api/terrain.md`.

The engine always does the chunks, streaming, workers, collision and vegetation. It has **no built-in landform**: `terrain()` without a generator is
flat gray ground at y = 0, with a dev warning. The height and ground type come from your own two functions or a preset, and the player can change the
ground during play.

## 0. A ready-made generator: the noise preset
```js
import { openWorld, createTerrain } from 'threedog';
import { terrainPreset, riverAt } from '@threedog/terrain-noise';   // optional package: noise hills, rivers, biomes
engine.use(openWorld({ camera: 'follow', seed: 7, terrain: terrainPreset({ shape: 'island' }) }));   // 'hills' (default) | 'island' | 'canyon' | 'flat'
const preview = createTerrain({ seed: 7, ...terrainPreset() });                    // same heights before the engine starts
const dry = (x, z) => riverAt(x, z, preview.noise) === 0;
```
Its ground types are `beach snow rock riverbank wetland savanna forest highland meadow`; the lowpoly style pack colors them
(`style.terrain.biomeColors`), and `terrainStrings` names them for `describe()`. Other options:
`heightScale mountains rivers riverWidth biomes noise island canyon` (types in the package's `index.d.ts`).

## 1. Your own generator
```js
import { terrain } from 'threedog';
terrain({
  // meters at (x, z); n = { fbm(x, z, octaves), noise(x, z), hash(x, z, salt), seed, waterLevel, params }
  height: (x, z, n) => 4 + 30 * n.fbm(x * 0.004, z * 0.004) - 8 * Math.abs(Math.sin(x * 0.01)),
  // a ground type name (null = 'default'); its colors come from biomeColors[type]
  groundType: (x, z, h, slope) => slope > 0.8 ? 'rock' : h < 1 ? 'beach' : 'grass',
  waterLevel: 0,   // a sea at y = 0; leave it out for no water (the default is -Infinity; terrainPreset() sets 0)
});
```
The terrain moves the camera's far plane out to its view distance but leaves the fog to the game; `terrain({ viewFog: true })` makes the fog end where
the chunks end so the edge fades out (`openWorld()` turns it on).
Both functions run in workers, so they are **pure**: they see only their parameters and globals like `Math`. Reading a variable from outside
(`(x, z) => x * scale`) throws at `terrain()` and names the variable; put the number inside the function, or pass settings as plain data in
`terrain({ params })` and read them as `n.params`. `flatten` plots still apply on top. A new type name needs colors:
`terrain({ biomeColors: { lava: ['lavaA', 'lavaB'] }, colors: { lavaA: 0xd04010, lavaB: 0xa03008 } })`.

## 2. Changing the ground: `engine.terrain.edit`
```js
const at = { x: 12, z: 20 };
engine.ops.define('ground.dig', { args: { at: 'position' }, run(e, a) { e.terrain?.edit(a.at, { radius: 3, lower: 1.5 }); } });
engine.ops.define('ground.level', { args: { at: 'position' }, run(e, a) {
  e.terrain?.edit(a.at, { shape: 'square', radius: 6, flatten: e.surface(a.at) });   // a flat foundation at the height of its center
} });
engine.ops.run('ground.dig', { at });
```
- One of `raise` / `lower` (meters) / `flatten` (target height), and / or `paint` (a ground type, `null` gives back the generated type). `shape` is
  `'circle'` (default) or `'square'`, `radius` in meters.
- Edits snap to the terrain grid: heights to grid points, paint to whole cells of `engine.terrain.cellSize` meters (`chunkSize / resolution`, default
  4). A shape smaller than a cell takes the nearest one. For finer paint use a higher `terrain({ resolution })` (64 gives 1 m cells); per-cell
  gameplay state belongs in a grid layer (section 3).
- It is saved gameplay state: call it from an op or a fixed step (in development a call from a plain button handler warns).
- Everything follows at once: the mesh, `engine.surface / slope / groundType`, character and physics collision, path rasters (`ground:change` event),
  and vegetation (trees and grass on edited cells are removed). Edits are saved with the save, and a chunk that unloads and comes back is generated
  edited (workers get the edits, so threads on and off build the same chunk).

## 3. Farming soil and ground types
Gameplay soil state (tilled, watered, crops) is **not** terrain paint: keep it in a grid layer (`grids()`, `farm.layer('soil')`), which is per cell,
saved, works on levels and indoors, and draws its own tiles. See `recipes/29-grid.md` section 3.
`terrain.edit({ paint })` is for landscape ground types: roads, sand, a coarse visual layer (a painted type with no color is gray; the game names its
types and gives them colors in its own style object: `terrain.colors` + `terrain.biomeColors`). `engine.groundType(pos)` reads the painted type
(footsteps, `can` checks):
```js
engine.ops.define('path.sand', { args: { at: 'position' },   // a sandy path; a new type name needs biomeColors (section 1)
  run(e, a) { e.terrain?.edit(a.at, { shape: 'square', radius: (e.terrain.cellSize ?? 4) / 2, paint: 'beach' }); } });
```

## 4. Height and snapping
Read the ground with `engine.surface(x, z)` (also `slope`, `groundType`, `waterAt`) and put an object on it with `engine.snapToGround(obj)`. Don't
raycast the terrain for this: the height function is exact and works before the chunk has a mesh.

Look open points (color map shading, triangle cut, normals, bounds margin): `37-terrain-look-hooks.md`.
