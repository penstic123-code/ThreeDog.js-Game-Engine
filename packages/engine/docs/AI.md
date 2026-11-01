# Using threedog.js (read this first)

threedog.js is a web 3D game engine on top of three.js 0.187 (plain three.js, no React): **core** (every game needs it) -> **modules** (installed on
demand with `engine.use`) -> **style pack** (all art, an optional separate package; the engine ships none and draws gray placeholders without one).
This file is the index for the AI that builds a game on the engine. Paths are relative to this `docs/` folder (`node_modules/threedog/docs/`).

**Before writing gameplay code**, look for the system in the entry table below (inventory, collision, saves, quests, grids, templates... already
exist). Hand-write a system only when no row fits.

## What to read, in order (stop when you have enough)
1. This file: find the task in the entry table below.
2. The recipe the row points to (`recipes/NN-*.md`): how to do the task, with a working pattern.
3. `api/<module>.md` for signatures, options and data shapes (generated from JSDoc; `API.md` is the index, `api/events.md` the events).
4. The game's own `GAMEMAP.md` (generated): what this game has, and "Read for this game".
5. When needed: `CODEMAP.md` (engine files, event emitters / listeners) · `THREE.md` (what the engine lacks: use three.js) · `PERF.md` ·
   `COMMANDS.md` (commands, scenarios, folders) · `CONVENTIONS.md` (the conventions below in detail).

