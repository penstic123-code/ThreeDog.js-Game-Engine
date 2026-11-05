# Conflicts review, 2026-11-05: what in the engine still fights what

Base commit `0a5c160c`, branch `review/conflicts`. This is a report: no engine or tool code changed.

How each finding was checked:

- **Confirmed by run**: a temporary test on the real engine in the headless browser. It was deleted afterwards.
- **Confirmed by reading**: the code path was followed line by line. Nothing was run.
- **Inferred**: the code was read, but the visible effect was not seen.

Paths are under `packages/engine/` unless they say otherwise. Severity: **High** means wrong behaviour in ordinary play or ordinary use of a public entry. **Medium** means wrong in a real but narrower case. **Low** means small, or a simplification.

## Result in brief

The big ownership questions are mostly settled: stacks, `control`, `owned` values and the time source all do their job. The fights that remain sit where a system was added beside those, not through them.

- 16 findings: 2 High, 5 Medium, 9 Low. Two were confirmed by run (V1, I1); each finding says how it was checked.
- The main pattern: "gameplay is stopped" has three separate meanings (loop paused, frozen, page held), and each frame-time system picks its own answer.
- Most fixes remove something: a branch in the loop, a three.js patch, a saved value.

## High

### T1. A page hold is not a freeze, so cutscenes run on while the game waits

Confirmed by reading. `core/loop.js:217` skips fixed steps while `page.held` is true, and the frame hooks still run on the next lines. `modules/timeline/Timeline.js:154` advances tweens and waits unless `engine.frozen`, and a page hold is not a freeze. Grep finds that line as the only module that reads `engine.frozen`.

The situation: the player alt-tabs during a cutscene. The window stays visible, so `requestAnimationFrame` keeps firing. Characters, physics, timers and the calendar stop. The timeline keeps moving the camera, finishes its waits and runs its `do` steps against a stopped world.

Tools also miss it. `runState` (`core/holds.js:86-90`) says `running`, and `describe().time` shows `paused: false, frozen: false` (`core/Describe.js:119`). Only `describe().page.held` knows.

Fix: make the page hold an entry on the `freeze` stack (owner `page`) and delete the `page.held` branch in the loop. The timeline and `runState` then become right with no new code. One behaviour to decide: `core/page.js:8` promises that `engine.step()` still advances while away, and `step()` obeys freezes. Either the bridge exempts that owner, or the promise goes.

### V1. `engine.setPixelRatio()` is undone by adaptive resolution; the raw three.js call is not

Confirmed by run. With adaptive on (the default, `core/Engine.js:58`) and cheap frames, `engine.setPixelRatio(1)` was back at 1.5 after 120 simulated seconds.

Why: `core/sceneMethods.js:112` marks the write as the engine's, so the "game took this value" yield never fires. `core/adaptive.js:61` then raises the ratio to `a.max`, and `a.max` is only set at `core/Engine.js:227` and in settings (`modules/settings/apply.js:45`). A direct `renderer.setPixelRatio` stops adaptive at once, so the plain three.js call is respected and the engine's own named entry is not. `core/view.js:18` even recommends `engine.setPixelRatio(1.5)`.

Fix: `engine.setPixelRatio(p)` also sets `adaptive.max = p`, adaptive writes through an internal path, and the `max` write in `apply.js:45` goes.

## Medium

### I1. The press that opens something can also act on it

Confirmed by run. A dialogue started from `onFixed` on a `confirm` press was at `typing: true, shown: 0` after the fixed step. After the frame hooks of the same tick it was at `typing: false, shown: 61` of 61. The opening press had also advanced it.

Why: `h.fresh` compares a frame counter (`ui/Focus.js:42`), and the counter is bumped in the first frame hook (`ui/Focus.js:56-57`). A push from a fixed step gets the old number, and the bump lands before anyone reads `fresh`. So `fresh` only protects pushes made during frame hooks. Gameplay pushes happen in fixed steps.

The same gap reaches the cursor (`ui/cursor.js:65`: a choice list opened by `confirm` presses its first choice, inferred) and the skip check (`Timeline.js:159`). It also depends on frame rate. It only happens when the press and the fixed step land in the same frame, so a 144 Hz screen hides it. With default keys it needs the opening key to be an advance key, such as `advanceActions: ['confirm', 'interact']`.

Fix: bump the counter once at `input.endFrame()`, not in the hook. This also removes O3.

### M1. Physics ignores slow motion

Confirmed by reading. `core/time.js:19` says physics "follows nothing here", and `modules/rigid/RigidBodies.js:425` steps with the plain fixed dt. Characters (`modules/characters/Character.js:358`), walks and swarms all honour channels.

