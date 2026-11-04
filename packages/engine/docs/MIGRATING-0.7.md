# Moving a game from 0.6 to 0.7

## Light probes: every pixel takes its own light

`engine.bakeProbes` now builds three's probe grid, so the one scene light that followed a point is gone. Bake or load the same way; lit materials pick the grid up by themselves.

| 0.6 | 0.7 |
|---|---|
| `bakeProbes({ follow })`, `loadProbes(json, { follow })` | delete it: every pixel inside the grid has its own light |
| `bakeProbes({ height: 1.5 })` (one layer over the ground) | `bounds` around the ground and the air above it; a grid is a box, and needs 2 layers an axis |
| `probes.probe`, `probes.own()` | `probes.grid`, a plain three.js light; a light of your own from `probes.sample(pos, myProbe)` as before |
| `probes.probe.intensity` | `probes.grid.intensity` on WebGPU; on WebGL three ignores it, so change the light you bake, or the exposure |
| a probe file from 0.6 (version 1) | refused with `probes-data`: bake again (the file is now half precision, about a third of the size) |
| objects anywhere got the light of the follow point | outside the grid there is no probe light: size `bounds` to the scene (`describe().render.probes.outside`) |

## Removed from the public surface

| 0.6 | 0.7 |
|---|---|
| `engine.level.object` | `engine.level.root` (the same object) |
| `engine.inventory.defs` | `engine.inventory.item(id)` for one definition; not in the types any more |
| `engine.quests.defs` | `engine.quests.list()`; not in the types any more |
| `engine.triggers.action`, `engine.settings.action`, `engine.interactions.action` | the option you passed to `triggers()`, `settings()`, `interactions()` |

## Follow camera and characters

| 0.6 | 0.7 |
|---|---|
| `collision({ cameraOcclusion })` defaulted to colliders only | the default is `'both'`: meshes added with `engine.rays.addStatic(mesh, { occluder: true })` and level buildings stop the camera arm too; `cameraOcclusion: 'colliders'` keeps the old test |
| `character.placeAt` over a prop or platform ignored it | it stands on a registered support (recipe 32 says what a support needs) |
| `mover: 'manual'` skipped the `states` hook | it runs the `states` hook (recipe 57, "Moved by script") |

## Layers 26 to 29 and 31 are reserved

The engine keeps these three.js layers for itself (`RESERVED_LAYERS` from `threedog/layers`). A game's own layers are 1 to 25; move anything of yours on layers 26 to 28 down. Layer 30 stays the default camera `hideLayer`.

## Starting a game

`threedog new-game --example` and `templates/example` are gone: start from `new-game` itself, and read the engine's `examples/` for finished techniques.
