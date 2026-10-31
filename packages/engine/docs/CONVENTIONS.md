# Additional conventions (read when the task is relevant)

For API details see `api/<module>.md`; this file holds conventions that don't belong to one API but cause problems when broken. `AI.md` lists each in one line; the detail is here.

## World data and level ownership
- **World data**: game objects that must be saved, survive level changes, or change while far away go in `engine.world` (the model is built with `present` only when near, the simulation runs with `simulate`).
  Items written in content use `add(def, { initial: true })` (an id is required; a save records only changes and deletions, independent of the order relative to content.load); items generated at runtime use a plain `add`; temporary ones use `{ save: false }`;
  discrete changes use `world.set` (it emits world:change), things that change every step modify the field directly or use `move`. Usage is in `api/world.md`.
- **Level ownership**: world data carrying `zone: engine.world.zone` (= the current level name) gets its model built and is simulated only in that level; when you leave, the data stays (content NPCs, pickups and props already work this way);
  things that need not be kept (trigger zones, etc.) use `level.track(handle)` and are deleted automatically on level change.
- **Levels are content**: placements come from `content/` (templates + props with ids, pickups, npcs, containers, game kinds) or the level model; a save stores only changes on top of them. Game code never places level objects at startup (rule R33): it holds ops, simulate / present and UI, and spawns during play with `engine.content.spawn` inside an op (`recipes/30-templates.md` section 5).
- To find leaks read `engine.counts()` (listeners, timers, geometry count; they should not grow when entering and leaving a level repeatedly).

## Textures
The opts of `assets.texture(name, opts)` are part of the cache key: the same image with different opts gives two separately configured textures.

## Adjusting sky brightness
The engine overwrites `sky.sun / sky.hemi` (intensity, color, position), `scene.fog` and the `camera` pose every frame; don't set them directly.
Adjust brightness with a modifier layer `engine.sky.modify('layer', { sun, ambient, fog, tint, tintAmount })`: layers multiply, and it doesn't clash with the weather's `'weather'` layer; `modify('layer', null)` removes it, and `sky.modifiers` is the combined result (read-only). Take over the camera with `engine.cameraOverride = { owner }` or a timeline camera step.

## Worker limits
`modules/terrain/terrainGen.js` (via `chunkJob.js`) runs in a Worker and must not import three.js; a vegetation `rule` is sent to the Worker and must not contain functions.
Workers are created only through `engine.threads.lane({ create, local })` (the same handler runs on the main thread when there are no workers); no `new Worker` / `postMessage` elsewhere (`npm run check` rule R19). Worker files import only worker-safe code (a game: `import { serve } from 'threedog/worker'`; inside the engine `core/threadServe.js`, `core/threadPure.js`), never `core/Threads.js` or three.js.

### Worker results that change gameplay: `engine.commits`
A result that changes gameplay never takes effect "when it arrives"; it takes effect on a fixed tick decided when you ask (`engine.tick + lag`, default 30 steps), so threads on or off, fast or slow machine, give the same state.
```js
const t = engine.commits.request({
  apply: r => { state.path = r; },           // runs on the due tick, with the worker result or the fallback result
  fallback: () => computePath(from, to),     // required: the SAME computation on the main thread
  valid: () => state.gen === myGen,          // still wanted? checked on the due tick
});
lane.run(job).then(r => t.resolve(r));       // when the worker replies; t.remove() if you no longer want it
```
- **The worker result has not come back by the due tick**: the main thread calls `fallback()` right then, `apply` gets that result, and `engine.commits.stats.late` goes up by 1. A worker reply that arrives afterwards is ignored. So `fallback` must give the same result as the worker (use one function for both) and must be fast enough to run inside one fixed step.
- **Dropping an old result**: `t.remove()`, or `valid()` returning false on the due tick. A save load (`saves.apply`) or `level.load` drops pending commits that have no `valid` (they were requested for the old world), including `jobs.add(work, { apply })` started before it (`jobs.add` also takes `valid`); a request with `valid` decides itself.