Generated docs (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`) are never edited by hand; after changing code run `npm run map`.

## One thing, one entry point (don't build another)
Three outward concepts: **Scene** (what is in the world, where, how you interact; content packs are part of it: `recipes/40-scene.md`), **Assets**
(models, textures, sounds, fonts: `recipes/05-props-bake.md` §3b), **Style** (the look; material roles are labels inside it: `recipes/09-style-pack.md`).
Patches, ops and world records are the scene's inner machinery.

### Scene
| To do | Use | Recipe |
|---|---|---|
| New game, project layout | `npm run new-game name`, `createEngine({ canvas, style })`, `engine.use(...)`, `engine.start()` | `recipes/01-new-game.md` |
| Canvas in a page section or editor panel | the canvas's CSS box decides (pointer, pick, UI follow it) | `recipes/01-new-game.md` §5 |
| Preset parts on / off | `openWorld({ camera: 'follow', sky: {...}, debug: false })` | `recipes/01-new-game.md` |
| Put something in the scene (two doors, one scene) | plain `engine.add(obj, { id })`, or a template: `engine.spawn(name, at)` (needs `content()`) / content props | `recipes/40-scene.md` |
| Game content data, content packs | `engine.content.load(data, { places })` or `load([base, dlc])`; own data kinds in `content/rules.js` | `recipes/20-content-actions-save.md` |
| Reusable object definitions (prefabs) | content `templates` (model + collision + op + defaults); place with props `{ template, x, z }` or `engine.spawn(name, pos)` | `recipes/30-templates.md` |
| A few props / many repeated objects, deleting objects | content `props` / `vegetation` (`engine.vegetation`), `engine.remove(obj)` | `recipes/05-props-bake.md` |
| What is this thing, where is it defined (point -> id) | `engine.pick(x, y).thing`, `engine.world.origin(id)` / `idOf(obj)`, `npx threedog pick x,y`, MCP `pick` | `recipes/30-templates.md` §5 |
| Many copies of one static model | automatic `engine.batching`; opt out `batch: false`, recolor one `engine.batching.tint(obj, color)` | `recipes/05-props-bake.md` §2b |
| Saved / far-away objects, the player record | `engine.world` (`present` near, `simulate` far), `player.placeAt()` | `recipes/18-world.md` |
| Stream in, teleport, what is loaded where | `engine.stream.add({ position, build })`, `await engine.stream.teleport(p)`, `engine.stream.source(...)` | `recipes/18-world.md` |
| Blender level | `engine.level`; check a level file first with `npm run assets -- check` | `recipes/10-blender-level.md` |
| Grass and trees without terrain | `vegetation({ area })`, rule `biomes` by ground type, `engine.vegetation.rebuild()` | `recipes/10-blender-level.md` §4 |
| Terrain generator, ground height, terrain editing | `terrain({ height, groundType })` or `terrainPreset()` (`@threedog/terrain-noise`; none = flat), `engine.surface(x, z)`, `engine.ground`, `engine.terrain.edit()` | `recipes/28-terrain.md` |
| Ground color borders (river banks), mesh cut, lighting normals | `terrain({ shading: 'texture', colorResolution, normals, normalFn, diagonal, boundsPad })` | `recipes/37-terrain-look-hooks.md` |
| Grid placement, per-cell soil state | `engine.grids.add / define`, ops `grid.place / move / remove` | `recipes/29-grid.md` |
| Collision, physics, vehicles | `engine.collision`, `engine.rigid` (Rapier; `rigid({ treeRadius })` limits tree colliders) | `recipes/11-vehicles.md` |
| Pathfinding, navmesh, "can walk there" | `engine.characters.findPath(from, to)`, `engine.nav`, `createEngine({ movement })` | `recipes/12-navmesh.md` |
| Interaction prompts (talk, pick up, open) | `engine.interactions` (`interactions({ ...presets.interactions.nearest })` or `{ pick, keys }`) | `recipes/20-content-actions-save.md` |
| Trigger zones | content `triggers`, `engine.triggers` | `recipes/20-content-actions-save.md` |
| Ray / mouse picking, shooting, lock-on | `engine.raycast / pick`, `engine.rays.addStatic(obj)`, `engine.entities`, `engine.particles`, `pickTarget` | `recipes/19-shooting-picking.md` |
| NPCs and what they do | content `npcs` (`behavior`: `schedule` / `wander`), `engine.npcs.behavior(name, { near, far })` | `recipes/02-npc.md` |
| Dialogue | content `dialogues`, `engine.dialogue` | `recipes/02-npc.md` |
| Items, pickups, inventory | content `items` / `pickups`, `engine.inventory` | `recipes/03-items-pickups.md` |
| Chests, corpses, shelves, transfers | `engine.inventory.container(id, { capacity, items })`, `inventory.transfer(from, to, item, n)` | `recipes/22-shop-gold.md` |
| Shops, gold | currency item + ops | `recipes/22-shop-gold.md` |
| Quests, objective markers | content `quests` (a step's `target` is marked automatically), `engine.quests`, `engine.hud.marker()` | `recipes/04-quests.md` |
| Player and characters | `engine.player`, `engine.characters.createPlayer({ ...presets.player.thirdPerson, model })` | `recipes/13-animation.md` |
| Camera | `openWorld({ camera })` (required), `engine.setCamera(...)`, `engine.cameraRig` | `recipes/21-camera.md` |
| Action game: hp, attacks, enemy AI, drops, death (no combat rules in the engine) | your ops (`player.attack`) + `world.simulate` + `inventory.spawnPickup`; `examples/action/` | `recipes/32-action-game.md` |

### Assets
| To do | Use | Recipe |
|---|---|---|
| Art assets, asset packs, fonts, loading, what failed | `engine.assets.manifest({ models, textures, sounds, fonts })` (a pack: lowpoly's `assets`), `engine.loading`, `npx threedog loading` | `recipes/05-props-bake.md` |
| Skeletal animation | `engine.assets.animate(model, config)`, mapping as data on the manifest entry, `anim.sync`, `anim.check` | `recipes/13-animation.md` |
| Far detail (HLOD) | `engine.hlod` | `recipes/15-perf.md` |
| Sound, buses, ambience rules, music, footsteps, ducking | `createEngine({ audio })`, `engine.audio.sfx(name)`, `engine.ambience`, `engine.music`; as content data: pack `audio: {...}` with `when` | `recipes/31-audio.md` |

### Style
| To do | Use | Recipe |
|---|---|---|
| Look, materials, post-processing, mixing packs | style pack (`createEngine({ style })`, e.g. `@threedog/style-lowpoly`, or parts `style: [lowpoly, { sky }]`), `engine.makeMaterial('role', {...})`, `style.palette`, `postAdd` / `postRemove`, `engine.post`, `engine.uniforms`; surface feel in a material spec: texture names (`map`, `normalMap`…), `detail`, `lighting`, toon `ramp`. **A material role name is free: invent a new one; the engine warns only on a name that looks like a typo of a known role** | `recipes/09-style-pack.md`, `recipes/43-shader-patches-surface-looks.md` |
| An island / floating rock / a world with an edge | `terrain({ shape: { mask, edge, side, bottom } })`; outside it `engine.surface` is `-Infinity`, check `engine.ground.has(x, z)`; falling out fires `terrain:void`, you handle respawn | `recipes/42-terrain-shape.md` |
| Real art assets (Blender model, baked textures, GLB) | Blender → GLB → `threedog assets check` → `engine.assets.manifest({ models })` | `recipes/46-blender-art-route.md` |
| Water depth colour / foam / reflection, rain and snow shapes, own weather particles | `style.water`, `style.weather`, `engine.weather.define` | `recipes/44-water-weather-look-hooks.md` |
| Shadows too blurry near the camera | `sky({ shadow: { cascades: 3 } })` (cascaded, off by default, switching recompiles once; set it in settings, not in play) | `recipes/45-cascaded-shadows.md` |
| Island edge, snow cover, flat-colour backdrop | `style.weather.snow.cover`, `style.sky.backdrop`, `weather:change`, `applyState({ season })` | `recipes/47-island-snow-backdrop.md` |
| Blank game / flat island / fixed dusk / still NPC | `npx threedog new-game name --blank`; `terrain({ height: () => 2, shape })`; `openWorld({ time })` without `calendar.cycle`; NPC without `schedule`+`behavior` | `recipes/01-new-game.md`, `28-terrain.md`, `08-weather-sky.md`, `02-npc.md` |
| `verify` scenario, why `shot` shows a fresh game | a scenario JSON; teleport + `step 1` collects `auto` pickups; `shot` = fresh, `snap` = current session | `recipes/16-dev-bridge.md` |
| `isDay`, dialogue in `describe`, HUD counter from items | `isDay` = 06:00-18:00 exclusive; `describe().ui.dialogue`, event `dialogue:line`; `hud.counter` in `onFrame` | `recipes/08-weather-sky.md`, `02-npc.md`, `26-ui-parts.md` |
| Who set tone / post / lights; own renderer | `engine.describe().render` (tags engine/style/game); `createEngine({ renderer })`, WebGL fully supported | `recipes/16-dev-bridge.md`, `recipes/50-own-renderer.md` |
| `makeMaterial` spec keys and who wins | call beats pack; any three.js property passes, typos warn | `recipes/48-make-material.md` |
| Fences, rivers (own collision) | `collision.addSegment(a,b,{thickness})`, `addBlocked((x,z)=>bool)`; both return `{ remove() }` | `recipes/12-navmesh.md` |
| Screenshot numbers, scripted playthrough | `shot --keep`, `--look` (luma, saturation, over/dark share); `state`, `hold`, `press`, `step` | `recipes/16-dev-bridge.md` |
| Use three.js directly | `engine.scene`, `engine.renderer`, `engine.camera` are plain three.js objects: use or change them; `engine.add(obj, { id })` to save | `recipes/40-scene.md` |
| Skip time from the dev bridge; blocked ground and async paths | `threedog skip to=06:00` / `seconds=600`; `addBlocked(fn,{bounds})` is sampled into async paths (not navmesh) | `recipes/16-dev-bridge.md`, `recipes/12-navmesh.md` |
| Orthographic camera (isometric, sim, puzzle) | `setCamera('fixed'/'follow', { projection: 'orthographic', size })`; own takeover: `cameraOverride` | `recipes/21-camera.md` |
| Own game system (crop, machine, burning) | save, `clock.now`, `skip` hook, `describe`, ops `can`/`offers`; check 10h step = 10h skip | `recipes/49-game-module-contract.md` |
| Make a new style from a reference image | `threedog style palette <image>`, `npm run new-style`, `threedog style check`, `style compare <ref> <shot>`; `threedog shot styletest --view room`, `/styletest.html?panel=1` | `recipes/35-style-from-reference.md` |
| Look knobs: clouds, ground patches, wind, fog, exposure, sky layers | `style.sky.clouds`, `terrain.variation`, `wind.glsl`, `sky.fog`, `sky.layers`, `style.exposure`; own lights / fog: `sky({ sun: false, fog: 'manual' })` | `recipes/36-sky-ground-plant-looks.md`, `recipes/38-environment-look-hooks.md` |
| Environment lighting (PBR reflections, ambient from the sky or an HDR) | `engine.sky.setEnvironment({ source: 'sky' \| asset name })` | `recipes/34-environment-lighting.md` |
| Color grading, grain, vignette, depth of field; outline modes | `@threedog/post-effects`: `bloom`, `ao`, `outline`, `dof`, `lut`… (`style: [lowpoly, postAdd(vignette({ enabled: true }), grain({ enabled: true }))]`); a style pack never imports another style pack, shared effects come from post-effects (R34) | `recipes/09-style-pack.md` |
| Many lights (torches, lamps, muzzle flashes) | `lightPool({ point })`, `engine.lightPool.add(obj, { color, intensity, distance, flicker, glow })` | `recipes/09-style-pack.md` |
| Day, night, seasons, sky, weather | `engine.sky` (`at / between / daily / onSeason`, `isDay`; fixed unless `sky({ dayLength })`), `engine.weather` (`weather({ types })`) | `recipes/08-weather-sky.md` |
| Water | `engine.water` | `recipes/08-weather-sky.md` |
| Shadow type and softness | `createEngine({ shadowType: 'basic' \| 'pcf' \| 'vsm' })`, `engine.sky.setShadow({ type, radius })`; switching recompiles materials | `recipes/15-perf.md` |

### Rules and flow
| To do | Use | Recipe |
|---|---|---|
| Player actions, UI buttons that change state | `engine.ops.define('noun.verb', { can, run, undo })`, `ops.run(name, args)`, `ops.undo(name, args, value)` | `recipes/23-ops.md` |
| Why can't / what can the player do here | `engine.explain(...)`, `engine.inspect(at?)`, scenario tests `tests/scenarios/*.json` | `recipes/23-ops.md` |
| Story flags, counters | `engine.vars` (`setFlag / flag / bump / counter`, saved) | `recipes/20-content-actions-save.md` |
| Saves | `engine.saves.register(key, { save, load })`; `await` every `saves.*` call; `saves.autosave(minutes)`; save stable ids, never positions | `recipes/20-content-actions-save.md` |
| New game / continue / back to title / retry | `await engine.session.newGame() / load(slot)`, `quit()`; things made during play go through `session.track(h)` | `recipes/07-flow-scenes-pause.md` |
| Scene flow, fades, pausing gameplay | `engine.flow` (`transition(fn)`, state `'paused'`), `fadeScreen(engine, to, s)` | `recipes/07-flow-scenes-pause.md` |
| Cutscenes, tweens | `engine.timeline` (`tween(obj, { 'position.y': 2 }, s)`; no other tween class) | `recipes/07-flow-scenes-pause.md` |
| Time, timers, skipping time | `engine.clock` (game seconds, `after / every`), `await engine.skip({ to: '06:00' })` | `recipes/06-clock-events.md` |
| Events | `engine.events.on / emit` (`noun:action`; a game declares its own in `GameEvents`) | `recipes/06-clock-events.md` |
| Gameplay randomness | `engine.random` (saved; never `Math.random`) | `recipes/23-ops.md` |
| Opt-in feel presets (weather, calendars, player, keys, interaction pick, camera) | `presets.weather.temperate`, `presets.calendar.cycle`, `presets.player.thirdPerson`, `presets.keys.*`, `presets.camera.*`; never auto-applied | `recipes/01-new-game.md` |
| Text and languages | `engine.t(key)`, `engine.i18n` | `recipes/26-ui-parts.md` |
| Keys and input contexts | `input.define('action', keys, label)`, read by action in the fixed step, `engine.input.push('menu')`, `input.simulate(action, down)` | `recipes/26-ui-parts.md` |
| Screen UI parts, Esc / UI layering, settings menu, labels over the world | `createEngine({ ui })`, `engine.ui.set(name, ...)`, `engine.hud`, `uiFocus(engine)`, `engine.settings`, `worldToScreen()` | `recipes/26-ui-parts.md` |
| Photo mode | `engine.photo` | `recipes/26-ui-parts.md` |
| Set up a scenario, dev bridge | `engine.applyState({...})`, `engine.defineState(name, params)`, `npx threedog play`, `status`, `verify <scenario>`, `scene --hidden` (mesh not drawn) | `recipes/16-dev-bridge.md` |
| Drive the game from an MCP client (Claude Code, Cursor) | `claude mcp add threedog -- npx threedog mcp` (`js` only with `--allow-js`) | `recipes/16-dev-bridge.md` §10 |
| Describe state for tests | `engine.describe()`, `engine.describe.add(name, fn)`, `describeText()` | `recipes/16-dev-bridge.md` |
| An engine error: what to do | `err.code` / `err.fix` / `err.docs` (also `engine.error`, `.threedog/errors.log`) | `recipes/16-dev-bridge.md` §8 |
| What is this thing / will a save keep it | `engine.add(obj, { id })` (only an id makes it saveable), `engine.thing(id \| obj)`, `pick().thing`, ops `thing.set` / `thing.remove` (undoable) | `recipes/41-thing-registry.md` |
| Your own module | `{ name, install, fixed, frame, describe, afterLoad }` + `engine.use` | `recipes/14-custom-module.md` |
| A module will not install, or runs in the wrong order | `engine.use(a, b)` installs a batch atomically; `before` / `after` sort inside one `stage`; `critical: true` | `recipes/14-custom-module.md` |
| Heavy loops, workers, background results | `engine.jobs.add(function* () {})`, `engine.threads.lane(...)`, `engine.commits` | `recipes/15-perf.md` |
| Performance budget, debug panel, where the time goes | `engine.budget`, `engine.debug`, `describe().perf`, `threedog capture` | `recipes/15-perf.md` |
| Random operation sequences, order-dependent bugs | the engine repository's `Properties` specs (fast-check) | `recipes/23-ops.md` |
| Co-op multiplayer | `engine.use(net({ role, transport }))`, `engine.net` | `recipes/27-net.md` |

## Commands (game side; details in `COMMANDS.md`)
`npm run dev` · `npm run check` (after every change) · `npm test -- name` (only related tests) · `npm run map` (after changing code, JSDoc or content)
· `npm run new-game name` · `npm run shot -- --describe-only`. Browser errors go to `.threedog/errors.log`: **read it first when something breaks**.

## Verification rules for AI
1. Order: `npm run map` (after API, JSDoc or content changes) -> `npm run check` -> the related tests.
2. Check logic with `describeText()`, not screenshots; drive a running game with the dev bridge, not playwright scripts. Ops run through the
   bridge change this session only; a lasting level change is an edit to `content/*.js`. `main.js` sets `window.engine = engine` before `start()`.
3. Screenshots only for what the eye must judge. A known error names the recipe to read.

## Conventions (each line is detailed in `CONVENTIONS.md`)
- **A position is one argument** (Vector3, Object3D, `[x, y, z]` or `{ x, z }`); sizes and counts go in the options object after it.
- **Registrations return a handle**; `h.remove()` undoes it. Objects are deleted with `engine.remove(obj)`.
- **Ready is the boolean `ready`** (`await h.whenReady`). **Event names are `noun:action`** (`item:add`).
- **Time**: fixed seconds (`dt`) and game seconds (`engine.clock.now`); never `setTimeout` / `setInterval` / `performance.now()` in game logic.
- **Fixed step vs frame**: `onFixed` runs game time (damage, cooldowns, AI, timers); `onFrame` is presentation (animation, camera feel, HUD).
- **Input**: gameplay keys in the fixed step, UI keys in the frame hook; never `addEventListener('keydown')` for gameplay.
- **Gameplay state** (world, containers, vars, quests) changes only in fixed steps or ops.
- **The engine owns** sky lights, fog and the camera every frame; adjust with `engine.sky.modify` / `engine.cameraOverride`.
- **Two doors, one scene**: plain three.js (`engine.add(mesh, { id })`) and templates (`engine.spawn`, content props) land in the same
  scene (`recipes/40-scene.md`). Put what must be saved and edited without code in content (stable ids: `npx threedog content ids --write`,
  `content/renames.js`); <!-- r18-ignore-line --> the check (R33) flags only startup calls that would repeat after a load. <!-- r18-ignore-line -->
- **Look parameters** belong in the style pack or content, never in logic; materials via `makeMaterial`.
- **Units** are meters, Y up, north -Z; characters face +Z.
- **Errors say how to fix it**: an old form throws with the fix.

## Stability
Tested but may change before 1.0 (api pages mark "(experimental)"): co-op `net()` · `engine.threads` ·
`grids()` · `engine.terrain.edit` · `world.simulate(kind, { worker: true })` · `engine.post.add` · `engine.stream.source` · `hlod()` · `engine.ops.guard / allow`.

## Hard rule for game content
Game content (dialogues, quests, items, map layout) lives in the game's own `content/` folder, never inside the engine.