The situation: `engine.mod('time.world', { mul: 0.2 })`. Enemies and bullets crawl while crates and debris fall at full speed. With `set: 0` for a hit-stop, bodies keep flying through it.

Fix: step rapier with `engine.time.dt('world')` and skip the step at 0. That deletes the exception. Physics keeps one world step, and a game wanting real-time physics can say so.

### T2. Freeze does not stop animation or particles, and `{ ambient: true }` promises it does

Confirmed by reading. `core/holds.js:64` says `ambient: true` stops ambient motion for "a photo / cutscene still". It stops only `uTime`. `core/Animator.js:64,233`, `modules/characters/index.js:269` and `modules/particles/Particles.js:164` run on frame dt with no check, so a held still still has moving limbs and sparks. Behind a plain pause menu this may be wanted. With `ambient: true` it contradicts the docs.

Fix: frame dt for those three is 0 while an ambient hold is up, using the existing `ambientHeld` in `core/loop.js`. If nobody needs a true still, delete the option instead.

### V2. Settings pin graphics values that the tier and adaptive own

Confirmed by reading; the effect after a tier change is inferred. Three separate problems, one root:

1. Presets write fixed ratios (`modules/settings/Settings.js:42-44`: 0.75, 1, 1.5). `core/tier.js:15-16` explains that a fixed 1 on a 2x screen is an upscaled, blurry picture. So "medium" on a 2x screen is exactly that case, and "high" on a 1x screen renders 1.5x for nothing.
2. `save()` writes every value (`Settings.js:208`), and values are read once in the constructor (`Settings.js:75`). One volume change pins the pixel ratio for all later launches, even though `core/startup.js:168` may re-detect the tier after that read.
3. `settings.get('pixelRatio')` and the slider stay at the old number while adaptive lowers the real ratio. They disagree with `describe().render.scale`.

Fix: save only what the player changed, as `input.rebound()` already does for keys, and make preset ratios factors of `defaultPixelRatio`.

### W1. `engine.pause()` is the wrong word for what it does

Confirmed by reading. It stops rendering and is for tests. `docs/recipes/07-flow-scenes-pause.md:31` has to say "Don't use `engine.pause()`", while other recipes show it for tests (`12-navmesh.md:31`, `13-animation.md:172`). An AI asked to pause a game reaches for that name first and gets a dead screen with no menu. The ways to stop things now are `engine.pause`, `engine.freeze`, flow `paused`, settings `freezeWorld`, `page.pauseOnBlur`, and a channel at 0.

Fix: rename it to something a game would not pick (`engine.haltLoop`). Which should stay: `freeze` for games, `flow` as the menu shape over it, the halt for tests. After T1, the page hold is just a freeze too.

## Low

| # | Where | The fight | Fix | Status |
|---|---|---|---|---|
| D1 | `core/shadows.js:271`, `core/batchGroups.js` (`B.root.add(im)`) | `shadows.cache(sun, { static: cityRoot })` walks parents, and a batch's InstancedMesh hangs under the batch root, not `cityRoot`: the saving is lost with no message. The function form calls a batch static, and then an instance moved by batching keeps a stale shadow | Test a batch by one of its originals; an instance move calls `redraw()` | Inferred, WebGPU only, not run |
| D2 | `render/occlusion.js:135-140` | Hiding saves the whole layer mask and showing restores it, so a game's `mesh.layers` write while hidden is lost. That breaks hard rule 4 | On show, restore only if the mask is still the hidden layer | Confirmed by reading |
| D3 | `modules/hlod/index.js:83-93` | Three ways to hide a mesh: batching and occlusion use layers, hlod puts an accessor on `visible` plus `userData.rayVisible` and a three.js patch | Hlod moves far originals to the batch layer (not drawn, no shadows, rays hit it). This deletes the `hlod-visible` patch and `rayVisible`. Needs D2 first, because occlusion watches these meshes | Confirmed by reading; a simplification |
| T3 | `core/loop.js:9-11`, `Timeline.js:153-154` | The loop header says cutscene waits belong in fixed; they run on frame dt, so `wait: 2` ignores channels. Probably right for smooth cameras | Correct the header | Confirmed by reading |
| I2 | `Timeline.js:158-159` | The `skip` key is read raw for all runs, so a key typed in a window above a cutscene, or pressed while frozen, skips the cutscene below | Skip only when the run's focus entry, or its own line, is on top | Confirmed by reading |
| O1 | `core/modules.js:6-8`, `modules/camera/common.js:181`, `modules/characters/index.js:269` | Camera rigs are stage `control`, so they run before `characters.frame` carries riders. On a platform moved in a frame hook the camera reads last frame's position | Done another way: the camera rig calls `characters.carryRiders` before its update, and rigs stay in `control` | Order confirmed by reading, effect inferred |
| O2 | `modules/swarm/Swarm.js:296-297` | `_begin` must run before the game's `onFixed`, and that holds only because `swarm()` is installed first. A later `engine.use(swarm())` loses interpolation for the game's own moves | Done: two buffers, `_px` and `_ex`, swapped in `time.onMove`, which has no order to get wrong | Confirmed by reading |
| O3 | `ui/Focus.js:56` | The hook is added on the first `uiFocus()` call, so its place among a game's `onFrame` depends on who called first. A game hook ahead of it sees the old frame | Goes with I1 | Confirmed by reading |
| O4 | `core/Animator.js:64,178` | The animator's update sits in the game's `onFrame` list, so `anim.sync` in an `onFrame` registered later takes effect a frame late | Make it a core step after the `onFrame` list | Inferred |

