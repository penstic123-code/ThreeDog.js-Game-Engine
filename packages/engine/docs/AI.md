# Using threedog.js (read this first)

threedog.js is a web 3D game engine on top of three.js 0.187 (plain three.js, no React): **core** (every game needs it) -> **modules** (installed on
demand with `engine.use`) -> **style pack** (all art, an optional separate package; the engine ships none and draws gray placeholders without one).
This file is the index for the AI that builds a game on the engine. Paths are relative to this `docs/` folder (`node_modules/threedog/docs/`).

## Most common mistakes
- Hand-writing a system the table lists (inventory, saves, quests, grids, collision): find the row first.
- `Math.random()`, `setTimeout`, `performance.now()` in game logic: use `engine.random`, `engine.clock.after / every`, fixed `dt`.
- `addEventListener('keydown')` for gameplay: define an action with `input.define` and read it in the fixed step.
- Changing gameplay state from a frame hook or a raw callback: do it in `onFixed`, in an op, or via `engine.nextFixed(fn)`.
- Saving positions or object references: save stable ids; `await` every `saves.*` call.
- A mesh added with plain `scene.add` and no id: `engine.add(obj, { id })` is what makes it saveable and inspectable.
- Changing a look by editing `renderer` / `scene.fog` / materials directly, or in logic: `engine.look.<part>` (recipe 52), values in the style pack.
- Putting game content (dialogue, quests, items, layout) inside the engine package: it lives in the game's `content/`.
- Editing generated docs (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`): change the code, run `npm run map`.
- Guessing a name: look it up in `api/<module>.md`; an engine error carries `err.code` / `err.fix` / `err.docs`.

## What to read, in order (stop when you have enough)
1. This file: find the task in the entry table below.
2. The recipe the row points to (`recipes/NN-*.md`): how to do the task, with a working pattern.
3. `api/<module>.md` for signatures, options and data shapes (`API.md` is the index, `api/events.md` the events).
4. The game's own `GAMEMAP.md` (generated): what this game has, and "Read for this game".
5. When needed: `CODEMAP.md` · `THREE.md` (what the engine lacks: use three.js) · `PERF.md` · `COMMANDS.md` · `CONVENTIONS.md`.

What can I do here: `threedog catalog`, `threedog how "<task>"` (ranks these rows and recipes for a task in your own words).

## One thing, one entry point (don't build another)
Three outward concepts: **Scene** (what is in the world; content packs are part of it), **Assets** (models, textures, sounds, fonts),
**Style** (the look; material roles are labels inside it). Patches, ops and world records are the scene's inner machinery.

### Scene
| To do | Use | Recipe |
|---|---|---|
| New game, project layout, canvas inside a page or editor panel | `npm run new-game name`, `createEngine({ canvas, style })`, `engine.use(...)`, `engine.start()` | `recipes/01-new-game.md` |
| Preset parts on / off, blank game | `openWorld({ camera: 'follow', sky: {...}, debug: false })`, `new-game name --blank` | `recipes/01-new-game.md` |
| Put something in the scene | `engine.add(obj, { id })`, `engine.spawn(name, at)`, content props | `recipes/40-scene.md` |
| Game content data, content packs | `engine.content.load(data, { places })`, `load([base, dlc])`, rules in `content/rules.js` | `recipes/20-content-actions-save.md` |
| Reusable object definitions (prefabs) | content `templates`; props `{ template, x, z }` | `recipes/30-templates.md` |
| Props, many repeated objects, delete an object, static batching | content `props` / `vegetation`, `engine.remove(obj)`, `engine.batching` (`batch: false`, `tint`) | `recipes/05-props-bake.md` |
| What is this thing, where is it defined (point -> id) | `engine.pick(x, y).thing`, `engine.world.origin(id)`, `engine.thing(id).explain()` | `recipes/30-templates.md` §5 |
| Saved / far-away objects, the player record, stream in, teleport | `engine.world`, `player.placeAt()`, `engine.stream.add / teleport / source` | `recipes/18-world.md` |
| Blender level, grass and trees without terrain | `engine.level`, `npm run assets -- check`, `vegetation({ area })`, `engine.vegetation.rebuild()` | `recipes/10-blender-level.md` |
| Terrain generator, ground height, terrain editing | `terrain({ height, groundType })`, `terrainPreset()`, `engine.surface(x, z)`, `engine.ground`, `engine.terrain.edit()` | `recipes/28-terrain.md` |
| Ground color borders, mesh cut, lighting normals | `terrain({ shading: 'texture', colorResolution, normals, diagonal })` | `recipes/37-terrain-look-hooks.md` |
| Island, floating rock, world with an edge | `terrain({ shape: { mask, edge, side, bottom } })`, `engine.ground.has`, event `terrain:void` | `recipes/42-terrain-shape.md` |
| Grid placement, per-cell soil state | `engine.grids.add / define`, ops `grid.place / move / remove` | `recipes/29-grid.md` |
| Collision, fences, rivers, physics, vehicles | `engine.collision` (`addSegment`, `addBlocked`, `lineClear`), `engine.rigid` | `recipes/11-vehicles.md` |
| Pathfinding, navmesh, "can walk there" | `engine.characters.findPath`, `engine.nav`, `createEngine({ movement })` | `recipes/12-navmesh.md` |
| Interaction prompts (talk, pick up, open a door or chest), trigger zones | `engine.interactions`, `interactions({ ...presets.interactions.nearest })`, `engine.triggers` | `recipes/20-content-actions-save.md` |
| Ray / mouse picking, shooting, lock-on | `engine.raycast / pick`, `engine.rays.addStatic`, `engine.entities`, `engine.particles` | `recipes/19-shooting-picking.md` |
| NPCs and what they do, dialogue | content `npcs` (`behavior`), `engine.npcs.behavior`, content `dialogues`, `engine.dialogue` | `recipes/02-npc.md` |
| Items, pickups, inventory, chests, shops, gold | content `items` / `pickups`, `engine.inventory` (`container`, `transfer`), currency item + ops | `recipes/03-items-pickups.md`, `22-shop-gold.md` |
| Quests, objective markers | content `quests`, `engine.quests`, `engine.hud.marker()` | `recipes/04-quests.md` |
| Player and characters | `engine.player`, `engine.characters.createPlayer({ ...presets.player.thirdPerson, model })` | `recipes/13-animation.md` |
| Camera, orthographic camera | `openWorld({ camera })` (required), `engine.setCamera(...)`, `engine.cameraRig`, `engine.takeCamera` | `recipes/21-camera.md` |
| Action game: hp, attacks, enemy AI, drops | your ops + `world.simulate` + `inventory.spawnPickup`; `examples/action/` | `recipes/32-action-game.md` |
| Use three.js directly, own renderer, no default lights | `engine.scene / renderer / camera`, `createEngine({ lights: false, renderer })` | `recipes/40-scene.md` §8, `50-own-renderer.md` |

### Assets
| To do | Use | Recipe |
|---|---|---|
| Art assets, asset packs, fonts, loading, what failed | `engine.assets.manifest({ models, textures, sounds, fonts })`, `engine.loading`, `threedog loading` | `recipes/05-props-bake.md` |
| Real art assets: Blender -> GLB, baked textures | `threedog assets check [--against old.glb]`, `engine.assets.manifest({ models })` | `recipes/46-blender-art-route.md` |
| Skeletal animation, far detail (HLOD) | `engine.assets.animate(model, config)`, `anim.sync`, `character.onPose(fn)`, `engine.hlod` | `recipes/13-animation.md`, `15-perf.md` |
| Sound, buses, ambience, music, footsteps | `createEngine({ audio })`, `engine.audio.sfx(name)`, `engine.ambience`, `engine.music` | `recipes/31-audio.md` |

### Style and look
| To do | Use | Recipe |
|---|---|---|
| Change any look at run time: tone, lights, fog, sky, clouds, shadow, wind, ground, water, weather, post | `engine.look.<part>.set / patch / replace` (`engine.catalog('look')`); own plain three.js: when to | `recipes/52-look.md`, `40-scene.md` §8 |
| Set the starting look: pack, materials, mixing packs, exposure, sky layers | style pack (`style: [lowpoly, { sky }]`), `engine.makeMaterial('role', {...})`, `style.palette`, `postAdd` / `postRemove` | `recipes/09-style-pack.md`, `36-sky-ground-plant-looks.md`, `48-make-material.md` |
| Material and lighting shader patches, toon ramp, wind, fog hooks | `applyEffects`, `look.surface.patch`, `look.wind.patch`, `look.fog.patch` | `recipes/43-shader-patches-surface-looks.md`, `38-environment-look-hooks.md` |
| Water depth / foam, rain and snow shapes, own weather particles, snow cover, backdrop | `look.water`, `look.weather`, `style.weather.snow.cover`, `style.sky.backdrop` | `recipes/44-water-weather-look-hooks.md`, `47-island-snow-backdrop.md` |
| Shadows too blurry near the camera; shadow type | `look.shadow.set({ cascades: 3, type })` | `recipes/45-cascaded-shadows.md`, `15-perf.md` |
| Environment lighting (PBR reflections, HDR) | `look.env.replace('sky' | asset)`, `look.env.set({ intensity })`\| asset })`, `look.env` | `recipes/34-environment-lighting.md` |
| Color grading, grain, vignette, DOF, outline, bloom | `@threedog/post-effects`, `postAdd(vignette())`, `engine.post`, `look.post.set` | `recipes/09-style-pack.md`, `52-look.md` |
| Many lights (torches, lamps, muzzle flashes) | `lightPool({ point })`, `engine.lightPool.add(obj, { color, intensity, distance, flicker })` | `recipes/09-style-pack.md` |
| Day, night, seasons, sky, weather, water, isDay | `engine.sky` (`at / between / daily / onSeason`), `engine.weather`, `engine.water` | `recipes/08-weather-sky.md` |
| Who set tone / post / lights; why does it look like this | `engine.describe().look` (value, by, at), `describe().render`, `debug.view('albedo'\|'lighting'\|'shadow'\|'normals')` | `recipes/52-look.md`, `16-dev-bridge.md` |
| New style from a reference image | `threedog style palette <image>`, `npm run new-style`, `style check`, `style compare <ref> <shot>` | `recipes/35-style-from-reference.md` |

### Rules and flow
| To do | Use | Recipe |
|---|---|---|
| Player actions, UI buttons that change state | `engine.ops.define('noun.verb', { can, run, undo })`, `ops.run(name, args)` | `recipes/23-ops.md` |
| What can this game do (modules, ops, saves, time) | `engine.catalog(id?)`, `threedog catalog [id]` | `recipes/51-capability-catalog.md` |
| Why can't / what can the player do here | `engine.explain(...)`, `engine.inspect(at?)`, `describeText()`, scenario tests | `recipes/23-ops.md` |
| Story flags, counters | `engine.vars` (`setFlag / flag / bump / counter`, saved) | `recipes/20-content-actions-save.md` |
| Saves: save game, load game, progress, slot, autosave, 存档 | `engine.saves.register(key, { save, load })`, `saves.autosave(minutes)` | `recipes/20-content-actions-save.md` |
| New game / continue / back to title / retry | `await engine.session.newGame() / load(slot)`, `quit()`, `session.track(h)` | `recipes/07-flow-scenes-pause.md` |
| Scene flow, fades, pausing, cutscenes, tweens | `engine.flow`, `fadeScreen(engine, to, s)`, `engine.pause(owner)`, `engine.timeline.tween` | `recipes/07-flow-scenes-pause.md` |
| Time, timers, skipping time | `engine.clock` (`after / every`), `await engine.skip({ to: '06:00' })`, `checkSkip`, `checkSave` | `recipes/06-clock-events.md` |
| Events, cause chain, randomness | `engine.events.on / emit`, `engine.random` (saved), `events.trace(name)`, `traceFocus(id)` | `recipes/06-clock-events.md` |
| Keys, input contexts, open / interact key; text and languages (`engine.t`, `engine.i18n`) | `input.define('action', keys, label)`, `engine.input.push('menu')`, `input.simulate` | `recipes/26-ui-parts.md` |
| Screen UI parts, Esc layering, settings menu, labels over the world, photo mode | `createEngine({ ui })`, `engine.ui.set`, `engine.hud`, `engine.settings`, `worldToScreen()`, `engine.photo` | `recipes/26-ui-parts.md` |
| Drive and test the running game | dev bridge: `applyState`, `defineState`, `status`, `verify <scenario>`, `scene --hidden`, `state`, `step`, `skip` | `recipes/16-dev-bridge.md` |
| Fixed camera views, same shot before / after | `engine.views.define`, `shot --view name --compare` | `recipes/46-blender-art-route.md` |
| Drive the game from an MCP client | `claude mcp add threedog -- npx threedog mcp` | `recipes/16-dev-bridge.md` §10 |
| Will a save keep it; hide / recolor on screen only | `engine.add(obj, { id })`, `engine.thing(id)`, ops `thing.set / remove`, `debug.override(owner, id, {...})` | `recipes/41-thing-registry.md` |
| Your own module, own game system (crop, machine) | `{ name, install, fixed, frame, describe, afterLoad }`, `engine.use`; `before` / `after`, `critical`; save, `skip` hook, ops `can` | `recipes/14-custom-module.md`, `49-game-module-contract.md` |
| Heavy loops, workers; performance budget, debug panel | `engine.jobs.add`, `engine.threads.lane`, `engine.commits`, `engine.budget`, `engine.debug.panel`, `threedog capture` | `recipes/15-perf.md` |
| Co-op multiplayer | `engine.use(net({ role, transport }))`, `engine.net` | `recipes/27-net.md` |

## Commands
Drive the running game with the MCP tools or `node node_modules/@threedog/tools/bin/threedog.mjs <cmd>` (avoid npx: +2.5 s per call); details
in `COMMANDS.md`. `npm run dev` · `npm run check` (after every change) · `npm test -- name` (related tests only) · `npm run map` (after code,
JSDoc or content changes). Browser errors go to `.threedog/errors.log`: **read it first when something breaks**.

## Verification rules for AI
1. Order: `npm run map` -> `npm run check` -> the related tests.
2. Check logic with `describeText()`, not screenshots; screenshots only for what the eye must judge. Ops run through the bridge change this
   session only; a lasting change is an edit to `content/*.js`. `main.js` sets `window.engine = engine` before `start()`.

## Conventions (detailed in `CONVENTIONS.md`)
- **A position is one argument** (Vector3, Object3D, `[x, y, z]` or `{ x, z }`); sizes and counts go in the options object after it.
- **Registrations return a handle**; `h.remove()` undoes it. **Ready is the boolean `ready`**. **Event names are `noun:action`**.
- **Fixed step vs frame**: `onFixed` runs game time (damage, AI, timers); `onFrame` is presentation (animation, camera feel, HUD).
- **The engine owns** sky lights, fog and the camera every frame: see CONVENTIONS "Adjusting sky brightness".
- **Units** are meters, Y up, north -Z; characters face +Z. **Errors say how to fix it**: an old form throws with the fix.

## Stability
Tested but may change before 1.0: `net()` · `engine.threads` · `grids()` · `terrain.edit` · `world.simulate({ worker })` · `look.post.add` · `stream.source` · `hlod()` · `ops.guard / allow`.
