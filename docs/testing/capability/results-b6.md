# Capability test results: batch 6 (world modules)

Run 2026-11-05, branch `test/capability-b6`, about 35 minutes of a 60 minute limit. Rows from `tasks.md` section 4: M01-M10, M14, M15.

**Result: 12 pass, 0 fail, 0 blocked.** Seven passed on the first build. Three (M03, M06, M10) failed on the first build and passed only after a workaround, so they count as pass but each has a real defect behind it, listed below. Two (M02, M05) needed a small correction.

## Renderer
- All rows ran on software rendering: SwiftShader through three's WebGL2 fallback (`requestAdapter() returned no adapter`), because the dev bridge's headless page has no WebGPU here. The games asked for WebGPU.
- Real GPU spot checks with `shot --gpu` (RTX 5060, drawn by WebGPU) for the three picture rows: M03 sky differs by the same amounts as on software (hue +179° and +161°), M05 shows rain streaks, M06 shows the lake. The other rows are script-judged and were not repeated on the GPU.

## Rows
Minutes are wall clock and approximate. The shared entry docs were read once, in M01's time and in the 4 minutes of setup, so a truly fresh start costs more per row.

| Row | Result | Min | T | First build | Note |
|---|---|---|---|---|---|
| M01 | pass | 5 | 10 | ok | Five heights equal after reload, different with another seed; hills visible (gray, as expected with no colors set) |
| M02 | pass | 4 | 12 | one retry | `instanceAt` found a tree; gone after cut, stays gone after save, reload, load. Retry: bridge position argument (cause T3) |
| M03 | pass | 4 | 10 | **failed** | Sky stayed `#949494` at all three times; passed after deleting one scaffold line (cause A). Sky hue then +178°, +162°, -20° |
| M04 | pass | 1 | 8 | ok | Event fired once per day over days 1 to 4; season changed to summer on day 3 |
| M05 | pass | 2 | 10 | ok | Auto mode changed weather twice in 300 s; `state weather=rain` shows streaks and turns auto off. Started with cause A's fix already applied |
| M06 | pass | 6 | 10 | **failed** | Recipe's Reflector stops the page on WebGPU (cause C); passed with a sky environment map and a shiny material. See the warning under the table |
| M07 | pass | 1 | 8 | ok | 300 records; 17 within 20 m, 15 after one move and one delete; ids stable. An unfiltered query counts the scaffold's own `marker-1` prop too, so filter by kind |
| M08 | pass | 1 | 8 | ok | 400 tiles read back with 0 differences; tiles visible in the screenshot, which is what "preview image" was taken to mean |
| M09 | pass | 2 | 8 | ok | Stopped at z = -5.1 (wall face -5.5 plus radius 0.4); pillar never closer than 1.4 m; `lineClear` false, true, false as expected |
| M10 | pass | 4 | 12 | **failed** | With the stack at the origin, one crate stayed above its start height and the ball bounced off nothing and moved 0 crates (cause B). Stack moved to x = 10: all 20 lower and asleep, ball moved 4 |
| M14 | pass | 1 | 12 | ok | Five markers match the file; player spawned at (6, 0, 4); goal trigger fired once. The GLB was generated with gltf-transform, not exported from Blender |
| M15 | pass | 2 | 6 | ok | Zone a entered and left 3 times, the `once` zone 1 time over a scripted walk. First layout missed the zones because W walks diagonally at the start (see "Smaller findings") |

**M06 warning.** The pass line is weaker than the prompt. Reflection is supported: with a blue noon and red dusk sky, the water's hue moved 47°. But "moving water" was not shown: two frames 2 s apart had no difference above the compare thresholds. A likely reason is that the circular lake mesh has only 18 vertices, so vertex waves have nothing to bend. Suggest adding "two frames differ in the water region" to the pass line.

## Root causes, by rows affected

| # | Layer | Cause | Failed first build | Also touched |
|---|---|---|---|---|
| A | tool (scaffold) | `templates/game/picture/index.js` line 13 sets `scene.background`, which silently hides the sky dome, so `sky.keyframes` and every sky setting show nothing in a new game | M03 | M05, M06 (avoided, already known); M01, M02 (gray sky) |
| B | engine | `rigid()` always creates the player capsule (`RigidBodies.js:110`) but moves it only when a player exists (line 330), so a game without a player has an invisible solid body at the origin | M10 | none |
| C | docs | Recipe 44's Reflector example is WebGL only, but new games default to WebGPU, and the recipe neither says so nor gives a WebGPU route | M06 | none |

Cause A is a designed rule (a game's write takes over from the engine) meeting a scaffold that makes that write on the game's behalf. Nothing warned about it: `check`, `errors` and `snap` were all clean. It was found by reading `engine.sky.dome.visible` and then the engine source, which a game-only AI would not have.

## Smaller findings (no row failed)

| # | Layer | Finding | Row |
|---|---|---|---|
| T1 | tool | `status` keeps reporting a fixed page error after `reload`; `errors` says none new, and only restarting the dev server clears it | M06 |
| T2 | tool | `snap` did not return for over 2 minutes on the page whose render threw; stopped by hand | M06 |
| T3 | tool | `op x at=25,45` passes a 2-number array that a `position` argument rejects, and that bad argument then freezes gameplay until reload; `at=25,0,45` works, while `state pos=x,z` takes two numbers | M02 |
| D1 | docs | COMMANDS.md gives `describe player.pos` as the example; that path does not exist (`describe player` works, with `x`, `y`, `z`) | M09 |
| D2 | docs | COMMANDS.md says `skip to=` needs the sky module; it worked with `calendar()` alone | M04 |
| D3 | docs | `moveForward` in a fresh third-person game walks diagonally (about -x, -z) because of the camera's start angle; no doc mentions it, and it cost one layout redo each in M09 and M15 | M09 M15 |
| E1 | engine or tool | Status text shows Chinese labels (`晴`, `默认`) in a game with no language set, next to English docs; not checked whether this follows the machine's locale | all |

## How this run differs from the rules
- One `new-game` per row costs 2 minutes of checks, so two generated games (blank and `--open-world`) were copied and renamed for each row. Each row still started from an untouched copy.
- The rows were run by one agent in sequence, so later rows benefited from earlier ones (M05 and M06 had cause A's fix from the start). Only M03 shows the cost of cause A.
- Engine source was read only to explain causes A and B after they appeared, never to write a row.
- Test games are deleted; none were committed. The engine was not changed.
