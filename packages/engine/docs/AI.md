# Using threedog.js (read first)

threedog.js: a web 3D game engine on plain three.js 0.187, **core** -> **modules** (`engine.use`); all art is the game's own (else gray placeholders).
Paths: `node_modules/threedog/docs/`. `threedog how "<2-4 English words>"`; no words: browse.

## Start by task
| The task | Where it goes |
|---|---|
| Lights, materials, models, shaders, fog, picture effects | Native three.js on `engine.scene / camera / renderer` (`THREE.md`), joined up with `onFrame`, `onRender`, `post.add` |
| Time, input, asset loading, saving, pausing, streaming | Check the engine first: rows below |
| Buying, picking up, attacking, opening doors: anything validated and recorded | `engine.ops` |
| Facts that persist, exist far away or keep changing | `engine.world`, `content` |
| Game-specific rules and looks | The game writes them; the engine coordinates (`engine.mod`) |
| Composing modules | `engine.use`, `requires` / `provides` when needed, `ctx.track`. A simple module may omit `type` |
| Troubleshooting | `describe`: state; `explain`: why; `catalog`: what exists; `inspect`: what can be done here; `thing`: one object |

**The engine lacks it?** Plain JS and three.js, joined through modules, events, ops, assets and saves, is the expected path; a small feature needs no provider protocol.

## Common mistakes
- `Math.random()`, `setTimeout`, `performance.now()`, `addEventListener('keydown')` in game logic: `engine.random.next()`, `engine.clock.after`, fixed `dt`, `input.bind`.
- Changing gameplay state from a frame hook or a raw callback: do it in `onFixed`, in an op, or via `engine.nextFixed(fn)`.
- Saving positions or object references: save stable ids; `await` every `saves.*` call; a mesh a save must know about gets `engine.add(obj, { id })`.
- Awaiting `level.load` / `content.load` in a save part's `load(data, turn)`: pass `{ turn }`, or it waits for ever.
- Editing generated docs (API.md, api/, CODEMAP, `types/generated/`): change the code, `npm run map`.
- Guessing a name: see `api/<module>.md`; errors carry `err.code` / `fix` / `docs`.

## What to read, in order
Taking over a game: `STATUS.md` first. A new feature: a row or `threedog how` -> recipe -> `api/<module>.md`. Several entries: `CONVENTIONS.md`. Also: `THREE.md`, `COMMANDS.md`; upgrading: `MIGRATING-1.0.md`.

