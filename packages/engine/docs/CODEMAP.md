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
| level | modules/level/index.js | — | world, content | world | after terrain |
| terrain | modules/terrain/index.js | — | vegetation | world | — |
| vegetation | modules/vegetation/index.js | — | terrain, level | world | after terrain, level |
| world | modules/world/index.js | — | — | world | — |
| sky | modules/sky/skyModule.js | — | — | environment | — |
| water | modules/water/Water.js | — | — | environment | after sky |
| weather | modules/weather/Weather.js | sky | — | environment | before sky |
| entities | modules/entities/Entities.js | world | sky, interactions, collision | gameplay | after interactions, dialogue, triggers |
| dialogue | modules/gameplay/Dialogue.js | — | — | gameplay | after interactions |
| interactions | modules/gameplay/Interactions.js | — | — | gameplay | — |
| grids | modules/grid/index.js | world | — | gameplay | — |
| triggers | modules/triggers/index.js | — | level | gameplay | after interactions |
| hud | modules/hud/index.js | — | inventory, content, level, quests | presentation | after particles, settings |
| particles | modules/particles/Particles.js | — | — | presentation | — |
| settings | modules/settings/Settings.js | — | terrain, vegetation | presentation | — |
| ambience | modules/ambience/Ambience.js | — | — | late | — |
| characters | modules/characters/index.js | — | cameraRig, sky, interactions, dialogue, nav, collision, rigid, world | late | — |
| collision | modules/collision/Collision.js | — | — | late | — |
| content | modules/content/index.js | — | level, sky, inventory, quests, particles, hud, vegetation, dialogue, triggers, collision, world, interactions, grids, rigid | late | — |
| debug | modules/debug/DebugPanel.js | — | sky, weather, terrain | late | — |
| flow | modules/flow/index.js | — | music | late | — |
| inventory | modules/gameplay/Inventory.js | — | world | late | — |
| quests | modules/gameplay/Quests.js | — | — | late | — |
| hlod | modules/hlod/index.js | — | terrain, level | late | — |
| lightPool | modules/lights/index.js | — | — | late | — |
| nav | modules/nav/index.js | — | — | late | — |
| net | modules/net/index.js | — | world, inventory | late | — |
| photo | modules/photo/Photo.js | — | cameraRig, sky, vegetation, entities | late | — |
| rigid | modules/rigid/RigidBodies.js | collision | interactions | late | — |
| music | modules/music/Music.js | — | dialogue | audio | — |

## Files


