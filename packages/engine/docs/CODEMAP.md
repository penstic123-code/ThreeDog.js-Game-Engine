# Code map (generated, do not edit by hand)

> `npm run map` scans the engine source. Read when needed, after `AI.md` and the game's `GAMEMAP.md`; API details are in `API.md` and `api/<module>.md`. Paths are relative to the package.

## Modules (installed with engine.use)

Per-frame hook order: by stage (control → world → environment → gameplay → presentation → late → audio; none = late), then before / after, then install order.

| Module (engine.xxx) | File | Requires | Optional | Stage | Within stage |
|---|---|---|---|---|---|
| cameraRig (firstPersonCamera()) | modules/camera/FirstPersonCamera.js | — | collision | control | — |
| cameraRig (fixedCamera()) | modules/camera/FixedCamera.js | — | collision | control | — |
| cameraRig (followCamera()) | modules/camera/FollowCamera.js | — | collision | control | — |
| cameraRig (rtsCamera()) | modules/camera/RtsCamera.js | — | collision | control | — |
| timeline | modules/timeline/Timeline.js | — | — | control | before cameraRig |
| level | modules/level/index.js | — | world | world | after terrain |
| terrain | modules/terrain/index.js | — | vegetation | world | — |
| world | modules/world/index.js | — | — | world | — |
| sky | modules/sky/Sky.js | — | — | environment | — |
| water | modules/water/Water.js | — | — | environment | after sky |
| weather | modules/weather/Weather.js | sky | — | environment | before sky |
| entities | modules/entities/Entities.js | world | sky, interactions, collision | gameplay | after interactions, dialogue, triggers |
| dialogue | modules/gameplay/Dialogue.js | — | — | gameplay | after interactions |
| interactions | modules/gameplay/Interactions.js | — | — | gameplay | — |
| grids | modules/grid/index.js | world | — | gameplay | — |
| triggers | modules/triggers/index.js | — | level | gameplay | after interactions |
| hud | modules/hud/index.js | — | inventory, content, level, quests | presentation | after particles, settings |
| particles | modules/particles/Particles.js | — | — | presentation | — |
| settings | modules/settings/Settings.js | — | terrain | presentation | — |
| ambience | modules/ambience/Ambience.js | — | sky, weather | late | — |
| characters | modules/characters/index.js | — | cameraRig, sky, interactions, dialogue, nav, collision, rigid, world | late | — |
| collision | modules/collision/Collision.js | — | — | late | — |
| content | modules/content/index.js | — | level, sky, inventory, quests, particles, hud, vegetation, dialogue, triggers, collision, world, interactions | late | — |
| debug | modules/debug/DebugPanel.js | — | sky, weather, terrain | late | — |
| flow | modules/flow/index.js | — | music | late | — |
| inventory | modules/gameplay/Inventory.js | — | world | late | — |
| quests | modules/gameplay/Quests.js | — | — | late | — |
| hlod | modules/hlod/index.js | — | terrain, level | late | — |
| nav | modules/nav/index.js | — | — | late | — |
| net | modules/net/index.js | — | world, inventory | late | — |
| photo | modules/photo/Photo.js | — | cameraRig, sky, vegetation, entities | late | — |
| rigid | modules/rigid/RigidBodies.js | collision | interactions | late | — |
| vegetation | modules/vegetation/Vegetation.js | terrain | — | late | — |
| music | modules/music/Music.js | — | weather, sky, dialogue | audio | — |

## Files


