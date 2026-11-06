# Additional conventions (read when the task is relevant)

For API details see `api/<module>.md`; this file holds conventions that don't belong to one API but cause problems when broken. `AI.md` lists each in
one line; the detail is here.

## Where a thing goes in the world

| The thing | Use |
|---|---|
| Built by code on every start | `scene.add` (plain three.js) or `engine.add` |
| Must be saved, or live on while far away | `engine.world` (`world.add`, `world.present` for its model) |
| Written as data | `content`, the data front of `engine.world` |
| Drawn in a level file | a level, through `level()` |
| Placed on cells | `engine.grids`, on top of the above |

`engine.stream` is the low-level loader under these; reach for it only for your own distance-based loading.

## World data and level ownership
- **World data**: game objects that must be saved, survive level changes, or change while far away go in `engine.world` (the model is built with
  `present` only when near, the simulation runs with `simulate`).
  Items written in content use `add(def, { initial: true })` (an id is required; a save records only changes and deletions, independent of the order
  relative to content.load); items generated at runtime use a plain `add`; temporary ones use `{ save: false }`;
  discrete changes use `world.set` (it emits world:change), things that change every step modify the field directly or use `move`. Usage is in `api/world.md`.
- **Level ownership**: world data carrying `zone: engine.world.zone` (= the current level name) gets its model built and is simulated only in that
  level; when you leave, the data stays (content NPCs, pickups and props already work this way);
  things that need not be kept (trigger zones, etc.) use `level.track(handle)` and are deleted automatically on level change.
- **Module type**: a module says what it owns with `type` (`'rules'` for game logic, the default; `'world'` state that draws nothing, `'picture'` what is
  seen and heard, `'ui'` panels, `'actor'`, `'net'`, `'tool'`; recipes/14). Modules depend on capabilities (`requires: ['inventory']`), never on
  another module's name or private fields; a module doing two kinds of thing is two definitions from one factory (`weather()`: state + drawing).
- **Who owns a handle**: every `{ remove() }` handle has one owner that removes it, chosen by how long it should live: the module
  (`ctx.track(h)` in its install / init: until the module goes), the playthrough (`engine.session.track(h)`: until newGame / load / quit), or
  the level (`level.track(h)`: until the level changes). A handle with none lives until `engine.dispose()`.
- **Two doors, one scene**: plain three.js (`engine.add(mesh, { id })`) and templates (`engine.content.spawn`, props) land in the same registry;
  `engine.thing(id)` says what it is and what a save keeps (`recipes/40-scene.md`). What must be saved with its own state or edited without
  code goes in `content/` (templates + props with ids, pickups, npcs, containers, game kinds) or the level model; a save stores only changes on top.
  Startup code never creates what a save stores whole (rule R33): things that appear during play come from `engine.content.spawn` inside an op.
- To find leaks read `engine.counts()` (listeners, timers, geometry count; they should not grow when entering and leaving a level repeatedly).

## Textures
The opts of `assets.texture(name, opts)` are part of the cache key: the same image with different opts gives two separately configured textures.

## Values the engine writes on its own (camera, shadow box)
Lights, fog, exposure and the environment have one writer, the game's `picture/` code: the sky computes signals and no module writes them (`recipes/62-picture-code.md`). With a camera module the
engine writes the `camera` pose every frame, and a sky keeps the shadow box around the focus. Setting one of those directly is plain three.js and works: the engine yields that value (stops
writing it, warns once). The camera: `engine.takeCamera(owner)` or a timeline camera step.

## Layers the engine keeps
The three.js layers below belong to the engine (one table: `RESERVED_LAYERS` in `threedog/layers`, file `render/layers.js`). A game's own layers are 1 to 25; 30 is the default camera `hideLayer`.

| Layer | Name | What sits there |
| --- | --- | --- |
| 26 | `lightVolumes` | the box of air and the lights `lightVolumes` reads |
| 27 | `occlusionBox` | occlusion culling's query boxes, seen by the scene render of the view camera alone |
| 28 | `occlusionHidden` | what culling is not drawing now, still seen by shadows, `engine.rays` and `voxelGI` |
| 29 | `outlineOff` | objects `outline({ offLayer })` leaves without lines; `OUTLINE_OFF_LAYER` from `@threedog/post-effects` is this same layer |
| 31 | `batched` | originals drawn through `engine.batching`, still hit by `engine.rays` |

## Customization ladder
Pick the row for what you want; each row is the one entry for it (take the first that fully works). Plain JS fields and your own `onFixed`
logic need none of this.