**./**
- index.js: Engine entry

**core/**
- Animator.js: Animation state machine: assets.animate(model, config) retu…
- Assets.js: Asset management: Asset manifest: register every model, tex…
- Audio.js: Audio core: buses (master, music, sfx, ambience, ui + the g…
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
- InspectScene.js: engine.inspect.scene(): "the mesh exists but I do not see i…
- Jobs.js: engine.jobs: a frame-sliced job scheduler
- Loading.js: engine.loading: one observable view of everything startup (…
- Ops.js: One entry point for actions: engine.ops
- Random.js: Seeded random numbers, engine.random: gameplay randomness (…
- Rays.js: Rays: engine.raycast / engine.pick, with the registry engin…
- SaveStore.js: Save storage layer: uses the browser's native IndexedDB (no…
- Saves.js: Saves: each module registers "how to save and load", and sa…
- Stream.js: Spatial stream-in, engine.stream: entries are only register…
- Threads.js: engine.threads: a small worker pool
- UrlState.js: Reproduce a scenario in one call: engine.applyState({ time,…
- Vars.js: Story flags and counters, engine.vars (saved automatically …
- actor.js: Who acts for the local user (part of Engine, mixed into Eng…
- assetEntry.js: The life of one engine.assets entry, split from Assets.js (…
- assetLoad.js: File loading for engine.assets, split into the phases engin…
- assetManifest.js: engine.assets.manifest(pack) (helper of Assets.js): registe…
- audioRules.js: The data side of audio rules: condition keys, measures (com…
- audioVoice.js: One playing sound (a "voice") of engine.audio.sfx / play: s…
- batchGroups.js: InstancedMesh side of engine.batching (core/Batching.js): b…
- canvasBox.js: The canvas's CSS box and the UI root laid over it (split ou…
- dayTime.js: Clock-time conversion (pure functions): sky time of day `ti…
- describeRender.js: describe().render: what the renderer, lights and post effec…
- describeText.js: engine.describeText(): write describe() as plain English fo…
- easing.js: Easing functions: input progress 0..1, output 0..1 (back/el…
- errorCodes.js: Stable error codes: errors the engine raises by name end th…
- errorHints.js: Error hints: a table of "message pattern -> likely cause + …
- errors.js: Error tiers: what to do when a module hook, onFixed / onFra…
- events.generated.js: Generated, do not edit by hand: npm run map generates it fr…
- ground.js: Ground API (part of Engine, mixed into Engine.prototype): w…
- inputContext.js: Input contexts (like Unity's Action Maps): a stack of named…
- inputDefaults.js: Input defaults and strings (split out of Input.js): neutral…
- inputPad.js: Gamepad (standard layout) button names; like keyboard key n…
- inputPointer.js: The mouse / touch pointer part of input: drag to look, whee…
- inputTouch.js: The touch part of input: which on-screen controls the game …
- lifecycle.js: Engine lifecycle (part of Engine, mixed into Engine.prototy…
- lightWatch.js: Dev-only check (called from loop.js after each render once …
- loop.js: Main loop (part of Engine, mixed into Engine.prototype): fi…
- math.js: Small shared helpers (used by several modules)
- modules.js: Module installation (part of Engine, mixed into Engine.prot…
- movement.js: One shared definition of "can walk there": character radius…
- mulberry32.js: mulberry32, the one copy (engine.random and terrain placeme…
- opsCheck.js: Dev checks for engine.ops (split out of Ops.js): op definit…
- opsGuard.js: The dev guard of engine.ops (split out of Ops.js): reports …
- opsHistory.js: The history of engine.ops (split out of Ops.js): a ring of …
- page.js: engine.page: the one place that listens to the browser wind…
- pureWorker.js: Worker that runs pure-function batches for engine.threads (…
- saveApply.js: Applying a save (split out of Saves.js): every part is chec…
- saveFiles.js: Save files (.json download / restore), split out of Saves.j…
- saveIds.js: Record ids inside save data, for upgrade steps (saves.regis…
- saveVersions.js: Save format and per-part versions
- scatter.js: Scatter by rule: where instances go in one ground chunk (pl…
- sceneMethods.js: Scene and render settings on the engine (split out of Engin…
- screenToGround.js: Screen point -> ground point: what clicking the ground mean…
- session.js: engine.session: one playthrough, from "new game" or "load" …
- shadowTypes.js: three 0.187 shadow filters
- skip.js: Skipping time (part of Engine, mixed into Engine.prototype)…
- startup.js: Startup (part of Engine, mixed into Engine.prototype): star…
- streamCells.js: Per-chunk view of stream sources for loaders that sync whol…
- streamSources.js: Stream sources (internal half of engine.stream): the places…
- styleParts.js: A style built from parts: createEngine({ style: [lowpoly, {…
- targeting.js: Target selection: pure functions (no camera, input or engin…
- thingOps.js: engine.thing and the two built-in ops on things (thing.set …
- things.js: Object registry behind engine.thing: every root handed to e…
- threadPure.js: Pure functions for workers: a function is sent as its sourc…
- threadServe.js: Worker side of engine.threads lanes: serve(handler) answers…
- tier.js: Device tier: Engine uses it at construction to pick default…
- validate.js: Runtime checks: when an option or name is misspelled, print…

**modules/** (one line per folder: what it does; its files)
- ambience/ Ambience module: a rule table of background sounds — Ambience.js
- camera/ Camera module collection — FirstPersonCamera.js, FixedCamera.js, FollowCamera.js, RtsCamera.js, common.js, index.js, projection.js
- characters/ Characters module: player (keyboard/stick control, camera follow, footsteps, en… — Character.js, NPC.js, assetModel.js, astar.js, behaviors.js, footsteps.js, index.js, moveHelpers.js, movers/common.js, movers/rapier.js, movers/simple.js, npcAvoid.js, npcSim.js, npcView.js, pathAsync.js, pathJob.js, pathWorker.js, playerStrings.js, proceduralRig.js
- collision/ Lightweight collision: characters are upright cylinders, trees/rocks are circle… — Collision.js, grid.js
- content/ Content loader: hands the plain data in the game's content/*.js to the engine (… — ids.js, index.js, loader.js, models.js, packs.js, props.js, rules.js, templates.js
- debug/ Performance panel + time/weather debugging + stress test — DebugPanel.js
- entities/ Entities — Entities.js, build.js, index.js
- flow/ Game flow: states (title, playing, paused, game over...) and scene transitions … — index.js
- gameplay/ Inventory module: define items first, then add/remove — Container.js, Containers.js, Dialogue.js, Interactions.js, Inventory.js, Quests.js, boxOps.js, dialogueBox.js, interactionPrompt.js, inventoryOps.js, pickups.js, questLog.js, questSave.js
- grid/ grids() module: placement grids for anything placed on cells (furniture, buildi… — Grid.js, Layer.js, index.js, ops.js, preview.js, tiles.js
- hlod/ HLOD: merge far-away buildings into a few proxy meshes, show originals when nea… — index.js
- hud/ Objective markers and a simple HUD: world markers (an edge-of-screen arrow when… — index.js, parts.js
- level/ Level module: load a hand-built scene (glTF/GLB from Blender, or THREE objects … — geometry.js, heightfield.js, index.js, nodes.js
- lights/ Light pool: many light sources (torches, street lamps, campfires, muzzle flashe… — index.js
- music/ Background music module entry — Music.js, index.js, rules.js
- nav/ Navmesh (Recast): generated after a level loads; engine.characters.findPath swi… — index.js, navPath.js
- net/ net() module: optional co-op multiplayer, host authority + state sync — Client.js, Host.js, Net.js, index.js, sync.js, transports.js
- particles/ Particles module: dust, falling leaves, splashes, chimney smoke, sparks.. — Particles.js, effect.js, shaders.js
- photo/ Photo mode: while taking the shot, temporarily raise resolution and shadow prec… — Photo.js
- rigid/ Real physics (Rapier): objects that topple, roll, get pushed and float on water — RigidBodies.js, Vehicles.js, sync.js
- settings/ Settings menu module entry — Settings.js, apply.js, index.js, sections.js, strings.js, view.js
- sky/ Sky module: dome shader (gradient + sun + moon + stars), sun/moon directional l… — Sky.js, calendar.js, cascades.js, clouds.js, domeLayers.js, environment.js, fog.js, frame.js, layers.js, look.js, schedule.js, shader.js, shadow.js, skyModule.js
- terrain/ Terrain module: chunked, streamed ground built from a height function (or a hei… — ChunkManager.js, chunkJob.js, chunkQueries.js, chunkWorker.js, index.js, mountTerrain.js, terrainColorMap.js, terrainDefaults.js, terrainEdit.js, terrainGen.js, terrainIsland.js, terrainMesh.js, terrainShape.js, terrainShapeMain.js, terrainTexture.js
- timeline/ Timeline: cutscenes, camera moves, scripted movement — Timeline.js, Tween.js, letterbox.js, shots.js
- triggers/ Trigger zone module: invisible regions in the world that notify you when the pl… — index.js
- vegetation/ Vegetation module factory: engine.use(vegetation(...)) — Vegetation.js, groundChunks.js, index.js, modelGeometry.js
- water/ Water module: draws the global water plane (sea, big lakes; snaps to a grid fol… — Water.js, surface.js
- weather/ Weather: the game's table of weather types (weather({ types })); without one on… — Weather.js, particles.js, shaders.js
- world/ world() module: installed as engine.world (world data, see World.js) — World.js, cells.js, index.js, persist.js, pos.js, records.js, sim.js, simFar.js, state.js, views.js

**render/**
- PostFX.js: Post-processing as an ordered list of named effects in four…
- detail.js: The `detail` surface patch: grain, paper, brush strokes or …
- effects.js: Built-in shader effects (used by render/materials.js): the …
- engineUniforms.js: Engine uniforms (helper of patches.js): a patch uniform tha…
- fuse.js: Fused post pass: several effects that each carry a small GL…
- lighting.js: The `lighting` surface patch and the toon ramp: extra, opti…
- lights.js: Default lights every engine has (engine.lights, the mechani…
- materials.js: Materials and shaders: Material factory makeMaterial(role, …
- patches.js: Named shader patches: one way to add shader code to any thr…
- surface.js: Surface keys of a material spec (used by makeMaterial): tex…
- uniformDecl.js: Declares style-supplied GLSL uniforms (sky clouds, wind): {…

**ui/**
- Focus.js: UI focus stack: windows, dialogue, cutscenes and the settin…
- LoadingScreen.js: Default 'loading' UI part: covers the view at start, shows …
- Parts.js: UI parts (engine.ui): every piece of screen UI the engine o…
- UI.js: UI base
- defaults.js: The core UI parts every engine declares: 'loading' (on), 't…
- theme.js: UI theme and default CSS in <head> (part of ui/UI.js): the …
- touchPart.js: Default 'touch' UI part: an on-screen stick (bottom left) a…

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
| day:start | sky | — |
| dialogue:end | gameplay | music |
| dialogue:line | gameplay | — |
| dialogue:start | gameplay | music |
| engine:error | core/errors.js | — |
| engine:ready | core/startup.js | content, flow |
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
| save:imported | core/saveFiles.js | photo |
| save:loaded | core/saveApply.js | — |
| save:written | core/Saves.js | — |
| season:change | sky | sky |
| session:end | core/session.js | core/skip.js, flow, gameplay, hud, music, timeline, triggers |
| session:start | core/session.js | core/things.js, camera, flow |
| settings:change | settings | — |
| settings:shadows | core/sceneMethods.js | terrain |
| state:applied | core/UrlState.js | — |
| terrain:void | rigid, terrain | — |
| time:skip | core/skip.js | — |
| timeline:end | timeline | — |
| timeline:start | timeline | — |
| trigger:enter | triggers | camera, content |
| trigger:exit | triggers | content |
| ui:close | ui/Parts.js, ui/UI.js | core/Engine.js, gameplay, settings |
| ui:open | ui/Parts.js, ui/UI.js | core/Engine.js, gameplay, settings |
| vegetation:remove | vegetation | — |
| vegetation:restore | vegetation | — |
| vehicle:enter | characters | characters |
| vehicle:exit | characters | characters |
| water:add | core/ground.js | water |
| water:remove | core/ground.js | water |
| weather:change | weather | — |
| weather:lightning | weather | weather |
| world:add | world | grid |
| world:change | world | grid |
| world:load | world | characters, content, entities, gameplay, grid |
| world:remove | world | characters, entities, gameplay, grid |

## Key actions (engine.input)

| Action | Default keys | Text key | Registered at |
|---|---|---|---|
| moveForward | ['KeyW', 'ArrowUp'] | input.moveForward | core/inputDefaults.js |
| moveBack | ['KeyS', 'ArrowDown'] | input.moveBack | core/inputDefaults.js |
| moveLeft | ['KeyA', 'ArrowLeft'] | input.moveLeft | core/inputDefaults.js |
| moveRight | ['KeyD', 'ArrowRight'] | input.moveRight | core/inputDefaults.js |
| confirm | ['Space', 'Enter'] | input.confirm | core/inputDefaults.js |
| cancel | ['Escape'] | input.cancel | core/inputDefaults.js |
| rotateLeft | rotateKeys.left//['KeyQ'] | camera.rotateLeft | camera |
| rotateRight | rotateKeys.right//['KeyR'] | camera.rotateRight | camera |
| jump | opts.jumpKeys | input.jump | characters |
| run | opts.runKeys | input.run | characters |
| brake | brakeKeys??[] | input.brake | characters |
| debugPanel | ['F3'] | debug.toggle | debug |
| 'choice'+i | ['Digit'+i,'Numpad'+i] | dialogue.choice | gameplay |
| interact (parameter action) | keys | input.interact | gameplay |
| inventory (parameter action) | keys | inventory.action | gameplay |
| quests (parameter action) | keys | quests.action | gameplay |
| "{a}" | ["KeyR"] | undefined | grid |
| rotate (parameter rotate) | rotateKeys | grid.rotate | grid |
| photo | keys | photo.action | photo |
| menu (parameter action) | ['Escape'] (parameter keys) | settings.action | settings |
| skip | ['Escape', 'Backspace'] (parameter skipKeys) | timeline.skipAction | timeline |
| triggersDebug (parameter action) | keys | triggers.debug | triggers |

## i18n key groups (engine.t; full keys are in each string table)

- core/I18n.js: common.* (8), loading.* (6), input.* (8), key.* (5), ground.* (1), module.* (32), shop.* (1)
- core/page.js: page.* (2)
- core/saveFiles.js: saves.* (7)
- modules/camera/common.js: camera.* (2)
- modules/characters/playerStrings.js: npc.* (1), input.* (2)
- modules/debug/DebugPanel.js: debug.* (1)
- modules/entities/Entities.js: entities.* (1)
- modules/gameplay/Dialogue.js: dialogue.* (2)
- modules/gameplay/Quests.js: quests.* (7)
- modules/gameplay/inventoryOps.js: inventory.* (8)
- modules/grid/preview.js: grid.* (1)
- modules/hud/index.js: hud.* (1)
- modules/level/index.js: level.* (2)
- modules/photo/Photo.js: photo.* (1)
- modules/rigid/Vehicles.js: vehicle.* (2)
- modules/settings/strings.js: settings.* (42)
- modules/timeline/Timeline.js: timeline.* (2)
- modules/triggers/index.js: triggers.* (1)
- modules/weather/Weather.js: weather.* (8)
- ui/defaults.js: title.* (3)

## Style pack keys (who reads engine.style.xxx)

| Key | Read in |
|---|---|
| character | characters |
| grid | grid |
| palette | core/Assets.js, core/assetLoad.js |
| particles | particles |
| pickup | gameplay |
| post | core/describeRender.js |
| seasons | sky |
| sky | sky |
| terrain | terrain |
| triggers | triggers |
| ui | gameplay, hud, ui/LoadingScreen.js, ui/UI.js |
| water | water |
| weather | weather |
| wind | vegetation |