**./**
- index.js: Engine entry

**core/**
- Animator.js: Animation state machine: assets.animate(model, config) retu…
- Assets.js: Asset management: Asset manifest: register every model, tex…
- Audio.js: Audio core: three channels (ambience, sfx, music), audio fi…
- Baked.js: Code-generated model <-> GLB file (shared by the auto-cache…
- Batching.js: Automatic batching, engine.batching: the same static model …
- Budget.js: Performance budget, engine.budget: the game sets limits (on…
- Clock.js: Game clock, engine.clock: game seconds `now` + "after a del…
- Commits.js: How background results take effect: engine.commits
- Describe.js: Game state description: engine.describe() returns a plain o…
- Engine.js: Engine core: what every 3D web game needs (rendering and po…
- Events.js: Event bus: modules do not call each other directly; they "s…
- I18n.js: i18n: engine and modules hardcode no UI text; they fetch it…
- Input.js: Input: read by "action", not by "key"
- Inspect.js: engine.inspect / engine.explain: questions an AI asks while…
- Jobs.js: engine.jobs: a frame-sliced job scheduler
- Load.js: Load sources, engine.load: the places the world must be loa…
- Loading.js: engine.loading: one observable view of everything startup (…
- Ops.js: One entry point for actions: engine.ops
- Random.js: Seeded random numbers, engine.random: gameplay randomness (…
- Raycast.js: Rays: engine.raycast / engine.pick, with the registry engin…
- SaveStore.js: Save storage layer: uses the browser's native IndexedDB (no…
- Saves.js: Saves: each module registers "how to save and load", and sa…
- Stream.js: Spatial stream-in, engine.stream: entries are only register…
- Threads.js: engine.threads: a small worker pool
- UrlState.js: Reproduce a scenario in one call: engine.applyState({ time,…
- Vars.js: Story flags and counters, engine.vars (saved automatically …
- actor.js: Who acts for the local user (part of Engine, mixed into Eng…
- assetLoad.js: File loading for engine.assets, split into the phases engin…
- batchGroups.js: InstancedMesh side of engine.batching (core/Batching.js): b…
- dayTime.js: Clock-time conversion (pure functions): sky time of day `ti…
- describeText.js: engine.describeText(): write describe() as plain English fo…
- easing.js: Easing functions: input progress 0..1, output 0..1 (back/el…
- errorCodes.js: Stable error codes: errors the engine raises by name end th…
- errorHints.js: Error hints: a table of "message pattern -> likely cause + …
- errors.js: Error tiers: what to do when a module hook, onFixed / onFra…
- events.generated.js: Generated, do not edit by hand: npm run map generates it fr…
- ground.js: Ground API (part of Engine, mixed into Engine.prototype): w…
- inputContext.js: Input contexts (like Unity's Action Maps): a stack of named…
- inputPad.js: Gamepad (standard layout) button names; like keyboard key n…
- inputPointer.js: The mouse / touch pointer part of input: drag to look, whee…
- inputTouch.js: The touch part of input: which on-screen controls the game …
- lifecycle.js: Engine lifecycle (part of Engine, mixed into Engine.prototy…
- loop.js: Main loop (part of Engine, mixed into Engine.prototype): fi…
- math.js: Small shared helpers (used by several modules)
- modules.js: Module installation (part of Engine, mixed into Engine.prot…
- movement.js: One shared definition of "can walk there": character radius…
- mulberry32.js: mulberry32, the one copy (engine.random and terrain placeme…
- opsCheck.js: Dev checks for engine.ops (split out of Ops.js): op definit…
- page.js: engine.page: the one place that listens to the browser wind…
- pureWorker.js: Worker that runs pure-function batches for engine.threads (…
- saveApply.js: Applying a save (split out of Saves.js): every part is chec…
- saveFiles.js: Save files (.json download / restore), split out of Saves.j…
- saveVersions.js: Save format and per-part versions
- screenToGround.js: Screen point -> ground point: what clicking the ground mean…
- session.js: engine.session: one playthrough, from "new game" or "load" …
- skip.js: Skipping time (part of Engine, mixed into Engine.prototype)…
- startup.js: Startup (part of Engine, mixed into Engine.prototype): star…
- targeting.js: Target selection: pure functions (no camera, input or engin…
- threadPure.js: Pure functions for workers: a function is sent as its sourc…
- threadServe.js: Worker side of engine.threads lanes: serve(handler) answers…
- tier.js: Device tier: Engine uses it at construction to pick default…
- validate.js: Runtime checks: when an option or name is misspelled, print…

**modules/** (one line per folder: what it does; its files)
- ambience/ Ambience module: wind, rain, water, birds, night insects; changes automatically… — Ambience.js
- camera/ Camera module collection — FirstPersonCamera.js, FixedCamera.js, FollowCamera.js, RtsCamera.js, common.js, index.js
- characters/ Characters module: player (keyboard/stick control, camera follow, footsteps, en… — Character.js, NPC.js, assetModel.js, astar.js, behaviors.js, index.js, movers/common.js, movers/rapier.js, movers/simple.js, npcAvoid.js, npcSim.js, pathAsync.js, pathJob.js, pathWorker.js
- collision/ Lightweight collision: characters are upright cylinders, trees/rocks are circle… — Collision.js, grid.js
- content/ Content loader: hands the plain data in the game's content/*.js to the engine (… — index.js, loader.js, models.js, props.js, rules.js, templates.js
- debug/ Performance panel + time/weather debugging + stress test — DebugPanel.js
- entities/ Entities — Entities.js, index.js
- flow/ Game flow: states (title, playing, paused, game over...) and scene transitions … — index.js
- gameplay/ Container: inventory, chest, corpse and shelf are all this — Container.js, Containers.js, Dialogue.js, Interactions.js, Inventory.js, Quests.js, dialogueBox.js, interactionPrompt.js, inventoryOps.js, pickups.js, questLog.js, questSave.js
- grid/ grids() module: placement grids for farming, furniture, crates, building — Grid.js, Layer.js, index.js, ops.js, preview.js, tiles.js
- hlod/ HLOD: merge far-away buildings into a few proxy meshes, show originals when nea… — index.js
- hud/ Objective markers and a simple HUD: world markers (an edge-of-screen arrow when… — index.js, parts.js
- level/ Level module: load a hand-built scene (glTF/GLB from Blender, or THREE objects … — heightfield.js, index.js
- music/ Background music module entry — Music.js, index.js
- nav/ Navmesh (Recast): generated after a level loads; engine.characters.findPath swi… — index.js, navPath.js
- net/ net() module: optional co-op multiplayer, host authority + state sync — Client.js, Host.js, Net.js, index.js, sync.js, transports.js
- particles/ Particles module: dust, falling leaves, splashes, chimney smoke, sparks.. — Particles.js, effect.js, shaders.js
- photo/ Photo mode: while taking the shot, temporarily raise resolution and shadow prec… — Photo.js
- rigid/ Real physics (Rapier): objects that topple, roll, get pushed and float on water — RigidBodies.js, Vehicles.js
- settings/ Settings menu module entry — Settings.js, index.js, sections.js, strings.js, view.js
- sky/ Sky module: dome shader (gradient + sun + moon + stars), sun/moon directional l… — Sky.js, calendar.js, frame.js, layers.js, schedule.js, shader.js, shadow.js
- terrain/ Terrain module: procedural infinite terrain (biomes, rivers, flattened plots), … — ChunkManager.js, chunkJob.js, chunkQueries.js, chunkWorker.js, index.js, terrainDefaults.js, terrainEdit.js, terrainGen.js, terrainMesh.js
- timeline/ Timeline: cutscenes, camera moves, scripted movement — Timeline.js, Tween.js
- triggers/ Trigger zone module: invisible regions in the world that notify you when the pl… — index.js
- vegetation/ Vegetation module: defines what to plant, where, how far before switching to lo… — Vegetation.js
- water/ Water module: draws the global water plane (sea, big lakes; snaps to a grid fol… — Water.js
- weather/ Weather: clear, cloudy, overcast, rain, storm, snow, fog — Weather.js, shaders.js
- world/ world() module: installed as engine.world (world data, see World.js) — World.js, cells.js, index.js, persist.js, pos.js, sim.js, simFar.js, views.js

**render/**
- PostFX.js: Post-processing as an ordered list of named effects in four…
- effects.js: Built-in shader effects (used by render/materials.js): the …
- lights.js: Default lights every engine has: a directional "sun" + hemi…
- materials.js: Materials and shaders: Material factory makeMaterial(role, …
- patches.js: Named shader patches: one way to add shader code to any thr…

**ui/**
- Focus.js: UI focus stack: windows, dialogue, cutscenes and the settin…
- LoadingScreen.js: Default 'loading' UI part: covers the view at start, shows …
- Parts.js: UI parts (engine.ui): every piece of screen UI the engine o…
- UI.js: UI base
- defaults.js: The core UI parts every engine declares: 'loading' (on), 't…
- theme.js: UI theme and default CSS in <head> (part of ui/UI.js): the …
- touchPart.js: Default 'touch' UI part: an on-screen stick (bottom left) a…

**styles/** (one line per folder: what it does; its files)
- lowpoly/ Lowpoly style pack: everything about how the engine looks and sounds lives here — index.js, models.js, post.js, shapes.js

## Events (internal emitters and listeners; arguments are in api/events.md)

| Event | Emitted by | Listened by |
|---|---|---|
| anim:end | core/Animator.js | — |
| audio:ready | core/Audio.js | — |
| camera:change | camera | settings |
| camera:shot | camera | — |
| character:jump | characters | — |
| character:land | characters | — |
| character:model | characters | — |
| day:new | sky | — |
| dialogue:end | gameplay | music |
| dialogue:line | gameplay | — |
| dialogue:start | gameplay | music |
| engine:error | core/errors.js | — |
| entity:remove | entities | — |
| entity:spawn | entities | — |
| entity:stage | entities | — |
| entity:state | entities | — |
| flow:change | flow | — |
| flow:transition | flow | — |
| ground:change | terrain | characters |
| i18n:change | core/I18n.js | core/inputTouch.js, gameplay, hud, settings, timeline, ui/UI.js |
| input:context | core/inputContext.js | — |
| input:rebind | core/Input.js, settings | gameplay, timeline, ui/UI.js |
| item:pickup | gameplay | — |
| item:use | gameplay | — |
| level:loaded | level | characters, grid, hlod, nav |
| load | core/saveApply.js | — |
| module:disabled | core/errors.js | — |
| music:change | music | — |
| music:stinger | music | — |
| net:close | net | — |
| net:join | net | — |
| net:leave | net | — |
| net:open | net | — |
| net:result | net | — |
| net:sync | net | — |
| page:blur | core/page.js | core/Input.js |
| page:contextlost | core/page.js | — |
| page:contextrestored | core/page.js | — |
| page:focus | core/page.js | — |
| page:pointerlock | core/page.js | — |
| photo:denied | photo | — |
| photo:taken | photo | — |
| quest:done | gameplay | — |
| quest:fail | gameplay | — |
| quest:part | gameplay | — |
| quest:start | gameplay | — |
| quest:step | gameplay | — |
| save | core/Saves.js | — |
| save:imported | core/saveFiles.js | photo |
| season:change | sky | sky |
| session:end | core/session.js | core/skip.js, flow, gameplay, hud, music, timeline, triggers |
| session:start | core/session.js | camera, flow |
| settings:change | settings | — |
| settings:shadows | core/Engine.js | terrain |
| state:applied | core/UrlState.js | — |
| time:skip | core/skip.js | — |
| timeline:end | timeline | — |
| timeline:start | timeline | — |
| trigger:enter | triggers | camera, content, music |
| trigger:exit | triggers | content, music |
| ui:close | ui/Parts.js, ui/UI.js | core/Engine.js, settings |
| ui:open | ui/Parts.js, ui/UI.js | core/Engine.js, settings |
| vegetation:remove | vegetation | — |
| vegetation:restore | vegetation | — |
| vehicle:enter | characters | characters |
| vehicle:exit | characters | characters |
| water:add | core/ground.js | water |
| water:remove | core/ground.js | water |
| weather:lightning | weather | weather |
| world:add | world | grid |
| world:change | world | grid |
| world:load | world | characters, content, entities, gameplay, grid |
| world:ready | core/startup.js | content, flow |
| world:remove | world | characters, entities, gameplay, grid |

## Key actions (engine.input)

| Action | Default keys | Text key | Registered at |
|---|---|---|---|
| moveForward | ['KeyW', 'ArrowUp'] | input.moveForward | core/Input.js |
| moveBack | ['KeyS', 'ArrowDown'] | input.moveBack | core/Input.js |
| moveLeft | ['KeyA', 'ArrowLeft'] | input.moveLeft | core/Input.js |
| moveRight | ['KeyD', 'ArrowRight'] | input.moveRight | core/Input.js |
| run | ['ShiftLeft', 'ShiftRight'] | input.run | core/Input.js |
| interact | ['KeyE'] | input.interact | core/Input.js |
| confirm | ['Space', 'Enter'] | input.confirm | core/Input.js |
| cancel | ['Escape'] | input.cancel | core/Input.js |
| rotateLeft | rotateKeys.left//['KeyQ'] | camera.rotateLeft | camera |
| rotateRight | rotateKeys.right//['KeyR'] | camera.rotateRight | camera |
| jump | opts.jumpKeys//['Space'] | input.jump | characters |
| brake | ['KeyB'] (parameter brakeKeys) | input.brake | characters |
| debugPanel | ['F3'] | debug.toggle | debug |
| 'choice'+i | ['Digit'+i,'Numpad'+i] | dialogue.choice | gameplay |
| inventory (parameter action) | ['KeyI'] (parameter keys) | inventory.action | gameplay |
| quests (parameter action) | ['KeyJ'] (parameter keys) | quests.action | gameplay |
| rotate (parameter rotate) | ['KeyR'] | grid.rotate | grid |
| photo | ['KeyP'] (parameter keys) | photo.action | photo |
| menu (parameter action) | ['Escape'] (parameter keys) | settings.action | settings |
| skip | ['Escape', 'Backspace'] (parameter skipKeys) | timeline.skipAction | timeline |
| triggersDebug (parameter action) | keys | triggers.debug | triggers |

## i18n key groups (engine.t; full keys are in each string table)

- core/I18n.js: common.* (8), loading.* (6), input.* (8), key.* (5), ground.* (1), module.* (31), shop.* (1)
- core/page.js: page.* (2)
- core/saveFiles.js: saves.* (7)
- modules/camera/common.js: camera.* (2)
- modules/characters/index.js: npc.* (1), input.* (2)
- modules/debug/DebugPanel.js: debug.* (1)
- modules/entities/Entities.js: entities.* (1)
- modules/gameplay/Dialogue.js: dialogue.* (2)
- modules/gameplay/Inventory.js: inventory.* (8)
- modules/gameplay/Quests.js: quests.* (7)
- modules/grid/preview.js: grid.* (1)
- modules/hud/index.js: hud.* (1)
- modules/level/index.js: level.* (2)
- modules/photo/Photo.js: photo.* (1)
- modules/rigid/Vehicles.js: vehicle.* (2)
- modules/settings/strings.js: settings.* (41)
- modules/terrain/index.js: ground.* (11)
- modules/timeline/Timeline.js: timeline.* (2)
- modules/triggers/index.js: triggers.* (1)
- modules/weather/Weather.js: weather.* (8)
- ui/defaults.js: title.* (3)

## Style pack keys (who reads engine.style.xxx)

| Key | Read in |
|---|---|
| ambience | ambience |
| character | characters |
| footstepMap | characters |
| grid | grid |
| models | content, entities |
| music | music |
| particles | particles |
| pickup | gameplay |
| seasons | sky |
| sky | sky |
| sounds | core/Audio.js |
| terrain | terrain |
| triggers | triggers |
| ui | gameplay, hud, ui/LoadingScreen.js, ui/UI.js |
| water | water |
| weather | weather |