| You want to | Use | Detail |
|---|---|---|
| Tweak a parameter of a system | its options (`createEngine({...})`, `terrain({...})`, `openWorld({...})`; unknown keys throw), or content data | `api/<module>.md` |
| Let several systems change one shared value (speed, time scale, gravity, damage taken): the game sets, effects multiply, settings cap | `engine.mod(point, { owner, set \| add \| mul \| clamp, for })`, in a module `ctx.mod`; `mul` / `add` cooperate, two owners' `set` on one layer is an error with the fix; your own point: `engine.stacks.define` | `recipes/55-mods-time-wrap.md` |
| Run code before / after / around a module method (a weight limit on `inventory.add`) | `engine.wrap(engine.inventory, 'add', (next, ...a) => next(...a), { owner })` | `recipes/55-mods-time-wrap.md` |
| Close one action for a while (stunned: no jump) | `engine.input.gate(action, { owner, for })` | `recipes/55-mods-time-wrap.md` |
| Replace a whole system (your own inventory, interactions, dialogue, quests, flow, characters, camera, collision, level; your own vehicle for `character.enter`) | `engine.use(mine(), { replaces: '<slot>' })` for a part that `provides` that slot; a module (or object) that meets that contract (`<module>.contract.js`; vehicle: `modules/characters/vehicle.contract.js`), checked with `runContract` | `recipes/55-mods-time-wrap.md` "Replacing a module" |
| Change a picture value (light, fog, sky, water, tone, post) | write it in your `picture/` code on the three.js object or the module's `material` (recipe 62); a value the engine drives (camera far, fov, pixel ratio): `engine.autoView.manual(key)` first; a screen effect: `engine.post.add(x)` |
| Write the picture yourself | plain three.js on `engine.scene / camera / renderer` (own material, `ShaderMaterial`, pass); a direct write takes that value over and the engine yields | `THREE.md` |

**What can be replaced**: a slot with a contract file (inventory, interactions, dialogue, quests, flow, characters, calendar, cameraRig, particles, collision, level, nav) lists what a replacement must supply, and `runContract` checks it. `nav` is narrower than the others: the path search calls Recast's `findPath` and `findStraightPath` on `query` and `getOffMeshConnectionByRef` on `navMesh`, the path worker gives the bytes from `exportMesh` to Recast's `importNavMesh`, and NPC steering calls `addAgent` on `crowd`, so a replacement is Recast underneath (a different mesh build, say), not another navigation library. For a search of another kind, leave `nav()` out and call yours from game code. The slots below have no contract; a replacement must supply what the engine's own callers read:

| Slot | A replacement must supply |
|---|---|
| `sky` | the `engine.uniforms` signals your `picture/` code reads; `dome` (the object a photo leaves out) if it has one |
| `terrain` | the ground through `engine.setGround`; `chunkSize`, `stats`, `edit` (nav), `view` and `setPlanter` (vegetation). Replace `terrain-draw` with it: the drawing half reads the engine terrain's chunks |
| `weather` | `types`, `name`, `current`, `label(name)`, `set(name, { seconds })`, `setAuto(on)`. Replace `weatherDraw` with it |
| `vegetation` | `define(name, rule)` (content), `instanceAt(point, { radius })` (photo), `host` (settings). Replace `vegetation-draw` with it |
| `rigid` | `vehicles`, a list of objects that meet `modules/characters/vehicle.contract.js` |
| `swarm` | nothing: no other module calls it |

**Not replaceable**: `world` (saves, the shared id space, streaming and content stand on its records; it provides the slot so that `requires: ['world']` names a capability), and the player inside `characters` (a replacement of `characters` leaves a live player's `world` record behind, and `engine.player` is the engine's own character; steer it with `control.take`).

The starting picture comes from the game's `picture/` folder; what it builds as a factory can also be passed at the call site, and the
call site wins (`terrain({ material })` and the like; the water surface is `engine.water.material`); a new style factory ships with its call-site option. No module option starts a value taken over.

**Time channels**: most games use only the default (fixed `dt` in real seconds, `engine.clock` for calendar time). A channel exists so one group
of things can run slower or faster than the rest (bullet time on enemies, haste on the player): `engine.onFixed(fn, { channel: 'enemies' })` gets
that channel's scaled `dt`, and `engine.mod('time.enemies', { owner, mul })` scales it; units and which clock to use: `recipes/06-clock-events.md`.

