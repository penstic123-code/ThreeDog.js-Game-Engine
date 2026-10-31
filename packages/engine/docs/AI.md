# Using threedog.js (read this first)

threedog.js is a web 3D game engine on top of three.js 0.187 (plain three.js, no React): **core** (every game needs it) -> **modules** (installed on demand with `engine.use`) -> **style pack** (all art). This file is the index for the AI that builds a game on the engine. Paths are relative to this `docs/` folder (in a game project: `node_modules/threedog/docs/`).

## What to read, in order (stop when you have enough)
1. This file: find the task in the entry table below.
2. The recipe the row points to (`recipes/NN-*.md`): how to do the task, with a working pattern.
3. `api/<module>.md` for signatures, options and data shapes (generated from JSDoc; `API.md` is the index, `api/events.md` the event table).
4. The game's own `GAMEMAP.md` (generated): what this game has, and "Read for this game", the recipes and api pages for its modules.
5. When needed: `CODEMAP.md` (engine files, who emits / listens to each event) · `THREE.md` (what the engine lacks: use three.js directly) · `PERF.md` · `COMMANDS.md` (commands, scenarios, folder layout) · `CONVENTIONS.md` (the conventions below in detail).

Generated docs (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`) are never edited by hand; after changing code run `npm run map`.

## One thing, one entry point (don't build another)
| To do | Use | Recipe |
|---|---|---|
| New game, project layout | `npm run new-game name`, `createEngine({ canvas, style })`, `engine.use(...)`, `engine.start()` | `recipes/01-new-game.md` |
| Preset parts on / off | `openWorld({ sky: {...}, debug: false })` (each part takes `false` or its options) | `recipes/01-new-game.md` |
| Game content data | `engine.content.load(data, { places })`; own data kinds in `content/rules.js` | `recipes/20-content-actions-save.md` |
| NPCs and what they do | content `npcs` (`behavior`: `schedule` / `wander`), `engine.npcs.behavior(name, { near, far })` | `recipes/02-npc.md` |
| Dialogue | content `dialogues`, `engine.dialogue` | `recipes/02-npc.md` |
| Items, pickups, inventory | content `items` / `pickups`, `engine.inventory` | `recipes/03-items-pickups.md` |
| Chests, corpses, shelves, transfers | `engine.inventory.container(id, { capacity, items })`, `inventory.transfer(from, to, item, n)` | `recipes/22-shop-gold.md` |
| Shops, gold | currency item + ops | `recipes/22-shop-gold.md` |
| Quests, objective markers | content `quests` (a step's `target` is marked automatically), `engine.quests`, `engine.hud.marker(target)` | `recipes/04-quests.md` |
| Story flags, counters | `engine.vars` (`setFlag / flag / bump / counter`, saved) | `recipes/20-content-actions-save.md` |
| Player actions, UI buttons that change state | `engine.ops.define('noun.verb', { can, run })`, `engine.ops.run(name, args)` | `recipes/23-ops.md` |
| Why can't / what can the player do here | `engine.explain(...)`, `engine.inspect(at?)`, scenario tests `tests/scenarios/*.json` | `recipes/23-ops.md` |
| Interaction prompts (talk, pick up, open) | `engine.interactions` (`interactions({ pick: 'aim' })`) | `recipes/20-content-actions-save.md` |
| Trigger zones | content `triggers`, `engine.triggers` | `recipes/20-content-actions-save.md` |
| Saves | `engine.saves.register(key, { save, load })`; `await` every `saves.*` call (Promise; show "saved" only on true); `saves.autosave(minutes)` runs only during play; save stable ids (quest step `id`, vehicle `{ id }`), never positions | `recipes/20-content-actions-save.md` |
| New game / continue / back to title / retry | `await engine.session.newGame() / load(slot)`, `quit()`; listeners, timers, zones, markers made during play go through `session.track(h)`; opening cutscene on `session:start` | `recipes/07-flow-scenes-pause.md` |
| Scene flow, fades, pausing gameplay | `engine.flow` (`transition(fn, { autosave })`, state `'paused'`), `fadeScreen(engine, to, s)` | `recipes/07-flow-scenes-pause.md` |
| Cutscenes, tweens | `engine.timeline` (`tween(obj, { 'position.y': 2 }, s)`; no other tween class) | `recipes/07-flow-scenes-pause.md` |
| Time, timers, skipping time | `engine.clock` (game seconds, `after / every`), `await engine.skip({ to: '06:00' })` | `recipes/06-clock-events.md` |
| Events | `engine.events.on / emit` (`noun:action`; a game declares its own in `GameEvents`) | `recipes/06-clock-events.md` |
| Day, night, seasons, sky, weather | `engine.sky` (`at / between / daily / onSeason`, `isDay`, `daylight`), `engine.weather` | `recipes/08-weather-sky.md` |
| Water, ambience | `engine.water`, `engine.ambience` | `recipes/08-weather-sky.md` |
| Look, materials, post-processing | style pack (`engine.style`), `makeMaterial('role', {...})`, `applyEffects(...)`, `engine.post`, shared shader time / wind in `engine.uniforms` | `recipes/09-style-pack.md` |
| Sound and music | `engine.audio`, `engine.music` (sounds come from the style pack) | `recipes/09-style-pack.md` |
| Text and languages | `engine.t(key)`, `engine.i18n` | `recipes/26-ui-parts.md` |
| Art assets, loading, what failed | `engine.assets.manifest({ models })`, `engine.loading`, `npx threedog loading` | `recipes/05-props-bake.md` |
| A few props / many repeated objects, deleting objects | content `props` / `vegetation` (`engine.vegetation`), `engine.remove(obj)` | `recipes/05-props-bake.md` |
| Reusable object definitions (prefabs) | content `templates` (model + collision + op + defaults); place with props `{ template, x, z }` or `engine.content.spawn(name, pos)` | `recipes/30-templates.md` |
| Many copies of one static model | automatic: `engine.batching` (one InstancedMesh per cell); opt out `batch: false`, recolor one `engine.batching.tint(obj, color)` | `recipes/05-props-bake.md` §2b |
| Far detail (HLOD) | `engine.hlod` | `recipes/15-perf.md` |
| Blender level | `engine.level` | `recipes/10-blender-level.md` |
| Saved / far-away objects, the player record | `engine.world` (`present` near, `simulate` far), `player.placeAt()` | `recipes/18-world.md` |
| Stream in, teleport, what is loaded where | `engine.stream.add({ position, build })`, `await engine.load.teleport(p, { timeout })`, `engine.load.source(...)` | `recipes/18-world.md` |
| Ground height, terrain editing | `engine.surface(x, z)`, `engine.snapToGround(obj)`, `engine.ground`, `engine.terrain.edit(...)` (in an op) | `recipes/28-terrain.md` |
| Grid placement, per-cell soil state | `engine.grids.add / define`, ops `grid.place / move / remove` | `recipes/29-grid.md` |
| Player and characters | `engine.player`, `engine.characters.createPlayer({ control, model })`, `faceMode`, `push(...)` | `recipes/13-animation.md` |
| Skeletal animation | `engine.assets.animate(model, config)`, `anim.sync(state, t)` | `recipes/13-animation.md` |
| Pathfinding, navmesh, "can walk there" | `engine.characters.findPath(from, to)`, `engine.nav`, `createEngine({ movement })` | `recipes/12-navmesh.md` |
| Collision, physics, vehicles | `engine.collision`, `engine.rigid` (Rapier) | `recipes/11-vehicles.md` |
| Ray / mouse picking, shooting, lock-on | `engine.raycast / pick`, `engine.raycaster.addStatic(obj)`, `engine.entities`, `engine.particles`, `pickTarget` | `recipes/19-shooting-picking.md` |
| Camera | `openWorld({ camera })`, `engine.setCamera(...)`, `engine.cameraRig` | `recipes/21-camera.md` |
| Keys and input contexts | `input.define('action', keys, label)`, read by action in the fixed step, `engine.input.push('menu')`, tests `input.simulate(action, down)` | `recipes/26-ui-parts.md` |
| Screen UI parts, Esc / UI layering, settings menu, labels over the world | `createEngine({ ui })`, `engine.ui.set(name, ...)`, `engine.hud`, `uiFocus(engine)`, `engine.settings`, `worldToScreen(engine, pos)` | `recipes/26-ui-parts.md` |
| Photo mode | `engine.photo` | `recipes/26-ui-parts.md` |
| Set up a scenario, dev bridge | `engine.applyState({...})`, `engine.defineState(name, params)`, `npx threedog describe / step / op` | `recipes/16-dev-bridge.md` |
| Drive the game from an MCP client (Claude Code, Cursor) | `claude mcp add threedog -- npx threedog mcp` (snap returns an image; `js` only with `--allow-js`) | `recipes/16-dev-bridge.md` §10 |
| Your own module | `{ name, install, fixed, frame, describe }` + `engine.use` | `recipes/14-custom-module.md` |
| Heavy loops, workers, background results | `engine.jobs.add(function* () {})`, `engine.threads.lane(...)` (worker file: `import { serve } from 'threedog/worker'`), `engine.commits` | `recipes/15-perf.md` |
| Performance budget, debug panel | `engine.budget`, `engine.debug`, `describe().perf` | `recipes/15-perf.md` |
| Gameplay randomness | `engine.random` (saved; never `Math.random`) | `recipes/23-ops.md` |
| Describe state for tests | `engine.describe()`, `engine.describe.add(name, fn)`, `describeText()` (a summary; `{ path }` / `{ full: true }` for more) | `recipes/16-dev-bridge.md` |
| An engine error: what to do | `err.code` / `err.fix` / `err.docs` (also `engine.error`, `.threedog/errors.log`) | `recipes/16-dev-bridge.md` §8 |
| Co-op multiplayer | `engine.use(net({ role, transport }))`, `engine.net` | `recipes/27-net.md` |

## Commands (game side; details in `COMMANDS.md`)
`npm run dev` · `npm run check` (after every change) · `npm test -- name` (only related tests) · `npm run map` (after changing code, JSDoc or content) · `npm run new-game name` · `npm run shot -- --describe-only` (state as text). A game imports the engine by package name (`import { createEngine } from 'threedog'`). Browser errors go to the workspace's `.threedog/errors.log`: **read it first when something breaks**.

## Verification rules for AI
1. Order: `npm run map` (only after changing a public API, JSDoc or content) -> `npm run check` -> the related tests. Report only after they ran and passed; attach before/after numbers for performance changes.
2. Check logic with `describeText()` / describe snapshots, not screenshots; drive a running game with the dev bridge (`recipes/16-dev-bridge.md`), not throwaway playwright scripts. `main.js` sets `window.engine = engine` before `await engine.start()`.
3. Screenshots only for what the eye must judge (light, animation feel, UI occlusion). Known errors end with "Possible cause / Read: recipes/...": read that page first.

## Conventions (each line is detailed in `CONVENTIONS.md`)
- **A position is one argument** (Vector3, Object3D, `[x, y, z]` or `{ x, z }`); sizes and counts go in the options object after it.
- **Registrations return a handle**; `h.remove()` undoes it. Objects and data are deleted with `engine.remove(obj)` or their own remove call.
- **Ready is the boolean `ready`**; wait with `await h.whenReady`.
- **Event names are `noun:action`** (`item:add`; a game's own: `door:open`).
- **Time**: fixed seconds (hook `dt`, `step`) and game seconds (`engine.clock.now`); never `setTimeout` / `setInterval` / `performance.now()` / `requestAnimationFrame` in game logic.
- **Input**: gameplay keys in the fixed step, UI keys in the frame hook; never `addEventListener('keydown')` or `pointer.clicked` for gameplay.
- **Gameplay state** (world, containers, vars, quests) changes only in fixed steps or ops.
- **The engine owns** sky lights, fog and the camera transform every frame; adjust with `engine.sky.modify` / `engine.cameraOverride`.
- **Look parameters** belong in the style pack or content, never in logic; materials via `makeMaterial`.
- **Units** are meters, Y up, north -Z; characters face +Z.
- **Errors say how to fix it**: an old form throws with the fix.

## Hard rule for game content
Game content (dialogues, quests, items, map layout) lives in the game's own `content/` folder, never inside the engine.
