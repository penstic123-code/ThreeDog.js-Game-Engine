# Using threedog.js (read this first)

threedog.js is a web 3D game engine on plain three.js 0.187: **core** -> **modules** (`engine.use`); all art is the game's own (its `style/` folder and
`assets.js`; without them the engine draws gray placeholders). This file is the index: one line per task, the detail is where the row points.
Paths are relative to this `docs/` folder (`node_modules/threedog/docs/`). `threedog how "<task in English>"` finds the section for a task.

## Two routes, side by side
**Looks** (materials, shaders, lights, post) are plain three.js on `engine.scene / camera / renderer`; engine look features are optional. **Coordination**
(day / night, weather, saves, who owns a value, verification) is the engine. A direct three.js write takes a value over (`THREE.md`).

## Most common mistakes
- Hand-writing a coordination system a row lists (inventory, saves, quests, grids, collision, day / night): find the row first.
- `Math.random()`, `setTimeout`, `performance.now()`, `addEventListener('keydown')` in game logic: `engine.random`, `engine.clock.after`, fixed `dt`, `input.define`.
- Changing gameplay state from a frame hook or a raw callback: do it in `onFixed`, in an op, or via `engine.nextFixed(fn)`.
- Saving positions or object references: save stable ids; `await` every `saves.*` call; a mesh a save must know about gets `engine.add(obj, { id })`.
- Editing generated docs (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`): change the code, run `npm run map`.
- Guessing a name: look it up in `api/<module>.md`; engine errors carry `err.code` / `fix` / `docs`.

## What to read, in order (stop when you have enough)
The row -> its recipe (`recipes/NN-*.md`) -> `api/<module>.md` (`API.md` index, `api/events.md`). When needed: `THREE.md` · `CONVENTIONS.md`
(several entries for one task: "One task, which entry") · `COMMANDS.md` · `PERF.md` · `CODEMAP.md`.

## One thing, one entry point (don't build another)
| To do | Use | Read (in `recipes/`) |
|---|---|---|
| New game, project layout, preset start | `npm run new-game name`, `createEngine`, `openWorld()` | 01-new-game.md |
| Put something in the scene | `engine.add(obj, { id })` | 40-scene.md |
| Game content data, packs, change an entry for good | `engine.content`, `threedog content set` | 20-content-actions-save.md |
| Reusable object definitions (prefabs) | content `templates` | 30-templates.md |
| Props, many repeated objects, static batching | content `props`, `engine.batching` | 05-props-bake.md |
| What is this thing, where is it defined | `engine.pick(x, y)`, `engine.thing(id).explain()` | 30-templates.md §5 |
| Teleport the player, far-away and saved objects, streaming | `player.placeAt`, `engine.stream.teleport`, `engine.world` | 18-world.md |
| Blender level, grass and trees | `engine.level`, `engine.vegetation` | 10-blender-level.md |
| Terrain, ground height, terrain editing | `engine.terrain`, `engine.ground` | 28-terrain.md |
| Ground up close, color borders, normals; island or world edge | `terrain({ detail, shading, shape })` | 53-ground-up-close.md, 37-terrain-look-hooks.md, 42-terrain-shape.md |
| Grid placement, plots, dig, build on cells | `engine.grids` | 29-grid.md |
| A grid field from a function or a PNG | `sampleGrid`, `engine.assets.gridFromImage` | 37-terrain-look-hooks.md §7 |
| Collision, fences, physics, vehicles | `engine.collision`, `engine.rigid` | 11-vehicles.md |
| Pathfinding, navmesh, "can walk there" | `engine.characters.findPath`, `engine.nav` | 12-navmesh.md |
| Interaction prompts, trigger zones | `engine.interactions`, `engine.triggers` | 20-content-actions-save.md |
| Ray / mouse picking, shooting, lock-on | `engine.rays`, `engine.particles` | 19-shooting-picking.md |
| NPCs and what they do, dialogue | `engine.npcs`, `engine.dialogue` | 02-npc.md |
| Barks over an NPC's head | `dialogue.say(text, { channel: 'bubble' })` | 26-ui-parts.md "Two channels" |
| Keyboard / gamepad menus, a results window | the UI choice cursor, `makeWindow` | 26-ui-parts.md "The choice cursor" |
| Replace dialogue / quests / camera / vehicle with your own | `runContract` | 55-mods-time-wrap.md "Replacing a module" |
| Items, inventory, chests, shops, gold | `engine.inventory` | 03-items-pickups.md, 22-shop-gold.md |
| Things on the ground to pick up (items, coins, health packs) | `engine.pickups` | 03-items-pickups.md |
| Quests, objective markers | `engine.quests`, `engine.hud.marker()` | 04-quests.md |
| Player and characters | `engine.player`, `createPlayer` | 13-animation.md |
| Camera: follow / third person (followCamera), first person, fixedCamera, rts; switch at runtime (setCamera) | `engine.cameraRig` | 21-camera.md |
| Action game: hp, attacks, enemy AI, drops | your ops + `world.simulate` | 32-action-game.md |
| A plain three.js idiom (where it goes, what the engine writes), own renderer | the idiom table, `createEngine({ renderer })` | 54-three-idioms.md, 50-own-renderer.md |
| Asset packs, loading, what failed | `engine.assets.manifest`, `engine.loading` | 05-props-bake.md |
| A model / texture / sound made in code | a function in the manifest | 05-props-bake.md §2a |
| Blender -> GLB art, baked textures | `threedog assets check` | 46-blender-art-route.md |
| Skeletal animation, far detail (HLOD) | `engine.assets.animate`, `engine.hlod` | 13-animation.md, 15-perf.md |
| Sound, music, ambience | `engine.audio`, `engine.music`, `engine.ambience` | 31-audio.md |
| Change any look at run time (sun, light intensity, fog, sky, post); who set it | `engine.look.<part>.set` | 52-look.md |
| The starting look: palette, materials, sky layers | the game's `style/index.js`, `engine.makeMaterial` | 09-style-pack.md, 48-make-material.md |
| Own material or shader, shader patches by slot | `look.surface.patch` | 43-shader-patches-surface-looks.md |
| Water, rain and snow shapes, snow cover | `look.water`, `look.weather` | 44-water-weather-look-hooks.md, 47-island-snow-backdrop.md |
| Shadows blurry near the camera | `look.shadow.set({ cascades })` | 45-cascaded-shadows.md |
| Environment lighting, reflections | `look.env` | 34-environment-lighting.md |
| Baked light probes, bounce light | `engine.bakeProbes` | 34-environment-lighting.md#light-probes-baked-indirect-light |
| Color grading, bloom, outline, post passes | `@threedog/post-effects`, `engine.post`, `look.post.add` | 52-look.md#post-effect-chain |
| Ambient occlusion, soft contact shadows | `look.post.set({ 'ao.enabled': true })`, `bakeVertexAO` | 52-look.md |
| Many lights (torches, lamps) | `engine.lightPool` | 09-style-pack.md §1b |
| Windows, signs, screens glow at night | `look.materials.glow` | 52-look.md |
| Set or read the time of day, day / night cycle, seasons | `engine.calendar` | 06-clock-events.md |
| Sky, weather (rain, snow, wet roads, puddles), water | `engine.sky`, `engine.weather` | 08-weather-sky.md |
| Technique examples: after your own attempt, when a shot shows a problem you cannot fix | `threedog examples list` | 52-look.md |
| New style from a reference image | `threedog style palette` | 35-style-from-reference.md |
| Player actions, UI buttons that change state | `engine.ops.define` | 23-ops.md |
| What can the player do here, and why not | `engine.catalog`, `engine.explain`, `engine.inspect`, `engine.describe` | 51-capability-catalog.md |
| Save game, load game, autosave, story flags, counters | `engine.saves.register`, `engine.vars` | 20-content-actions-save.md |
| New game / continue / back to title | `engine.session` | 07-flow-scenes-pause.md |
| Scene flow, fades, pause the game for a menu, cutscenes, tweens | `engine.flow`, `engine.freeze`, `engine.timeline` | 07-flow-scenes-pause.md |
| Timers, skip time, speed up time | `engine.clock` (`after / every`), `engine.mod('clock.rate', …)` | 06-clock-events.md |
| One value several systems change (bullet time, haste), wrap or replace a module | `engine.mod`, `engine.stacks`, `engine.time`, `engine.wrap` | 55-mods-time-wrap.md |
| Events, cause chain, randomness | `engine.events`, `engine.random` | 06-clock-events.md |
| Keys, input contexts, languages, screen UI, settings, labels, photo mode | `engine.input`, `engine.i18n`, `engine.ui`, `engine.hud`, `engine.settings`, `engine.photo` | 26-ui-parts.md |
| Drive and test the running game, MCP | the dev bridge (`verify <scenario>`) | 16-dev-bridge.md |
| Fixed camera views, the same shot before / after | `engine.views` | 46-blender-art-route.md |
| Will a save keep it | `engine.thing(id)` | 41-thing-registry.md |
| Your own module or game system | `engine.use` | 14-custom-module.md, 49-game-module-contract.md |
| Heavy loops, workers, budgets, debug panel, machine load | `engine.jobs`, `engine.threads`, `engine.commits`, `engine.budget`, `engine.debug`, `threedog stress` | 15-perf.md |
| Co-op multiplayer | `engine.net` | 27-net.md |

## When something happens -> which tool
Tools: MCP, or `node node_modules/@threedog/tools/bin/threedog.mjs <cmd>` (`COMMANDS.md`). Errors: `.threedog/errors.log`, **read first when something breaks**.
- Not sure the engine has X -> `threedog how "<task>"`, `threedog catalog [id]`.
- An action failed -> its `code`, `facts`, `nextActions`.
- What is this object, why can't I click it -> `thing(id).explain()`.
- The game seems stuck -> `describe().holds` (every pause, freeze, camera, input context, gate and mod, with its owner).
- What caused this -> `events.trace(name)`, `traceFocus(id)`.
- Placeholders (gray look, capsule, boxes) -> the look is not made yet: `style/` (recipe 09), models in code (recipe 05), tuning (recipe 35).
- The picture looks wrong -> `engine.debug.view('lighting')` (other modes: `debug.viewModes()`), `describe().look`, `threedog inspect materials`.
- Slow or stutters -> `threedog inspect perf`, `debug.view('shaderCost')`.
- "... so the engine stopped writing it" -> your direct write owns it now: `look.<part>.manual(key)` keeps it, `describe().owned` (recipe 52).
- Models made in code -> hot swap on save, `threedog gallery --shots` (recipe 05 §2c); another game's art code -> `threedog art copy`.
- Verifying a change -> `describeText()` for logic, shots for looks, `threedog verify <scenario>` (read "not proven").
- Saves or time skips broken -> `checkSave`, `checkSkip`.

## Conventions (`CONVENTIONS.md`)
- **A position is one argument**; sizes and counts go in the options object after it. **Units** are meters, Y up, north -Z; characters face +Z.
- **Registrations return a handle** (`h.remove()`). **Ready is `ready`**. **Events are `noun:action`**. **`owner`** is the name you pass; `describe()` names the `writer`.
- **Fixed step vs frame**: `onFixed` runs game time (damage, AI, timers); `onFrame` is presentation (animation, camera feel, HUD).

## Stability
May change before 1.0: `net()` · `engine.threads` · `grids()` · `terrain.edit` · `world.simulate({ worker })` · `look.post.add` · `stream.source` · `hlod()` · `ops.guard / allow`.