### Pure functions for workers: `engine.threads.pure(fn, label)`
A function sent to a worker (`world.simulate(kind, { far, worker: true })`, your own lane) is sent as source text and recompiled in an empty scope. So it **cannot use outside variables, `this` or imports**, and cannot be native, bound, a class, `async` or a generator; it may use its parameters, constants written inside it, and globals such as `Math`. The main thread runs the same recompiled copy, so a mistake fails the same way with threads on or off.
```js
const RATE = 1 / 600;
// wrong: RATE is an outside variable -> ReferenceError "RATE is not defined" (message says to put it inside)
engine.world.simulate('crop', { far: (rec, dt) => { rec.growth += dt * RATE; }, worker: true });
// right: the constant lives inside, or on the record (rec.rate)
engine.world.simulate('crop', { far: (rec, dt) => { rec.growth = Math.min(1, rec.growth + dt / 600); }, worker: true });
```
What is checked when: at registration (`threads.pure` / `simulate`) it checks that the function can be recompiled (not native, not async, parseable). Outside variables are also scanned at registration and reported by name with the fix (a heuristic scan: it may miss a few forms such as variables inside template strings, which then throw on the first call).

## Interface conventions (one style across the engine)
- **A position is one argument**: any API that takes a position takes it as a single argument: Vector3, Object3D (its position), `[x, y, z]` or `{ x, z }` all work. Size, radius and count go in the options object after it: `collision.addBox(house, { halfWidth: 3, halfDepth: 2 })`, `particles.emit('dust', p, { count: 20 })`, `entities.nearest(p, { radius, type })`. A position key inside an options object is always `position` (`stream.add({ position, build })`). The only exceptions are ground sampling `engine.surface / slope / groundType / waterAt(x, z)` and `ground.height(x, z)`; `{ place, x, z }` in content data is a data form.
- **Registrations return a handle**: anything that registers a listener, timer, continuing effect or registration (`events.on/once`, `onFixed/onFrame`, `clock.after/every`, `sky.at/between/daily/onSeason`, `collision.addBox/...`, `interactions.add`, `rays.addStatic`, `stream.add`, `triggers.add`, `hud.marker`, `hlod.add`, `particles.attach`, `inventory.spawnPickup`, `rigid.addBox/...`) returns a handle; `h.remove()` undoes it (safe to call repeatedly), never a bare function. `remove()` undoes what that call did: models it created itself are deleted with it (such as a pickup); objects you passed in are not. APIs that add an object or change business data return what their own signature says: `engine.add(obj)` returns the added object, `inventory.add` returns a result, `world.add` a record; delete those with `engine.remove(obj)` / their own remove call.
- **Ready is always the boolean property `ready`** (to wait, `await h.whenReady`); a module's readiness hook is `isReady(e)`.
- **Event names are `noun:action`**: the noun is the emitter's singular camelCase name (`item`, `entity`...), the action is a lowercase verb or state (`add`, `done`, `change`); a game's own events follow the same rule (`door:open`).
- **Time**: two fixed names, **fixed seconds** (the `dt` of `onFixed` and module hooks, `step(N)`, `engine.elapsed`; not multiplied by the time scale) and **game seconds** (`engine.clock.now` = fixed seconds x `clock.timeScale`); sky time of day `engine.sky.timeOfDay` (0-1) is derived from game seconds. Which one to use for movement, action timelines, cooldowns, hit-stop, crop growth, calendar and UI, and what pause / freeze / `timeScale = 2` do to each: the table in `recipes/06-clock-events.md` (the only place that lists them).
- **Input**: gameplay keys (attack, jump, interact...) are read in the fixed step (`onFixed` / module `fixed`), where `pressed / down / released` give a snapshot taken at the start of the step, so the result does not depend on frame rate and a press is never lost. UI keys (menus, toggling a view, a HUD button) are read in `onFrame` / module `frame`, which gives this frame's latest state. Never read `pointer.clicked` for gameplay; bind a `Mouse0` action.
- **Module names**: `collision()` installs as `engine.collision` (lightweight collision: walking, camera); `rigid()` installs as `engine.rigid` (real physics with Rapier).
- **Presets**: `openWorld()` installs only world, environment and basic modules; gameplay modules (interactions, dialogue, inventory, quests...) are added by the game with `engine.use`; pass `false` for items you don't want; change camera with `openWorld({ camera: 'firstPerson' })`.
- **Errors say how to fix it**: passing an old form (a numeric position, etc.) throws and explains the fix.