### One task, which entry
Where a task has more than one entry they are layers of the ladder above, not alternatives: take the first, go down only for the reason given.
Picture rows (light, glow, environment, post) follow the order in `THREE.md` (plain three.js first): they name the hook your three.js code plugs
into, or a convenience for after.

| Task | First | Go down a layer when |
|---|---|---|
| Windows, signs, screens glow at night | a material whose `emissiveIntensity` reads `engine.uniforms.uNight` (recipe 09 §1b) | `lightPool.add(obj, { glow })` is something else: the stand-in a pooled lamp shows while it holds no real light |
| Time of day | `engine.calendar` (`calendar({ time })`) | no calendar at all (one fixed scene): `sky({ time })`; timers: `engine.clock`; one group faster / slower: a time channel |
| Sun / light strength | your own three.js light in `picture/`, reading `engine.uniforms` (recipe 62) | the placeholders: write `engine.lights.sun` directly |
| A game test (write one for your game) | a spec file `tests/specs/<name>.mjs` exporting `specs` (COMMANDS.md "A game's tests": minimal example, `threedog test <name>`) | the test is steps and checks only: a scenario JSON `tests/scenarios/<name>.json` (recipes/23 §7); compare whole state: describe snapshots (recipes/16 §7) |
| Teleport the player | `player.placeAt(p)` in an op | not streamed in yet: `await engine.stream.teleport(p)` (waits, then places); a test or scenario: `applyState({ pos })` |
| Camera | install one: `openWorld({ camera })`, `engine.use(fixedCamera({ position, lookAt }))` | switch kinds at runtime: `setCamera(kind)`; a shot of your own: `takeCamera(owner)` |
| Sky | `sky({ ... })` start values, tuned through `engine.uniforms` and `engine.sky` | a custom sky of your own (shader dome, skybox, painted backdrop): `engine.sky.replace(obj)` (recipe 08 "Your own sky object"); on WebGPU three's `SkyMesh` the same way |
| Environment light | `engine.sky.environment({ into: engine.scene })`, or `scene.environment` | light that changes from place to place: `bakeProbes` |
| Post effects | your own three.js Pass in the engine's chain: `engine.post.add(pass)`, the one way in (the engine renders through its composer) | ready-made effects as an optional convenience: `@threedog/post-effects` through the same call or a plugin file, tuned with its handle; a whole chain of your own: `engine.post.own()` |
| Ambient occlusion | `engine.post.add(ao())` (screen space) | a model made in code: `bakeVertexAO(geometry)`; bounce light between places: `bakeProbes` |

## Owners
Everything that holds the engine is named by an owner, and only that owner releases it. Positional `freeze('menu')` and `freeze({ owner: 'menu' })` are the same.

| What | Take | Release | Returns |
|---|---|---|---|
| Real-time loop | `haltLoop(owner)` (tests and tools; a game freezes) | `handle.remove()` | handle `{ remove() }` |
| Gameplay freeze | `freeze(owner, { kind? })` | `handle.remove()` | handle |
| Camera | `takeCamera(owner, { focus? })` | `handle.remove()` | handle |
| Where a character goes | `control.take(character, { owner, layer, step? })` (layers base < script < cutscene < net; higher pauses lower) | `handle.remove()` | handle `{ active, move(), remove() }` |
| Debug override / view | `debug.override(owner, ...)`, `debug.view(mode, { owner })` | `debug.clear(owner)` | handle / state |

## Worker limits
`modules/terrain/terrainGen.js` (via `chunkJob.js`) runs in a Worker and must not import three.js; a vegetation `rule` is sent to the Worker and must
not contain functions.
Workers are created only through `engine.threads.lane({ create, local })` (the same handler runs on the main thread when there are no workers); no
`new Worker` / `postMessage` elsewhere (`npm run check` rule R19). Worker files import only worker-safe code (a game:
`import { serve } from 'threedog/worker'`; inside the engine `core/threads/threadServe.js`, `core/threads/threadPure.js`), never `core/threads/Threads.js` or three.js.

### Worker results that change gameplay: `engine.commits`
A result that changes gameplay never takes effect "when it arrives"; it takes effect on a fixed tick decided when you ask (`engine.time.tick + lag`,
default 30 steps), so threads on or off, fast or slow machine, give the same state.
```js
const t = engine.commits.request({
  apply: r => { state.path = r; },           // runs on the due tick, with the worker result or the fallback result
  fallback: () => computePath(from, to),     // required: the SAME computation on the main thread
  valid: () => state.gen === myGen,          // still wanted? checked on the due tick
});
lane.run(job).then(r => t.resolve(r));       // when the worker replies; t.remove() if you no longer want it
```
- **The worker result has not come back by the due tick**: the main thread calls `fallback()` right then, `apply` gets that result, and
  `engine.commits.stats.late` goes up by 1. A worker reply that arrives afterwards is ignored. So `fallback` must give the same result as the worker
  (use one function for both) and must be fast enough to run inside one fixed step.
