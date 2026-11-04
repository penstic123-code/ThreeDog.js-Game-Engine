# Crisp ground color borders, terrain normals, height from a grid

For an AI that wants the ground to look a way the defaults do not: crisp color borders (a river bank, a path edge), a coarse low-poly mesh with
fine color, a different triangle cut, custom lighting normals, height read from a grid or image. Terrain basics are in `28-terrain.md`, ground
color noise in `36-sky-ground-plants.md`, the ground up close (detail, variation, symptoms) in `53-ground-up-close.md`. Each knob names its
default (`tests/specs/terrain-draw.mjs` pins them). Each knob has three exits: a parameter, a small pure function, or replacing the whole ground material.

## Why the bank is jagged: color lived on the mesh
With `shading: 'smooth'` or `'flat'` a color is computed at a grid point (or triangle center) and blended across the triangle. At the default
`resolution: 16` on a 64 m chunk that is one color sample per 4 m, so any border between two ground types can only run along triangle edges.
Raising `resolution` fixes it at the price of triangles (and collision, and edit granularity). `shading: 'texture'` cuts the link: color is
computed per pixel into a per-chunk image, the mesh stays as coarse as you like.

## 1. `shading: 'texture'` (and `colorResolution`)
```js
engine.use(terrain({ ...terrainPreset(), shading: 'texture', colorResolution: 128 }));
```
- A worker computes a `(colorResolution + 2)^2` RGBA image per chunk with the same rules as the vertex colors (`faceColor`: ground type from your
  `groundType`, `biomeColors` two-color noise blend, `steep` slope colors, `variation` blend / jitter / patches, painted cells).
  The main thread uploads it as a `DataTexture` (sRGB, mipmaps, anisotropy 4). The `+ 2` is a 1 pixel border computed from world coordinates, so
  neighboring chunks hold identical values at the seam and no seam shows (checked byte for byte).
- Vertex colors are plain white in this mode (they carry no color). The material samples the image by world xz (the `world` patch), so `uv`
  stays free (`world xz / chunk size`, for your own textures). Each chunk gets its own clone of the terrain material (same patches, one compiled
  program), so a change you make to the terrain material object after chunks exist does not reach loaded chunks; pass it through `terrain({ material })`.
- Painted cells (`terrain.edit(..., { paint })`) keep their whole-cell color; the image of every chunk touched by an edit is re-uploaded in place.
- Steep-slope colors test a normal interpolated between grid points, so they no longer follow single triangles either.
- Independent of `resolution`: `resolution` still sets mesh, collision and edit granularity, `colorResolution` only the color detail
  (64 m chunk: 128 = 0.5 m per pixel, 256 = 0.25 m).

Numbers (resolution 16, 64 m chunk, a curved ground-type border, rendered top-down in the real engine, error against the true curve):

| shading | border RMS error | border jaggedness (RMS 2nd difference) |
| --- | --- | --- |
| smooth | 1.12 m | 0.48 |
| texture, colorResolution 128 | 0.14 m | 0.10 |

Cost (software-rendered machine, relative values only):
- worker time per chunk: about 9 ms for `texture` at 128 (calculation is mostly your `groundType` called once per pixel) against 1.1 ms for smooth
  (measured in Node, the worker runs the same code); 64 costs a quarter, 256 four times that.
- memory: 130 x 130 x 4 = 68 KB per chunk plus mipmaps (about 90 KB; 23 KB at 64). 69 loaded chunks = about 6 MB at 128.
- `threedog perf --only=stream --shading=texture` against the default: frame CPU average 5.5 ms both; worst frame 64 ms -> 88 ms (one-time shader
  program compile plus first uploads, it lands once, not per chunk); upload stage total 41 ms -> 112 ms over 69 chunks.
- Low-tier devices (`engine.tier === 'low'`, see `core/tier.js`): if you did not set `colorResolution`, the terrain module uses 64 there. To skip the
  color map completely on low tier, choose the shading yourself: `shading: engine.tier === 'low' ? 'smooth' : 'texture'` in your terrain() call.
- With `terrain({ shape })` (an outline, `42-terrain-shape.md`) the map covers the top only: void pixels keep the color of the ground under them
  (no seam at the rim) with alpha 0, and island sides and bottom draw with vertex colors (or `shape.side.material`).

## 2. Lighting normals: `normals` and `normalFn`
- `shading: 'smooth'` lights with one normal per grid point, `'flat'` one per triangle. In texture mode choose: `normals: 'smooth'` (default) or
  `'flat'` (faceted light, fine color: a low-poly shape with crisp borders).
- `normalFn(i, j, h, cell) => [nx, ny, nz]` replaces the smooth normal at grid point `(i, j)`; `h(i, j)` reads a grid-point height, `cell` is the
  spacing in meters. Pure like `height` / `groundType` (only its parameters, `Math`; a function you pass travels to workers as source text and an
  outside variable throws naming it). The engine normalizes the result. Default: central difference of the four neighbors.
