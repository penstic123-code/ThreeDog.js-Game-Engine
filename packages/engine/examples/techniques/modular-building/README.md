Modular buildings on a grid: parameterized wall / window / door / roof / trim modules, an assembler for buildings and seeded streets, any style.

# Modular buildings (technique example)

A kit of building pieces made in code, snapped to a grid and assembled into buildings and whole streets, with the colours and materials left to
the game. The pieces are plain on purpose: the same kit draws a cozy town, a gray block-out or a cold sci-fi row by swapping one set of
materials and one set of trim profiles. Run it with `npm run dev` and open `/modular-building.html` (`?set=gray|warm|cool`, `seed=1`,
`count=10`, `view=street|close`, `batch=0|merge`). The engine never imports this folder; copy it and change anything.

## The principle
A town reads from far to near: skyline first, then the rhythm of openings, then trim, then small detail. A grid makes every piece fit every
slot, and a few repeated pieces are both cheap to draw and what makes a street look built rather than noisy. These are ways to judge your own
pieces, not fixed recipes; the numbers in `kit.js` are this example's current params, picked for a street seen from a few metres to a few dozen.

1. **Block out first: grid and silhouettes.** Decide the cell (one wall module wide) and the storey height from the player's size: block out
   with the player model (or a capsule of its size) in view, or a door that looks fine alone is too short next to the player. Then place
   plain boxes for whole buildings and look at the street from the game's camera. Height, width and roof shape are what read from far away;
   if the skyline is dull, no window detail will save it.
2. **Then modules.** Replace blank cells with windows and doors. Every module of one kind shares its outline with its neighbours (same cell
   width, same storey height, outer face on the same plane), so any module fits any slot.
3. **Then trim and detail, big to small.** Big: roof shape, floor count, overhangs. Medium: cornices and floor bands, pilasters on corners,
   awnings, signs. Small: sills, mullions, planters. Each level should still read at the distance where the player sees it; detail smaller
   than a few pixels on screen costs triangles and turns into noise or shimmer.
4. **One texture language.** Pick one way surfaces get their pattern (flat colour, vertex AO, one kind of canvas mask) and use it everywhere.
5. **Change style by swapping, not rewriting.** A style is a set of materials plus trim cross-sections plus window variants.
6. **Variation from a few choices, not continuous noise.** Pick each trait from a short list (floors, width, roof, window variant, trim
   profile, door position, shop front) with a seeded random, and mirror upper floors around the middle so facades look designed. A few
   variants keep geometry shared while no two neighbours repeat; a random size per window makes every window unique (noise, and nothing
   batches). A street of one window reads as copy-paste.
7. **Facades follow the inside.** A door on a side wall facing another building, or windows where an interior wall would be: if the game
   has interiors, derive facades from the floor plan.

How to judge it: a shot at the game's real camera, not a close-up. Does the skyline vary? Do neighbours differ? Does any detail shimmer or
vanish at that distance? Does anything flicker at seams when the camera moves?