- **Dropping an old result**: `t.remove()`, or `valid()` returning false on the due tick. A save load (`saves.apply`) or `level.load` drops pending
  commits that have no `valid` (they were requested for the old world), including `jobs.add(work, { apply })` started before it (`jobs.add` also takes
  `valid`); a request with `valid` decides itself.

### Pure functions for workers: `engine.threads.pure(fn, label)`
A function sent to a worker (`world.simulate(kind, { far, worker: true })`, your own lane) is sent as source text and recompiled in an empty scope. So
it **cannot use outside variables, `this` or imports**, and cannot be native, bound, a class, `async` or a generator; it may use its parameters,
constants written inside it, and globals such as `Math`. The main thread runs the same recompiled copy, so a mistake fails the same way with threads on or off.
```js
const RATE = 1 / 600;
// wrong: RATE is an outside variable -> ReferenceError "RATE is not defined" (message says to put it inside)
engine.world.simulate('crop', { far: (rec, dt) => { rec.growth += dt * RATE; }, worker: true });
// right: the constant lives inside, or on the record (rec.rate)
engine.world.simulate('crop', { far: (rec, dt) => { rec.growth = Math.min(1, rec.growth + dt / 600); }, worker: true });
```
What is checked when: at registration (`threads.pure` / `simulate`) it checks that the function can be recompiled (not native, not async, parseable).
Outside variables are also scanned at registration and reported by name with the fix (a heuristic scan: it may miss a few forms such as variables
inside template strings, which then throw on the first call).

## Interface conventions (one style across the engine)
- **A position is one argument**: any API that takes a position takes it as a single argument: Vector3, Object3D (its position), `[x, y, z]` or
  `{ x, z }` all work. Size, radius and count go in the options object after it: `collision.addBox(house, { halfWidth: 3, halfDepth: 2 })`,
  `particles.emit('dust', p, { count: 20 })`, `world.query({ near: p, radius, kind })`. A position key inside an options object is always `position`
  (`stream.add({ position, build })`). The only exceptions are ground sampling `engine.surface / slope / groundType / waterAt(x, z)` and
  `ground.height(x, z)`; `{ place, x, z }` in content data is a data form.
- **Registrations return a handle**: anything that registers a listener, timer, continuing effect or registration (`events.on/once`,
  `onFixed/onFrame`, `clock.after/every`, `calendar.at/between/daily/onSeason`, `collision.addBox/...`, `interactions.add`, `rays.addStatic`, `stream.add`,
  `triggers.add`, `hud.marker`, `hlod.add`, `particles.attach`, `pickups.spawn`, `rigid.addBox/...`, `audio.addBus`, `defineState`) returns a
  handle `{ owner?, remove() }`; `h.remove()` undoes it, the only give-back form (no `null` / `false` hand-back calls)
  (safe to call repeatedly), never a bare function. `remove()` undoes what that call did: models it created itself are deleted with it (such as a
  pickup); objects you passed in are not. APIs that add an object or change business data return what their own signature says: `engine.add(obj)`
  returns the added object, `inventory.add` returns a result, `world.add` a record; delete those with `engine.remove(obj)` / their own remove call.
