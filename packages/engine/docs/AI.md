# Using threedog.js (read this first)

threedog.js is a web 3D game engine on top of three.js 0.187 (plain three.js, no React): **core** (every game needs it) -> **modules** (installed on
demand with `engine.use`) -> **style pack** (all art, an optional separate package; the engine ships none and draws gray placeholders without one).
This file is the index for the AI that builds a game on the engine. Paths are relative to this `docs/` folder (in a game project:
`node_modules/threedog/docs/`).

**Before writing gameplay code**, look for the system in the entry table below: inventory, collision, characters, saves, interactions, quests, grids,
templates and more already exist. Hand-write a system only when no row fits.

## What to read, in order (stop when you have enough)
1. This file: find the task in the entry table below.
2. The recipe the row points to (`recipes/NN-*.md`): how to do the task, with a working pattern.
3. `api/<module>.md` for signatures, options and data shapes (generated from JSDoc; `API.md` is the index, `api/events.md` the event table).
4. The game's own `GAMEMAP.md` (generated): what this game has, and "Read for this game", the recipes and api pages for its modules.
5. When needed: `CODEMAP.md` (engine files, who emits / listens to each event) · `THREE.md` (what the engine lacks: use three.js directly) · `PERF.md`
   · `COMMANDS.md` (commands, scenarios, folder layout) · `CONVENTIONS.md` (the conventions below in detail).

