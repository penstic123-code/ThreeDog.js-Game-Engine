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

## 0.7.0 to 0.7.1

Nothing public was removed. A few things now behave differently:

| 0.7.0 | 0.7.1 |
|---|---|
| a `model()`, `texture()` or `font()` awaited while the engine was disposed could reject or resume | the promise stays pending for good, and so does any later call: code after that `await` does not run, so put teardown work in your dispose path, not after the `await` |
| a load ended by `release`, `trim`, a palette write or registering the name again could write its result back | its result is freed when it arrives; code awaiting it gets a fresh load |
| `release('shrub')` on a name that fell back to `rock` touched `rock`'s data | a name that fell back holds no data: release `rock`, and `users('rock')` counts the copies of `shrub` too |
| a mesh dropped while its material stayed in use held memory on WebGPU | the engine sweeps these every few seconds, also after plain `scene.remove`, so calls you added to work around it can go; `threePatches.off('webgpu-record-sweep')` turns it off |
| `assets optimize` put the optimized pack anywhere in `assets.js` | it comes last, so `/optimized/x.glb` wins over an original of the same name; the next run moves an older game over |
| `assets optimize --strict` or a lower `--budget` skipped cached models | cached models count like fresh ones, so a run that passed may now fail |
| | `threedog check` has new rules: R52 (captured twice) and R53 (merge conflict markers in a tracked file); the dev warning `geometry-undisposed` asks for `geometry.dispose()` on a mesh gone for good |

## Unreleased

| Before | Now |
|---|---|
| `sky({ moonSize })`, `sky({ starScale })`, `sky({ gradientCurve })`, `sky({ orbitTilt })`, `sky({ orbitSway })` | throw `sky-option` naming where to write: `engine.uniforms.uMoonSize.value`, `uStarScale.value`, `uCurve.value`, `engine.sky.orbit.tilt`, `engine.sky.orbit.sway` (plain values after `engine.use(sky())`; defaults unchanged) |
| two manifest entries naming each other as `fallback` waited on each other for good | the load fails once with `asset-fallback-cycle`, naming the chain |

- `interaction.use` no longer answers `noKey`. With no key it runs when code asks, `ops.list({ available: true })` leaves it out, and `interaction-no-key` is a dev warning. Code that read `code === 'noKey'` reads `engine.input.isUnbound(action)`.
- A class instance in a saved `world` record (`Vector3`, `Color`, `Map`) now throws `world-plain` in dev at `world.add` / `world.set`. Write `{ x, y, z }`, or add the record with `{ save: false }`. `position` stays free.
- `engine.sky.sunDir` is now the same vector as `engine.uniforms.uSunDir`, and a direct write stays. Code that wrote it and relied on the next frame undoing it calls `engine.view.manual('sunDir', false)`.
- `applyState` no longer rejects for `season` with no calendar or an `at` nothing knows: read `refused`. The `state-at` code is gone.
- `engine.sky.environment()` called twice replaces the first instead of throwing. `sky({ time })` with a calendar warns instead of throwing.
- A game's `check` no longer fails on file size, its own docs, a stale GAMEMAP, a module with no key, or startup creation. A CI step that relied on one of these reads the warnings.
