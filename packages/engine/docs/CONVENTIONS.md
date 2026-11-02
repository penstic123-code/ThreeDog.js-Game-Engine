# Additional conventions (read when the task is relevant)

For API details see `api/<module>.md`; this file holds conventions that don't belong to one API but cause problems when broken. `AI.md` lists each in
one line; the detail is here.

## World data and level ownership
- **World data**: game objects that must be saved, survive level changes, or change while far away go in `engine.world` (the model is built with
  `present` only when near, the simulation runs with `simulate`).
  Items written in content use `add(def, { initial: true })` (an id is required; a save records only changes and deletions, independent of the order
  relative to content.load); items generated at runtime use a plain `add`; temporary ones use `{ save: false }`;
  discrete changes use `world.set` (it emits world:change), things that change every step modify the field directly or use `move`. Usage is in `api/world.md`.
- **Level ownership**: world data carrying `zone: engine.world.zone` (= the current level name) gets its model built and is simulated only in that
  level; when you leave, the data stays (content NPCs, pickups and props already work this way);
  things that need not be kept (trigger zones, etc.) use `level.track(handle)` and are deleted automatically on level change.
- **Two doors, one scene**: plain three.js (`engine.add(mesh, { id })`) and templates (`engine.content.spawn`, props) land in the same registry;
  `engine.thing(id)` says what it is and what a save keeps (`recipes/41-thing-registry.md`). What must be saved with its own state or edited without
  code goes in `content/` (templates + props with ids, pickups, npcs, containers, game kinds) or the level model; a save stores only changes on top.
  Startup code never creates what a save stores whole (rule R33): things that appear during play come from `engine.content.spawn` inside an op.
- To find leaks read `engine.counts()` (listeners, timers, geometry count; they should not grow when entering and leaving a level repeatedly).

## Textures
The opts of `assets.texture(name, opts)` are part of the cache key: the same image with different opts gives two separately configured textures.

## Values the engine drives (sun, hemi, fog, camera)
With a sky or camera module installed the engine writes `engine.lights.sun / hemi` (intensity, color, position), `scene.fog` and the `camera` pose
every frame. Setting them directly is plain three.js and works: the engine yields that value (stops writing it, warns once). Say it on purpose with
`engine.look.<part>.manual(key)` (no warning; `manual(key, false)` gives it back), or adjust without taking it, keeping the day cycle, with
`look.<part>.set(...)` (the "Customization ladder" below; which to pick: `recipes/52-look.md` "Who writes it"). The camera: `engine.takeCamera(owner)`
or a timeline camera step.

## Customization ladder
Pick the row for what you want; each row is the one entry for it (take the first that fully works). Plain JS fields and your own `onFixed`
logic need none of this.

| You want to | Use | Detail |
|---|---|---|
| Tweak a parameter of a system | its options (`createEngine({...})`, `terrain({...})`, `openWorld({...})`; unknown keys throw), or content data | `api/<module>.md` |
| Let several systems change one gameplay value (speed, time scale, gravity, damage taken) | `engine.mod(target, { owner, set \| add \| mul \| clamp, for })`; your own quantity: `engine.stacks.define` | `recipes/55-mods-time-wrap.md` |
| Run code before / after / around a module method (a weight limit on `inventory.add`) | `engine.wrap(engine.inventory, 'add', (next, ...a) => next(...a), { owner })` | `recipes/55-mods-time-wrap.md` |
| Close one action for a while (stunned: no jump) | `engine.input.gate(action, { owner, for })` | `recipes/55-mods-time-wrap.md` |
| Replace a whole system (your own inventory, interactions, dialogue, quests, flow, characters, camera; your own vehicle for `character.enter`) | a module (or object) that meets that contract (`<module>.contract.js`; vehicle: `modules/characters/vehicle.contract.js`), checked with `runContract` | `recipes/55-mods-time-wrap.md` "Replacing a module" |
| Change a look value (light, fog, sky, water, tone, post, materials) | `engine.look.<part>.set(values, { owner })`; take a value the engine drives: `manual(key)`; swap the part whole: `replace(impl)`; shader code: `patch('hook:<name>', glsl)` (never a `glsl` key in an option) | `recipes/52-look.md` |
| Write the look yourself | plain three.js on `engine.scene / camera / renderer` (own material, `ShaderMaterial`, pass); a direct write takes that value over and the engine yields | `THREE.md`, `recipes/54-three-idioms.md` |

