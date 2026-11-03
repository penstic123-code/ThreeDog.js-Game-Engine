# Using threedog.js (read this first)

threedog.js is a web 3D game engine on plain three.js 0.187: **core** -> **modules** (`engine.use`); all art is the game's own (its `style/` folder and
`assets.js`; without them the engine draws gray placeholders). This file is an index: one short row per task, the detail is in the recipe it names.
Paths are relative to this folder, `node_modules/threedog/docs/`. `threedog how "<2-4 English task words>"` finds the section.

## Two routes, side by side
**Looks** (materials, shaders, lights, post) are plain three.js on `engine.scene / camera / renderer` first; engine look features are optional
conveniences (`THREE.md`). **Coordination** (time, weather, saves, who owns a value, verification) is the engine.

## Most common mistakes
- Hand-writing a coordination system a row lists (inventory, saves, quests, grids, collision, day / night): find the row first.
- `Math.random()`, `setTimeout`, `performance.now()`, `addEventListener('keydown')` in game logic: `engine.random.next()`, `engine.clock.after`, fixed `dt`, `input.bind`.
- Changing gameplay state from a frame hook or a raw callback: do it in `onFixed`, in an op, or via `engine.nextFixed(fn)`.
- Saving positions or object references: save stable ids; `await` every `saves.*` call; a mesh a save must know about gets `engine.add(obj, { id })`.
- Editing generated docs (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`): change the code, run `npm run map`.
- Guessing a name: look it up in `api/<module>.md`; engine errors carry `err.code` / `fix` / `docs`.
- Something broke: read `.threedog/errors.log` first; which tool answers which symptom: recipe 16 §11.

## What to read, in order
The row -> its recipe (`recipes/NN-*.md`) -> `api/<module>.md` (`API.md` index, `api/events.md`). Several entries for one task: `CONVENTIONS.md`
"One task, which entry". When needed: `THREE.md` · `COMMANDS.md` · `PERF.md` · `CODEMAP.md`.

## One thing, one entry point (don't build another)
Rows are grouped; a new API adds one short row to its group (the detail goes in the recipe).

### Project, world, content
| To do | Use | Recipe |
|---|---|---|
| New game, project layout, preset start | `npm run new-game name`, `createEngine`, `openWorld()` | 01-new-game.md |
| Put something in the scene | `scene.add(obj)`; saved: `engine.add(obj, { id })` | 40-scene.md |
| Content data, packs, change an entry for good | `engine.content`, `threedog content set` | 20-content-actions-save.md |
| Reusable object definitions (prefabs) | content `templates` | 30-templates.md |
| Props, many repeated objects, static batching | content `props`, `engine.batching` | 05-props-bake.md |
| What is this thing, where is it defined, does it persist | `engine.pick(x, y)`, `engine.thing(id).explain()` | 30-templates.md §5, 41-thing-registry.md |
| Teleport the player, far-away and saved objects, streaming | `player.placeAt`, `engine.stream.teleport`, `engine.world` | 18-world.md, 33-stream-sources.md |
| Blender level, grass and trees | `engine.level`, `engine.vegetation` | 10-blender-level.md |
| Terrain, ground height, terrain editing; a chunk failed (`terrain:chunkFailed`, `retry()`) | `engine.terrain`, `engine.ground` | 28-terrain.md |
| Replace the ground or plant look, keep collision, paths and felling | `{ replaces: 'terrain-look' \| 'vegetation-look' }` + `engine.terrain.view` / `engine.vegetation.view`; parts: `engine.terrainLook`, `engine.vegetationLook` | 28-terrain.md §6 |
| Ground up close; island or world edge | `terrain({ detail, shading, shape })` | 53-ground-up-close.md, 42-terrain-shape.md |
| Grid placement, plots, build on cells; a grid from a PNG | `engine.grids`, `sampleGrid`, `assets.gridFromImage` | 29-grid.md, 37-terrain-look-hooks.md §7 |
| Asset packs, loading, what failed; models made in code | `engine.assets.manifest`, `engine.loading` | 05-props-bake.md |
| Blender -> GLB art; fixed views before / after | `threedog assets check`, `engine.views` | 46-blender-art-route.md |

### Characters, input, UI
| To do | Use | Recipe |
|---|---|---|
| Player and characters, who steers one | `engine.player`, `createPlayer`, `engine.characters`, `engine.control` | 57-control.md, 13-animation.md |
| Keys and gamepad: actions, contexts, rebinding | `engine.input` | 58-input.md |
| Camera: follow / third person (followCamera), first person, fixedCamera, rts; switch at runtime (setCamera) | `engine.cameraRig` | 21-camera.md |
| 2D, side-scroller, orthographic; 2D lights | `presets.player.sideScroller`, example `rc2d` | 21-camera.md §6, 09-style.md §1b |
| Skeletal animation, far detail (HLOD) | `engine.assets.animate`, `engine.hlod` | 13-animation.md, 15-perf.md |
| Pathfinding, navmesh, "can walk there" | `engine.characters.findPath`, `engine.nav` | 12-navmesh.md |
| Physics (push crates, joints), collision, vehicles | `engine.collision`, `engine.rigid` | 11-vehicles.md |
| Ray / mouse picking, shooting, lock-on | `engine.rays`, `engine.particles` | 19-shooting-picking.md |
| Interaction prompts, trigger zones | `engine.interactions`, `engine.triggers` | 20-content-actions-save.md |
| NPCs and what they do, dialogue | `engine.npcs`, `engine.dialogue` | 02-npc.md |
| Barks over an NPC's head | `dialogue.say(text, { channel: 'bubble' })` | 26-ui-parts.md "Two channels" |
| UI, menus, choice cursor, HUD, languages, settings, photo mode | `engine.ui`, `makeWindow`, `engine.hud`, `engine.i18n`, `engine.settings`, `engine.photo` | 26-ui-parts.md |
| A settings row that turns off your own effect (the scene cannot turn it back on) | `engine.settings.define(key, true, { limits: 'look.post.<name>.enabled' })` | 26-ui-parts.md §6 |
| Action game: hp, attacks, enemy AI, drops | your ops + `world.simulate` | 32-action-game.md |

### Rules, state, time
| To do | Use | Recipe |
|---|---|---|
| Items, inventory, chests, shops, gold; pick up things on the ground | `engine.inventory`, `engine.pickups` | 03-items-pickups.md, 22-shop-gold.md |
| Quests, objective markers | `engine.quests`, `engine.hud.marker()` | 04-quests.md |
| Player actions, UI buttons that change state | `engine.ops.define` | 23-ops.md |
| What can the player do here, and why not | `engine.catalog`, `engine.explain`, `engine.inspect`, `engine.describe` | 51-capability-catalog.md |
| Save game, load game, autosave, story flags, counters | `engine.saves.register`, `engine.vars` | 20-content-actions-save.md |
| New game / continue, scene flow, fades, pause for a menu, cutscenes | `engine.session`, `engine.flow`, `engine.freeze`, `engine.timeline` | 07-flow-scenes-pause.md |
| Timers, read / skip time | `engine.clock` (after, every), `engine.time.now(…)` | 06-clock-events.md |
| Speed up or slow down time, bullet time | `engine.mod('clock.rate')`, `engine.mod('time.<channel>', …)` | 55-mods-time-wrap.md |
| Set or read the time of day, day / night cycle, seasons | `engine.calendar` | 06-clock-events.md |
| A value several systems change; one-holder parts; wrapping | `engine.mod`, `engine.stacks`, `provides`, `wrap` | 55-mods-time-wrap.md |
| Replace a module (dialogue, camera) | `replaces`, `runContract` | 55-mods-time-wrap.md "Replacing a module" |
| Events, cause chain, randomness | `engine.events`, `engine.random.next()` | 06-clock-events.md |
| Co-op multiplayer | `engine.net` | 27-net.md |
| Your own module or game system: declare `type` (`'rules'` game logic, `'look'` shows things, `'ui'` panels, `'world'` state that draws nothing); depend on a capability (`requires: ['inventory']`); swap an engine part (`provides` + `{ replaces }`) | `engine.use` | 14-custom-module.md, 49-game-module-contract.md |

### Looks and sound
| To do | Use | Recipe |
|---|---|---|
| Change any look at run time (sun, light intensity, fog, sky, post) | `engine.look.<part>.set` (every part: set patch add replace manual value) | 52-look.md#verbs, 38-environment-look-hooks.md |
| The starting look: palette, materials, sky layers; material per role | the game's `style/index.js`, `engine.makeMaterial`, `look.materials` | 09-style.md, 48-make-material.md, 36-sky-ground-plant-looks.md |
| Own material or shader (toon bands, outline) | `THREE.ShaderMaterial` on WebGL; optional: `look.surface.patch` | 43-shader-patches-surface-looks.md |
| WebGPU renderer, TSL node materials, WebGL fallback | `renderer: 'webgpu'`, `import 'threedog/tsl'` | 56-webgpu-tsl.md |
| Drop-in file per piece (mesh, Pass or post effect, material patch, module), no main.js line; a style folder's own plugins | `plugins/`, `engine.plugins`, `style.plugins`, `describe().slots` | 40-scene.md, 09-style.md |
| A plain three.js idiom (where it goes), own renderer | the idiom table, `createEngine({ renderer })` | 54-three-idioms.md, 50-own-renderer.md |
| Sky, weather (rain, snow, wet roads, puddles; state on `engine.weather`, particles and flash on `engine.weatherLook`) | `engine.sky`, `engine.weather` | 08-weather-sky.md |
| Water, rain and snow shapes, snow cover | `look.water`, `look.weather` | 44-water-weather-look-hooks.md, 47-island-snow-backdrop.md |
| Shadows blurry near the camera | `look.shadow.set({ cascades })` | 45-cascaded-shadows.md |
| Environment lighting, reflections, baked light probes | `look.env`, `engine.bakeProbes` | 34-environment-lighting.md |
| Post passes: grading, bloom, outline | `engine.look.post.add(pass)`; optional: `@threedog/post-effects`; one way in (plugin files too); read: `engine.post` | 52-look.md#post-effect-chain |
| Ambient occlusion, soft contact shadows | `look.post.set({ 'ao.enabled': true })`, `bakeVertexAO` | 52-look.md |
| Many lights (torches, lamps) | `engine.lightPool` | 09-style.md §1b |
| Windows, signs, screens glow at night | `look.materials.glow` | 52-look.md |
| New style from a reference image; technique examples | `threedog style palette`, `threedog examples list` | 35-style-from-reference.md |
| Reuse your own effects / models from earlier games | `threedog lib list` / `lib pull` (check before writing one) | 05-props-bake.md |
| Sound, music, ambience | `engine.audio`, `engine.music`, `engine.ambience` | 31-audio.md |

### Verify and speed
| To do | Use | Recipe |
|---|---|---|
| Something broke, looks wrong or is slow: which tool | `.threedog/errors.log`, `engine.describe`, `threedog how` | 16-dev-bridge.md §11 |
| Drive and test the running game, MCP | the dev bridge (`verify <scenario>`) | 16-dev-bridge.md |
| Slow, low fps, workers, budgets, debug panel | `engine.jobs`, `engine.threads`, `engine.commits`, `engine.budget`, `engine.debug`, `threedog stress` | 15-perf.md |

## Conventions (`CONVENTIONS.md`)
- **A position is one argument**; sizes and counts go in the options object after it. **Units** are meters, Y up, north -Z; characters face +Z.
- **Registrations return a handle** (`h.remove()`). **Ready is `ready`**. **Events are `noun:action`**. **`owner`** is the name you pass; `describe()` names the `writer`.
- **Fixed step vs frame**: `onFixed` runs game time (damage, AI, timers); `onFrame` is presentation (animation, camera feel, HUD).

## Stability
May change before 1.0: `net()` · `engine.threads` · `grids()` · `terrain.edit` · `world.simulate({ worker })` · `look.post.add` · `stream.source` · `hlod()` · `ops.guard / allow`.