## Plain three.js
- Pieces: `BoxGeometry`, `RoundedBoxGeometry` (addon), and trim strips as an `ExtrudeGeometry` of a `Shape` cross-section
  ([ExtrudeGeometry](https://threejs.org/docs/#api/en/geometries/ExtrudeGeometry)). Each module a `Group` placed at integer cell offsets.
- Many copies: [InstancedMesh](https://threejs.org/docs/#api/en/objects/InstancedMesh) per repeated piece
  ([webgl_instancing_performance](https://threejs.org/examples/#webgl_instancing_performance)), or
  [BatchedMesh](https://threejs.org/docs/#api/en/objects/BatchedMesh) for mixed geometries sharing a material
  ([webgl_mesh_batch](https://threejs.org/examples/#webgl_mesh_batch)).
- Merging: `mergeGeometries` from [BufferGeometryUtils](https://threejs.org/docs/#examples/en/utils/BufferGeometryUtils) gives one draw per
  material, at the cost of culling and per-piece edits.
- Seams: avoid coplanar faces; if one is unavoidable, `material.polygonOffset` is the last resort, not the plan.

## Style routes
- **Gray block-out**: boxes and `.` cells only; judges silhouette and scale before any art. Cheapest.
- **Cozy / storybook**: soft cove trims, rounded edges, warm slot materials, awnings and planters. More trim strips (one-off geometry).
- **Cold sci-fi / brutalist**: hard stepped trims, flat roofs, faintly emissive frames. Fewer pieces, more repetition.
- **Low-poly flat**: flat colour per slot, vertex AO for depth, no textures. Very cheap.
- **Hand-painted / textured**: one texture set per slot from a DCC tool, the kit only for layout. Texture memory instead of geometry.
- **Merged hero block**: a fixed set piece merged once for the fewest draws, when it never changes.

## The engine helper (optional convenience)
`kit.js` is the kit: modules, assembler, manifest entries; it imports only `three` and `three/addons`. `main.js` is the demo page; it builds the
same seed three times (gray block-out, warm with soft cove trims, cool with hard stepped trims and faintly emissive frames; the two coloured
sets are demo values, not advice). In the kit, the block-out stage is `facade` strings of `.` (blank walls) and `roof`. A style is the slot
materials (`wall`, `trim`, `roof`, `frame`, `glass`, `accent`, `awning`, `sign`) plus `profiles` plus `windows`. The only textures are gray
masks (awning stripes, sign text) tinted by the slot material's colour, so a material swap recolours them too. `street` mirrors upper floors
and picks traits with a seeded `rng`.

```js
import { createModularKit, PROFILES, WINDOWS } from './kit.js';
const kit = createModularKit({
  slots: { wall, trim, roof, frame, glass, accent, awning, sign },   // the game's materials; only wall is required, the rest fall back
  cell: 2, storey: 3, wall: 0.2,                                    // grid cell, floor height, wall thickness (metres)
  profiles: PROFILES, windows: WINDOWS,                              // trim cross-sections and window variants: swap them per style
  ao: { bake: bakeVertexAO, samples: 24 },                           // optional: threedog's bakeVertexAO per module (slots then need vertexColors)
});
engine.assets.manifest(kit.pack);              // mb-wall, mb-window, mb-door, mb-corner, mb-trim, mb-gable, mb-flatRoof, mb-awning,
                                               // mb-sign, mb-chimney, mb-building, mb-street; all { build, params }
// content/props.js: { model: ['mb-street', { seed: 7, count: 12 }], x: 0, z: 0 }   or   { model: ['mb-building', { floors: 3 }], ... }
const b = kit.building({ width: 3, depth: 2, floors: 2, front: 'SDS/WWW', back: 'W.W', roof: 'gable', trim: 'cove', sign: 'BAKERY' });
const s = kit.street({ seed: 7, count: 10, gap: 1 });
s.userData.batch = true; engine.scene.add(s);   // opt in to engine.batching (recipe 05, 2b)
engine.scene.add(kit.merge(s));                 // or: one mesh per material (see costs)
kit.modules.window({ width: 1.1, height: 1.5, sill: 0.8, mullions: 2, planter: true });   // any single module as a Group
```
- Each module is a `Group` with one mesh per slot (pieces of the same slot are merged), identity transforms, geometry shared by every copy
  with the same params. `userData.module = { type, side, floor, i }` names each placed module; the wall slab mesh is named `wall`.
- Because every piece is a registered `{ build, params }` entry, `threedog gallery` shows each module on a turntable, saving `kit.js` swaps
  the pieces in a running game, and `?panel=1` drags the params (`threedog tune write` writes them back).
- `kit.dispose()` frees the geometries, textures and textured materials it made; the slot materials are the game's.

Costs (seed 1, 10 buildings, 960x540, `npm run shot`, 2026-11-02). Draw calls as `describe().perf` counts them (the shadow pass included),
about 74k triangles in every case:

| | draw calls |
|---|---|
| plain meshes (`?batch=0`) | 1377 |
| `engine.batching` (`userData.batch = true`, the default page) | 308 |
| `kit.merge` (`?batch=merge`) | 24 |

- `engine.batching` instances meshes that repeat at least 8 times in a 64 m cell: windows, walls, corners. What stays single is one-off
  geometry: each building's roof and trim strips (their length is the building's), signs. Fewer distinct sizes = fewer draws.
- `kit.merge` gives one draw per material, but the whole merged street is drawn whenever any of it is on screen, and single pieces can no
  longer be moved or swapped. Merge per block (a few buildings) in a large town so culling still works.
- Rounded edges use `RoundedBoxGeometry` with one segment (108 triangles per piece instead of 300 with two): a chamfer with smooth normals
  catches the same highlight, and sills / pilasters / copings repeat hundreds of times.
- This kit's 4 cm mullions are fine up close and vanish or shimmer a few dozen metres away: size each level of detail for your camera.

Rules (correctness):
- **Every facade module spans exactly one cell and one storey, with its outer face at module z = 0**, details in front (+z), the slab behind.
  A module that breaks this leaves gaps or overlaps that the assembler cannot fix.
- **Building origins land on whole cells** (`street` places each building at an integer cell offset). Off-grid origins break the snapping
  the spec checks.
- **A facade row has one letter per footprint cell** (`W` window, `S` shop window with awning, `D` door, `.` blank); rows are separated by `/`,
  ground floor first, and the last row repeats upward. A wrong length or a door above the ground floor throws, naming the side.
- **No two visible faces share a plane.** Two faces in one plane flicker when the camera moves; never rely on "same colour, nobody will
  notice". Where pieces meet, either one covers the seam (corner pilasters cover the wall ends; front / back trims run past the corners,
  side trims stop at the walls) or they are offset by a few millimetres (the sill top sits above the reveal floor).
- **Generators get every input from `params`.** The slot materials are live objects, so the kit's manifest entries are `cache: false`
  (the dev cache would otherwise keep a model built with old materials). To bake a street, make the slots `makeMaterial` roles inside the
  generator instead (recipe 05, section 2a) and drop `cache: false`.

Limits:
- Footprints are rectangles of cells (`width` x `depth`); an L-shaped building needs `building` extended to take a cell list (two buildings
  with `gap: 0` meet wall to wall, and their corner pilasters then overlap).
- Gable ridges run along the building's width; hip roofs, dormers and balconies are not in the kit (each is one more module).
- The test is `npm test -- "modular building"` (tests/specs/modular-building.mjs): determinism per seed, grid snapping without gaps,
  shared geometry, batching under 400 draw calls, params changing shape, the optional AO pass.

Sources: written for this example; no code copied. Background: the grid-snapped kit of reusable pieces is common modular level design practice
(Joel Burgess, "Skyrim's Modular Approach to Level Design", GDC 2013); `RoundedBoxGeometry` and `mergeGeometries` are three.js addons.
