# Engine API index (generated, do not edit by hand; produced by npm run map)

> **To do something, first look at the recipe in `recipes/` whose file name matches** (it has a ready-made pattern, faster than browsing the API): 01-new-game · 02-npc · 03-items-pickups · 04-quests · 05-props-bake · 06-clock-events · 07-flow-scenes-pause · 08-weather-sky · 09-style-pack · 10-blender-level · 11-vehicles · 12-navmesh · 13-animation · 14-custom-module · 15-perf · 16-dev-bridge · 18-world · 19-shooting-picking · 20-content-actions-save · 21-camera · 22-shop-gold · 23-ops · 26-ui-parts · 27-net · 28-terrain · 29-grid · 30-templates · 31-audio
> The api pages are generated too, do not edit them by hand; `?` in a signature means optional, what follows `→` is the return value; the full types are in `types/*.d.ts`.
> With no matching recipe: read this page first: the core everyday API + one line per core object / module (listing method names). For the one you need, **read only that page** `api/<name>.md` (methods, parameters, properties and data structures are all in it).
> Paths are relative to the package (`node_modules/threedog/`). Entry: `import { createEngine, openWorld, … } from 'threedog'` (the engine package's own examples use relative paths); a module that is not installed is undefined, so use `engine.xxx?.method()`.

## Core everyday API (all methods, properties, createEngine options and how to write a module are in [api/engine.md](api/engine.md))
- `createEngine(opts: EngineOptions) → Engine` — creates the engine (core only); options: canvas style loading saveKey headless budget …
- `openWorld(opts: OpenWorldOptions) → ModuleDef[]` — open-world preset (world and environment + basic modules; add gameplay modules yourself; `xxx: false` turns one off), options in [api/openWorld.md](api/openWorld.md)
- `engine.use(...mods: ModuleInput[])` — Install one or more modules
- `engine.start() → Promise<this>` — Start: initialize modules, preload assets, wait for the world to be ready
- `engine.step(seconds: number, opts?: { render?, frameEvery?, describe? }) → GameState | null` — Advance seconds of fixed-step time synchronously
- `engine.describeText(opts?: { radius?, full?, path? }) → string` — The same information as English text, summary first: at most 30 lines…
- `engine.applyState(params: StateParams) → Promise<void>` — Set up a scenario: time of day, weather, player position, load a save, advance time, skip cutscenes
- `engine.onFixed(fn: (dt: number) => void) → Handle` — Fixed-step logic (60 times per second, dt in fixed seconds): movement, physics, cooldowns, and game…
- `engine.onFrame(fn: (dt: number) => void) → Handle` — Once per frame (dt in frame seconds): animation, camera, UI and UI keys…
- `engine.add(obj: T, ...more: Object3D[]) → T` — Add an object to the scene, returns the first one
- `engine.remove(...objs: Object3D[])` — Fully delete an object (use it when you no longer want the object): removes it from its parent, unr…
- `engine.surface(x: number, z: number, refY?: number) → number` — Ground height (meters) at (x, z)
- `engine.snapToGround(obj: T, offset?: number) → T` — Put an object on the ground under it (y = ground height + offset) and return the object
- `engine.raycast(origin: Vec3Like, dir: Vec3Like, opts?: RaycastOptions) → RayHit | null` — Ray: shoot from origin along dir, returns the nearest hit or null…
- `engine.pick(ndcX: number, ndcY: number, opts?: RaycastOptions) → RayHit | null` — Shoot a ray through the camera from screen coordinates (-1..1, e.g. input.pointer.ndcX/ndcY)
- `engine.freeze(owner?: string)` — Gameplay pause (menu, flow's paused): fixed steps are skipped entirely…
- `engine.pause()` — Pause the real-time loop: the picture stops and even rendering stops, only step() advances…
- `engine.stateApplied` — Scenario is ready: start() completed, and the URL parameters / the latest applyState have all been …
- `engine.ready` — True once start() completes and the loading screen is gone…
- `engine.player` — The player (exists only after characters.createPlayer())
- `engine.scene` — three.js scene
- `engine.camera` — three.js perspective camera

## Core objects (engine.xxx, no install needed)
- [`engine.events`](api/events.md) the event bus: recent on once emit; event table
- [`engine.input`](api/input.md) Input: read by "action": define touchButton simulate rebind keysOf label down pressed released pressedRaw push
- [`engine.clock`](api/clock.md) game seconds and "after how long / every how long": after every
- [`engine.vars`](api/vars.md) story flags and counters (autosaved): flag setFlag counter bump
- [`engine.saves`](api/saves.md) engine.saves handles saving: register queue flush collect check apply save load list remove export import exportFile importFile …
- [`engine.assets`](api/assets.md) Assets: manifest preload model modelNow geometry texture release trim users forget cached animate
- [`engine.audio`](api/audio.md) buses: addBus setVolume duck register condition matches sfx noiseBurst tone load play
- [`engine.i18n`](api/i18n.md) string tables: add setLocale has t
- [`engine.rays`](api/rays.md) engine.rays is the ray registry…: addStatic forget addProvider cast pick
- [`engine.jobs`](api/jobs.md) engine.jobs queues build work in a binary heap: add run
- [`engine.stream`](api/stream.md) engine.stream builds on demand by space: only entries n…: add setRadius source teleport readyCheck sources
- [`engine.budget`](api/budget.md) performance budget (turned on by createEngine: enable disable metric limitOf report checkStartup values byTag
- [`engine.post`](api/post.md) PostFX: add get enable list
- [`engine.ground`](api/ground.md) Ground: whoever provides the ground height is the "terr…: height slope type forEachCollider viewRange chunkCollision staticTrimeshes staticVersion navGeometry

## Modules (installed with engine.use; the openWorld preset installs only world and environment, see [api/openWorld.md](api/openWorld.md))
- [`engine.terrain`](api/terrain.md) terrain() Procedural terrain: setViewChunks setDensity rebuild edit isReadyAround
- [`engine.vegetation`](api/vegetation.md) vegetation() Vegetation: add get list isRemoved removeInstance restoreInstance instanceAt
- [`engine.sky`](api/sky.md) sky() Sky, day/night, calendar: modify at between daily onSeason setShadow setShadowMapSize
- [`engine.weather`](api/weather.md) weather() Weather: setAuto set label
- [`engine.water`](api/water.md) water() Water surface
- [`engine.world`](api/world.md)  World data: add origin idOf get set move remove query forEachNear present view refresh …
- [`engine.net`](api/net.md)  net: reconnect
- [`engine.grids`](api/grids.md)  grids: add get list define preview
- [`engine.collision`](api/collision.md) collision() Lightweight collision: addCircle addBox addObject forEachStatic walkable walkableAt
- [`engine.rigid`](api/rigid.md) rigid() Real physics, Rapier: addBox addBall addHull impulse setPosition groundReady addVehicle
- [`engine.cameraRig`](api/cameraRig.md) followCamera() / firstPersonCamera() / fixedCamera() / rtsCamera() Current camera: follow forward right focusPoint update onOverride onEnter onExit
- [`engine.timeline`](api/timeline.md) timeline() Cutscenes, tweens: tween play skip
- [`engine.level`](api/level.md) level() Hand-built level: marker markersWith unload load track
- [`engine.triggers`](api/triggers.md) triggers() Trigger zones: list add clear byTag fromMarkers setDebug
- [`engine.entities`](api/entities.md) entities() Entities: define spawn get byType list nearest remove clear setStage
- [`engine.particles`](api/particles.md) particles() Particles: define has emit attach count clear
- [`engine.settings`](api/settings.md) settings() Settings menu: get set preset define addSection removeSection open close toggle resetBindings rebind actionList …
- [`engine.music`](api/music.md) music() Background music: addTracks play stop stinger rules override pick
- [`engine.characters`](api/characters.md) characters() Characters: findSpawn createPlayer moveInput removePlayer findPath findPathAsync; Character, NPC; engine.npcs: list add remove behavior get character avoid (behavior and avoid: see recipes/02-npc)
- [`engine.interactions`](api/interactions.md) interactions() Interaction prompts: add get
- [`engine.dialogue`](api/dialogue.md) dialogue() Dialogue: define start say end
- [`engine.inventory`](api/inventory.md) inventory() Inventory: define item count has list get add remove trade setData container transfer …
- [`engine.quests`](api/quests.md) quests() Quests: define start isDone isActive isFailed check list
- [`engine.photo`](api/photo.md) photo() Photo mode: take subject
- [`engine.ambience`](api/ambience.md) ambience() Ambience: add rules nearWater
- [`engine.debug`](api/debug.md) debug() F3 debug panel: startBench
- [`engine.nav`](api/nav.md) nav() Navmesh: findPath dispose
- [`engine.hlod`](api/hlod.md) hlod() hlod: add
- [`engine.lightPool`](api/lightPool.md) lightPool() Light pool: add usage
- [`engine.content`](api/content.md) content() Content loading: load condition test run place where template spawn
- [`engine.flow`](api/flow.md) flow() Game flow and scene transitions: define go transition
- [`engine.hud`](api/hud.md) hud() Objective markers, counters, progress bars: marker counter bar remove

## Other
- [Style pack Style](api/style.md): all look options (sky, weather, water, terrain, UI, materials, particles, sound, models)
- [Utility functions](api/tools.md): presets world net fakeNetwork webSocket grids screenToGround EASINGS ease checkOptions createTerrain terrainMaterial mergeColored applyEffects MATERIAL_PURPOSES makeMaterial materialPatches toast makeWindow worldToScreen fadeScreen uiFocus toggleOnKey parseClock …