- **Verbs**: defining a kind is `define` (`vegetation.define`, `particles.define`, `grids.define`, `ops.define`); placing one is `add` / `spawn`;
  hooking up a provider the engine calls back is `register` (`saves.register(key, { save, load })`: it defines no kind and places nothing).
  One timer entry: `engine.clock.after(seconds, fn, { data, channel })` (calendar seconds, or `'real'` / a time channel's seconds with `channel`);
  one queue, so `remove()` is immediate: a removed timer never fires, not even later in the same step.
- **Unknown options throw**: every options bag goes through a `readParams` schema (one schema gives the check, the defaults and the catalog entry); an
  unknown key throws in dev with a did-you-mean and warns once in a release build; `checkOptions` is only for extensible data (item, template
  state and material fields, where games add their own keys).
- **Ready is always the boolean property `ready`** (to wait, `await h.whenReady`); a module's readiness hook is `isReady(e)`.
- **Event names are `noun:action`**: the noun is the emitter's singular camelCase name (`item`, `template`...), the action is a lowercase verb or state
  (`add`, `done`, `change`); a game's own events follow the same rule (`door:open`).
- **Time**: one source, `engine.time.tick`; real, ambient, channel and calendar seconds are read-only views (`engine.time.now(name)`), and only
  `core/time/time.js` adds to them (a spec checks). Always name the unit, real, channel or calendar seconds; `recipes/06-clock-events.md` defines them (and the calendar's time of day) and has
  the table of which one to use for movement, action timelines, cooldowns, hit-stop, crop growth, calendar and UI, and what pause / freeze /
  `clock.rate` 2 do to each. Speeds change only through `engine.mod` (the "Customization ladder" above).
- **Input**: gameplay keys (attack, jump, interact...) are read in the fixed step (`onFixed` / module `fixed`), where `pressed / down / released` give
  a snapshot taken at the start of the step, so the result does not depend on frame rate and a press is never lost. UI keys (menus, toggling a view, a
  HUD button) are read in `onFrame` / module `frame`, which gives this frame's latest state. Never read `pointer.clicked` for gameplay; bind a `Mouse0` action.
  Modules declare actions and their context (`ctx.input.action`) and never name a key; the game binds (`createEngine({ bindings })`,
  `input.bind`, `presets.bindings.*`); only the basics (move, confirm, cancel, UI cursor) have default keys (`recipes/58-input.md`).
- **Module names**: `collision()` installs as `engine.collision` (lightweight collision: walking, camera); `rigid()` installs as `engine.rigid` (real
  physics with Rapier).
- **Presets**: `openWorld()` installs only world, environment and basic modules; gameplay modules (interactions, dialogue, inventory, pickups, quests...) are
  added by the game with `engine.use`; pass `false` for items you don't want; the camera has no default and must be named, e.g.
  `openWorld({ camera: 'firstPerson' })` (`'follow'` / `'rts'` / `'fixed'`, a camera module, or `false`).
- **Errors say how to fix it**: passing an old form (a numeric position, etc.) throws and explains the fix.

## Core conventions
- Lighting without `sky`: every engine has `engine.lights = { sun, hemi }` (neutral); to light the scene yourself hide or adjust them and add three.js
  lights. The engine ships no art: the humanoid, pickup shapes and flat shading come from the game's `picture/` folder and `assets.js` (e.g.
  `terrain({ shading: 'flat' })`); without them the engine shows a gray capsule, a gray box and flat gray ground at y = 0, with a
  dev warning naming the fix.
- Gameplay state (world, containers, vars, quests) changes only in fixed steps or inside ops; dev warns otherwise (`npm test` prints the first place, all in
  `<game>/.threedog/ops-guard.log`). (game side)
- **One source for "can walk there"**: `createEngine({ movement: { radius, height, maxSlope, stepHeight } })` -> read-only `engine.movement`;
  collision, the Rapier capsule, navigation, A* and level steps all read it; don't write another 0.4 / 0.45 in a module. A character's position
  belongs to the Character mover; other systems only request movement (`placeAt` / `move` / vehicle `enter`) and never set `player.position` directly.
  Who calls `move` is the character's control holder (`engine.control`, `recipes/57-control.md`): one per step; anyone else is `[control-bypass]`.
- Units are meters, Y is up, north is -Z. Characters and vehicles face the model's +Z; `facing` 0 = +Z, forward = (sin f, cos f).
- Never call `requestAnimationFrame` or `renderer.render` yourself. **Game logic always uses real seconds or calendar seconds** (the hook's `dt`,
  `engine.clock`; see the time table in `recipes/06-clock-events.md`); no `setTimeout` / `setInterval` / `performance.now()`: they ignore pause,
  freeze and `engine.step` fast-forward, so they can't be tested or saved.
- To be saved, call `engine.saves.register(key, { save, load })` (`load` may return a Promise); `saves.save / load` always return `Promise<boolean>`,
  so `await` them. Saved data names things by stable ids, never positions; when it changes shape raise `version` and add a `migrate` step
  (`recipes/20-content-actions-save.md` "Save format").
- Day / night in gameplay comes from the calendar: read `calendar.isDay`, use `calendar.daylight` (0-1) for fades (they work with no sky); don't judge by clock text yourself.
- A game's own picture parameters (colors, materials) can live anywhere plain three.js code lives; its `picture/` folder keeps them in one place (recipe 62).
- Vegetation `rule` must not contain functions (it is sent to a Worker).
- Terrain is editable: `engine.terrain.edit(pos, { lower|raise|flatten|paint })`, only inside an op or fixed step; custom
  `terrain({ height, groundType })` must be pure functions.
- Loading follows the `engine.stream` sources (player + camera focus by default); display, physics and world data are separate: unloading a model
  never removes its world record.
- Window blur, tab hidden, pointer lock and WebGL context loss are listened to only in `core/engine/page.js`; modules read `engine.page` or listen to
  `page:*`. Show "saved" only after `saves.save` returns true.
- Character bodies are assets: `createPlayer({ ...presets.player.thirdPerson, model: 'humanoid' | 'hero' })` (a procedural builder is built
  now; a file shows a gray capsule and is swapped in when it loads: `await player.whenReady`, event `character:model`), or `{ rig }`; a name no model
  asset has throws. Per-character colors: `colors: { body, skin, legs, hair }` on meshes marked `userData.part`.
- Importing the engine makes `Mesh.prototype.customDepthMaterial` / `customDistanceMaterial` default to a depth material carrying the mesh material's
  vertex patches, so wind-swayed meshes cast swaying shadows with nothing to set up; assigning your own value still wins. Shader time, wind and cloud
  cover are per engine in `engine.uniforms` (share them in your own `ShaderMaterial`); with two engines on a page, pass the engine to
  `applyEffects(mat, { engine })`.

## Failures: which shape
A runtime "can't" (not enough money, shelf empty) is returned as `{ ok: false, code, facts, nextActions }` (ops.run / can / undo, and direct calls such as `container.trade`, which a module builds by returning that shape, or a code string from an op's `can`). Misuse (a wrong call, a typo) is a thrown `codedError`. Documented exceptions: `checkSkip` / `checkSave` return `{ ok, diffs }`, `walkTo` returns `{ status }`. Read `code` (there is no `reason` field). Predicates (op `can`, `grid.can()`) may return a plain code string.

Inside the engine a failure takes one of three forms, so every one reaches the reader with a code, a fix and a page: misuse throws `codedError(code, message)` with an `ERROR_CODES` entry (`core/base/errorCodes.js`: what to change, which page to read); a recoverable problem warns once with `warnOnce(coded(code, message))`; a game or module callback that threw goes to `reportError`. Check rule R45 rejects a plain `throw new Error` and a bare `console.warn` / `console.error` in engine code.

## Stability

`@experimental` means one thing: the name may change or go in any version, with no migration note. Everything unmarked is frozen at 1.0.

- **How to see it.** The tag sits on the declaration, so an editor shows it; `api/*.md` prints `(experimental)`; the name's line in `docs/api-surface.txt` ends with it. A tag on a module or an engine member covers what hangs off it. A value or a sub-command has no line of its own, so its docs say so.
- **How it is kept.** The API lock (rule R55) lets a marked name change. Marking a stable name needs a line in the changelog: the mark takes a promise back.
- **Objects from other libraries**, which follow that library's version: `rigid.rapier / world / playerBody / playerCollider`, `nav.navMesh / query / tileCache / crowd / helper`, `assets.gltf / draco / ktx2`, `post.object / targets`, `shadows.csm`.
- **Effects still moving with three.js**: all of `threedog/tsl` and `@threedog/post-effects/tsl`.
- **Names nothing uses yet**: a public name no game, recipe, example or template used at 0.8 stays marked until one does; `docs/api-surface.txt` lists them.
- **Coordination no test game has used**: `engine.stacks`, `engine.wrap`, `engine.mod`, `time.channel / channels`.
- **Systems still settling**: `net()`, `engine.threads`, `engine.commits`, `grids()`, `hlod()`, `swarm()`, `stream.source / teleport / addReadyCheck / sources`, `post.get / own / setAntialias / list`, `world.simulate({ worker })`, `terrain.edit`, `ops.guard / allow`, `terrainDraw`, `vegetationDraw`, `weatherDraw`, `engine.bakeProbes / loadProbes / loadLightmap`.
- **Flat content**: an entry's `source`, `content stamp`, `content capture`.
- **Tuning and readings**: `engine.moduleOrder / moduleStates / disabledModules`, `player.saveMotion / loadMotion`, `jobs.loadingMs / maxSteps / slowStepMs`, `stream.unloadFactor`, `batching.held`, `world.steps`, `level.heightfield`.
- **Commands.** Only the `--json` and MCP shapes are an interface; printed text keeps changing for AI readers. An error's `code` string is frozen, its message is not.
