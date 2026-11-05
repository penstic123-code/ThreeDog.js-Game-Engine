# Moving a game from 0.7 to 0.8

Names were settled before 1.0: a few were removed, a few renamed. Nothing below keeps working under its old name. The renamed uniforms warn once in development, because a stale name in shader text otherwise fails without an error.

## Uniforms

Search your shader strings as well as your JavaScript.

| 0.7 | 0.8 |
|---|---|
| `engine.uniforms.uCloudScale` | `uCloudShadowScale` (the cloud shadows on the ground) |
| `engine.uniforms.uCloudSpeed` | `uCloudShadowSpeed` |
| `uCloud` | `uWeatherCloud` |
| `uCurve` | `uSkyCurve` |
| `uCover` | `uGroundCover` |
| `uSunPower` | `uSunBrightness` |
| `uMoonPower` | `uMoonBrightness` |
| `uCloudScale`, `uCloudSpeed` on `engine.sky.uniforms`, or in `engine.sky.clouds()` and dome layer GLSL | `uSkyCloudScale`, `uSkyCloudSpeed` (the dome's clouds, the same names as on `engine.uniforms`) |

The same names apply to `uniforms(engine)` from `threedog/tsl`, `c.fx.uniform('...')`, and `#include <threedog_uniforms>`. A patch that brings its own uniform called `uCover` is yours and is left alone.

## Changed shapes

These do not fail loudly, so search for them.

| 0.7 | 0.8 |
|---|---|
| `const key = bag.add(id)`; `false` when full | `const r = bag.add(id)`: `{ ok: true, key, added }`, or `{ ok: false, code: 'full', facts }`. The result is always an object, so `if (bag.add(id))` is now `if (bag.add(id).ok)` |
| `clock.after(s, 'ev', data, { channel })` | `clock.after(s, 'ev', { data, channel })`, the same third argument as `clock.every`. The old form throws |
| `player.onStep = type => ...` | `engine.events.on('character:step', ({ character }) => ...)`, ground from `character.groundType()`. Assigning the old property does nothing but warn once in dev |
| `player.onLand = impact => ...` | `engine.events.on('character:land', ({ character, impact }) => ...)`. Assigning the old property does nothing but warn once in dev |
| `grids.get(name)`, `inventory.get(key)`, `container.get(key)`, `interactions.get(id)` return `null` when there is none | `undefined`, like every other `get`; a test `=== null` no longer matches, use `!x` |
| `settings({ presets: { high: { pixelRatio: 1.5 } } })`: a fixed ratio | A share from 0 to 1 of the ratio the engine picked for this device (`high: { pixelRatio: 1 }`); above 1 throws `bad-arg`. For a fixed ratio call `engine.setPixelRatio` |
| `settings.values` was the stored object; `settings.get('pixelRatio')` kept the last number set | `settings.values` is a read-only copy, change a value with `settings.set`; `pixelRatio` is the renderer's real ratio, the same as `describe().render.scale.current` |
| `mesh.visible` on a registered hlod mesh read `false` while far | It is your own value near and far. To ask whether the camera draws it: `mesh.layers.test(engine.camera.layers)` |

## Removed names

| 0.7 | 0.8 |
|---|---|
| `engine.rays.cast(...)`, `engine.rays.pick(...)` | `engine.raycast(...)`, `engine.pick(...)` |
| `engine.i18n.t(key)` | `engine.t(key)` |
| `engine.openWindows` | `engine.ui.isOpen(id)` |
| `engine.decoders` | set it with `createEngine({ decoders })`; it can no longer be read back |
| `EASINGS` | `ease(name)` |
| `assets.reportText(name)` | `assets.report(name)` |
| `assets.users(name)` | no replacement: it was internal |
| `player.object`, `character.object` | `.root`, the same object (`npc.object` stays) |
| `character.addTo()` | `engine.add(character.root)` for a `new Character` of your own; `createPlayer` still adds the player |
| `engine.rigid.R` | `engine.rigid.rapier` |
| `collision.circles`, `collision.boxes` | `collision.forEachStatic((type, data) => ...)` |
| `engine.stream.readyCheck(name, fn)` | `engine.stream.addReadyCheck(name, fn)` |
| `engine.music.addTracks({ a: url, b: url })` | `engine.music.define('a', url)`, one call per track; it no longer returns the music object |
| `debug.startBench()`, `debug.benchmarking`, the debug panel's stress button, `describe().debugPanel.benchmarking` | `threedog stress` |
| The types `Object3D`, `Vector3`, `Vector2`, `Color`, `Quaternion`, `Material`, `BufferGeometry`, `Texture` from `threedog` | import them from `three` |
| `threedog assets` with no verb | `threedog assets optimize` (it writes files) or `threedog assets check`. `npm run assets` becomes `npm run assets -- optimize` |
| `threedog doctor --json`: `{ healthy, items: [{ status, msg, fix }], render }` | `{ ok, summary, items: [{ level, message, fix }] }`, the shape of `check --json`. Items are the problems (`error`) and info lines (`warn`); passed lines are left out; `summary` says whether a hardware GPU is reachable |
| `engine.tick` | `engine.time.tick` |
| `engine.cpuMs`, `engine.cpuPhases` | `engine.inspect.perf()` (`cpuMs`, `cpuPhases`), `engine.budget.values().cpuMs` |
| `saves.queue(fn)` | `saves.putAttachment(group, id, blob, meta)`, `saves.removeAttachment(group, id)`; read with `saves.attachments(group)` |
| `saves.prefix` | `saves.storageKey(name)` for a key of your own |
| `userData.rayVisible = true` on a hidden object | Leave `visible` alone and put the mesh on `RESERVED_LAYERS.batched` (`threedog/layers`): not drawn, no shadows, still hit by `engine.raycast` |
| `engine.adaptive.paused` | `engine.adaptive.on = false` |
| `terrain.readyAt(p)`, `rigid.readyAt(p)` | `engine.stream.addReadyCheck` and `stateApplied` already wait on them; no game called these |
| `settings.removeSection(id)` | List the tabs you want: `settings({ sections: [...] })` |
| `engine.lightPool.stats` | `engine.describe().lightPool` |

## Renamed

The table below keeps every rename; `engine.page.held` is removed: ask `engine.frozen`, or `engine.stacks.get('freeze').has('page')` for this one holder. A page hold is now a plain freeze by owner `'page'`, so cutscene tweens and `runState` obey it, and `engine.step()` on a page in the background needs the loop stopped first, as the dev bridge already does.

| 0.7 | 0.8 |
|---|---|
| `hud.add(id, n)` | `hud.bump(id, n)` |
| `dialogue.cps` | `dialogue.charsPerSecond` (the option already had this name) |
| `rtsCamera({ angle })`, `cameraRig.angle` under that camera | `pitch`, as on the other cameras; `angle` is now refused as an unknown option |
| `weather.define(field, spec)` | `weather.defineField(field, spec)` |
| `terrain.T` | `terrain.generator` |
| `terrain.CHUNK` | `terrain.chunkSize` (`createTerrain()` keeps its own `CHUNK`) |
| `engine.pause(owner)` | `engine.haltLoop(owner)`, for tests and tools. It stops rendering too, so a game that wants to pause uses `engine.freeze` or flow `'paused'`. The `{ kind: 'test' }` option is gone |
| `engine.paused`, `describe().time.paused` | `engine.halted`, `describe().time.halted` |
| `engine.mod('pause', ...)`, `describe().holds.pause` | `engine.mod('halt', ...)`, `describe().holds.halt` |
| `runState.state` `'test-paused'`, `'paused'` | `'halted'` (the loop is stopped), `'frozen'` (a game, page or error freeze) |
| `engine.terms` | `engine.shaderTerms` |
| `engine.view` | `engine.autoView` |
| `lightPool.usage()` | `engine.describe().lightPool` |
| `terrain.isReadyAround(p)`, `rigid.groundReady(p)` | `engine.stream.addReadyCheck` and `stateApplied` already wait on them |

## Stability

`@experimental` now means one thing everywhere: the name may change or go in any version with no migration note. See "Stability" in `CONVENTIONS.md` for the list. Nothing stops working, but do not build a save format on a marked name. The printed text of commands was never an interface: read `--json`.