## Core conventions
- Lighting without `sky`: every engine has `engine.lights = { sun, hemi }` (neutral); to light the scene yourself hide or adjust them and add three.js lights. The engine ships no art: the humanoid, pickup shapes and flat shading live in the optional lowpoly style pack (`@threedog/style-lowpoly`: `shapes.js`, `terrain.config.shading: 'flat'`); without a style pack or model the engine shows a gray capsule, a gray box and flat gray ground at y = 0, with a dev warning naming the fix.
- Gameplay state (world, containers, vars, quests) changes only in fixed steps or inside ops; dev warns otherwise (`.threedog/ops-guard.log` after `npm test`). (game side)
- **One source for "can walk there"**: `createEngine({ movement: { radius, height, maxSlope, stepHeight } })` -> read-only `engine.movement`; collision, the Rapier capsule, navigation, A* and level steps all read it; don't write another 0.4 / 0.45 in a module. A character's position belongs to the Character mover; other systems only request movement (`placeAt` / `move` / vehicle `enter`) and never set `player.position` directly.
- Units are meters, Y is up, north is -Z. Characters and vehicles face the model's +Z; `facing` 0 = +Z, forward = (sin f, cos f).
- Never call `requestAnimationFrame` or `renderer.render` yourself. **Game logic always uses fixed seconds or game seconds** (the hook's `dt`, `engine.clock`; see the time table in `recipes/06-clock-events.md`); no `setTimeout` / `setInterval` / `performance.now()`: they ignore pause, freeze and `engine.step` fast-forward, so they can't be tested or saved.
- To be saved, call `engine.saves.register(key, { save, load })` (`load` may return a Promise); `saves.save / load` always return `Promise<boolean>`, so `await` them. Saved data names things by stable ids, never positions; when it changes shape raise `version` and add a `migrate` step (`recipes/20-content-actions-save.md` "Save format").
- The engine overwrites `sky.sun / sky.hemi`, `scene.fog` and the `camera` position/orientation every frame; don't set them. Adjust brightness with `engine.sky.modify('layer', {...})`; take over the camera with `engine.cameraOverride = { owner }` or a timeline camera step (see "Adjusting sky brightness" above).
- Day / night comes only from sky: read `sky.isDay`, use `sky.daylight` (0-1) for fades; don't judge by clock time yourself.
- A game's own look parameters (colors, materials) belong in its style pack (`style`) or the content, never hard-coded into logic.
- Vegetation `rule` must not contain functions (it is sent to a Worker).
- Terrain is editable: `engine.terrain.edit(pos, { lower|raise|flatten|paint })`, only inside an op or fixed step; custom `terrain({ height, groundType })` must be pure functions.
- Loading follows the `engine.stream` sources (player + camera focus by default); display, physics and world data are separate: unloading a model never removes its world record.
- Window blur, tab hidden, pointer lock and WebGL context loss are listened to only in `core/page.js`; modules read `engine.page` or listen to `page:*`. Show "saved" only after `saves.save` returns true.
- Characters can name their model by asset: `style.character.model: 'hero'` or `createPlayer({ ...presets.player.thirdPerson, model: 'hero' })` builds now with the placeholder body and swaps in the registered asset when it loads (`await player.whenReady`, event `character:model`); a name missing from a registered manifest throws.
- Importing the engine makes `Mesh.prototype.customDepthMaterial` / `customDistanceMaterial` default to a depth material carrying the mesh material's vertex patches, so wind-swayed meshes cast swaying shadows with nothing to set up; assigning your own value still wins. Shader time, wind and cloud cover are per engine in `engine.uniforms` (share them in your own `ShaderMaterial`); with two engines on a page, pass the engine to `makeMaterial(role, params, engine)`.