## What exists: look here first
Recommendations. Your own code wires in time by `onFixed` and `engine.clock`, saving by `engine.saves.register`, cleanup by handles (`ctx.track`).
### Picture and sound
| To do | Use | Recipe |
|---|---|---|
| The picture in three.js (`picture/`): lights, fog, exposure, parts | `lights: false`, `engine.uniforms` | 62-picture-code.md, 34-environment-lighting.md |
| Picture, writers; try a value | `describe().picture`, `explain({ value })`, `debug.watch`, `debug.override` | 52-around-the-picture.md, 62-picture-code.md |
| Materials, textures, a module's picture | `engine.water.material` | 09-materials-lights-models.md |
| Own material or shader (toon, cel shading) | TSL (WebGPU), `ShaderMaterial` (WebGL), `rampTexture`, `celLighting` | 43-shader-patches-surfaces.md, 56-webgpu-tsl.md |
| WebGPU (new games' default), TSL node materials, WebGL fallback | `renderer: 'webgpu'`, `import 'threedog/tsl'` | 56-webgpu-tsl.md |
| three.js idioms, own renderer | the idiom table in `THREE.md`, `createEngine({ renderer })` | 50-own-renderer.md |
| Dust, smoke | `engine.particles` | 64-particles.md |
| Sky, season tints, weather, wet roads | `engine.sky`, `engine.weather`, `engine.weatherDraw` | 08-weather-sky.md |
| Water, rain / snow, snow cover (own rain: `THREE.md`) | `engine.water`, `weather({ rain, snow })` | 44-water-weather-hooks.md |
| Shadows: blur, follow, cost | `engine.shadows` | 45-cascaded-shadows.md |
| Own far, fov; clouds | `engine.autoView`, `engine.shaderTerms` | 52-around-the-picture.md |
| Environment light, reflections, probes, lightmaps, GI, culling | `engine.sky.environment`, `engine.bakeProbes`, `engine.loadLightmap`, `engine.occlusion` | 34-environment-lighting.md |
| Post passes: color grading, bloom, outline, depth, AO | `engine.post.add(pass)`, `@threedog/post-effects` | 52-around-the-picture.md#post-effect-chain, 59-depth-post-effects.md |
| Many lights (torches); windows, signs at night | `engine.lightPool`, `uNight` | 09-materials-lights-models.md §1b |
| Picture from a reference; judge | `threedog picture palette`, `threedog examples list` | 35-picture-from-reference.md, 60-judge-the-picture.md |
| Reuse effects, models of old games | `threedog lib` | 05-props-bake.md |
| Sound, music, ambience | `engine.audio`, `engine.music`, `engine.ambience` | 31-audio.md |

### Rules, state, time
| To do | Use | Recipe |
|---|---|---|
| Items, chests, shops, gold; things to pick up | `engine.inventory`, `engine.pickups` (`.material`) | 03-items-pickups.md, 22-shop-gold.md |
| Quests, objective markers | `engine.quests`, `engine.hud.marker()` | 04-quests.md |
| Player actions, UI buttons | `engine.ops.define` | 23-ops.md |
| What can the player do here, why not | `engine.inspect`, `engine.explain`, `engine.catalog` | 51-capability-catalog.md |
| Save game, load game, autosave, story flags, counters | `engine.saves.register` (`load(data, turn)`), `engine.vars` | 20-content-actions-save.md |
| New game / continue, scene flow, fades, pause for a menu, cutscenes | `engine.session`, `engine.flow`, `engine.freeze`, `engine.timeline` | 07-flow-scenes-pause.md |
| Timers, read / skip time | `engine.clock` (after, every), `engine.time.now(…)` | 06-clock-events.md |
| Slow or speed up time, bullet time | `engine.mod('clock.rate')` | 55-mods-time-wrap.md |
| Time of day, day / night, seasons | `engine.calendar` | 06-clock-events.md |
| Events, cause chain, randomness | `engine.events`, `engine.random.next()` | 06-clock-events.md |
| Multiplayer | `engine.net` | 27-net.md |

### Characters, input, UI
| To do | Use | Recipe |
|---|---|---|
| Third-person start (walk, pause, menu) | `createPlayer` | 63-third-person-start.md |
| Player, characters, who steers one | `engine.player`, `engine.characters` (`.material`), `engine.control` | 57-control.md, 13-animation.md |
| Keys, gamepad, rebinding, seats | `engine.input` | 58-input.md |
| Camera: followCamera (third person), first person, fixedCamera, rts; switch: setCamera | `engine.cameraRig`, `engine.page` | 21-camera.md |
| 2D, side-scroller, orthographic; 2D lights | `presets.player.sideScroller`; example `rc2d` | 21-camera.md §6 |
| Pixel art, pixel perfect camera | `pixelSize`, `pixelSnap` | 62-picture-code.md §4b |
| Skeletal animation | `engine.assets.animate`, `engine.hlod` | 13-animation.md, 15-perf.md |
| Pathfinding, navmesh, NPC jumps and gaps | `engine.characters.findPath`, `engine.nav` | 12-navmesh.md |
| Physics, ragdoll, collision, vehicles | `engine.collision`, `engine.rigid`, `engine.collider3d` | 11-vehicles.md |
| Ray / mouse picking, shooting, lock-on | `engine.rays` | 19-shooting-picking.md |
| Prompts, trigger zones | `engine.interactions`, `engine.triggers` | 20-content-actions-save.md |
| Press E on a mesh | `interactions.add(mesh, { once, counter })` | 03-items-pickups.md |
| Reskin UI | `createEngine({ ui: { theme } })` | 26-ui-parts.md |
| Start at a place | `?at=<place>` | 07-flow-scenes-pause.md |
| NPCs and what they do, dialogue | `engine.npcs`, `engine.dialogue` | 02-npc.md |
| Barks over an NPC | `dialogue.say(text, { channel: 'bubble' })` | 26-ui-parts.md "Two channels" |
| UI, menus, HUD, popup message, languages, settings, photo mode | `engine.ui`, `makeWindow`, `toast(engine, text)`, `engine.hud`, `engine.i18n`, `engine.settings`, `engine.photo` | 26-ui-parts.md |
| Ambient occlusion, soft shadows | `engine.post.add(ao())`, `bakeVertexAO` | 52-around-the-picture.md |
| Settings turn off my effect | `settings.define(k, true, { limits: 'post.<name>.enabled' })` | 26-ui-parts.md |
| Action game: hp, attacks, enemy AI, drops | your ops + `world.simulate` | 32-action-game.md |
| Many bullets, debris | `engine.swarm` | 65-swarm.md |
| Enemy crowds, hordes, flocks | `engine.swarm` | 65-swarm.md |

### Project, world, content
| To do | Use | Recipe |
|---|---|---|
| New game, project layout, preset start | `npx threedog init` (repo: `new-game`), `createEngine`, `openWorld()` | 01-new-game.md |
| Put something in the scene | `scene.add(obj)`; saved: `engine.add(obj, { id })` | 40-scene.md |
| Content data, packs, change an entry for good | `engine.content`, `threedog content set` | 20-content-actions-save.md |
| Reusable objects (prefabs), groups of them | `templates`, flat `props` | 30-templates.md |
| Props, many repeated objects, static batching | content `props`, `engine.batching` | 05-props-bake.md |
| What is this thing, does it persist | `engine.pick(x, y)`, `engine.explain({ thing: id })` | 30-templates.md §5, 40-scene.md |
| Teleport the player, far-away and saved objects, streaming | `player.placeAt`, `engine.stream.teleport`, `engine.world` | 18-world.md, 33-stream-sources.md |
| Blender level | `engine.level`; `engine.vegetation.define` | 10-blender-level.md |
| Terrain, height, edits | `engine.terrain`, `engine.ground` | 28-terrain.md |
| Ground picture | `engine.terrain.material`, `terrain({ detail, shape })` | 36-ground-plants.md, 53-ground-up-close.md |
| Grid placement, plots, build on cells; a grid from a PNG | `engine.grids`, `sampleGrid`, `assets.gridFromImage` | 29-grid.md, 28-terrain.md §9 |
| Assets, loading; code-made models; LOD | `engine.assets.manifest`, `.palette`, `.lod`, `engine.loading` | 05-props-bake.md, 15-perf.md |
| Blender -> GLB art; fixed views before / after | `threedog assets check`, `engine.views` | 46-blender-art-route.md |

### Composing modules
| To do | Use | Recipe |
|---|---|---|
| A value several systems change; one-holder parts | `engine.mod`, `engine.stacks`, `provides`, `wrap` | 55-mods-time-wrap.md |
| Replace a module (dialogue, camera) | `replaces`, `runContract` | 55-mods-time-wrap.md "Replacing a module" |
| Your own module: `type`, `requires`, swap a part (`provides` + `{ replaces }`) | `engine.use`, `.unuse` | 14-custom-module.md, 49-game-module-contract.md |
| Drop-in file per piece, no main.js | `plugins/`, `engine.plugins`, `describe().slots` | 40-scene.md |

### Advanced
| To do | Use | Recipe |
|---|---|---|
| Own ground or plant drawing, keep collision | `engine.terrain.view`, `engine.terrainDraw`, `engine.vegetationDraw` | 28-terrain.md §6 |
| Worker results, far records' models, raw navmesh or physics, content sections, own mover | `engine.commits`, `world.present`, `nav.query`, `rigid.world`, module `content`, `characters.kit` | 15-perf.md, 18-world.md, 12-navmesh.md, 11-vehicles.md, 14-custom-module.md, 57-control.md |

### Troubleshooting and speed
| To do | Use | Recipe |
|---|---|---|
| Broke, looks wrong or slow: which tool | `.threedog/errors.log`, `engine.describe`, `engine.explain` | 16-dev-bridge.md §11 |
| Drive and check the live game | the dev bridge (`verify <scenario>`) | 16-dev-bridge.md |
| Slow, low fps, workers, budgets | `engine.jobs`, `engine.threads`, `engine.commits`, `engine.budget`, `engine.debug`, `threedog stress` | 15-perf.md |
| Deploy | `npm run build` | 61-deploy.md |

## Conventions (`CONVENTIONS.md`)
- **A position is one argument**, then an options object. **Units** are meters, Y up, north -Z; characters face +Z.
- **Registrations return a handle** (`h.remove()`, `ctx.track` takes it). **Ready is `ready`**. **Events are `noun:action`**. **`owner`** is the name you pass.
- **`onFixed`** is game time, **`onFrame`** presentation; draw what `onFixed` moves with `engine.stepBlend`, or it stutters.

## Stability
`@experimental`: may change or go with no migration note.