The starting look comes from the game's `style/` folder; what a style section builds as a factory can also be passed at the call site, and the
call site wins (`water({ material })` and the like); a new style factory ships with its call-site option. No module option starts a value taken over.

**Time channels**: most games use only the default (fixed `dt` in real seconds, `engine.clock` for calendar time). A channel exists so one group
of things can run slower or faster than the rest (bullet time on enemies, haste on the player): `engine.onFixed(fn, { channel: 'enemies' })` gets
that channel's scaled `dt`, and `engine.mod('time.enemies', { owner, mul })` scales it; units and which clock to use: `recipes/06-clock-events.md`.

### One task, which entry
Where a task has more than one entry they are layers of the ladder above, not alternatives: take the first, go down only for the reason given.

| Task | First | Go down a layer when |
|---|---|---|
| Windows, signs, screens glow at night | `look.materials.glow(match, { night })` | your own emissive logic: plain three.js. `lightPool.add(obj, { glow })` is something else: the stand-in a pooled lamp shows while it holds no real light |
| Time of day | `engine.calendar` (`calendar({ time })`) | no calendar at all (one fixed scene): `sky({ time })`; timers: `engine.clock`; one group faster / slower: a time channel |
| Sun / light strength | `look.lights.set(values, { owner })`: a layer over the day keyframes, `remove()` gives them back | take it for good (the day cycle stops writing it): write `engine.lights.sun` directly, or `look.lights.manual('sun')` |
| Teleport the player | `player.placeAt(p)` in an op | not streamed in yet: `await engine.stream.teleport(p)` (waits, then places); a test or scenario: `applyState({ pos })` |
| Camera | install one: `openWorld({ camera })`, `engine.use(fixedCamera({ position, lookAt }))` | switch kinds at run time: `setCamera(kind)`; a shot of your own: `takeCamera(owner)` |
| Environment light | the style, then `look.env.replace('sky' \| asset)` / `look.env.set` | light that changes from place to place: `bakeProbes` |
| Post effects | the style (`postAdd(effect)`), tuned with `look.post.set` | your own three.js Pass: `look.post.add({ name, create })`; a whole chain of your own: `look.post.replace([...])` |
| Ambient occlusion | `look.post.set({ 'ao.enabled': true })` (screen space) | a model made in code: `bakeVertexAO(geometry)`; bounce light between places: `bakeProbes` |

## Owners
Everything that holds the engine is named by an owner, and only that owner releases it. Positional `pause('menu')` and `pause({ owner: 'menu' })` are the same.

| What | Take | Release | Returns |
|---|---|---|---|
| Real-time loop | `pause(owner, { kind? })` | `handle.remove()` | handle `{ remove() }` |
| Gameplay freeze | `freeze(owner, { kind? })` | `handle.remove()` | handle |
| Camera | `takeCamera(owner, { focus? })` | `handle.remove()` | handle |
| Debug override / view | `debug.override(owner, ...)`, `debug.view(mode, { owner })` | `debug.clear(owner)` | handle / state |
| Look values | `look.<part>.set(values, { owner })` | `handle.remove()` | handle |

## Worker limits
`modules/terrain/terrainGen.js` (via `chunkJob.js`) runs in a Worker and must not import three.js; a vegetation `rule` is sent to the Worker and must
not contain functions.
Workers are created only through `engine.threads.lane({ create, local })` (the same handler runs on the main thread when there are no workers); no
`new Worker` / `postMessage` elsewhere (`npm run check` rule R19). Worker files import only worker-safe code (a game:
`import { serve } from 'threedog/worker'`; inside the engine `core/threadServe.js`, `core/threadPure.js`), never `core/Threads.js` or three.js.

