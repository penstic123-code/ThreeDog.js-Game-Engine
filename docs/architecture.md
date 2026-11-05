# threedog architecture (how the engine is built now)

Audience: AI agents that maintain the engine. Intent and principles are in `design.md` (Chinese, the owner's words); this file is the code-side map: each part, its files, its one rule, and the test that fails if the rule is bypassed. Games use `packages/engine/docs/AI.md`, not this file. Read the file header of each source file for details; this page only says where to look and what must hold.

Test names below are filters for `threedog test "<name>"` (they match test names, not file names). Specs live in `packages/engine/tests/specs/`.

## Layers

`core/`, `render/` and `ui/` depend on each other as one layer: core imports render and ui, they import core back, and many core files import three, so core is not free of rendering. The folders are for finding things, not boundaries. `modules/` sits on top of that layer, and that line is the one kept: core never imports a module (CLAUDE.md hard rule 2).

`core/` is sorted by what a file does, for finding it; CODEMAP lists each folder's files:
- `base/`: errors, codes, validation, params, events, i18n, random, vars, small helpers. `engine/`: the Engine class, loop, startup, lifecycle, module install, plugins, page, loading.
- `time/`: time source, clock, skip. `input/`: input and its parts. `saves/`: saves, storage, the playthrough (`session.js`). `assets/`: assets, baking, animator, named models. `audio/`: buses and voices.
- `ops/`: actions and who holds what: ops, shared points, owned values, control, wrap, holds. `stream/`: spatial streaming, batching, scatter. `threads/`: workers, jobs, commits.
- `scene/`: things, rays, ground, camera, canvas and plain three.js adoption. `inspect/`: describe, inspect, debug views, catalog, checks, budget, picture writers.

## 1. Lifecycle

- Files: `core/engine/Engine.js` (`engine.phase`), `core/engine/lifecycle.js` (dispose, counts), `core/engine/modules.js` (install, rollback, `ctx`), `core/saves/session.js` (playthroughs), `core/saves/saveApply.js` (apply a save, roll back).
- `engine.phase`: `constructed -> loading -> ready -> running -> disposed`. It is the one "may this run yet" state: no fixed step before `ready` (`core/engine/loop.js`), no module hook before that module's `init` finished (module state `registered -> initializing -> running | failed`).
- Rule: everything a module adds goes through its `ctx = { name, track(handle), mod(point, o), input, control }` (`install(e, ctx)` / `init(e, ctx)`). A tracked handle leaves with the module: when the `engine.use` batch rolls back, when `init` fails, on `engine.dispose()` (before the module's own `dispose`). `engine.use(a, b)` is all-or-nothing.
- Per-playthrough state is a save part; `engine.session.newGame / load / quit` end the old playthrough (tracked handles, function timers, pending commits, a running skip) and apply the captured new-game state. A part whose `load()` throws rolls every part back and keeps the old playthrough (`session:failed`).
- Not-saved state: stops on a tracked `session:end` listener; derived state is rebuilt on `session:start` / `save:loaded`.
- Tests: `Lifecycle` (every built-in module leaves nothing behind; no fixed step while loading), `Session`, `Save failure`, `durability` specs.

## 2. Shared points (the one way several owners change one value)

- Files: `core/ops/sharedPoint.js` (the rules and the layer table), `core/ops/stacks.js` (registry `engine.stacks`, `engine.mod`, timers behind `for`, save, `describe().shared`), `core/engine/moduleSlots.js` (slots), `core/ops/holds.js` (pause / freeze / camera are points too).
- Layer table, lowest first: `engine < game < effect < system < settings < debug`. Inside a layer: `set`, then every `add`, then every `mul`, then every `clamp`. A higher layer's `set` hides everything below. Settings only restrict (`clamp: { max }`, `mul` 0..1, `set: false`); it never raises a value or switches something on, and it sits above `system`, so a cutscene or menu cannot undo what the player turned off (only `debug` can).
- One entry per owner per point (the same owner writing again replaces its entry). Two different owners that `set` one point on one layer throw `shared-conflict` in dev (the later wins in release). `add / mul / clamp` never conflict.
- Nothing remembers an old value: a read is a recompute from the base and the entries still there. This is why effects can end in any order.
- Kinds: `number`, `value`, `any` (true while anyone holds it: freeze, halt, gates), `top` (latest holder: camera), `one` (exclusive slot).
- Slots: a module declares `provides: ['inventory']`, `requires: ['inventory']` (the slot, not a module name); `engine.use(mine(), { replaces: 'inventory' })` unloads the holder first. A slot is a kind-`one` shared point, so `describe().shared` shows holders beside values.
- A point writes no three.js by itself. The few values the engine still writes on its own yield to a direct three.js write (`core/ops/owned.js`, listed in `describe().owned`).
- Tests: `shared points` (conflict, layers, settings, slots, rollback), `shared points in a running game`, `owned`.

## 3. One time source

- Files: `core/time/time.js` (the only file that adds to any time), `core/time/Clock.js` / `modules/calendar/` (calendar views and timers), `core/time/skip.js`, `core/engine/loop.js`.
- `engine.time.tick` counts fixed steps. Everything else is a read-only view: `time.now('real')` (tick / 60, no scale), `'ambient'` (keeps moving while frozen), a channel name (`world`, `player`, `enemies` ...; speeds change only through `engine.mod('time.<channel>', ...)`), `'calendar'` (= `engine.clock.now`, world seconds x `clock.rate`). Timers are one queue (`engine.clock.after / every`, `{ channel }`).
- Three entry points move all views together: a fixed step, `engine.skip`, a new playthrough. `engine.elapsed` is removed (reading it throws in dev). Freeze is not "scale 0": a frozen engine runs no fixed step.
- Test: `TIME` (skip equals step on every view; a static scan allows only `core/time/time.js` to accumulate time).

## 4. Input by context

- Files: `core/input/Input.js`, `core/input/inputContext.js`, `core/input/inputDefaults.js`, `core/input/inputPad.js`, `core/input/inputPointer.js`, `core/input/inputTouch.js`, `presets.js`.
- Contexts form a stack (`BASE_CONTEXT 'walk'`); the top one shadows lower ones bound to the same key; opaque by default. Menus, dialogue and cutscenes push a context (with an `owner`) instead of "locking input". A switch applies at the start of the next fixed step.
- Modules only declare actions (`ctx.input.action(name, { context })`); the game binds keys (`createEngine({ bindings })`, `input.bind`, `presets.bindings.*`). Key bindings are the shared point `input.keys` (per action; the player's rebinding is the one settings-layer `set`). Only `inputDefaults.js` (basic move / confirm / cancel / UI cursor) and `presets.js` may name a key.
- Tests: `input owners` (static: no module binds a key; double binding and unbound actions explain the fix).

## 5. Character control

- File: `core/ops/control.js` (`engine.control`, `ctx.control.take`).
- One control slot per character id; layers `base < script < cutscene < net`; the highest is in charge and lower holders are paused, not cancelled. One owner per layer (`control-conflict`). A character with a holder moves only through the holder; a direct `character.move()` from anyone else throws `control-bypass` in dev. "Who decides where to go" (control) is separate from "how the body moves" (`character.mover`). Holds are not saved.
- Tests: `character control` (includes the static tools test).

## 6. Module types

- Files: `core/engine/moduleTypes.js`; rules `packages/tools/rules/R47` (types), `R27` (core names no module), `R25` / `R46` (modules reach each other only by public API and events).
- Seven types, no subtypes: `world` (state, draws nothing), `picture`, `actor`, `rules`, `ui`, `net`, `tool`. Every module declares one (missing is an error naming the guess). The `type` is the one source: it says what the module may own and how its errors are handled (a throwing `picture` or `ui` module is reported once and the game keeps running, `core/base/errors.js`); `stage` only orders hooks (`control -> ground -> environment -> gameplay -> effects -> late -> audio`). Differences inside a type are declarations the engine already checks (provides, shared values written with `ctx.mod`, patched material slots, backends). Dev-only checks at the common write points (a picture module defining an op, a ui module binding a key).
- Terrain, vegetation and weather are split into a data module (`world`) and a drawing module (`picture`: `terrainDraw`, `vegetationDraw`, `weatherDraw`, slots `terrain-draw`, `vegetation-draw`), so replaced drawing keeps collision, navigation and saves (`modules/terrain/`, `modules/vegetation/`, `modules/weather/`).
- Contracts: a replaceable module (inventory, quests, dialogue, particles, camera ...) has a `contract.js` / `*.contract.js` listing its api and fields; `@threedog/tools/contract` runs the same check on the engine's module and on a replacement. R50: engine code outside a module calls `engine.<slot>.<member>` only when the member is in that contract, so a replacement that passes the check cannot crash on a call nobody listed.
- Tests: `module types`, `module boundaries`, `rules`, tools test `contracts`.

## 7. The picture is plain three.js

- Files: the game's `picture/` folder writes three.js and reads `engine.uniforms` (recipe 62); `core/inspect/describeRender.js` reads `describe().picture` straight off three.js; `render/shadows.js` (`engine.shadows`), `core/scene/view.js` (`engine.autoView`), `render/terms.js` (`engine.shaderTerms`), `render/PostFX.js` (`engine.post`) are the entries that do what three.js has no line for.
- Rule: the engine has no second picture language. A module's look is a three.js material on the module (`engine.water.material`), a picture value is the three.js value, and what the engine computes (sun, daylight, wind, cloud shadow) is a signal in `engine.uniforms`. Several systems that share one value meet on a shared point (`post.<name>.enabled`, `shadows.enabled`, `sky.tint`, `sky.flash`, `ground.cover`).
- Picture writers tool: `core/inspect/pictureWriters.js` keeps "one writer per value" from being words only. On the dev server it puts an own get / set on the picture values of objects in the engine's scene (`notePatch` entry `picture-writers`), records which `file:line` last wrote each value (`describe('picture').picture.writers`, `explain({ picture })`), and warns `picture-conflict` with both lines when two places write one value in one frame. Slots: `core/scene/pictureSlots.js` is the one table of picture slot names (sky, fog, tone, environment, background, sun, taken with `provides`); a write to a held value from anyone else is `picture-held`, naming the holder and both lines, and a picture module removed (`engine.unuse`, `replaces`) with lights, objects, post effects or hooks still there is `picture-leftover`. It reports and never blocks; a value written every frame is sampled, and outside parts two anonymous functions in one file count as one place. Bundles and release builds do not carry it. R48 checks that engine code itself does not write these values.
- One entry per job: post effects go in only through `engine.post.add(x)` (a three.js Pass, a TSL node function, or an effect `{ name, create | node | fuse }`; on / off and params with its handle; `render/PostFX.js`).
- Tests: `no style option`, `no makeMaterial`, `ships no art`, `one post entry`, `sky entries`, `picture writers`, `picture parts`.

## 8. Plain three.js adoption

- Files: `core/scene/sceneDelta.js` (`scene.add` at any depth is `engine.add`), `core/scene/gameLights.js` (plain lights counted in the budget), `core/engine/plugins.js` + `tools/vite/vite-threedog-plugins.js` (the game's `plugins/` folder: each file is plugged in by what it exports, through the call a game would write by hand), `render/ownFrame.js` (a game that draws the full canvas itself takes the frame; the engine stops its own draw and takes it back when the game stops), `render/terms.js` (cloud shadow and season tint on engine materials and materials handed to `applyEffects`).
- Rule: the AI writes plain three.js and the engine plugs it in; only where the engine cannot guess the intent does the game write one line (`engine.add(obj, { id })` for a save id, `engine.rays.addStatic`, `applyEffects(mat, { wind })`). The slot map with every route is `plans/2026-11-03-slot-map.md` (written before the look layer went, so its `look.*` rows are history).
- Every change the engine makes to three.js itself (prototype wrappers, accessors on the game's objects, the renderer's `render`, `ShaderChunk` entries) is registered in `core/scene/threePatches.js` with `notePatch`, listed in `describe().threePatches`, each with what stops working when `threePatches.off(id)` turns it off (or why it cannot be turned off). THREE.md "Global changes" is the game-facing table.
- Tests: `plain three.js adoption`, `plugins folder`, `Sweep` (threePatches).

## 9. Render backends (WebGL and WebGPU)

- Files: `render/backend.js` (renderer facts that differ: `isWebGPU`, `backendName`, counters, the WebGPU route; it imports nothing from three), `core/engine/startup.js` (choose backend, fall back by `createEngine({ fallback })`), `render/fx/` (the engine's own shaders as TSL, published as `threedog/tsl`, which calls `registerWebGPUPart` so WebGL games never load `three/webgpu`), `render/slots.js` (the one table of semantic patch slots: GLSL anchor and TSL node mapping), `render/patches.js` / `effects.js` (named patches), `render/fxNumbers.js` (numbers shared by the GLSL and TSL versions of wind, noise, clouds, sky, water).
- Rules: the backend is chosen at start and never switches; a patch or effect written for one backend only fails at start naming itself; shader numbers exist once in `fxNumbers.js`; shader code enters only as named patches (R26), never `onBeforeCompile`; every patch the engine ships has a GLSL and a TSL form (R49; a GLSL-only patch is silently skipped on WebGPU, which once froze the open world there).
- Tests: `renderer backend`, `engine content on WebGPU looks like WebGL`, `threedog/tsl` parity (`fx-parity`), `shader errors on WebGPU`.

## 10. Data, saves, ops and content write-back

- Saves: `core/saves/Saves.js`, `saveApply.js`, `saveVersions.js`, `SaveStore.js`. Parts are checked and migrated before anything changes; a shape change raises `version` with a `migrate`. Entries on shared points are saved for layers below settings.
- Ops: `core/ops/Ops.js` (+ `opsRun`, `opsCheck`, `opsGuard`, `opsHistory`). `engine.ops.define / run`: one discrete player or NPC action, checked by `can`, logged with tick and actor. `ops.guard` warns in dev when saved gameplay state is written outside fixed steps and ops.
- Content: `modules/content/`, world records `modules/world/`. Design data (content, templates, placements) lives in the game's files with fixed ids; `packages/tools/content-write.mjs` (`threedog content set|add|remove`, `threedog tune`) edits one file by targeted text edit, refuses code-built entries, and rolls back when the check fails. The in-browser editor (`packages/tools/editor/`, dev server only, plan `plans/2026-11-05-editor.md`) reaches content through two files only: `editor/design.js` in the page, `content-write.mjs` on the server (R54).
- Tests: `Save failure`, `durability-saves`, `ops`, tools tests `content-write`, `content-src`.

## 11. Describe and verification

- Files: `core/inspect/Describe.js`, `describeText.js`, `describeRender.js`, `core/base/errorHints.js` + `errorCodes.js` (coded errors that name the rule and the fix), `core/base/validate.js`, `core/base/params.js` (`readParams`: unknown option throws), R44 (every module has `describe`).
- `engine.describe()` is JSON-able state: values with their writers, `shared` points and slots, control and input holds, installed modules and types, `threePatches`. Errors carry a code, the broken rule and a pasteable fix; release builds warn once instead of throwing.
- Tests: `describe` specs, tools test `describe everywhere`, `error codes`.

## 12. Tools

- `packages/tools/paths.mjs`: the single source of paths and the project context (`project(cwd)`: MODE `monorepo` or `game`, engine found by Node resolution). Never import across packages by relative path (R24). `lib/cli-args.mjs` is the one option parser for page-taking commands (an unknown option fails with the list); `lib/text.mjs`, `lib/proc.mjs`, `browser.mjs` are shared helpers.
- `packages/tools/rules/R*.mjs`: one file per rule, header `Detection:` says what it flags and its limits, registered in `rules/index.mjs`. `check.mjs` runs hard rules, rules, the type check, content validation and "generated docs up to date", and ends with one line: `✓ check passed` or `✗ check FAILED: <parts with counts>` (for example `type check 3 errors`); type errors fail the check.
- CLI: `bin/threedog.mjs` -> `threedog/` (dispatch, commands, dev bridge, mcp). Generated docs (`GAMEMAP`, `API.md`, `api/`, `CODEMAP`, `types/generated/`) come from `npm run map`.
- Tests: tools tests in `packages/tools/tests/` (`cli surface`, `doc rules`, `pack-external` ...).

## 13. Test runner

- The runner finds the tests itself (`packages/tools/lib/specs.mjs`): every `tests/specs/*.mjs` of a workspace exporting a `specs` array, and every `packages/tools/tests/*.mjs` exporting `name` and `run`; there is no list to register them in. A spec is `{ name, url, run({ ev, check, page }) }`. A file with no runnable items, an item without name / url / run, or a name used twice stops the run before any browser. `packages/tools/run.mjs` runs them in headless Chromium; file order carries no meaning (each item gets its own page).
- `software: true` forces software rendering (SwiftShader, same pixels everywhere); unset, it is true when `run()` itself calls a pixel API. `serial: true` runs a spec alone. `--jobs N` sets parallelism; unknown options fail.
- Filters match test names, any case; a filter word that matches nothing fails loudly ("NOTHING MATCHED", exit 1), never a pass. Output by default: failed items with their failed checks, a progress line, the summary; `--verbose` prints every check. Results are logged in `docs/testing/runs.md`.