```js
terrain({ normalFn: (i, j, h, cell) => [(h(i - 1, j) - h(i + 1, j)) / cell, 4, (h(i, j - 1) - h(i, j + 1)) / cell] })   // gentler lighting on slopes
```
`normals` and `normalFn` change light only, never height or collision. `engine.terrain.recolor({ normals: 'flat' })` changes it at run time (rebuilds the chunks).

## 3. `diagonal`: how a cell is cut into triangles
```js
terrain({ diagonal: 'adaptive' })   // 'fixed' (default) | 'adaptive' | 'alternate'
```
`fixed` cuts every cell the same way. `adaptive` cuts along the diagonal with the smaller height difference, which removes
the zigzag ridges a fixed cut leaves on a slope; `alternate` flips every other cell (no directional bias on flat low-poly facets). `engine.surface`,
collision and vegetation heights follow the chosen cut, so nothing floats. It changes the walkable shape, so `recolor` does not take it.

## 4. `boundsPad`: the chunk bounding sphere margin
`boundsPad: { up: 3, radius: 8 }` (meters, the defaults) is the margin of the culling sphere: the center is raised by `up`, the radius grows
by `radius`. Raise it if a shader moves vertices far (wind on tall ground cover, a vertex-displacement patch) and chunks pop out at the screen edge.

## 5. Relation to `variation`
`variation` shapes *what* color a point gets; `shading` decides *where* it is evaluated. In vertex modes every variation is limited to cell size; in
texture mode it is sampled per pixel, so `patches: { size: 20, levels: 4 }` gives hard-edged color blocks, and a `jitter.size` below the pixel size
(0.5 m at `colorResolution: 128`) comes out as one grain per pixel, coarser than asked. Choosing a combination, and ground that looks wrong up close: recipe 53.

## 6. Example: a river bank
```js
engine.use(terrain({
  shading: 'texture', colorResolution: 192, resolution: 16,
  height: (x, z) => 0,
  // the border is a curve; the ground type is evaluated per pixel
  groundType: (x, z) => z > 32 + 14 * Math.sin(x * 0.09) ? 'grass' : 'sand',
  colors: { grass: 0x5a8a3a, sand: 0xd8c690 }, biomeColors: { grass: ['grass'], sand: ['sand'] },
}));
```
Using a preset (`riverAt` of `@threedog/terrain-noise`) the same switch gives crisp banks without more triangles: `terrain({ ...terrainPreset(), shading: 'texture' })`.

## 7. Height from a grid or image
`sampleGrid(data, { width, height, size | cellSize, origin, interp })` turns numbers laid out on a regular grid into a function `(x, z) => value`;
`await engine.assets.gridFromImage(nameOrUrl, { channel, range, bits })` reads such a grid from an image (PNG at full 8 or 16 bits, jpg/webp at 8;
`channel` is `'r'`/`'g'`/`'b'`/`'a'`; `range: [min, max]` maps the pixel values to world units, default `[0, 1]`). Samples sit on the grid nodes, so
`width` samples span `width - 1` cells; outside the grid the edge value is used, or `outside: v`. The grid is just a field: height, moisture, a
ground-type weight, spawn density, a walkable mask, danger, travel cost.

`interp` is the picture between nodes; none of them is the right one:
- `'nearest'`: flat steps, one value per cell. Terraces, blocky or voxel-like ground, tile masks, numbers that are ids.
- `'linear'` (default): plain bilinear blend; smooth enough for most fields, never leaves the range of its four corners.
- `'cubic'`: smooth slopes without cell creases (rolling hills, soft gradients). It can overshoot beside a sharp step; `clamp: true` keeps the
  result inside the four corner values.

```js
const g = await engine.assets.gridFromImage('/maps/height16.png', { range: [-5, 60] });   // meters, 16-bit file
const heightAt = sampleGrid(g.data, { ...g, size: [512, 512], origin: [-256, -256], interp: 'cubic', clamp: true });
heightAt(10, 20);                                                    // gameplay side: where to put a camp, a mine, a lighthouse
const wet = sampleGrid(moisture, { width: 32, height: 32, cellSize: 8 });   // a hand-made field: wetter ground grows reeds, rice, moss
const walk = sampleGrid(mask, { width: 64, height: 64, cellSize: 1, interp: 'nearest', outside: 0 });   // 0 / 1 per tile; off the map: not walkable
```
A terrain `height` function is recompiled in a worker and cannot capture `heightAt`, so the terrain reads the same image through its own
`heightmap` (bilinear, centered on `center`): `terrain({ heightmap: { ...g, size: [512, 512], min: -5, max: 60 } })` with `g` from `gridFromImage`
using the default `range` (it expects 0-1 values; `min`/`max` scale them). Use `sampleGrid` for everything outside the terrain module; when you need
a picture the terrain's bilinear read does not give (terraces: `nearest`), bake it into the data first or write the step in a `height` function.

## Whole replacement
Anything beyond this: `terrain({ material })` (or `engine.terrain.material = m`) swaps the ground material and `engine.terrain.T.buildChunk(cx, cz)` returns the
raw arrays (`pos`, `nor`, `col`, `uv`, and `tex: { data, size }` in texture mode) if you build chunk meshes yourself.