### Worker results that change gameplay: `engine.commits`
A result that changes gameplay never takes effect "when it arrives"; it takes effect on a fixed tick decided when you ask (`engine.tick + lag`,
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
  `triggers.add`, `hud.marker`, `hlod.add`, `particles.attach`, `pickups.spawn`, `rigid.addBox/...`, `audio.addBus`, `time.manual`, `defineState`) returns a
  handle `{ owner?, remove() }`; `h.remove()` undoes it, the only give-back form (no `null` / `false` hand-back calls)
  (safe to call repeatedly), never a bare function. `remove()` undoes what that call did: models it created itself are deleted with it (such as a
  pickup); objects you passed in are not. APIs that add an object or change business data return what their own signature says: `engine.add(obj)`
  returns the added object, `inventory.add` returns a result, `world.add` a record; delete those with `engine.remove(obj)` / their own remove call.
- **Verbs**: defining a kind is `define` (`vegetation.define`, `particles.define`, `grids.define`, `ops.define`); placing one is `add` / `spawn`;
  hooking up a provider the engine calls back is `register` (`saves.register(key, { save, load })`: it defines no kind and places nothing).
  One timer entry: `engine.clock.after(seconds, fn, data, { channel })` (calendar seconds, or a time channel's seconds with `channel`).
- **Unknown options throw**: every options bag goes through a `readParams` schema (one schema gives the check, the defaults and the catalog entry); an
  unknown key throws in dev with a did-you-mean and warns once in a release build; `checkOptions` is only for extensible data (item, template
  state and material fields, where games add their own keys).
- **Ready is always the boolean property `ready`** (to wait, `await h.whenReady`); a module's readiness hook is `isReady(e)`.
- **Event names are `noun:action`**: the noun is the emitter's singular camelCase name (`item`, `template`...), the action is a lowercase verb or state
  (`add`, `done`, `change`); a game's own events follow the same rule (`door:open`).
- **Time**: always name the unit, real, channel or calendar seconds; `recipes/06-clock-events.md` defines them (and the calendar's time of day) and has
  the table of which one to use for movement, action timelines, cooldowns, hit-stop, crop growth, calendar and UI, and what pause / freeze /
  `clock.rate` 2 do to each. Speeds change only through `engine.mod` (the "Customization ladder" above).
- **Input**: gameplay keys (attack, jump, interact...) are read in the fixed step (`onFixed` / module `fixed`), where `pressed / down / released` give
  a snapshot taken at the start of the step, so the result does not depend on frame rate and a press is never lost. UI keys (menus, toggling a view, a
  HUD button) are read in `onFrame` / module `frame`, which gives this frame's latest state. Never read `pointer.clicked` for gameplay; bind a `Mouse0` action.
- **Module names**: `collision()` installs as `engine.collision` (lightweight collision: walking, camera); `rigid()` installs as `engine.rigid` (real
  physics with Rapier).
- **Presets**: `openWorld()` installs only world, environment and basic modules; gameplay modules (interactions, dialogue, inventory, pickups, quests...) are
  added by the game with `engine.use`; pass `false` for items you don't want; the camera has no default and must be named, e.g.
  `openWorld({ camera: 'firstPerson' })` (`'follow'` / `'rts'` / `'fixed'`, a camera module, or `false`).
- **Errors say how to fix it**: passing an old form (a numeric position, etc.) throws and explains the fix.

## Core conventions
- Lighting without `sky`: every engine has `engine.lights = { sun, hemi }` (neutral); to light the scene yourself hide or adjust them and add three.js
  lights. The engine ships no art: the humanoid, pickup shapes and flat shading come from the game's `style/` folder and `assets.js` (e.g.
  `terrain.config.shading: 'flat'` in its style); without them the engine shows a gray capsule, a gray box and flat gray ground at y = 0, with a
  dev warning naming the fix.
- Gameplay state (world, containers, vars, quests) changes only in fixed steps or inside ops; dev warns otherwise (`.threedog/ops-guard.log` after
  `npm test`). (game side)
- **One source for "can walk there"**: `createEngine({ movement: { radius, height, maxSlope, stepHeight } })` -> read-only `engine.movement`;
  collision, the Rapier capsule, navigation, A* and level steps all read it; don't write another 0.4 / 0.45 in a module. A character's position
  belongs to the Character mover; other systems only request movement (`placeAt` / `move` / vehicle `enter`) and never set `player.position` directly.
- Units are meters, Y is up, north is -Z. Characters and vehicles face the model's +Z; `facing` 0 = +Z, forward = (sin f, cos f).
- Never call `requestAnimationFrame` or `renderer.render` yourself. **Game logic always uses fixed seconds or game seconds** (the hook's `dt`,
  `engine.clock`; see the time table in `recipes/06-clock-events.md`); no `setTimeout` / `setInterval` / `performance.now()`: they ignore pause,
  freeze and `engine.step` fast-forward, so they can't be tested or saved.
- To be saved, call `engine.saves.register(key, { save, load })` (`load` may return a Promise); `saves.save / load` always return `Promise<boolean>`,
  so `await` them. Saved data names things by stable ids, never positions; when it changes shape raise `version` and add a `migrate` step
  (`recipes/20-content-actions-save.md` "Save format").
- Day / night in gameplay comes from the calendar: read `calendar.isDay`, use `calendar.daylight` (0-1) for fades (they work with no sky); don't judge by clock text yourself.
- A game's own look parameters (colors, materials) can live anywhere plain three.js code lives; put them in its `style/` folder when you want
  them in one place (mixed, tuned with `look.<part>.set`).
- Vegetation `rule` must not contain functions (it is sent to a Worker).
- Terrain is editable: `engine.terrain.edit(pos, { lower|raise|flatten|paint })`, only inside an op or fixed step; custom
  `terrain({ height, groundType })` must be pure functions.
- Loading follows the `engine.stream` sources (player + camera focus by default); display, physics and world data are separate: unloading a model
  never removes its world record.
- Window blur, tab hidden, pointer lock and WebGL context loss are listened to only in `core/page.js`; modules read `engine.page` or listen to
  `page:*`. Show "saved" only after `saves.save` returns true.
- Character bodies are assets, not style: `createPlayer({ ...presets.player.thirdPerson, model: 'humanoid' | 'hero' })` (a procedural builder is built
  now; a file shows a gray capsule and is swapped in when it loads: `await player.whenReady`, event `character:model`), or `{ rig }`; a name no model
  asset has throws. The style tints bodies through material roles (cloth, skin, trousers, hair).
- Importing the engine makes `Mesh.prototype.customDepthMaterial` / `customDistanceMaterial` default to a depth material carrying the mesh material's
  vertex patches, so wind-swayed meshes cast swaying shadows with nothing to set up; assigning your own value still wins. Shader time, wind and cloud
  cover are per engine in `engine.uniforms` (share them in your own `ShaderMaterial`); with two engines on a page, pass the engine to
  `makeMaterial(role, params, engine)`.

## Failures: which shape
A runtime "can't" (not enough money, shelf empty) is returned as `{ ok: false, code, facts, nextActions }` (ops.run / can / undo, and direct calls such as `container.trade`, which a module builds by returning that shape, or a code string from an op's `can`). Misuse (a wrong call, a typo) is a thrown `codedError`. Documented exceptions: `checkSkip` / `checkSave` return `{ ok, diffs }`, `walkTo` returns `{ status }`. Read `code` (there is no `reason` field). Predicates (op `can`, `grid.can()`) may return a plain code string.

Inside the engine a failure takes one of three forms, so every one reaches the reader with a code, a fix and a page: misuse throws `codedError(code, message)` with an `ERROR_CODES` entry (`core/errorCodes.js`: what to change, which page to read); a recoverable problem warns once with `warnOnce(coded(code, message))`; a game or module callback that threw goes to `reportError`. Check rule R45 rejects a plain `throw new Error` and a bare `console.warn` / `console.error` in engine code.
