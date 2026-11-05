# Using threedog.js (read first)

threedog.js is a web 3D game engine on plain three.js 0.187: **core** -> **modules** (`engine.use`); all art is the game's own (its `picture/` folder and
`assets.js`; without them: gray placeholders).
Paths: `node_modules/threedog/docs/`. `threedog how "<2-4 English words>"` finds the section.

## Two routes
**Picture** (materials, shaders, lights) is plain three.js on `engine.scene / camera / renderer` first (`THREE.md`). **Engineering** (saves, pause, menus, input, camera, time, checks) is the engine.
New games start on WebGPU with TSL (recipe 56). With no WebGPU the same game runs on three's WebGL2 backend, slower; `describe().renderer` says why. TSL-only effects (`voxelGI`, `temporalAA`, `sunShafts`, `lightVolumes`): `@threedog/post-effects/tsl`. Imports: recipe 52.

## Most common mistakes
- Hand-writing a system a row lists: find the row.
- `Math.random()`, `setTimeout`, `performance.now()`, `addEventListener('keydown')` in game logic: `engine.random.next()`, `engine.clock.after`, fixed `dt`, `input.bind`.
- Changing gameplay state from a frame hook or a raw callback: do it in `onFixed`, in an op, or via `engine.nextFixed(fn)`.
- Saving positions or object references: save stable ids; `await` every `saves.*` call; a mesh a save must know about gets `engine.add(obj, { id })`.
- Editing generated docs (API.md, api/, CODEMAP, `types/generated/`): change the code, `npm run map`.
- Guessing a name: look it up in `api/<module>.md`; errors carry `err.code` / `fix` / `docs`.

## What to read, in order
The row -> its recipe (`recipes/NN-*.md`) -> `api/<module>.md`. Several entries for one task: `CONVENTIONS.md`. When needed: `THREE.md` · `COMMANDS.md` · `MIGRATING-0.8.md`.


## One thing, one entry point (don't build another)
### Project, world, content
| To do | Use | Recipe |
|---|---|---|
| New game, project layout, preset start | `npx threedog init` (repo: `new-game`), `createEngine`, `openWorld()` | 01-new-game.md |
| Put something in the scene | `scene.add(obj)`; saved: `engine.add(obj, { id })` | 40-scene.md |
| Content data, packs, change an entry for good | `engine.content`, `threedog content set` | 20-content-actions-save.md |
| Reusable objects (prefabs), groups of them | `templates`, flat `props` | 30-templates.md |
| Props, many repeated objects, static batching | content `props`, `engine.batching` | 05-props-bake.md |
| What is this thing, does it persist | `engine.pick(x, y)`, `engine.thing(id).explain()` | 30-templates.md §5, 40-scene.md |
| Teleport the player, far-away and saved objects, streaming | `player.placeAt`, `engine.stream.teleport`, `engine.world` | 18-world.md, 33-stream-sources.md |
| Blender level | `engine.level`; `engine.vegetation.define` | 10-blender-level.md, 05-props-bake.md §2e |
| Terrain, height, edits | `engine.terrain`, `engine.ground` | 28-terrain.md |
| Own ground or plant drawing, keep collision | `{ replaces: 'terrain-draw' }`, `engine.terrain.view`, `engine.terrainDraw`, `engine.vegetationDraw` | 28-terrain.md §6 |
| Ground picture | `engine.terrain.material`, `.recolor`, `terrain({ detail, shading, shape })` | 36-ground-plants.md, 53-ground-up-close.md, 28-terrain.md §5 |
| Grid placement, plots, build on cells; a grid from a PNG | `engine.grids`, `layer.material`, `sampleGrid`, `assets.gridFromImage` | 29-grid.md, 28-terrain.md §9 |
| Asset packs, loading; code-made models; far detail | `engine.assets.manifest`, `.palette`, `.lod`, `engine.loading` | 05-props-bake.md, 15-perf.md |
| Blender -> GLB art; fixed views before / after | `threedog assets check`, `engine.views` | 46-blender-art-route.md |

