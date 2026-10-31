---
paths:
  - "packages/engine/**/*.js"
  - "packages/engine/**/*.d.ts"
  - "packages/engine/types/**"
---

# API design

New public APIs follow these conventions. The "one thing, one entry point" table (what to use for raycasts, tweens, deleting objects, pathfinding, timers...) is in `packages/engine/docs/AI.md`; its principle: before adding a new way to do something, check that table and extend the existing entry point instead of building another.

## Interface conventions
- **A position is one argument**: any API that takes a position takes it as a single argument: Vector3, Object3D (its position), `[x, y, z]` or `{ x, z }` all work. Size, radius and count go in the options object after it: `collision.addBox(house, { halfWidth: 3, halfDepth: 2 })`, `particles.emit('dust', p, { count: 20 })`, `entities.nearest(p, { radius, type })`. A position key inside an options object is always `position` (`stream.add({ position, build })`). The only exceptions are ground sampling `engine.surface / slope / groundType / waterAt(x, z)` and `ground.height(x, z)`; `{ place, x, z }` in content data is a data form.
- Cancel convention: registering a listener, timer, continuing effect or registration returns a handle, and `h.remove()` undoes it (safe to call repeatedly); never return a bare function.
  Covers `events.on/once`, `onFixed/onFrame`, `clock.after/every`, `sky.at/between/daily/onSeason`, `collision.addBox/...`, `interactions.add`, `rays.addStatic`, `stream.add`, `triggers.add`, `hud.marker`, `hlod.add`, `particles.attach`, `inventory.spawnPickup`, `rigid.addBox/...`. `remove()` undoes what that call did: models it created itself are deleted with it (such as a pickup); objects you passed in are not. APIs that add an object or change business data (`engine.add`, `inventory.add`, `world.add`...) return what their own declaration says (the added object, a result, a record), not a handle.
- **Ready is always the boolean property `ready`** (to wait, `await h.whenReady`); a module's readiness hook is `isReady(e)`.
- **Event names are `noun:action`**: the noun is the emitter's singular camelCase name (`item`, `entity`...), the action is a lowercase verb or state (`add`, `done`, `change`). Engine/module events: add them to `EventMap` in `types/core.d.ts` first. Game events: declare them in `games/<game>/events.d.ts` as `interface GameEvents { 'name:verb': [args] }` (global, merged into EventMap); never edit the engine for a game event.
- **Time**: two fixed names, fixed seconds (hook `dt`, `step(N)`, `engine.elapsed`) and game seconds (`engine.clock.now` = fixed seconds x `clock.timeScale`); sky time of day is derived from game seconds. Which to use for what, and the effect of pause / freeze / `timeScale`: only in the table in `recipes/06-clock-events.md`; don't restate it. Say "game seconds" or "fixed seconds", never plain "game time".
- **Input**: gameplay keys are read in the fixed step (`onFixed` / module `fixed`, a per-step snapshot); UI keys in `onFrame` / module `frame`. Write JSDoc examples that way.
- **Module names**: `collision()` installs as `engine.collision` (lightweight collision: walking, camera); `rigid()` installs as `engine.rigid` (real physics with Rapier).
- **Presets**: `openWorld()` installs only world, environment and basic modules; gameplay modules (interactions, dialogue, inventory, quests...) are added by the game with `engine.use`; pass `false` for items you don't want; change camera with `openWorld({ camera: 'firstPerson' })`.
- **Errors say how to fix it**: passing an old form (a numeric position, etc.) throws and explains the fix (what is wrong + how to fix).
