---
paths:
  - "packages/engine/core/**"
  - "packages/engine/modules/**"
---

# Engine core and modules

- Hard rule 2 in detail: module-to-module dependencies go in `requires`; an optional dependency is used as `engine.xxx?.` and listed in `optional`, and must not throw when missing.
- **One source for "can walk there"**: `createEngine({ movement: { radius, height, maxSlope, stepHeight } })` -> read-only `engine.movement`. Collision, the Rapier capsule, navigation, A* and level steps all read it; never write another 0.4 / 0.45 in a module. A character's position belongs to the Character mover; other systems only request movement (`placeAt` / `move` / vehicle `enter`) and never set `player.position`.
- Units are meters, Y is up, north is -Z. Characters and vehicles face the model's +Z; `facing` 0 = +Z, forward = (sin f, cos f).
- No `requestAnimationFrame` or `renderer.render` of your own. **Game logic uses fixed seconds or game seconds** (the hook's `dt`, `engine.clock`; table in `recipes/06-clock-events.md`), never `setTimeout` / `setInterval` / `performance.now()`: they ignore pause, freeze and `engine.step`, and can be neither tested nor saved.
  Real time or `Math.random` that the engine cannot avoid gets a purpose tag at the end of the line: `// presentation` `// measure` `// wall-clock` `// main-loop` `// debug`. R4 lets only tagged lines through; `// measure` is not accepted inside the fixed step (gameplay limits count items/steps, never milliseconds).
- State that must be saved: `engine.saves.register(key, { save, load })` (`load` may return a Promise); `saves.save / load` always return `Promise<boolean>` (callers `await`). Saved data names things by stable ids, never positions; a shape change raises `version` with a `migrate` step (recipe 20 "Save format").
- The engine overwrites `sky.sun / sky.hemi`, `scene.fog` and the `camera` pose every frame. Adjust brightness with `engine.sky.modify('layer', {...})`; take over the camera with `engine.cameraOverride = { owner }` or a timeline camera step (see `packages/engine/docs/CONVENTIONS.md`).
- Day / night is computed only by sky: read `sky.isDay`, use `sky.daylight` (0-1) for fades; never judge by clock time.
- `terrainGen.js` must not import three.js (it runs in a Worker); vegetation `rule` must not contain functions (it is sent to a Worker). Split a file by responsibility when it passes about 400 lines (R1).

## Writing a module
Template and steps: `packages/engine/docs/recipes/14-custom-module.md`.
- A module is a function returning `{ name, label, requires, optional, stage, install, fixed, frame, describe, ... }`; `engine.use` installs it and the object returned by `install` becomes `engine.<name>`. Validate options with `checkOptions('name()', opts, [...])`; UI text goes through i18n (`e.i18n.add` + `e.t('key')`).
- Movement, timing and gameplay keys go in `fixed` (`input.pressed / down / released / axis` read this step's snapshot, independent of frame rate); animation, UI and camera go in `frame` (it keeps running while frozen, so check `e.frozen` before gameplay decisions). Gameplay timing never reads an Animator's mixer or `anim:end`. Saving: `e.saves.register(key, { save, load })`; modules talk through `engine.events`.
- Cleanup is not written by hand: events, onFixed/onFrame, clock, jobs, stream, load sources, ray registrations and scene GPU memory are collected by `engine.dispose()`; DOM listeners use `{ signal: engine.signal }`, UI elements attach to `engine.uiRoot`.
- A new public API is exported from `packages/engine/index.js` and gets JSDoc with an example in `index.d.ts` / `types/*.d.ts` (`npm run types` finds gaps). The source JSDoc is the truth; the migration registry is `MIGRATED_JS_REL` in `packages/tools/paths.mjs`.
- Per-frame order: fixed step (60 Hz) `onFixed` -> module `fixed` -> clock timers; each frame runs `frame` by module `stage` (control -> world -> environment -> gameplay -> presentation -> late -> audio), inside a stage by `before / after`, then install order (read the real order from `engine.moduleOrder`; stages per module are in CODEMAP). While frozen (`engine.freeze`, flow pause) the whole fixed step is skipped.
- Per-playthrough state that is not a save part (open dialogue, trigger `inside` / `once`, markers derived from quests) is dropped on `session:end` and rebuilt on `session:start` / `load` (recipe 14 "Per-playthrough state"); describe() shows it so the session spec catches leaks.
- Gameplay state (world, containers, vars, quests) changes only in fixed steps or inside ops (`engine.ops`); dev warns otherwise (`.threedog/ops-guard.log` after `npm test`). Engine-built player actions are ops (`interaction.use`, `dialogue.advance/choose`, `inventory.transfer`).