### Characters, input, UI
| To do | Use | Recipe |
|---|---|---|
| Third-person start (walk, pause, menu) | `createPlayer` | 63-third-person-start.md |
| Player, characters, who steers one | `engine.player`, `engine.characters` (`.material`), `engine.control` | 57-control.md, 13-animation.md |
| Keys, gamepad: actions, contexts, rebinding | `engine.input` | 58-input.md |
| Camera: follow / third person (followCamera), first person, fixedCamera, rts; switch live (setCamera) | `engine.cameraRig`, `engine.page` | 21-camera.md |
| 2D, side-scroller, orthographic; 2D lights | `presets.player.sideScroller`; 2D lights: example `rc2d` | 21-camera.md §6, 09-materials-lights-models.md §1b |
| Pixel art | plain three.js | 62-picture-code.md §4b |
| Skeletal animation | `engine.assets.animate`, `engine.hlod` | 13-animation.md, 15-perf.md |
| Pathfinding, navmesh, "can walk there" | `engine.characters.findPath`, `engine.nav` | 12-navmesh.md |
| Physics (crates, joints, ragdoll), collision, vehicles | `engine.collision`, `engine.rigid` | 11-vehicles.md |
| Ray / mouse picking, shooting, lock-on | `engine.rays` | 19-shooting-picking.md |
| Prompts, trigger zones | `engine.interactions`, `engine.triggers` | 20-content-actions-save.md |
| Press E on a mesh | `interactions.add(mesh, { once, counter })` | 03-items-pickups.md |
| Reskin UI | `createEngine({ ui: { theme } })` | 26-ui-parts.md |
| Start at a place | `?at=<place>` | 07-flow-scenes-pause.md |
| NPCs and what they do, dialogue | `engine.npcs`, `engine.dialogue` | 02-npc.md |
| Barks over an NPC | `dialogue.say(text, { channel: 'bubble' })` | 26-ui-parts.md "Two channels" |
| UI, menus, HUD, popup message, languages, settings, photo mode | `engine.ui`, `makeWindow`, `toast(engine, text)`, `engine.hud`, `engine.i18n`, `engine.settings`, `engine.photo` | 26-ui-parts.md |
| A settings row that turns off your own effect | `engine.settings.define(key, true, { limits: 'post.<name>.enabled' })` | 26-ui-parts.md §6 |
| Action game: hp, attacks, enemy AI, drops | your ops + `world.simulate` | 32-action-game.md |
| Many bullets, debris with rules | `engine.swarm` | 65-swarm.md |
| Enemy crowds, hordes, flocks | `engine.swarm` | 65-swarm.md |

### Rules, state, time
| To do | Use | Recipe |
|---|---|---|
| Items, chests, shops, gold; things to pick up | `engine.inventory`, `engine.pickups` (`.material`) | 03-items-pickups.md, 22-shop-gold.md |
| Quests, objective markers | `engine.quests`, `engine.hud.marker()` | 04-quests.md |
| Player actions, UI buttons | `engine.ops.define` | 23-ops.md |
| What can the player do here, why not | `engine.catalog`, `engine.explain`, `engine.inspect`, `engine.describe` | 51-capability-catalog.md |
| Save game, load game, autosave, story flags, counters | `engine.saves.register`, `engine.vars` | 20-content-actions-save.md |
| New game / continue, scene flow, fades, pause for a menu, cutscenes | `engine.session`, `engine.flow`, `engine.freeze`, `engine.timeline` | 07-flow-scenes-pause.md |
| Timers, read / skip time | `engine.clock` (after, every), `engine.time.now(…)` | 06-clock-events.md |
| Slow or speed up time, bullet time | `engine.mod('clock.rate')`, `engine.mod('time.<channel>', …)` | 55-mods-time-wrap.md |
| Time of day, day / night, seasons | `engine.calendar` | 06-clock-events.md |
| A value several systems change; one-holder parts | `engine.mod`, `engine.stacks`, `provides`, `wrap` | 55-mods-time-wrap.md |
| Replace a module (dialogue, camera) | `replaces`, `runContract` | 55-mods-time-wrap.md "Replacing a module" |
| Events, cause chain, randomness | `engine.events`, `engine.random.next()` | 06-clock-events.md |
| Multiplayer | `engine.net` | 27-net.md |
| Your own module: `type`, `requires`, swap a part (`provides` + `{ replaces }`) | `engine.use`, `.unuse` | 14-custom-module.md, 49-game-module-contract.md |