Generated docs (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`) are never edited by hand; after changing code run `npm run map`.

## One thing, one entry point (don't build another)
| To do | Use | Recipe |
|---|---|---|
| New game, project layout | `npm run new-game name`, `createEngine({ canvas, style })`, `engine.use(...)`, `engine.start()` | `recipes/01-new-game.md` |
| Canvas in a page section, split layout or editor panel | the canvas's CSS box decides (pointer, pick, UI follow it) | `recipes/01-new-game.md` §5 |
| Preset parts on / off | `openWorld({ camera: 'follow', sky: {...}, debug: false })` (each part takes `false` or its options) | `recipes/01-new-game.md` |
| Game content data, content packs | `engine.content.load(data, { places })` or several packs `load([base, dlc])` (an id in two packs is an error); own data kinds in `content/rules.js` | `recipes/20-content-actions-save.md` |
| NPCs and what they do | content `npcs` (`behavior`: `schedule` / `wander`), `engine.npcs.behavior(name, { near, far })` | `recipes/02-npc.md` |
| Dialogue | content `dialogues`, `engine.dialogue` | `recipes/02-npc.md` |
| Items, pickups, inventory | content `items` / `pickups`, `engine.inventory` (swap one for another: `inventory.trade(take, give)`) | `recipes/03-items-pickups.md` |
| Chests, corpses, shelves, transfers | `engine.inventory.container(id, { capacity, items })`, `inventory.transfer(from, to, item, n)` | `recipes/22-shop-gold.md` |
| Shops, gold | currency item + ops | `recipes/22-shop-gold.md` |
| Quests, objective markers | content `quests` (a step's `target` is marked automatically), `engine.quests`, `engine.hud.marker(target)` | `recipes/04-quests.md` |
| Story flags, counters | `engine.vars` (`setFlag / flag / bump / counter`, saved) | `recipes/20-content-actions-save.md` |
| Player actions, UI buttons that change state | `engine.ops.define('noun.verb', { can, run, undo })`, `engine.ops.run(name, args)`, `engine.ops.undo(name, args, value)` | `recipes/23-ops.md` |
| Why can't / what can the player do here | `engine.explain(...)`, `engine.inspect(at?)`, scenario tests `tests/scenarios/*.json` | `recipes/23-ops.md` |
| Interaction prompts (talk, pick up, open) | `engine.interactions` (`interactions({ ...presets.interactions.nearest })` or `{ pick, keys }`; no default pick or key) | `recipes/20-content-actions-save.md` |
| Trigger zones | content `triggers`, `engine.triggers` | `recipes/20-content-actions-save.md` |
| Saves | `engine.saves.register(key, { save, load })`; `await` every `saves.*` call (Promise; show "saved" only on true); `saves.autosave(minutes)` runs only during play; save stable ids (quest step `id`, vehicle `{ id }`), never positions | `recipes/20-content-actions-save.md` |
| New game / continue / back to title / retry | `await engine.session.newGame() / load(slot)`, `quit()`; listeners, timers, zones, markers made during play go through `session.track(h)`; opening cutscene on `session:start` | `recipes/07-flow-scenes-pause.md` |
| Scene flow, fades, pausing gameplay | `engine.flow` (`transition(fn, { autosave })`, state `'paused'`), `fadeScreen(engine, to, s)` | `recipes/07-flow-scenes-pause.md` |
| Cutscenes, tweens | `engine.timeline` (`tween(obj, { 'position.y': 2 }, s)`; no other tween class) | `recipes/07-flow-scenes-pause.md` |
| Time, timers, skipping time | `engine.clock` (game seconds, `after / every`), `await engine.skip({ to: '06:00' })` | `recipes/06-clock-events.md` |
| Events | `engine.events.on / emit` (`noun:action`; a game declares its own in `GameEvents`) | `recipes/06-clock-events.md` |
| Day, night, seasons, sky, weather | `engine.sky` (`at / between / daily / onSeason`, `isDay`, `daylight`; a fixed time of day unless `sky({ dayLength })` or `presets.calendar.cycle`; seasons off unless `sky({ seasons })`), `engine.weather` (`weather({ types })`, only `clear` without) | `recipes/08-weather-sky.md` |
| Opt-in feel presets (weather tables, calendars and day cycle, player movement / keys, interaction pick / key, module keys, camera) | `presets` (`presets.weather.temperate`, `presets.calendar.cycle` / `fourSeasons`, `presets.player.thirdPerson`, `presets.interactions.nearest`, `presets.keys.inventory` / `quests` / `photo` / `gridRotate` / `brake`, `presets.camera.overShoulder`); never applied by the engine | `recipes/01-new-game.md` |
| Water | `engine.water` | `recipes/08-weather-sky.md` |
| Look, materials, post-processing, mixing packs | style pack (`createEngine({ style })`, e.g. `@threedog/style-lowpoly`, or parts `style: [lowpoly, { sky }]` deep-merged; without one gray placeholders), `engine.makeMaterial('role', {...})` (the free `makeMaterial()` only at module top level or with one engine), style only holds looks (water level / sea / terrain shape go in `water({...})` / `terrain({...})`), `style.palette` recolors procedural models, `postAdd` / `postRemove` change effects by name, `applyEffects(...)`, `engine.post`, shared shader time / wind in `engine.uniforms` | `recipes/09-style-pack.md` |
| Sound, buses, ambience rules, music, footsteps, ducking | `createEngine({ audio: { sounds, ambience, music, footsteps, levels } })` (the game's), `engine.audio.sfx(name, { at })`, `audio.duck({ music: 0.3 })`, `engine.ambience`, `engine.music` (`rules`, `intensity`) | `recipes/31-audio.md` |
| Sound config as content data, measures | content pack `audio: { sounds, ambience, music, footsteps }` (sound names from an asset pack, no functions), `when: { daylight: { gt: 0.15 } }`, `volume: { base, add: { rain: 0.22 }, max }`, `engine.audio.measure(name, fn)` | `recipes/31-audio.md` |
| Text and languages | `engine.t(key)`, `engine.i18n` | `recipes/26-ui-parts.md` |
| Art assets, asset packs, fonts, loading, what failed | `engine.assets.manifest({ name, base, models, textures, sounds, fonts })` (`style.ui.fonts` names fonts) (a pack: lowpoly's `assets`), `engine.loading`, `npx threedog loading` | `recipes/05-props-bake.md` |
| A few props / many repeated objects, deleting objects | content `props` / `vegetation` (`engine.vegetation`), `engine.remove(obj)` | `recipes/05-props-bake.md` |
| What is this thing, where is it defined (point -> id) | `engine.pick(x, y).thing` (`{ id, kind, template, definedAt, fields }`), `engine.world.origin(id)` / `idOf(obj)`, `npx threedog pick x,y`, MCP `pick` | `recipes/30-templates.md` §5 |
| Reusable object definitions (prefabs) | content `templates` (model + collision + op + defaults); place with props `{ template, x, z }` or `engine.content.spawn(name, pos)` | `recipes/30-templates.md` |
| Many copies of one static model | automatic: `engine.batching` (one InstancedMesh per cell); opt out `batch: false`, recolor one `engine.batching.tint(obj, color)` | `recipes/05-props-bake.md` §2b |
| Far detail (HLOD) | `engine.hlod` | `recipes/15-perf.md` |
| Look knobs the engine keeps open: cloud shape, ground color patches, wind sway | `style.sky.clouds` (`kind: 'plane' \| 'cumulus'`, `glsl`), `style.terrain.variation`, `style.wind.glsl`; change these in the style, not the engine | `recipes/36-sky-ground-plant-looks.md` |
| Ground color borders (river banks), mesh cut, lighting normals | `terrain({ shading: 'texture', colorResolution, normals, normalFn, diagonal, boundsPad })`; `shading` / `colorResolution` / `normals` / `normalFn` may go in `style.terrain.config`, `diagonal` / `boundsPad` are world keys | `recipes/37-terrain-look-hooks.md` |
| Surface feel (grain, paper, brush, normal / roughness maps), shadow tint, rim light, toon ramp, seasons mix | material spec keys `map` / `normalMap` / `roughnessMap` … (asset names), `detail: { noise \| texture \| glsl }`, `lighting: { shadowTint, rim, wrap, glsl }`, toon `ramp`, `style.seasons.mode: 'mix'`; material role names can be anything you invent | `recipes/43-shader-patches-surface-looks.md` |
| Make a new style from a reference image | `threedog style palette <image>`, `npm run new-style <name>`, `threedog style check <name>`; look at the fixed scene with `threedog shot styletest --view overview\|character\|water\|room\|path\|ui [--time day\|dusk\|night] [--weather clear\|rain\|snow]`, `/styletest.html?panel=1` is the tweak panel (devDependency tweakpane) | `recipes/35-style-from-reference.md` |
| Environment lighting (PBR reflections, ambient from the sky or an HDR) | `engine.sky.setEnvironment({ source: 'sky' \| asset name, intensity, rotation })` (off by default; a Lambert material only gets diffuse irradiance, no reflection) | `recipes/34-environment-lighting.md` |
| Color grading, grain, vignette, chromatic aberration, depth of field; outline modes | optional package `@threedog/post-effects` (`style: [lowpoly, postAdd(vignette(), grain())]`, off by default; adjacent ldr effects fuse into one pass), `outline({ mode: 'both', wobble, offLayer: OUTLINE_OFF_LAYER })` | `recipes/09-style-pack.md` |
| Many lights (torches, lamps, muzzle flashes) without shader stalls | `lightPool({ point })`, `engine.lightPool.add(obj, { color, intensity, distance, flicker, glow })` | `recipes/09-style-pack.md` |
| Blender level | `engine.level`; check a level file first with `npm run assets -- check` (spawns, colliders, triggers, missing templates, duplicate ids, material hints; `npm run check` reads the GLB, no hand-written marker list) | `recipes/10-blender-level.md` |
| Grass and trees on a level or code-built ground (no terrain) | `vegetation({ area })`, rule `biomes` by ground type, `engine.vegetation.rebuild()` | `recipes/10-blender-level.md` §4 |
| Saved / far-away objects, the player record | `engine.world` (`present` near, `simulate` far), `player.placeAt()` | `recipes/18-world.md` |
| Stream in, teleport, what is loaded where | `engine.stream.add({ position, build })`, `await engine.stream.teleport(p, { timeout })`, `engine.stream.source(...)` | `recipes/18-world.md` |
| Terrain generator, ground height, terrain editing | `terrain({ height, groundType })` or a preset (`terrainPreset()` from `@threedog/terrain-noise`; none = flat), `engine.surface(x, z)`, `engine.snapToGround(obj)`, `engine.ground`, `engine.terrain.edit(...)` (in an op) | `recipes/28-terrain.md` |
| Grid placement, per-cell soil state | `engine.grids.add / define`, ops `grid.place / move / remove` | `recipes/29-grid.md` |
| Player and characters | `engine.player`, `engine.characters.createPlayer({ ...presets.player.thirdPerson, model })` (control required: `'camera'` / `'none'` / fn; `runKeys`, `jumpKeys`, `cameraFollow`), `faceMode`, `push(...)` | `recipes/13-animation.md` |
| Skeletal animation | `engine.assets.animate(model, config)`, mapping as data on the manifest entry (`models: { hero: { url, animation: { states } } }`), `anim.sync(state, t)`, `anim.check([...actions])` | `recipes/13-animation.md` |
| Shadow type and softness | `createEngine({ shadowType: 'basic' \| 'pcf' \| 'vsm' })` (default pcf), `engine.sky.setShadow({ type, radius, blurSamples })`; switching recompiles materials, do not switch every frame | `recipes/15-perf.md` |
| Pathfinding, navmesh, "can walk there" | `engine.characters.findPath(from, to)`, `engine.nav`, `createEngine({ movement })` | `recipes/12-navmesh.md` |
| Collision, physics, vehicles | `engine.collision`, `engine.rigid` (Rapier) | `recipes/11-vehicles.md` |
| Ray / mouse picking, shooting, lock-on | `engine.raycast / pick`, `engine.rays.addStatic(obj)`, `engine.entities`, `engine.particles`, `pickTarget` | `recipes/19-shooting-picking.md` |
| Action game: hp, attacks, enemy AI, drops, death (the engine has no combat rules) | your ops (`player.attack`, `enemy.damage`) + `world.simulate` + `inventory.spawnPickup`; example `examples/action/` | `recipes/32-action-game.md` |
| Camera | `openWorld({ camera })` (required), `engine.setCamera(...)`, `engine.cameraRig` | `recipes/21-camera.md` |
| Keys and input contexts | `input.define('action', keys, label)`, read by action in the fixed step, `engine.input.push('menu')`, tests `input.simulate(action, down)` | `recipes/26-ui-parts.md` |
| Screen UI parts, Esc / UI layering, settings menu, labels over the world | `createEngine({ ui })`, `engine.ui.set(name, ...)`, `engine.hud`, `uiFocus(engine)`, `engine.settings`, `worldToScreen(engine, pos)` | `recipes/26-ui-parts.md` |
| Photo mode | `engine.photo` | `recipes/26-ui-parts.md` |
| Set up a scenario, dev bridge | `engine.applyState({...})`, `engine.defineState(name, params)`, `npx threedog play` (start and connect), `status`, `describe / step / op`, `errors latest`, `verify <scenario>`; every result has a `code` and `runtime` (step / press / hold / verify advance time, op / state do not) | `recipes/16-dev-bridge.md` |
| Drive the game from an MCP client (Claude Code, Cursor) | `claude mcp add threedog -- npx threedog mcp` (snap returns an image; `js` only with `--allow-js`) | `recipes/16-dev-bridge.md` §10 |
| Your own module | `{ name, install, fixed, frame, describe, afterLoad }` + `engine.use` | `recipes/14-custom-module.md` |
| A module will not install, or runs in the wrong order | `engine.use(a, b)` installs a batch atomically; `before` / `after` sort only inside one `stage` (a clash with the stage order throws `module-order`); `critical: true` makes a failed `init` reject `start()`; `engine.moduleStates`, `await engine.loading.settled()` for modules installed after start; `engine.step(0)` advances nothing, a negative or non-finite value throws | `recipes/14-custom-module.md` |
| Heavy loops, workers, background results | `engine.jobs.add(function* () {})`, `engine.threads.lane(...)` (worker file: `import { serve } from 'threedog/worker'`), `engine.commits` | `recipes/15-perf.md` |
| Random operation sequences, find an order-dependent bug | the engine repository's `Properties` specs (fast-check): a failure prints the seed and the shortest sequence, replay with `FC_SEED=<seed> npm test -- "Properties: random op"`; write the found bug as a fixed regression test, then fix | `recipes/23-ops.md` |
| Rigid bodies: how far tree colliders are built | `rigid({ treeRadius = 16 })` (tree cylinders only around the player and moving bodies; character collision stays in `engine.collision`); trigger zones sit on a 16 m grid, a trigger with its own `who` is checked every step | `recipes/11-vehicles.md` |
| Performance budget, debug panel, where the time goes | `engine.budget`, `engine.debug`, `describe().perf` (`.cpu` phases, `.apply` background-result stages; transit and upload are approximate), `engine.budget.cost.report()`, `threedog capture` (one frame: draw calls, shadow draws, post passes, biggest draws) | `recipes/15-perf.md` |
| Gameplay randomness | `engine.random` (saved; never `Math.random`) | `recipes/23-ops.md` |
| Describe state for tests | `engine.describe()`, `engine.describe.add(name, fn)`, `describeText()` (a summary; `{ path }` / `{ full: true }` for more) | `recipes/16-dev-bridge.md` |
| An engine error: what to do | `err.code` / `err.fix` / `err.docs` (also `engine.error`, `.threedog/errors.log`) | `recipes/16-dev-bridge.md` §8 |
| Co-op multiplayer | `engine.use(net({ role, transport }))`, `engine.net` | `recipes/27-net.md` |

## Commands (game side; details in `COMMANDS.md`)
`npm run dev` · `npm run check` (after every change) · `npm test -- name` (only related tests) · `npm run map` (after changing code, JSDoc or content)
· `npm run new-game name` · `npm run shot -- --describe-only` (state as text). A game imports the engine by package name
(`import { createEngine } from 'threedog'`). Browser errors go to the workspace's `.threedog/errors.log`: **read it first when something breaks**.

## Verification rules for AI
1. Order: `npm run map` (only after changing a public API, JSDoc or content) -> `npm run check` -> the related tests. Report only after they ran and
   passed; attach before/after numbers for performance changes.
2. Check logic with `describeText()` / describe snapshots, not screenshots; drive a running game with the dev bridge (`recipes/16-dev-bridge.md`), not
   throwaway playwright scripts. Ops run through the bridge, MCP or `js` change this session only (and its saves); a lasting level change is an edit
   to `content/*.js` or the level model. `main.js` sets `window.engine = engine` before `await engine.start()`.
3. Screenshots only for what the eye must judge (light, animation feel, UI occlusion). Known errors end with "Possible cause / Read: recipes/...":
   read that page first.

## Conventions (each line is detailed in `CONVENTIONS.md`)
- **A position is one argument** (Vector3, Object3D, `[x, y, z]` or `{ x, z }`); sizes and counts go in the options object after it.
- **Registrations return a handle**; `h.remove()` undoes it. Objects and data are deleted with `engine.remove(obj)` or their own remove call.
- **Ready is the boolean `ready`**; wait with `await h.whenReady`.
- **Event names are `noun:action`** (`item:add`; a game's own: `door:open`).
- **Time**: fixed seconds (hook `dt`, `step`) and game seconds (`engine.clock.now`); never `setTimeout` / `setInterval` / `performance.now()` /
  `requestAnimationFrame` in game logic.
- **Fixed step vs frame**: `onFixed` runs game time (damage, cooldowns, AI, timers), the same at any frame rate; `onFrame` is presentation (animation,
  camera feel, HUD).
- **Input**: gameplay keys in the fixed step, UI keys in the frame hook; never `addEventListener('keydown')` or `pointer.clicked` for gameplay.
- **Gameplay state** (world, containers, vars, quests) changes only in fixed steps or ops.
- **The engine owns** sky lights, fog and the camera transform every frame; adjust with `engine.sky.modify` / `engine.cameraOverride`.
- **A level is content, code holds rules**: what stands in a level is a template plus a placement in `content/` (stable ids, saved as changes;
  `npx threedog content ids --write` writes missing ones, `content/renames.js` renames them without losing saves); <!-- r18-ignore-line --> code holds
  ops, `world.simulate` /
  `present`, conditions and UI, and things made during play come from `engine.content.spawn` inside an op (rule R33, `recipes/30-templates.md`). <!--
  r18-ignore-line -->
- **Look parameters** belong in the style pack or content, never in logic; materials via `makeMaterial`.
- **Units** are meters, Y up, north -Z; characters face +Z.
- **Errors say how to fix it**: an old form throws with the fix.

## Stability
These work and are tested, but their shape may still change before 1.0 (api pages mark them "(experimental)"): co-op `net()` / `fakeNetwork()` /
`webSocket()` · `engine.threads` and `createEngine({ threads })` · `grids()` / `engine.grids` · `engine.terrain.edit` ·
`world.simulate(kind, { worker: true })` · `engine.post.add / get / enable / list` · `engine.stream.source / sources / teleport / readyCheck` ·
`hlod()` · `engine.ops.guard / allow`.

## Hard rule for game content
Game content (dialogues, quests, items, map layout) lives in the game's own `content/` folder, never inside the engine.