## Two ways of doing one job

These have no bug behind them. An AI simply has to choose.

- **Placing things**: `scene.add`, `engine.add`, `world.add`, `world.present`, `content.spawn`, `stream.add`, `grids.add`, level files. `docs/CONVENTIONS.md:7` covers `world`; nothing covers them all. Nothing here can be deleted on the evidence. **Keep** `scene.add` / `engine.add` for what code builds each start, and `engine.world` for what must be saved. `content` is the data front of `world`, `level` is a file, and `grids` is cell placement on top. One table in `AI.md` says this; `stream.add` stays low-level and is not offered first.
- **"Tell me when"**: `events.on` is the default and should stay. `onX` methods should stay only where the function runs in a hot loop or has one owner (`swarm.onStep`, `time.onMove`). `calendar.onSeason` is a filter over `season:change` (`modules/calendar/Calendar.js:110`), and `net.onJoin` / `onLeave` sit beside `net:*` events. Both could go; net waits, since the owner said not to touch it.
- **"Grid" and "tier" mean several things**: `sampleGrid` (fields), `engine.grids` (placement), `core/cells.js` (near queries), and the swarm and collision grids; `engine.tier` (device) and the things table's save tier (`core/things.js:140`). No fight, but renaming the save tier internally is cheap.

## Tools that disagree

- `runState` and `describe().time` against `describe().page` on whether the game is running (T1). `threedog status` is described as reporting this, so it should inherit the error (inferred, not run).
- `settings.get('pixelRatio')` against `describe().render.scale` (V2).

`check`, `doctor`, `how` and `inspect` were not compared on live output. A dev server was not started, so this section is a floor, not a full answer.

## Little use

`api-count --unused` today: 7 of 1755 names.

- `adaptive.paused` (the engine reads it, nothing sets it)
- `terrain.readyAt`, `rigid.readyAt`
- `settings.removeSection`
- `lightPool.stats`
- `hud.value`

Delete these before the freeze unless a reason turns up. `engine.stateRefused` is the seventh name in that count and stays: `wait-engine.mjs` reads it for `capture`, which the count does not see.

A word count over `docs/testing/capability` and `docs/testing/field`, plus examples and templates, is crude, but it shows two with no use at all:

- **`net`**: 0 mentions, 0 examples. The owner decided to leave it alone. It should stay out of the frozen API.
- **`engine.threads`**: 0 mentions, 0 examples. The same applies.

`nav` also shows 0, but `characters.findPath` sits on it. `packages/engine/sheepisland.html` carries a past game's name in the engine package; `packages/tools/perf.mjs` still uses it. Rename it to a neutral test page (hard rule 3).

## Must land before the 1.0 freeze

Only these change public names or public meaning:

1. **W1**: rename `engine.pause`.
2. **T1**: the `page.held` and `runState` meaning, and the `step()` promise.
3. **T2**: keep or delete `freeze(owner, { ambient })`.
4. The seven unused names, and marking `net` and `engine.threads` outside the freeze.

Everything else is a behaviour fix and can land after.

## Checked and found clean

Character `control` layers; shadow budget, idle shadows, lightPool and photo redraws; batching against hlod ownership; time views, timers and skip; the input context stack; `cells.js` as the one near query; sky reading fog rather than writing it; rigid against world rebuild order on load; ops undo against editor undo (different jobs, no shared state).

## Not covered

Nothing ran on real WebGPU. Moves that bypass `control` (`placeAt`, `thing.set` on a held character) were not traced. Save-part load order was read only for rigid and world. The editor was read only at its undo. Issues in `2026-11-05-logic.md` and `2026-11-05-design.md` are not repeated here.