### Picture and sound
| To do | Use | Recipe |
|---|---|---|
| The picture in three.js (`picture/`): lights, fog, exposure, parts | `lights: false`, `engine.uniforms` | 62-picture-code.md, 34-environment-lighting.md |
| Read the picture, its writers; try a value | `describe().picture`, `debug.override(owner, obj, key, value)` | 52-around-the-picture.md, 62-picture-code.md |
| Materials, textures, a module's picture | `engine.water.material` | 09-materials-lights-models.md |
| Own material or shader (toon, cel shading) | TSL (WebGPU), `ShaderMaterial` (WebGL), `rampTexture`, `celLighting` | 43-shader-patches-surfaces.md, 56-webgpu-tsl.md |
| WebGPU renderer, TSL node materials, WebGL fallback | `renderer: 'webgpu'`, `import 'threedog/tsl'` | 56-webgpu-tsl.md |
| Drop-in file per piece, no main.js | `plugins/`, `engine.plugins`, `describe().slots` | 40-scene.md |
| three.js idioms, own renderer | the idiom table in `THREE.md`, `createEngine({ renderer })` | 50-own-renderer.md |
| Dust, smoke | `particles({ effects })`, `engine.particles` | 64-particles.md |
| Sky (`replace`, `clouds`, `layer`, `keyframes`), season tints, weather, wet roads | `engine.sky`, `engine.weather`, `engine.weatherDraw` | 08-weather-sky.md |
| Water, rain / snow, snow cover | `engine.water`, `weather({ rain, snow })`, `weather.defineField` | 44-water-weather-hooks.md |
| Shadows: blur, follow, cost | `engine.shadows.cascades(light)`, `.box(light)`, `.budget(light)`, `.cache(light, { static })`, `.mapSize(light, n)`, `.enabled` | 45-cascaded-shadows.md |
| Own far, fov; clouds | `engine.autoView`, `engine.shaderTerms` | 52-around-the-picture.md |
| Environment light, reflections, probes, lightmaps, GI, culling | `engine.sky.environment`, `engine.bakeProbes`, `engine.loadLightmap`, `engine.occlusion` | 34-environment-lighting.md |
| Post passes: color grading, bloom, outline, depth | `post.add(pass)`: `lut`, `paletteLut`, `outline` of `@threedog/post-effects` | 52-around-the-picture.md#post-effect-chain, 59-depth-post-effects.md |
| Ambient occlusion, soft shadows | `engine.post.add(ao())`, `bakeVertexAO` | 52-around-the-picture.md |
| Many lights (torches); windows, signs at night | `engine.lightPool`, `uNight` | 09-materials-lights-models.md §1b |
| Picture from a reference; judge | `threedog picture palette`, `threedog examples list` | 35-picture-from-reference.md, 60-judge-the-picture.md |
| Reuse effects, models of old games | `threedog lib list` / `lib pull` | 05-props-bake.md |
| Sound, music, ambience | `engine.audio`, `engine.music`, `engine.ambience` | 31-audio.md |

### Verify and speed
| To do | Use | Recipe |
|---|---|---|
| Something broke, looks wrong or is slow: which tool | `.threedog/errors.log`, `engine.describe`, `threedog how` | 16-dev-bridge.md §11 |
| Drive and check the live game | the dev bridge (`verify <scenario>`) | 16-dev-bridge.md |
| Slow, low fps, workers, budgets | `engine.jobs`, `engine.threads`, `engine.commits`, `engine.budget`, `engine.debug`, `threedog stress` | 15-perf.md |
| Deploy | `npm run build` | 61-deploy.md |

## Conventions (`CONVENTIONS.md`)
- **A position is one argument**; sizes and counts go in the options object after it. **Units** are meters, Y up, north -Z; characters face +Z.
- **Registrations return a handle** (`h.remove()`). **Ready is `ready`**. **Events are `noun:action`**. **`owner`** is the name you pass; `describe()` names the `writer`.
- **Fixed step vs frame**: `onFixed` runs game time (damage, AI, timers); `onFrame` is presentation (animation, HUD). Draw what `onFixed` moves with `engine.stepBlend`, or it stutters.

## Stability
`@experimental` on a name: it may change or go with no migration note (list: `CONVENTIONS.md`, "Stability").
